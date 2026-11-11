package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func flatOf(t *testing.T, store *storage.Store, userID, docID string) []string {
	t.Helper()
	d, err := store.GetDocumentByID(userID, docID)
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(d.Blocks))
	for _, b := range d.Blocks {
		out = append(out, strings.Repeat(">", b.Level)+b.Content)
	}
	return out
}

func TestExtractBranchIntoOwnNote(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	src, _ := store.CreateDocument(uid, "", "Projekt", "", "Arbeit", []domain.DocumentBlock{
		{ID: "blk_a", Type: "bullet", Content: "- Konzept: Garten #draußen", Level: 0, Position: 1},
		{ID: "blk_b", Type: "bullet", Content: "Beete", Level: 1, Position: 2},
		{ID: "blk_c", Type: "todo", Content: "Erde kaufen", Level: 2, Position: 3, Checked: true},
		{ID: "blk_d", Type: "bullet", Content: "Zaun", Level: 1, Position: 4},
		{ID: "blk_e", Type: "bullet", Content: "Danach", Level: 0, Position: 5},
	}, nil, false)

	rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", token, `{"blockId":"blk_a"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("extract: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Document domain.Document
		Link     string
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	created := out.Document
	if created.Title != "Konzept: Garten" || created.FolderPath != "Arbeit" || out.Link != "[[Konzept: Garten#"+created.ID+"]]" {
		t.Fatalf("new note: %q in %q, link %q", created.Title, created.FolderPath, out.Link)
	}
	// The bullet itself stays the first bullet, its hashtags with it
	if got := strings.Join(flatOf(t, store, uid, created.ID), "|"); got != "- Konzept: Garten #draußen|>Beete|>>Erde kaufen|>Zaun" {
		t.Fatalf("new note blocks: %s", got)
	}
	// The server leaves the source alone; the editor replaces the branch itself
	if got := strings.Join(flatOf(t, store, uid, src.ID), "|"); got != "- Konzept: Garten #draußen|>Beete|>>Erde kaufen|>Zaun|Danach" {
		t.Fatalf("source must stay unchanged on the server: %s", got)
	}
	// Same title again: the link must stay unique
	_, _ = store.CreateDocument(uid, "", "Projekt 2", "", "", []domain.DocumentBlock{{ID: "blk_x", Type: "bullet", Content: "Konzept: Garten", Level: 0}}, nil, false)
	docs, _ := store.GetDocuments(uid)
	var p2 string
	for _, d := range docs {
		if d.Title == "Projekt 2" {
			p2 = d.ID
		}
	}
	var second struct{ Document domain.Document }
	_ = json.Unmarshal(sessionCall(router, "POST", "/api/v1/documents/"+p2+"/extract", token, `{"blockId":"blk_x"}`, "").Body.Bytes(), &second)
	if second.Document.Title != "Konzept: Garten (2)" {
		t.Fatalf("duplicate title: %q", second.Document.Title)
	}
	// Undo puts the new note into the trash; only its creator may
	_, strangerToken := newTestUser(t, store, "fremd2@example.com")
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+created.ID+"/extract/undo", strangerToken, "", ""); rec.Code == http.StatusOK {
		t.Fatal("stranger must not undo")
	}
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+created.ID+"/extract/undo", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body.String())
	}
	if d, _ := store.GetDocumentByID(uid, created.ID); d == nil || !d.IsArchived {
		t.Fatal("extracted note must be in the trash after undo")
	}
}

