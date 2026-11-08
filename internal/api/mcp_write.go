package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// MCP tools that change existing notes and work on the inbox. Bullets
// change through the same operations as the editor (internal/collab), so whoever has the note open sees
// the change live and nothing overwrites parallel typing; a bullet someone is editing right now is left
// alone. Deleting a note puts it into the trash. Inbox entries are converted or discarded like in the
// triage; discarded ones can be restored from the triage trash.

func init() {
	mcpTools = append(mcpTools, mcpWriteTools...)
}

// noteBullet: a bullet with its id, so an agent can change exactly this one
type noteBullet struct {
	ID      string `json:"id"`
	Level   int    `json:"level"`
	Type    string `json:"type"`
	Text    string `json:"text"`
	Checked bool   `json:"checked,omitempty"`
}

// mcpBulletTypes: the types an agent may give a bullet
var mcpBulletTypes = map[string]bool{"text": true, "todo": true, "h1": true, "h2": true, "h3": true, "numbered": true, "callout": true, "warning": true, "error": true, drawing.BlockType: true}

// errMCPDrawing: the text of a drawing bullet was neither Mermaid nor a drawing model
var errMCPDrawing = errors.New("Für eine Zeichnung erwartet text Mermaid (flowchart/graph oder mindmap) oder ein MindSift-Zeichnungsmodell (JSON)")

// mcpDrawingContent reads what an agent sends for a drawing: Mermaid, laid out by the server, or the
// drawing model itself (as get_note's bullets never show it, mostly written by the agent from the docs)
func mcpDrawingContent(text string) (string, error) {
	if drawing.IsMermaid(text) {
		return drawing.FromMermaid(text)
	}
	text = strings.TrimSpace(text)
	if _, ok := drawing.Parse(text); ok && len(text) <= 100_000 {
		return text, nil
	}
	return "", errMCPDrawing
}

// mcpDrawingHelp: how drawings are written, for the tool descriptions
const mcpDrawingHelp = "type drawing: text is either a Mermaid diagram, laid out automatically — flowchart/graph TD|LR|BT|RL with " +
	"A[box], B(rounded), C{decision}, D((circle)), arrows -->, --- (no head), -.-> (dashed), ==> (bold), <-->, labels -->|yes|, chains A --> B --> C, " +
	"colours via style A fill:#9f9 or classDef ok fill:green + class A ok; or a mindmap (one node per line, children indented, first line the root) — " +
	"or a MindSift drawing model as JSON {\"v\":1,\"els\":[…]}: shapes {\"id\",\"t\":\"rect|ellipse|diamond\",\"x\",\"y\",\"w\",\"h\",\"txt\",\"s\":stroke,\"f\":fill or \"none\",\"sw\":2,\"r\":true for round corners}, " +
	"text {\"id\",\"t\":\"text\",\"x\",\"y\",\"txt\",\"s\"}, arrows {\"id\",\"t\":\"arrow\",\"from\":shapeId,\"to\":shapeId,\"a\":[x,y],\"b\":[x,y],\"route\":\"straight|curve|elbow\",\"head\":0 none|1 start|2 end|3 both,\"txt\":label,\"s\",\"sw\":2}; " +
	"colours are main, muted, accent, red, orange, green, blue, purple (they follow the user's theme). Prefer Mermaid."

// noteDoc loads the live block tree of a note
func (s *Server) noteDoc(docID string) (*collab.Doc, error) {
	snap, err := s.store.GetDocSnapshot(docID)
	if err != nil {
		return nil, errors.New("Notiz nicht gefunden")
	}
	d := collab.NewDoc()
	d.Title, d.TitleVersion = snap.Title, snap.TitleVersion
	for i := range snap.Blocks {
		b := snap.Blocks[i]
		d.Blocks[b.ID] = &b
	}
	return d, nil
}

func noteBullets(d *collab.Doc) []noteBullet {
	out := []noteBullet{}
	for _, b := range d.Flatten() {
		text := b.Content
		if b.Type == drawing.BlockType {
			text = drawing.Describe(b.Content)
		}
		out = append(out, noteBullet{ID: b.ID, Level: b.Level, Type: b.Type, Text: text, Checked: b.Props.Checked})
	}
	return out
}

