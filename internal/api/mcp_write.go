package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
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
	mcpTools = append(append(append(mcpTools, mcpWriteTools...), mcpStructureTools...), mcpDrawingTools...)
}

// noteBullet: a bullet with its id, so an agent can change exactly this one
type noteBullet struct {
	ID      string `json:"id"`
	Level   int    `json:"level"`
	Type    string `json:"type"`
	Text    string `json:"text"`
	Checked bool   `json:"checked,omitempty"`
	// Language: of a code bullet (the editor's id; empty = plain code)
	Language string `json:"language,omitempty"`
}

// mcpBulletTypes: the types an agent may give a bullet
var mcpBulletTypes = map[string]bool{"text": true, "todo": true, "h1": true, "h2": true, "h3": true, "numbered": true, "callout": true, "warning": true, "error": true, "table": true, "code": true, "divider": true, drawing.BlockType: true}

// mcpBulletTypeEnum: the same types for the tool schemas
var mcpBulletTypeEnum = []string{"text", "todo", "h1", "h2", "h3", "numbered", "callout", "warning", "error", "table", "code", "divider", drawing.BlockType}

// errMCPType: an unknown bullet type
var errMCPType = errors.New("'type': text, todo, h1, h2, h3, numbered, callout, warning, error, table, code, divider oder drawing")

// errMCPLanguage: a language for a bullet that is no code bullet
var errMCPLanguage = errors.New("'language' gibt es nur für Code (type code)")

// errMCPMarkdownAlone: markdown together with the fields of a single bullet
var errMCPMarkdownAlone = errors.New("'markdown' ersetzt text, type, language und checked, nur eines davon angeben")

// errMCPMarkdownEmpty: markdown that gave no bullets
var errMCPMarkdownEmpty = errors.New("Aus 'markdown' ist kein Punkt entstanden. Schicke den Inhalt als Markdown-Liste, eine Zeile pro Punkt.")

// errMCPDividerText: text for a divider, which has none
var errMCPDividerText = errors.New("Ein Trennstrich hat keinen Text (mit type einen anderen Typ wählen)")

// errMCPDrawing: the text of a drawing bullet was neither Mermaid nor a drawing model
var errMCPDrawing = errors.New("Für eine Zeichnung erwartet text Mermaid (flowchart/graph, mindmap, sequenceDiagram, stateDiagram oder gitGraph) oder ein MindSift-Zeichnungsmodell (JSON)")

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

// Links to notes come without ids, with the current titles (titles: storage.DocTitles of the user).
func noteBullets(d *collab.Doc, titles map[string]string) []noteBullet {
	out := []noteBullet{}
	for _, b := range d.Flatten() {
		text := storage.ReadableWikiLinks(b.Content, titles)
		if b.Type == drawing.BlockType {
			text = drawing.Describe(b.Content)
		}
		nb := noteBullet{ID: b.ID, Level: b.Level, Type: b.Type, Text: text, Checked: b.Props.Checked}
		if b.Type == "code" {
			nb.Language = b.Props.Lang
		}
		out = append(out, nb)
	}
	return out
}

// mcpCollabActor: the agent as the writer of note changes (its own client id, so editors' leases count)
func (s *Server) mcpCollabActor(userID string, actor *apiActor) collab.Actor {
	a := collab.Actor{UserID: userID, ClientID: collab.MCPHolder}
	if actor != nil && actor.KeyID != "" {
		a.ClientID = collab.MCPKeyHolderPrefix + actor.KeyID
	}
	if u, err := s.store.GetUserByID(userID); err == nil {
		a.Name = u.DisplayName
	}
	return a
}

// applyNoteOps runs bullet operations as the agent and tells open editors and lists about them
func (s *Server) applyNoteOps(userID string, actor *apiActor, docID string, ops []collab.Op) error {
	return s.applyNoteOpsCtx(context.Background(), userID, actor, docID, ops)
}

