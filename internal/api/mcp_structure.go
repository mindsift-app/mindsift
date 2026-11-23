package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// MCP tools that change the structure of a note like the editor does: move a bullet with its children
// (drag and drop, Alt+Shift+arrows, Tab and Shift+Tab) and turn a bullet into a note of its own (/extract).
// They go through the editor's operations (applyNoteOpsCtx) as well, so open editors follow live and a
// bullet someone is editing stays put.

// mcpUnit: a bullet with the conflict copies right below it on its level, which move with it in the
// editor (outlineList.ts branchEnd)
func mcpUnit(siblings []*collab.Block, i int) []*collab.Block {
	unit := []*collab.Block{siblings[i]}
	for j := i + 1; j < len(siblings); j++ {
		s := siblings[j]
		if s.Props.ConflictOf == "" || (s.Props.ConflictOf != unit[0].ID && s.Props.ConflictOf != unit[len(unit)-1].Props.ConflictOf) {
			break
		}
		unit = append(unit, s)
	}
	return unit
}

// mcpUnits splits siblings into units (a bullet with its conflict copies)
func mcpUnits(siblings []*collab.Block) [][]*collab.Block {
	var out [][]*collab.Block
	for i := 0; i < len(siblings); {
		u := mcpUnit(siblings, i)
		out = append(out, u)
		i += len(u)
	}
	return out
}

// mcpUnitIndex: the unit of id among units (-1 if none holds it)
func mcpUnitIndex(units [][]*collab.Block, id string) int {
	for i, u := range units {
		for _, b := range u {
			if b.ID == id {
				return i
			}
		}
	}
	return -1
}

// mcpKeys: n order keys in a row between prev and next ("" = open end)
func mcpKeys(prev, next string, n int) ([]string, error) {
	keys := make([]string, 0, n)
	for range n {
		k, err := collab.KeyBetween(prev, next)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
		prev = k
	}
	return keys, nil
}

// errMCPIntoItself: a bullet cannot go below or next to itself or its own children
var errMCPIntoItself = errors.New("Ein Punkt lässt sich nicht in seine eigenen Unterpunkte oder neben sich selbst verschieben")

// mcpMove: where move_note_bullet puts the bullet
type mcpMove struct {
	AfterID, BeforeID string
	ParentID          *string
	Step              string
}