// A bullet without text to name the note (a drawing) gives "Neue Notiz", never its content as the title
func TestExtractDrawingGetsDefaultTitle(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	drawingJSON := `{"v":1,"els":[{"id":"e1","t":"text","x":0,"y":0,"txt":"Skizze"}]}`
	src, _ := store.CreateDocument(uid, "", "Plan", "", "", []domain.DocumentBlock{
		{ID: "blk_dr", Type: "drawing", Content: drawingJSON, Level: 0, Position: 1},
		{ID: "blk_dc", Type: "bullet", Content: "Erläuterung", Level: 1, Position: 2},
	}, nil, false)
	rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", token, `{"blockId":"blk_dr"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("extract: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Document domain.Document
		Link     string
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Document.Title != "Neue Notiz" || out.Link != "[[Neue Notiz#"+out.Document.ID+"]]" {
		t.Fatalf("title %q, link %q", out.Document.Title, out.Link)
	}
	d, _ := store.GetDocumentByID(uid, out.Document.ID)
	if len(d.Blocks) != 2 || d.Blocks[0].Type != "drawing" || d.Blocks[0].Content != drawingJSON || d.Blocks[1].Level != 1 {
		t.Fatalf("new note blocks: %+v", d.Blocks)
	}
}

func TestExtractRejectsBulletThatIsOnlyANoteLink(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	src, _ := store.CreateDocument(claims.UserID, "", "Projekt", "", "", []domain.DocumentBlock{
		{ID: "blk_l", Type: "bullet", Content: "[[Konzept: Garten]] #draußen", Level: 0, Position: 1},
		{ID: "blk_m", Type: "bullet", Content: "Siehe [[Konzept: Garten]] für Details", Level: 0, Position: 2},
	}, nil, false)
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", token, `{"blockId":"blk_l"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("link-only bullet: want 400, got %d %s", rec.Code, rec.Body.String())
	}
	// A link inside other text is ordinary content
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", token, `{"blockId":"blk_m"}`, ""); rec.Code != http.StatusCreated {
		t.Fatalf("bullet with text and link: want 201, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestExtractInSharedNoteKeepsAccess(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	owner, _ := newTestUser(t, store, "owner@example.com")
	editor, editorToken := newTestUser(t, store, "editor@example.com")
	reader, readerToken := newTestUser(t, store, "reader@example.com")
	src, _ := store.CreateDocument(owner.ID, "", "Gemeinsam", "", "", []domain.DocumentBlock{
		{ID: "blk_s1", Type: "bullet", Content: "Idee", Level: 0, Position: 1},
		{ID: "blk_s2", Type: "bullet", Content: "Detail", Level: 1, Position: 2},
	}, nil, false)
	if _, err := store.CreateDocShare(owner.ID, src.ID, editor.ID, "write"); err != nil {
		t.Fatal(err)
	}
	_, _ = store.CreateDocShare(owner.ID, src.ID, reader.ID, "read")

	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", readerToken, `{"blockId":"blk_s1"}`, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("reader must not extract: %d", rec.Code)
	}
	rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", editorToken, `{"blockId":"blk_s1"}`, "")
	var out struct{ Document domain.Document }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	created := out.Document
	if rec.Code != http.StatusCreated {
		t.Fatalf("editor extract: %d %s", rec.Code, rec.Body.String())
	}
	if r := store.DocRole(editor.ID, created.ID); r != storage.DocRoleOwner {
		t.Fatalf("editor should own the new note, got %q", r)
	}
	if r := store.DocRole(owner.ID, created.ID); !storage.CanEditDoc(r) {
		t.Fatalf("source owner must be able to edit the new note, got %q", r)
	}
	if r := store.DocRole(reader.ID, created.ID); r == "" || storage.CanEditDoc(r) {
		t.Fatalf("reader must read (not edit) the new note, got %q", r)
	}
}