// applyNoteOpsCtx is applyNoteOps that stops waiting for the note when ctx ends (the client went away)
func (s *Server) applyNoteOpsCtx(ctx context.Context, userID string, actor *apiActor, docID string, ops []collab.Op) error {
	results, _, err := s.store.ApplyDocOpsCtx(ctx, docID, s.mcpCollabActor(userID, actor), ops, s.leases.View(docID))
	if err != nil {
		return err
	}
	for _, res := range results {
		if res.Status == collab.StatusRejected {
			return errors.New("Änderung abgelehnt: " + res.Reason)
		}
	}
	s.afterDocChange(userID, docID, ops, results)
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

// bulletPlace: where a new bullet goes — right after afterID on its level, as the last child of
// parentID, or at the end of the note — as its parent and order key
func bulletPlace(d *collab.Doc, afterID, parentID string) (parent, key string, err error) {
	prev, next := "", ""
	switch {
	case afterID != "":
		after, err := liveBullet(d, afterID)
		if err != nil {
			return "", "", err
		}
		parent, prev = after.ParentID, after.OrderKey
		for _, sib := range d.Children(parent) {
			if sib.OrderKey > after.OrderKey || (sib.OrderKey == after.OrderKey && sib.ID > after.ID) {
				next = sib.OrderKey
				break
			}
		}
	case parentID != "":
		if _, err := liveBullet(d, parentID); err != nil {
			return "", "", err
		}
		parent = parentID
		if kids := d.Children(parent); len(kids) > 0 {
			prev = kids[len(kids)-1].OrderKey
		}
	default:
		if top := d.Children(""); len(top) > 0 {
			prev = top[len(top)-1].OrderKey
		}
	}
	key, err = collab.KeyBetween(prev, next)
	return parent, key, err
}

// addNoteMarkdown inserts a whole outline written as Markdown (read like create_note's content) in one
// change: its first level at the place bulletPlace picks, deeper levels as children below it.
func addNoteMarkdown(ctx context.Context, s *Server, userID string, actor *apiActor, noteID, markdown, afterID, parentID string) (any, error) {
	raw, _ := json.Marshal(markdown)
	content, err := mcpNoteContent(raw)
	if err != nil {
		return nil, err
	}
	blocks := mcpContentBlocks(content)
	if len(blocks) == 0 {
		return nil, errMCPMarkdownEmpty
	}
	d, err := s.noteDoc(noteID)
	if err != nil {
		return nil, err
	}
	anchor, first, err := bulletPlace(d, afterID, parentID)
	if err != nil {
		return nil, err
	}
	// The next sibling after the place, so the new top-level bullets fit between first and it
	next := ""
	for _, sib := range d.Children(anchor) {
		if sib.OrderKey > first {
			next = sib.OrderKey
			break
		}
	}
	parents := storage.TreeFromLevels(len(blocks), func(i int) int { return blocks[i].Level })
	ids := make([]string, len(blocks))
	children := map[int][]int{} // parent index (-1 = the place's parent) → its new children in order
	for i := range blocks {
		ids[i] = domain.NewID("blk")
		children[parents[i]] = append(children[parents[i]], i)
	}
	keys := make([]string, len(blocks))
	for p, idxs := range children {
		var ks []string
		if p < 0 {
			// The first new top-level bullet takes the place bulletPlace picked, the others follow it
			// before the next sibling
			rest, err := collab.KeysBetween(first, next, len(idxs)-1)
			if err != nil {
				return nil, err
			}
			ks = append([]string{first}, rest...)
		} else if ks, err = collab.KeysBetween("", "", len(idxs)); err != nil {
			return nil, err
		}
		for j, i := range idxs {
			keys[i] = ks[j]
		}
	}
	link := s.store.WikiLinker(userID)
	ops := make([]collab.Op, 0, len(blocks))
	for i, b := range blocks {
		parent := anchor
		if parents[i] >= 0 {
			parent = ids[parents[i]]
		}
		text := b.Content
		// [[Titel]] links like in create_note; code and drawings stay as written
		if b.Type != drawing.BlockType && b.Type != "code" {
			text = link(text)
		}
		props := collab.Props{Checked: b.Checked, Lang: b.Lang}
		ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: ids[i], ParentID: &parent, OrderKey: keys[i], Type: b.Type, Content: &text, Props: &props})
	}
	if err := s.applyNoteOpsCtx(ctx, userID, actor, noteID, ops); err != nil {
		return nil, err
	}
	res, err := noteResult(s, userID, noteID)
	if m, ok := res.(map[string]any); ok {
		m["addedIds"] = ids
	}
	return res, err
}