// mcpMoveOps builds the operations that move the bullet b (with its children and conflict copies) as m
// says, under the editor's rules: never into its own branch; indent only below the bullet above it on
// its level, outdent only from below a parent — then, as with Shift+Tab, the bullets that followed it
// there become its children.
func mcpMoveOps(d *collab.Doc, b *collab.Block, m mcpMove) ([]collab.Op, error) {
	given := 0
	for _, set := range []bool{m.AfterID != "", m.BeforeID != "", m.ParentID != nil, m.Step != ""} {
		if set {
			given++
		}
	}
	if given != 1 {
		return nil, errors.New("Genau eins angeben: afterId, beforeId, parentId oder step")
	}
	siblings := d.Children(b.ParentID)
	units := mcpUnits(siblings)
	at := mcpUnitIndex(units, b.ID)
	unit := units[at]
	if unit[0].ID != b.ID {
		// b is a conflict copy below its original: it moves on its own
		unit = []*collab.Block{b}
	}
	moving := map[string]bool{}
	for _, u := range unit {
		moving[u.ID] = true
	}
	// inBranch: id is one of the moving bullets or below one of them
	inBranch := func(id string) bool {
		for seen := 0; id != "" && seen < len(d.Blocks); seen++ {
			if moving[id] {
				return true
			}
			p, ok := d.Blocks[id]
			if !ok {
				return false
			}
			id = p.ParentID
		}
		return false
	}
	target := func(id string) (*collab.Block, error) {
		t, err := liveBullet(d, id)
		if err != nil {
			return nil, err
		}
		if inBranch(id) {
			return nil, errMCPIntoItself
		}
		return t, nil
	}
	// The siblings at the destination without the moving bullets
	others := func(parent string) [][]*collab.Block {
		var rest []*collab.Block
		for _, s := range d.Children(parent) {
			if !moving[s.ID] {
				rest = append(rest, s)
			}
		}
		return mcpUnits(rest)
	}
	// after: right below the unit of x; before: right above it
	after := func(x *collab.Block) (string, string, string) {
		us := others(x.ParentID)
		i := mcpUnitIndex(us, x.ID)
		prev, next := us[i][len(us[i])-1].OrderKey, ""
		if i+1 < len(us) {
			next = us[i+1][0].OrderKey
		}
		return x.ParentID, prev, next
	}
	before := func(x *collab.Block) (string, string, string) {
		us := others(x.ParentID)
		i := mcpUnitIndex(us, x.ID)
		prev := ""
		if i > 0 {
			prev = us[i-1][len(us[i-1])-1].OrderKey
		}
		return x.ParentID, prev, us[i][0].OrderKey
	}
	lastChild := func(parent string) (string, string, string) {
		prev := ""
		if kids := others(parent); len(kids) > 0 {
			last := kids[len(kids)-1]
			prev = last[len(last)-1].OrderKey
		}
		return parent, prev, ""
	}

	var parent, prev, next string
	var followers []*collab.Block
	switch {
	case m.AfterID != "":
		x, err := target(m.AfterID)
		if err != nil {
			return nil, err
		}
		parent, prev, next = after(x)
	case m.BeforeID != "":
		x, err := target(m.BeforeID)
		if err != nil {
			return nil, err
		}
		parent, prev, next = before(x)
	case m.ParentID != nil:
		if p := strings.TrimSpace(*m.ParentID); p != "" {
			if _, err := target(p); err != nil {
				return nil, err
			}
			parent, prev, next = lastChild(p)
		} else {
			parent, prev, next = lastChild("")
		}
	case m.Step == "up":
		if at == 0 || unit[0].ID != units[at][0].ID {
			return nil, errors.New("Der Punkt steht schon als erster auf seiner Ebene")
		}
		parent, prev, next = before(units[at-1][0])
	case m.Step == "down":
		if at == len(units)-1 {
			return nil, errors.New("Der Punkt steht schon als letzter auf seiner Ebene")
		}
		parent, prev, next = after(units[at+1][0])
	case m.Step == "indent":
		if at == 0 || unit[0].ID != units[at][0].ID {
			return nil, errors.New("Einrücken geht nur unter einen Punkt, der auf derselben Ebene darüber steht")
		}
		parent, prev, next = lastChild(units[at-1][0].ID)
	case m.Step == "outdent":
		if b.ParentID == "" {
			return nil, errors.New("Der Punkt steht schon auf der obersten Ebene")
		}
		up, ok := d.Blocks[b.ParentID]
		if !ok {
			return nil, errMCPIntoItself
		}
		parent, prev, next = after(up)
		// Like Shift+Tab: the bullets below it under the old parent become its children
		for _, u := range units[at+1:] {
			followers = append(followers, u...)
		}
	default:
		return nil, errors.New("'step': up, down, indent oder outdent")
	}
	keys, err := mcpKeys(prev, next, len(unit))
	if err != nil {
		return nil, err
	}
	var ops []collab.Op
	for i, u := range unit {
		p := parent
		ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpMove, BlockID: u.ID, ParentID: &p, OrderKey: keys[i]})
	}
	if len(followers) > 0 {
		last := ""
		if kids := d.Children(b.ID); len(kids) > 0 {
			last = kids[len(kids)-1].OrderKey
		}
		fkeys, err := mcpKeys(last, "", len(followers))
		if err != nil {
			return nil, err
		}
		for i, f := range followers {
			p := b.ID
			ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpMove, BlockID: f.ID, ParentID: &p, OrderKey: fkeys[i]})
		}
	}
	return ops, nil
}