func TestMergeDocumentsAndUndo(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	source, _ := store.CreateDocument(uid, "", "Einkauf", "🛒", "", []domain.DocumentBlock{
		{ID: "blk_m1", Type: "bullet", Content: "Milch", Level: 0, Position: 1},
		{ID: "blk_m2", Type: "bullet", Content: "laktosefrei", Level: 1, Position: 2},
	}, nil, false)
	target, _ := store.CreateDocument(uid, "", "Haushalt", "", "", []domain.DocumentBlock{{ID: "blk_t1", Type: "bullet", Content: "Putzen", Level: 0}}, nil, false)

	if rec := sessionCall(router, "POST", "/api/v1/documents/"+target.ID+"/merge", token, `{"sourceId":"`+target.ID+`"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("merge into itself: want 400, got %d", rec.Code)
	}
	rec := sessionCall(router, "POST", "/api/v1/documents/"+target.ID+"/merge", token, `{"sourceId":"`+source.ID+`"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("merge: %d %s", rec.Code, rec.Body.String())
	}
	var res storage.MergeResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	got := flatOf(t, store, uid, target.ID)
	if len(got) != 4 || got[0] != "Putzen" || !strings.HasPrefix(got[1], "🛒 Einkauf (") || got[2] != ">Milch" || got[3] != ">>laktosefrei" {
		t.Fatalf("target after merge: %v", got)
	}
	if d, _ := store.GetDocumentByID(uid, source.ID); d == nil || !d.IsArchived {
		t.Fatal("source must be in the trash")
	}

	undo := `{"sourceId":"` + source.ID + `","headingId":"` + res.HeadingID + `"}`
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+target.ID+"/merge/undo", token, undo, ""); rec.Code != http.StatusOK {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body.String())
	}
	if got := strings.Join(flatOf(t, store, uid, target.ID), "|"); got != "Putzen" {
		t.Fatalf("target after undo: %s", got)
	}
	if d, _ := store.GetDocumentByID(uid, source.ID); d == nil || d.IsArchived {
		t.Fatal("source must be back")
	}

	// Someone else's note cannot be the source
	other, otherToken := newTestUser(t, store, "andere@example.com")
	own, _ := store.CreateDocument(other.ID, "", "Eigen", "", "", nil, nil, false)
	if _, err := store.CreateDocShare(uid, target.ID, other.ID, "write"); err != nil {
		t.Fatal(err)
	}
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+own.ID+"/merge", otherToken, `{"sourceId":"`+target.ID+`"}`, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign source: want 403, got %d %s", rec.Code, rec.Body.String())
	}
}