// editableNote checks that the user may change the note (own or shared for editing, not in the trash)
func (s *Server) editableNote(userID, docID string) error {
	role := s.store.DocRole(userID, docID)
	if role == "" {
		return errors.New("Notiz nicht gefunden")
	}
	if !storage.CanEditDoc(role) {
		return errors.New("Keine Schreibrechte für diese Notiz (nur Lesen oder im Papierkorb)")
	}
	return nil
}

// applyNoteOps runs bullet operations as the agent and tells open editors and lists about them
func (s *Server) applyNoteOps(userID string, actor *apiActor, docID string, ops []collab.Op) error {
	a := collab.Actor{UserID: userID, ClientID: "mcp"}
	if actor != nil && actor.KeyID != "" {
		a.ClientID = "mcp-" + actor.KeyID
	}
	if u, err := s.store.GetUserByID(userID); err == nil {
		a.Name = u.DisplayName
	}
	results, _, err := s.store.ApplyDocOps(docID, a, ops, s.leases.View(docID))
	if err != nil {
		return err
	}
	for _, res := range results {
		if res.Status == collab.StatusRejected {
			return errors.New("Änderung abgelehnt: " + res.Reason)
		}
	}
	s.afterDocChange(docID, ops, results)
	_, head, _ := s.store.GetDocOpsSince(docID, 0, 0)
	s.notifyDocChanged(docID, head)
	return nil
}

// bulletFree refuses a bullet that someone is editing right now (their editor would get a conflict copy)
func (s *Server) bulletFree(docID, bulletID string) error {
	if _, held := s.leases.View(docID).HolderOf(bulletID); held {
		return errors.New("Dieser Punkt wird gerade bearbeitet; später noch einmal versuchen")
	}
	return nil
}

func liveBullet(d *collab.Doc, id string) (*collab.Block, error) {
	b, ok := d.Blocks[id]
	if !ok || b.Deleted {
		return nil, errors.New("Punkt nicht gefunden (Ids liefert get_note)")
	}
	return b, nil
}

func noteResult(s *Server, docID string) (interface{}, error) {
	d, err := s.noteDoc(docID)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"id": docID, "title": d.Title, "bullets": noteBullets(d)}, nil
}

// inboxEntry: an open inbox entry as an agent sees it
func inboxView(t domain.Thought) map[string]interface{} {
	v := map[string]interface{}{"id": t.ID, "content": t.Content, "priority": t.Priority, "createdAt": t.CreatedAt}
	if t.DueDate != "" {
		v["dueDate"] = t.DueDate
	}
	if len(t.Tags) > 0 {
		v["tags"] = t.Tags
	}
	return v
}