var mcpStructureTools = []mcpTool{
	{
		Name: "move_note_bullet",
		Description: "Move a bullet of a note together with the bullets below it, within the same note. Bullet ids come from get_note. " +
			"Give exactly one of: afterId (put it right below that bullet, on that bullet's level), beforeId (right above that bullet, on its level), " +
			"parentId (make it the last child of that bullet; \"\" = the last bullet on the top level of the note), or step: " +
			"up / down (swap with the bullet above / below it on the same level), indent (make it the last child of the bullet above it on its level, like Tab), " +
			"outdent (one level up, right below its parent, like Shift+Tab; as in the editor, the bullets that followed it under that parent become its children). " +
			"A bullet cannot go into its own children. Returns the note with the bullets' new levels.",
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "bulletId"}, map[string]any{
			"noteId":   prop("string", "Note id"),
			"bulletId": prop("string", "Id of the bullet to move"),
			"afterId":  prop("string", "Put it right below this bullet, on its level"),
			"beforeId": prop("string", "Put it right above this bullet, on its level"),
			"parentId": prop("string", "Make it the last child of this bullet; \"\" = end of the top level"),
			"step":     map[string]any{"type": "string", "enum": []string{"up", "down", "indent", "outdent"}, "description": "A step like the editor's keys instead of a target"},
		}),
		run: func(ctx context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
			var a struct {
				NoteID, BulletID, AfterID, BeforeID, Step string
				ParentID                                  *string
			}
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
			ops, err := mcpMoveOps(d, b, mcpMove{AfterID: a.AfterID, BeforeID: a.BeforeID, ParentID: a.ParentID, Step: a.Step})
			if err != nil {
				return nil, err
			}
			// Every bullet that moves must be free (the bullet, its conflict copies, adopted followers)
			for _, op := range ops {
				if err := s.bulletFree(a.NoteID, op.BlockID); err != nil {
					return nil, err
				}
			}
			if err := s.applyNoteOpsCtx(ctx, userID, actor, a.NoteID, ops); err != nil {
				return nil, err
			}
			res, err := noteResult(s, userID, a.NoteID)
			if m, ok := res.(map[string]any); ok {
				m["movedId"] = b.ID
			}
			return res, err
		},
	},
	{
		Name: "extract_note_bullet",
		Description: "Turn a bullet with the bullets below it into a note of its own, like the editor's /extract: the new note starts with that bullet, " +
			"its children below it, shared like the original; in the original note the bullet becomes a plain bullet with a [[link]] to the new note and its children go. " +
			"Bullet ids come from get_note. Returns the original note (bullets) and newNote (id, title, url).",
		Scope: storage.ScopeNotesWrite,
		Schema: schema([]string{"noteId", "bulletId"}, map[string]any{
			"noteId":     prop("string", "Note id"),
			"bulletId":   prop("string", "Id of the bullet to turn into a note"),
			"title":      prop("string", "Title of the new note, optional, at most 60 characters (default: the bullet's text, shortened to 60; made unique with (2), (3) … if taken)"),
			"folderPath": prop("string", "Folder of the new note, e.g. Projekte/MindSift; empty string = top level; leave out for the folder of the original note"),
		}),
		run: func(ctx context.Context, s *Server, userID string, actor *apiActor, args json.RawMessage) (any, error) {
			var a struct {
				NoteID, BulletID, Title string
				FolderPath              *string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			return s.mcpExtractBullet(ctx, userID, actor, a.NoteID, a.BulletID, a.Title, a.FolderPath)
		},
	},
}

// mcpExtractBullet does what the editor's /extract does: the server creates the note
// (storage.ExtractBranchAs), then the branch is replaced by the link as a change of the agent's own
// (useBranchActions.ts handleExtractBlock).
func (s *Server) mcpExtractBullet(ctx context.Context, userID string, actor *apiActor, noteID, bulletID, title string, folderPath *string) (any, error) {
	if err := s.editableNote(userID, noteID); err != nil {
		return nil, err
	}
	if folderPath != nil {
		folder := strings.Trim(strings.TrimSpace(*folderPath), "/")
		if err := s.store.CheckCreateInFolder(userID, folder); err != nil {
			return nil, err
		}
		folderPath = &folder
	}
	d, err := s.noteDoc(noteID)
	if err != nil {
		return nil, err
	}
	b, err := liveBullet(d, bulletID)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	created, link, err := s.store.ExtractBranchAs(userID, noteID, b.ID, title, folderPath, s.mcpCollabActor(userID, actor), s.leases.View(noteID))
	if err != nil {
		return nil, err
	}
	// The bullet itself went into the note: a plain bullet with the link stays (not a to-do, heading …)
	typ, unchecked := "bullet", false
	ops := []collab.Op{
		{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: b.ID, BaseVersion: b.Version, Content: &link},
		{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: b.ID, Patch: &collab.PropsPatch{Type: &typ, Checked: &unchecked}},
	}
	for _, kid := range d.Children(b.ID) {
		ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpDelete, BlockID: kid.ID})
	}
	if err := s.applyNoteOpsCtx(ctx, userID, actor, noteID, ops); err != nil {
		// The original stays as it was: the new note goes into the trash again
		if undoErr := s.store.UndoExtract(userID, created.ID); undoErr != nil {
			slog.Warn("MCP extract_note_bullet: new note not trashed after a failed change", "doc_id", created.ID, "error", undoErr)
		}
		return nil, err
	}
	if full, err := s.store.GetDocumentByID(userID, created.ID); err == nil {
		created = full
	}
	s.afterDocCreated(userID, created, true)
	res, err := noteResult(s, userID, noteID)
	if m, ok := res.(map[string]any); ok {
		m["newNote"] = s.toNoteView(created)
	}
	return res, err
}