// The way back from extracting: the link bullet gets the note's blocks, the note goes to the trash.
func TestInlineNoteBringsBranchBack(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	note, _ := store.CreateDocument(uid, "", "Konzept: Garten", "", "", []domain.DocumentBlock{
		{ID: "blk_b", Type: "bullet", Content: "Beete", Level: 0, Position: 1},
		{ID: "blk_c", Type: "todo", Content: "Erde kaufen", Level: 1, Position: 2, Checked: true},
		{ID: "blk_d", Type: "bullet", Content: "Zaun", Level: 0, Position: 3},
	}, nil, false)
	src, _ := store.CreateDocument(uid, "", "Projekt", "", "", []domain.DocumentBlock{
		{ID: "blk_l", Type: "bullet", Content: "[[konzept: garten]] #draußen", Level: 0, Position: 1},
		{ID: "blk_t", Type: "bullet", Content: "Siehe [[Konzept: Garten]]", Level: 0, Position: 2},
		{ID: "blk_x", Type: "bullet", Content: "[[Gibt es nicht]]", Level: 0, Position: 3},
	}, nil, false)
	inline := func(docID, blockID, tok string) (int, storage.InlineResult) {
		rec := sessionCall(router, "POST", "/api/v1/documents/"+docID+"/inline", tok, `{"blockId":"`+blockID+`"}`, "")
		var out storage.InlineResult
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	if code, _ := inline(src.ID, "blk_t", token); code != http.StatusBadRequest {
		t.Fatalf("text with a link is no link bullet: %d", code)
	}
	if code, _ := inline(src.ID, "blk_x", token); code != http.StatusNotFound {
		t.Fatalf("missing note: %d", code)
	}

	// Linked from another note as well: refused, nothing changes
	other, _ := store.CreateDocument(uid, "", "Anderswo", "", "", []domain.DocumentBlock{
		{ID: "blk_o", Type: "bullet", Content: "auch [[Konzept: Garten]]", Level: 0, Position: 1},
	}, nil, false)
	if code, _ := inline(src.ID, "blk_l", token); code != http.StatusConflict {
		t.Fatalf("note linked elsewhere must be refused: %d", code)
	}
	if d, _ := store.GetDocumentByID(uid, note.ID); d.IsArchived {
		t.Fatal("refused inline must not trash the note")
	}
	if rec := sessionCall(router, "DELETE", "/api/v1/documents/"+other.ID, token, "", ""); rec.Code >= 300 {
		t.Fatalf("delete other: %d", rec.Code)
	}

	// Another person's note cannot be pulled in, even when shared with write access
	stranger, strangerToken := newTestUser(t, store, "fremd3@example.com")
	openSharing(t, store)
	if _, err := store.CreateDocShare(uid, src.ID, stranger.Email, "write"); err != nil {
		t.Fatal(err)
	}
	if code, _ := inline(src.ID, "blk_l", strangerToken); code != http.StatusForbidden && code != http.StatusNotFound {
		t.Fatalf("stranger must not pull in someone else's note: %d", code)
	}

	code, res := inline(src.ID, "blk_l", token)
	if code != http.StatusOK || res.SourceID != note.ID || res.Content != "Konzept: Garten #draußen" {
		t.Fatalf("inline: %d %+v", code, res)
	}
	var got []string
	for _, b := range res.Blocks {
		got = append(got, strings.Repeat(">", b.Level)+b.Content)
		if b.ID == "blk_b" || b.ID == "blk_c" {
			t.Fatal("blocks need fresh ids, the old ones live on in the trashed note")
		}
	}
	if strings.Join(got, "|") != "Beete|>Erde kaufen|Zaun" || !res.Blocks[1].Checked || res.Blocks[1].Type != "todo" {
		t.Fatalf("blocks: %v %+v", got, res.Blocks)
	}
	if d, _ := store.GetDocumentByID(uid, note.ID); d == nil || !d.IsArchived {
		t.Fatal("brought-back note must be in the trash")
	}
	// Undo uses the ordinary restore
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+note.ID+"/restore", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
}

// Extracting and pulling back gives the branch as it was: the note's first bullet takes the link's
// place again (type and props included), not the title on top of it
func TestInlineExtractedNoteRestoresBullet(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	src, _ := store.CreateDocument(uid, "", "Projekt", "", "", []domain.DocumentBlock{
		{ID: "blk_a", Type: "todo", Content: "Garten #draußen", Level: 0, Position: 1, Checked: true},
		{ID: "blk_b", Type: "bullet", Content: "Beete", Level: 1, Position: 2},
	}, nil, false)
	// A note of that name exists already: the extracted one is "Garten (2)"
	_, _ = store.CreateDocument(uid, "", "Garten", "", "", nil, nil, false)
	var out struct {
		Document domain.Document
		Link     string
	}
	_ = json.Unmarshal(sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/extract", token, `{"blockId":"blk_a"}`, "").Body.Bytes(), &out)
	if out.Link != "[[Garten (2)#"+out.Document.ID+"]]" {
		t.Fatalf("link: %q", out.Link)
	}
	// What the editor leaves behind (the server does not change the source itself)
	withLink, _ := store.CreateDocument(uid, "", "Projekt neu", "", "", []domain.DocumentBlock{
		{ID: "blk_l", Type: "bullet", Content: out.Link + " #neu", Level: 0, Position: 1},
	}, nil, false)
	rec := sessionCall(router, "POST", "/api/v1/documents/"+withLink.ID+"/inline", token, `{"blockId":"blk_l"}`, "")
	var res storage.InlineResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != http.StatusOK || res.Head == nil || res.Head.Type != "todo" || !res.Head.Checked || res.Content != "Garten #draußen #neu" {
		t.Fatalf("inline: %d %+v head %+v", rec.Code, res, res.Head)
	}
	if len(res.Blocks) != 1 || res.Blocks[0].Content != "Beete" || res.Blocks[0].Level != 0 {
		t.Fatalf("blocks: %+v", res.Blocks)
	}
}

func TestMoveBranchToOtherNote(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	src, _ := store.CreateDocument(uid, "", "Quelle", "", "", []domain.DocumentBlock{
		{ID: "blk_a", Type: "bullet", Content: "Garten", Level: 0, Position: 1},
		{ID: "blk_b", Type: "bullet", Content: "Beete", Level: 1, Position: 2},
		{ID: "blk_c", Type: "todo", Content: "Erde kaufen", Level: 2, Position: 3},
		{ID: "blk_d", Type: "bullet", Content: "Danach", Level: 0, Position: 4},
	}, nil, false)
	dst, _ := store.CreateDocument(uid, "", "Ziel", "", "", []domain.DocumentBlock{
		{ID: "blk_z", Type: "bullet", Content: "Schon da", Level: 0, Position: 1},
	}, nil, false)
	task, err := store.CreateTaskFromDocBlock(uid, src.ID, "blk_c", "Erde kaufen", false)
	if err != nil {
		t.Fatal(err)
	}

	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/branches/move", token, `{"blockId":"blk_a","targetId":"`+src.ID+`"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("move into the same note: %d", rec.Code)
	}
	_, strangerToken := newTestUser(t, store, "fremd3@example.com")
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/branches/move", strangerToken, `{"blockId":"blk_a","targetId":"`+dst.ID+`"}`, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger must not move: %d", rec.Code)
	}

	rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/branches/move", token, `{"blockId":"blk_a","targetId":"`+dst.ID+`"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("move: %d %s", rec.Code, rec.Body.String())
	}
	var res storage.MoveResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.TargetTitle != "Ziel" || res.RootID == "" || res.Moved[res.RootID] != "blk_a" || len(res.Moved) != 3 {
		t.Fatalf("result: %+v", res)
	}
	if got := strings.Join(flatOf(t, store, uid, dst.ID), "|"); got != "Schon da|Garten|>Beete|>>Erde kaufen" {
		t.Fatalf("target: %s", got)
	}
	// The server leaves the source alone; the editor removes the branch itself
	if got := strings.Join(flatOf(t, store, uid, src.ID), "|"); got != "Garten|>Beete|>>Erde kaufen|Danach" {
		t.Fatalf("source must stay unchanged on the server: %s", got)
	}
	moved, _ := store.GetThoughtByIDUnchecked(task.ID)
	if moved.DocID != dst.ID || res.Moved[moved.BlockID] != "blk_c" {
		t.Fatalf("task must follow the checkbox: %s:%s", moved.DocID, moved.BlockID)
	}

	body, _ := json.Marshal(res)
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/branches/move/undo", token, string(body), ""); rec.Code != http.StatusOK {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body.String())
	}
	if got := strings.Join(flatOf(t, store, uid, dst.ID), "|"); got != "Schon da" {
		t.Fatalf("target after undo: %s", got)
	}
	back, _ := store.GetThoughtByIDUnchecked(task.ID)
	if back.DocID != src.ID || back.BlockID != "blk_c" {
		t.Fatalf("task must be linked to the source again: %s:%s", back.DocID, back.BlockID)
	}

	// The earlier address stays for apps with older code
	rec = sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/move", token, `{"blockId":"blk_a","targetId":"`+dst.ID+`"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("move at the earlier address: %d %s", rec.Code, rec.Body.String())
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	body, _ = json.Marshal(res)
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/move/undo", token, string(body), ""); rec.Code != http.StatusOK {
		t.Fatalf("undo at the earlier address: %d %s", rec.Code, rec.Body.String())
	}
	if got := strings.Join(flatOf(t, store, uid, dst.ID), "|"); got != "Schon da" {
		t.Fatalf("target after the second undo: %s", got)
	}
}

func TestInlineRejectsLinkToSingleBullet(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	_, _ = store.CreateDocument(uid, "", "Ziel", "", "", []domain.DocumentBlock{{ID: "blk_z", Type: "bullet", Content: "Garten", Level: 0}}, nil, false)
	src, _ := store.CreateDocument(uid, "", "Quelle", "", "", []domain.DocumentBlock{
		{ID: "blk_l", Type: "bullet", Content: "[[Ziel#^blk_z|Ziel › Garten]]", Level: 0},
	}, nil, false)
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+src.ID+"/inline", token, `{"blockId":"blk_l"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("a link to one bullet must not bring back the whole note: %d %s", rec.Code, rec.Body.String())
	}
}