var mcpWriteTools = []mcpTool{
	{
		Name:        "update_note",
		Description: "Rename a note, change its icon or move it into another folder.",
		Scope:       storage.ScopeNotesWrite,
		Schema: schema([]string{"id"}, map[string]interface{}{
			"id":         prop("string", "Note id"),
			"title":      prop("string", "New title, optional"),
			"icon":       prop("string", "One emoji, optional"),
			"folderPath": prop("string", "Folder, e.g. Projekte/MindSift; empty string = top level; leave out to keep it"),
		}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ID         string
				Title      *string
				Icon       *string
				FolderPath *string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.editableNote(userID, a.ID); err != nil {
				return nil, err
			}
			if a.Title != nil && strings.TrimSpace(*a.Title) == "" {
				return nil, errors.New("'title' darf nicht leer sein")
			}
			if a.Icon != nil {
				if err := checkMCPIcon(*a.Icon); err != nil {
					return nil, err
				}
			}
			if a.FolderPath != nil {
				folder := strings.Trim(strings.TrimSpace(*a.FolderPath), "/")
				if err := s.store.CheckCreateInFolder(userID, folder); err != nil {
					return nil, err
				}
				a.FolderPath = &folder
			}
			d, err := s.store.UpdateDocument(userID, a.ID, a.Title, a.Icon, a.FolderPath, nil)
			if err != nil {
				return nil, err
			}
			if a.Title != nil {
				_, head, _ := s.store.GetDocOpsSince(a.ID, 0, 0)
				s.notifyDocChanged(a.ID, head)
			}
			s.broadcastDocToAuthorizedUsers(a.ID, "DOC_UPDATED")
			return s.toNoteView(d), nil
		},
	},
	{
		Name: "add_note_bullet",
		Description: "Add a bullet to a note: after a bullet (same level), as the last child of a bullet, or at the end. " +
			"Bullet ids come from get_note. type: text (default), todo, h1, h2, h3, numbered, callout, warning, error, drawing. " + mcpDrawingHelp,
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "text"}, map[string]interface{}{
			"noteId":   prop("string", "Note id"),
			"text":     prop("string", "Text of the new bullet"),
			"type":     map[string]interface{}{"type": "string", "enum": []string{"text", "todo", "h1", "h2", "h3", "numbered", "callout", "warning", "error", "drawing"}},
			"afterId":  prop("string", "Insert right after this bullet, on its level (optional)"),
			"parentId": prop("string", "Insert as the last child of this bullet (optional; ignored with afterId)"),
			"checked":  map[string]interface{}{"type": "boolean", "description": "For a to-do: already done"},
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				NoteID, Text, Type, AfterID, ParentID string
				Checked                               bool
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.editableNote(userID, a.NoteID); err != nil {
				return nil, err
			}
			if a.Type == "" {
				a.Type = "text"
			}
			if !mcpBulletTypes[a.Type] {
				return nil, errors.New("'type': text, todo, h1, h2, h3, numbered, callout, warning, error oder drawing")
			}
			d, err := s.noteDoc(a.NoteID)
			if err != nil {
				return nil, err
			}
			parent, prev, next := "", "", ""
			switch {
			case a.AfterID != "":
				after, err := liveBullet(d, a.AfterID)
				if err != nil {
					return nil, err
				}
				parent, prev = after.ParentID, after.OrderKey
				for _, sib := range d.Children(parent) {
					if sib.OrderKey > after.OrderKey || (sib.OrderKey == after.OrderKey && sib.ID > after.ID) {
						next = sib.OrderKey
						break
					}
				}
			case a.ParentID != "":
				if _, err := liveBullet(d, a.ParentID); err != nil {
					return nil, err
				}
				parent = a.ParentID
				if kids := d.Children(parent); len(kids) > 0 {
					prev = kids[len(kids)-1].OrderKey
				}
			default:
				if top := d.Children(""); len(top) > 0 {
					prev = top[len(top)-1].OrderKey
				}
			}
			key, err := collab.KeyBetween(prev, next)
			if err != nil {
				return nil, err
			}
			id := domain.NewID("blk")
			text := a.Text
			if a.Type == drawing.BlockType {
				if text, err = mcpDrawingContent(a.Text); err != nil {
					return nil, err
				}
			}
			props := collab.Props{Checked: a.Type == "todo" && a.Checked}
			op := collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &parent, OrderKey: key, Type: a.Type, Content: &text, Props: &props}
			if err := s.applyNoteOps(userID, actor, a.NoteID, []collab.Op{op}); err != nil {
				return nil, err
			}
			res, err := noteResult(s, a.NoteID)
			if m, ok := res.(map[string]interface{}); ok {
				m["addedId"] = id
			}
			return res, err
		},
	},
	{
		Name: "update_note_bullet",
		Description: "Change one bullet of a note: its text, tick or untick a to-do, or its type. Bullet ids come from get_note. " +
			"A drawing is replaced as a whole: text is the new drawing (Mermaid or the model, see add_note_bullet); type drawing turns a bullet into one.",
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "bulletId"}, map[string]interface{}{
			"noteId":   prop("string", "Note id"),
			"bulletId": prop("string", "Bullet id"),
			"text":     prop("string", "New text, optional"),
			"checked":  map[string]interface{}{"type": "boolean", "description": "To-do done (true) or open (false), optional"},
			"type":     map[string]interface{}{"type": "string", "enum": []string{"text", "todo", "h1", "h2", "h3", "numbered", "callout", "warning", "error", "drawing"}},
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				NoteID, BulletID string
				Text             *string
				Checked          *bool
				Type             *string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.editableNote(userID, a.NoteID); err != nil {
				return nil, err
			}
			if a.Type != nil && !mcpBulletTypes[*a.Type] {
				return nil, errors.New("'type': text, todo, h1, h2, h3, numbered, callout, warning, error oder drawing")
			}
			d, err := s.noteDoc(a.NoteID)
			if err != nil {
				return nil, err
			}
			b, err := liveBullet(d, a.BulletID)
			if err != nil {
				return nil, err
			}
			// Drawings are replaced as a whole and stay drawings; a bullet becomes one only with its drawing
			toDrawing := a.Type != nil && *a.Type == drawing.BlockType
			if b.Type == drawing.BlockType && a.Type != nil && !toDrawing {
				return nil, errors.New("Dieser Punkt ist eine Zeichnung und bleibt eine (ersetzen mit text, entfernen mit delete_note_bullet)")
			}
			if b.Type == drawing.BlockType || toDrawing {
				if a.Text == nil {
					if b.Type != drawing.BlockType {
						return nil, errMCPDrawing
					}
				} else {
					content, err := mcpDrawingContent(*a.Text)
					if err != nil {
						return nil, err
					}
					a.Text = &content
				}
			}
			if err := s.bulletFree(a.NoteID, b.ID); err != nil {
				return nil, err
			}
			var ops []collab.Op
			if a.Text != nil && *a.Text != b.Content {
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: b.ID, BaseVersion: b.Version, Content: a.Text})
			}
			if a.Checked != nil || a.Type != nil {
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: b.ID, Patch: &collab.PropsPatch{Checked: a.Checked, Type: a.Type}})
			}
			if len(ops) == 0 {
				return noteResult(s, a.NoteID)
			}
			if err := s.applyNoteOps(userID, actor, a.NoteID, ops); err != nil {
				return nil, err
			}
			return noteResult(s, a.NoteID)
		},
	},
	{
		Name:        "delete_note_bullet",
		Description: "Remove one bullet of a note together with the bullets below it. Bullet ids come from get_note.",
		Scope:       storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "bulletId"}, map[string]interface{}{
			"noteId":   prop("string", "Note id"),
			"bulletId": prop("string", "Bullet id"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct{ NoteID, BulletID string }
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.editableNote(userID, a.NoteID); err != nil {
				return nil, err
			}
			d, err := s.noteDoc(a.NoteID)
			if err != nil {
				return nil, err
			}
			b, err := liveBullet(d, a.BulletID)
			if err != nil {
				return nil, err
			}
			if err := s.bulletFree(a.NoteID, b.ID); err != nil {
				return nil, err
			}
			op := collab.Op{OpID: domain.NewID("op"), Kind: collab.OpDelete, BlockID: b.ID}
			if err := s.applyNoteOps(userID, actor, a.NoteID, []collab.Op{op}); err != nil {
				return nil, err
			}
			return noteResult(s, a.NoteID)
		},
	},
	{
		Name:        "delete_note",
		Description: "Move one of the user's own notes into the trash (it can be restored there).",
		Scope:       storage.ScopeNotesWrite,
		Schema:      schema([]string{"id"}, map[string]interface{}{"id": prop("string", "Note id")}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct{ ID string }
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			d, err := s.store.GetDocumentByID(userID, a.ID)
			if err != nil || d == nil {
				return nil, errors.New("Notiz nicht gefunden")
			}
			// DeleteDocument would leave a shared note or delete a trashed one for good: neither here
			if !d.IsOwner {
				return nil, errors.New("Nur eigene Notizen lassen sich löschen")
			}
			if d.IsArchived {
				return nil, errors.New("Die Notiz liegt schon im Papierkorb")
			}
			audience, _ := s.store.GetAuthorizedDocUsers(a.ID)
			if err := s.store.DeleteDocument(userID, a.ID); err != nil {
				return nil, err
			}
			for _, uid := range audience {
				s.wsHub.BroadcastToUser(uid, "DOC_DELETED", map[string]string{"id": a.ID})
			}
			return map[string]interface{}{"id": a.ID, "trashed": true}, nil
		},
	},
	{
		Name:        "list_inbox",
		Description: "Open entries of the user's inbox (thoughts waiting for triage), newest first; optionally only those containing a text.",
		Scope:       storage.ScopeInboxRead,
		Schema: schema(nil, map[string]interface{}{
			"query": prop("string", "Only entries containing this text (case-insensitive), optional"),
			"limit": map[string]interface{}{"type": "integer", "description": "Maximum number (default 50)"},
		}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Query string
				Limit int
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if a.Limit <= 0 || a.Limit > 100 {
				a.Limit = 50
			}
			thoughts, err := s.store.GetThoughts(userID, "inbox", 100)
			if err != nil {
				return nil, err
			}
			q := strings.ToLower(strings.TrimSpace(a.Query))
			out := []map[string]interface{}{}
			for _, t := range thoughts {
				if q != "" && !strings.Contains(strings.ToLower(t.Content), q) {
					continue
				}
				out = append(out, inboxView(t))
				if len(out) == a.Limit {
					break
				}
			}
			return map[string]interface{}{"items": out}, nil
		},
	},
	{
		Name: "convert_inbox_item",
		Description: "Triage an inbox entry: turn it into a task (optionally in a task list), a note, or an item of a shopping/check list. " +
			"Ids come from list_inbox, list_task_lists and list_lists.",
		Scope: storage.ScopeInboxWrite,
		Schema: schema([]string{"id", "to"}, map[string]interface{}{
			"id":         prop("string", "Inbox entry id"),
			"to":         map[string]interface{}{"type": "string", "enum": []string{"task", "note", "list_item"}},
			"taskListId": prop("string", "For a task: the task list (empty = personal tasks)"),
			"listId":     prop("string", "For a list item: the list (required)"),
			"dueDate":    prop("string", "For a task: YYYY-MM-DD or YYYY-MM-DDTHH:MM, optional"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ID, To, TaskListID, ListID, DueDate string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			convertTo := map[string]string{"task": "task", "note": "document", "list_item": "list_item"}[a.To]
			if convertTo == "" {
				return nil, errors.New("'to': task, note oder list_item")
			}
			if convertTo == "list_item" && a.ListID == "" {
				return nil, errors.New("'listId' fehlt (Ids liefert list_lists)")
			}
			if err := s.inboxEntry(userID, a.ID); err != nil {
				return nil, err
			}
			updated, err := s.store.UpdateThoughtTriage(userID, a.ID, "keep", convertTo, a.ListID, a.DueDate, a.TaskListID)
			if err != nil {
				return nil, err
			}
			if convertTo == "list_item" {
				if lst, err := s.store.GetListByID(userID, a.ListID); err == nil && lst != nil {
					s.wsHub.BroadcastListEvent(lst.ID, "LIST_UPDATED", lst)
				}
			}
			if convertTo == "document" && updated.ConvertedRefID != "" {
				s.broadcastDocToAuthorizedUsers(updated.ConvertedRefID, "DOC_CREATED")
			}
			s.wsHub.BroadcastToUsers(s.taskAudience(updated), "TASK_UPDATED", updated)
			out := map[string]interface{}{"id": updated.ID, "status": fmt.Sprint(updated.Status), "convertedType": updated.ConvertedType}
			if updated.ConvertedRefID != "" {
				out["refId"] = updated.ConvertedRefID
			}
			return out, nil
		},
	},
	{
		Name:        "discard_inbox_item",
		Description: "Discard an inbox entry. It goes to the triage trash, where the user can restore it.",
		Scope:       storage.ScopeInboxWrite,
		Schema:      schema([]string{"id"}, map[string]interface{}{"id": prop("string", "Inbox entry id")}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct{ ID string }
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.inboxEntry(userID, a.ID); err != nil {
				return nil, err
			}
			updated, err := s.store.UpdateThoughtTriage(userID, a.ID, "discard", "", "", "", "")
			if err != nil {
				return nil, err
			}
			s.wsHub.BroadcastToUsers(s.taskAudience(updated), "TASK_UPDATED", updated)
			return map[string]interface{}{"id": updated.ID, "status": fmt.Sprint(updated.Status)}, nil
		},
	},
}

// inboxEntry makes sure the id is an open inbox entry of the user: the inbox rights must not reach tasks
func (s *Server) inboxEntry(userID, id string) error {
	t, err := s.store.GetThoughtByID(userID, id)
	if err != nil || t == nil || t.UserID != userID || t.Status != domain.StatusInbox {
		return errors.New("Kein offener Inbox-Eintrag mit dieser Id (Ids liefert list_inbox)")
	}
	return nil
}