func noteResult(s *Server, userID, docID string) (any, error) {
	d, err := s.noteDoc(docID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": docID, "title": d.Title, "bullets": noteBullets(d, s.store.DocTitles(userID))}, nil
}

// inboxEntry: an open inbox entry as an agent sees it
func inboxView(t domain.Thought) map[string]any {
	v := map[string]any{"id": t.ID, "content": t.Content, "priority": t.Priority, "createdAt": t.CreatedAt}
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
		Schema: schema([]string{"id"}, map[string]any{
			"id":         prop("string", "Note id"),
			"title":      prop("string", "New title, optional; at most 60 characters (a longer existing title may be kept or shortened)"),
			"icon":       prop("string", "One emoji, optional"),
			"folderPath": prop("string", "Folder, e.g. Projekte/MindSift; empty string = top level; leave out to keep it"),
		}),
		run: func(_ context.Context, s *Server, userID string, _ *apiActor, args json.RawMessage) (any, error) {
			var a struct {
				ID         string
				Title      *string
				Icon       *string
				FolderPath *string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.docWritable(userID, a.ID); err != nil {
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
			s.broadcastDocToAuthorizedUsers(a.ID, eventDocUpdated)
			if a.FolderPath != nil {
				s.announceNoteMoved(userID, a.ID)
			}
			return s.toNoteView(d), nil
		},
	},
	{
		Name: "add_note_bullet",
		Description: "Add a bullet to a note: after a bullet (same level), as the last child of a bullet, or at the end. " +
			"Bullet ids come from get_note. type: text (default), todo, h1, h2, h3, numbered, callout, warning, error, table, code, divider, drawing. " +
			"[[Note title]] links another note (|text for an own link text). " +
			"Several bullets at once: markdown instead of text and type, a whole outline in one call (as create_note's content: nested list with a tab or 2+ spaces per level, - [ ] to-dos, ## headings, code fences, tables, ```mermaid); " +
			"its first level goes where a single bullet would, deeper levels below it. Prefer this over one call per bullet. " +
			"Outline: details as children (parentId) rather than \"**Term:** text\"; h2/h3 for sections, with an empty text bullet above a heading that follows other bullets. " +
			"type table: text is a Markdown table (| :---: | centers a column, | ---: | aligns it right, \\| is a | inside a cell). " + mcpCodeStyleShort + mcpCodeHelp + mcpDrawingHelp,
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId"}, map[string]any{
			"noteId":   prop("string", "Note id"),
			"text":     prop("string", "Text of the new bullet (none for a divider)"),
			"markdown": prop("string", "Several bullets as Markdown, nested (instead of text, type, language and checked)"),
			"type":     map[string]any{"type": "string", "enum": mcpBulletTypeEnum},
			"language": prop("string", "For type code: the code's language, e.g. go, python, typescript, bash, sql, json; another name (e.g. pf) is kept as written, without highlighting (optional)"),
			"afterId":  prop("string", "Insert right after this bullet, on its level (optional)"),
			"parentId": prop("string", "Insert as the last child of this bullet (optional; ignored with afterId)"),
			"checked":  map[string]any{"type": "boolean", "description": "For a to-do: already done"},
		}),
		run: func(ctx context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
			var a struct {
				NoteID, Text, Type, Language, AfterID, ParentID, Markdown string
				Checked                                                   bool
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.docWritable(userID, a.NoteID); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Markdown) != "" {
				if a.Text != "" || a.Type != "" || a.Language != "" || a.Checked {
					return nil, errMCPMarkdownAlone
				}
				return addNoteMarkdown(ctx, s, userID, actor, a.NoteID, a.Markdown, a.AfterID, a.ParentID)
			}
			if a.Type == "" {
				a.Type = "text"
			}
			if !mcpBulletTypes[a.Type] {
				return nil, errMCPType
			}
			if strings.TrimSpace(a.Language) != "" && a.Type != "code" {
				return nil, errMCPLanguage
			}
			lang, err := mcpCodeLanguage(a.Language)
			if err != nil {
				return nil, err
			}
			d, err := s.noteDoc(a.NoteID)
			if err != nil {
				return nil, err
			}
			parent, key, err := bulletPlace(d, a.AfterID, a.ParentID)
			if err != nil {
				return nil, err
			}
			id := domain.NewID("blk")
			// [[Titel]] written by the agent points at its note by id where the title is unambiguous
			text := s.store.WikiLinker(userID)(a.Text)
			if a.Type == drawing.BlockType {
				if text, err = mcpDrawingContent(a.Text); err != nil {
					return nil, err
				}
			}
			if a.Type == "table" {
				text = blockfmt.NormalizeTable(text)
			}
			props := collab.Props{Checked: a.Type == "todo" && a.Checked}
			switch a.Type {
			case "code":
				// The code as written, like the editor's code block; the write path puts a placeholder in place
				// of a hidden value (collab.Env.CodeText)
				text, props.Lang = a.Text, lang
			case "divider":
				text = ""
			}
			op := collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &parent, OrderKey: key, Type: a.Type, Content: &text, Props: &props}
			if err := s.applyNoteOpsCtx(ctx, userID, actor, a.NoteID, []collab.Op{op}); err != nil {
				return nil, err
			}
			res, err := noteResult(s, userID, a.NoteID)
			if m, ok := res.(map[string]any); ok {
				m["addedId"] = id
			}
			return res, err
		},
	},
	{
		Name: "add_note_image",
		Description: "Add an image to a note as its own bullet (e.g. a picture you generated or a screenshot), placed like add_note_bullet. " +
			"Give exactly one of data or url. data: the image file as base64 (standard alphabet; a data:image/…;base64, prefix is accepted too). " +
			"url: an https address of an image on the internet; MindSift copies the image into the note (addresses in the server's own network are refused). " +
			"Accepted: JPEG, PNG, GIF, WebP (no SVG), at most " + mcpImageLimitText + " per image (the server's limit for images in notes). " +
			"Returns the note with addedId (the bullet) and mediaId.",
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId"}, map[string]any{
			"noteId":   prop("string", "Note id"),
			"data":     prop("string", "The image as base64, without line breaks (or with a data: prefix); leave out when giving url"),
			"url":      prop("string", "https address of an image to copy into the note; leave out when giving data"),
			"caption":  prop("string", "Caption shown under the image, optional"),
			"afterId":  prop("string", "Insert right after this bullet, on its level (optional)"),
			"parentId": prop("string", "Insert as the last child of this bullet (optional; ignored with afterId)"),
		}),
		run: func(ctx context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
			return s.mcpAddNoteImage(ctx, userID, actor, args)
		},
	},
	{
		Name: "update_note_bullet",
		Description: "Change one bullet of a note: its text, tick or untick a to-do, or its type. Bullet ids come from get_note. " +
			"A drawing is replaced as a whole: text is the new drawing (Mermaid or the JSON model, see drawing_help); type drawing turns a bullet into one. " +
			"type code turns a bullet into a code block (its text becomes the code; language sets or changes the language), type divider into a line (its text goes). " +
			"Code and dividers are written as in add_note_bullet; text that is a command or code to copy is type code, a path, flag or single command inside other text is `inline code`.",
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "bulletId"}, map[string]any{
			"noteId":   prop("string", "Note id"),
			"bulletId": prop("string", "Bullet id"),
			"text":     prop("string", "New text, optional"),
			"checked":  map[string]any{"type": "boolean", "description": "To-do done (true) or open (false), optional"},
			"type":     map[string]any{"type": "string", "enum": mcpBulletTypeEnum},
			"language": prop("string", "Language of a code bullet (type code), e.g. go, python, bash; another name is kept as written, without highlighting; empty = plain code; optional"),
		}),
		run: func(ctx context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
			var a struct {
				NoteID, BulletID string
				Text             *string
				Checked          *bool
				Type             *string
				Language         *string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.docWritable(userID, a.NoteID); err != nil {
				return nil, err
			}
			if a.Type != nil && !mcpBulletTypes[*a.Type] {
				return nil, errMCPType
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
			target := b.Type
			if a.Type != nil {
				target = *a.Type
			}
			// The language belongs to code; a table keeps its line mode there, which code would misread
			var lang *string
			switch {
			case a.Language != nil && target != "code":
				return nil, errMCPLanguage
			case a.Language != nil:
				l, err := mcpCodeLanguage(*a.Language)
				if err != nil {
					return nil, err
				}
				lang = &l
			case target != b.Type && (target == "table" || b.Type == "table"):
				l := ""
				lang = &l
			}
			// A divider has no text: a bullet that becomes one loses it
			if target == "divider" {
				if b.Type == "divider" && a.Text != nil && *a.Text != "" {
					return nil, errMCPDividerText
				}
				empty := ""
				a.Text = &empty
			}
			if err := s.bulletFree(a.NoteID, b.ID); err != nil {
				return nil, err
			}
			// Code is kept as written ([[…]] is no link there), like the editor's code block
			if a.Text != nil && b.Type != drawing.BlockType && !toDrawing && target != "code" && target != "divider" {
				text := s.store.WikiLinker(userID)(storage.KeepWikiLinkIDs(b.Content, *a.Text, s.store.DocTitles(userID)))
				a.Text = &text
			}
			// A table's text is written the way the editor writes it (also when a bullet becomes one)
			if toTable := a.Type != nil && *a.Type == "table"; toTable || (a.Type == nil && b.Type == "table") {
				text := b.Content
				if a.Text != nil {
					text = *a.Text
				}
				if text = blockfmt.NormalizeTable(text); text != b.Content || a.Text != nil {
					a.Text = &text
				}
			}
			var ops []collab.Op
			if a.Text != nil && *a.Text != b.Content {
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: b.ID, BaseVersion: b.Version, Content: a.Text})
			}
			if lang != nil && *lang == b.Props.Lang {
				lang = nil
			}
			if a.Checked != nil || a.Type != nil || lang != nil {
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: b.ID, Patch: &collab.PropsPatch{Checked: a.Checked, Type: a.Type, Lang: lang}})
			}
			if len(ops) == 0 {
				return noteResult(s, userID, a.NoteID)
			}
			if err := s.applyNoteOpsCtx(ctx, userID, actor, a.NoteID, ops); err != nil {
				return nil, err
			}
			return noteResult(s, userID, a.NoteID)
		},
	},
	{
		Name:        "delete_note_bullet",
		Description: "Remove one bullet of a note together with the bullets below it. Bullet ids come from get_note.",
		Scope:       storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "bulletId"}, map[string]any{
			"noteId":   prop("string", "Note id"),
			"bulletId": prop("string", "Bullet id"),
		}),
		run: func(ctx context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
			var a struct{ NoteID, BulletID string }
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.docWritable(userID, a.NoteID); err != nil {
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
			if err := s.applyNoteOpsCtx(ctx, userID, actor, a.NoteID, []collab.Op{op}); err != nil {
				return nil, err
			}
			return noteResult(s, userID, a.NoteID)
		},
	},
	{
		Name:        "delete_note",
		Description: "Move one of the user's own notes into the trash (it can be restored there).",
		Scope:       storage.ScopeNotesWrite,
		Schema:      schema([]string{"id"}, map[string]any{"id": prop("string", "Note id")}),
		run: func(_ context.Context, s *Server, userID string, _ *apiActor, args json.RawMessage) (any, error) {
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
			s.dropLostNoteRooms(a.ID)
			for _, uid := range audience {
				s.wsHub.BroadcastToUser(uid, eventDocDeleted, map[string]string{"id": a.ID})
			}
			return map[string]any{"id": a.ID, "trashed": true}, nil
		},
	},
	{
		Name:        "list_inbox",
		Description: "Open entries of the user's inbox (thoughts waiting for triage), newest first; optionally only those containing a text.",
		Scope:       storage.ScopeInboxRead,
		Schema: schema(nil, map[string]any{
			"query": prop("string", "Only entries containing this text (case-insensitive), optional"),
			"limit": map[string]any{"type": "integer", "description": "Maximum number (default 50)"},
		}),
		run: func(_ context.Context, s *Server, userID string, _ *apiActor, args json.RawMessage) (any, error) {
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
			out := []map[string]any{}
			for _, t := range thoughts {
				if q != "" && !strings.Contains(strings.ToLower(t.Content), q) {
					continue
				}
				out = append(out, inboxView(t))
				if len(out) == a.Limit {
					break
				}
			}
			return map[string]any{"items": out}, nil
		},
	},
	{
		Name: "convert_inbox_item",
		Description: "Triage an inbox entry: turn it into a task (optionally in a task list), a note, or an item of a shopping/check list. " +
			"Ids come from list_inbox, list_task_lists and list_lists.",
		Scope: storage.ScopeInboxWrite,
		Schema: schema([]string{"id", "to"}, map[string]any{
			"id":         prop("string", "Inbox entry id"),
			"to":         map[string]any{"type": "string", "enum": []string{"task", "note", "list_item"}},
			"taskListId": prop("string", "For a task: the task list (empty = personal tasks)"),
			"listId":     prop("string", "For a list item: the list (required)"),
			"dueDate":    prop("string", "For a task: YYYY-MM-DD or YYYY-MM-DDTHH:MM, optional"),
		}),
		run: func(_ context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
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
			s.afterTriage(userID, updated, convertTo, a.ListID)
			out := map[string]any{"id": updated.ID, "status": fmt.Sprint(updated.Status), "convertedType": updated.ConvertedType}
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
		Schema:      schema([]string{"id"}, map[string]any{"id": prop("string", "Inbox entry id")}),
		run: func(_ context.Context, s *Server, userID string, _ *apiActor, args json.RawMessage) (any, error) {
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
			s.wsHub.BroadcastToUsers(s.taskAudience(updated), eventTaskUpdated, updated)
			return map[string]any{"id": updated.ID, "status": fmt.Sprint(updated.Status)}, nil
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
