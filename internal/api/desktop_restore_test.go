package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/importer"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// serverSnapshot builds a small server with two accounts that share with each other and returns its
// daily database snapshot (.db.gz) and the two accounts.
func serverSnapshot(t *testing.T) (string, *domain.User, *domain.User) {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewStore(filepath.Join(dir, "mindsift.db"))
	if err != nil {
		t.Fatalf("server store: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna Server", domain.RoleAdmin)
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", domain.RoleMember)

	// Anna's own: a note in a folder, a task list she shares with Ben (one task each), a list, an inbox entry
	if _, err := store.CreateDocument(anna.ID, "", "Annas Notiz", "📄", "Projekte", []domain.DocumentBlock{{ID: "a1", Type: "bullet", Content: "Plan"}}, nil, false); err != nil {
		t.Fatalf("note: %v", err)
	}
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	if _, err := store.AddTaskListShare(tl.ID, "user", ben.ID, "editor", anna.ID); err != nil {
		t.Fatalf("task list share: %v", err)
	}
	for _, u := range []*domain.User{anna, ben} {
		task, _ := store.CreateThoughtWithDetails(u.ID, "Aufgabe von "+u.DisplayName, "normal", "manual", "", tl.ID, "todo", "")
		if _, err := store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", "", tl.ID); err != nil {
			t.Fatalf("task: %v", err)
		}
	}
	list, _ := store.CreateList(anna.ID, "Einkauf", "🛒", "shopping")
	_, _ = store.CreateListItem(list.ID, "Milch", "", "", 0, anna.ID)
	_, _ = store.CreateThought(anna.ID, "Idee", "normal", "manual", "")
	_ = store.SetLanguage(anna.ID, "en")

	// Ben's: a note and a list he shares with Anna, and a note of his own
	benDoc, _ := store.CreateDocument(ben.ID, "", "Bens geteilte Notiz", "📄", "", []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Geheim"}}, nil, false)
	if _, err := store.CreateDocShare(ben.ID, benDoc.ID, "anna@example.com", "write"); err != nil {
		t.Fatalf("doc share: %v", err)
	}
	benList, _ := store.CreateList(ben.ID, "Bens Liste", "🛒", "shopping")
	if _, err := store.AddListShare(ben.ID, benList.ID, "user", anna.ID, "editor"); err != nil {
		t.Fatalf("list share: %v", err)
	}
	_, _ = store.CreateDocument(ben.ID, "", "Bens Tagebuch", "📄", "", nil, nil, false)

	name, err := store.WriteSystemSnapshot(filepath.Join(dir, "backups", "system"), time.Now())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return filepath.Join(dir, "backups", "system", name), anna, ben
}

func uploadSnapshot(t *testing.T, router http.Handler, token, path string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		raw = []byte(path) // not a file: sent as the content
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", filepath.Base(path))
	_, _ = fw.Write(raw)
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/backups/server-snapshot", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept-Language", "de")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

type snapshotUploadResult struct {
	Token    string                    `json:"token"`
	Accounts []storage.SnapshotAccount `json:"accounts"`
}

// A server's snapshot restored in a local instance: the person picks one account; only what it owns comes
// into the local account (things others shared with it are listed as skipped), with its settings; the
// other account, the sharing and the server's settings stay out, and the instance keeps its one account.
func TestDesktopTakesOverOneAccountOfAServerSnapshot(t *testing.T) {
	t.Parallel()
	snapshot, anna, _ := serverSnapshot(t)
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)
	local, _ := store.GetAllUsers()
	if len(local) != 1 {
		t.Fatalf("local accounts: %d", len(local))
	}
	me := local[0]

	rec := uploadSnapshot(t, router, token, snapshot)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var up snapshotUploadResult
	if err := json.Unmarshal(rec.Body.Bytes(), &up); err != nil || up.Token == "" || len(up.Accounts) != 2 {
		t.Fatalf("upload answer: %s", rec.Body.String())
	}
	a := up.Accounts[0]
	if a.ID != anna.ID || a.DisplayName != "Anna Server" || a.Email != "anna@example.com" || a.Notes != 1 || a.Tasks != 2 || a.Lists != 1 || a.Inbox != 1 {
		t.Errorf("Anna in the list: %+v", a)
	}
	if b := up.Accounts[1]; b.Notes != 2 || b.Lists != 1 || b.Tasks != 1 {
		t.Errorf("Ben in the list: %+v", b)
	}

	base := "/api/v1/admin/backups/server-snapshot/" + up.Token + "?account=" + anna.ID
	rec = sessionCall(router, http.MethodPost, base+"&preview=1", token, "", "")
	var prev struct {
		importer.Summary
		Account  storage.SnapshotAccount `json:"account"`
		Settings bool                    `json:"settings"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &prev) != nil {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body.String())
	}
	// Both tasks of her list come along, also the one Ben added; his shared note and list are skipped
	if prev.Notes != 1 || prev.Tasks != 2 || prev.TaskLists != 1 || prev.Lists != 1 || prev.Inbox != 1 || prev.Account.ID != anna.ID || !prev.Settings || prev.Applied {
		t.Errorf("preview: %+v", prev)
	}
	skipped := rec.Body.String()
	if !strings.Contains(skipped, "Bens geteilte Notiz") || !strings.Contains(skipped, "Bens Liste") {
		t.Errorf("shared items not listed as skipped: %s", skipped)
	}
	if docs, _ := store.GetDocuments(me.ID); hasTitle(docs, "Annas Notiz") {
		t.Fatal("the preview imported")
	}

	if rec := sessionCall(router, http.MethodPost, "/api/v1/admin/backups/server-snapshot/"+up.Token+"?account=usr_nobody", token, "", ""); rec.Code != http.StatusNotFound {
		t.Errorf("unknown account: %d", rec.Code)
	}

	rec = sessionCall(router, http.MethodPost, base+"&mode=restore", token, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("take over: %d %s", rec.Code, rec.Body.String())
	}
	users, _ := store.GetAllUsers()
	if len(users) != 1 || users[0].ID != me.ID || users[0].Role != domain.RoleAdmin || users[0].Username != me.Username {
		t.Fatalf("accounts after the take over: %+v", users)
	}
	// Recorded like the other changes of the backups: who took which account over, and how
	if e := lastAudit(t, store, storage.AuditBackupTakenOver); e.ActorID != me.ID || e.TargetKind != storage.AuditTargetBackup ||
		!strings.Contains(string(e.Details), `"mode":"restore"`) || !strings.Contains(string(e.Details), `"notes":1`) || strings.Contains(string(e.Details), `"account":""`) {
		t.Errorf("audit row of the take over: %+v %s", e, e.Details)
	}
	if users[0].DisplayName != "Anna Server" || store.Language(me.ID) != "en" {
		t.Errorf("settings not taken over: name %q, language %q", users[0].DisplayName, store.Language(me.ID))
	}
	docs, _ := store.GetDocuments(me.ID)
	if !hasTitle(docs, "Annas Notiz") || hasTitle(docs, "Bens geteilte Notiz") || hasTitle(docs, "Bens Tagebuch") {
		t.Errorf("notes after the take over: %v", titles(docs))
	}
	tasks, _ := store.GetTasks(me.ID, "")
	if len(tasks) != 2 {
		t.Errorf("tasks after the take over: %d", len(tasks))
	}
	if lists, _ := store.GetAllListsForUser(me.ID); len(lists) != 1 || lists[0].Title != "Einkauf" || len(lists[0].Items) != 1 {
		t.Errorf("lists after the take over: %+v", lists)
	}
	if store.SharingMode() != storage.SharingPrivate {
		t.Errorf("sharing after the take over: %q", store.SharingMode())
	}
	if _, err := os.Stat(srv.snapshotRoot()); !os.IsNotExist(err) {
		t.Errorf("the staged snapshot is still there: %v", err)
	}
	// The snapshot is gone: the token no longer works
	if rec := sessionCall(router, http.MethodPost, base+"&preview=1", token, "", ""); rec.Code != http.StatusNotFound {
		t.Errorf("token after the take over: %d", rec.Code)
	}
	// The app still signs in to the one local account
	if rec := desktopSession(t, router, desktopTestOrigin); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), me.ID) {
		t.Errorf("desktop session after the take over: %d %s", rec.Code, rec.Body.String())
	}
}

// What is not a snapshot is refused, and a cancelled one is removed.
func TestDesktopSnapshotRefusesOtherFilesAndCancels(t *testing.T) {
	t.Parallel()
	snapshot, _, _ := serverSnapshot(t)
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	if rec := uploadSnapshot(t, router, token, "kein Datenbank-Abzug"); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "kein Backup eines MindSift-Servers") {
		t.Errorf("text file: %d %s", rec.Code, rec.Body.String())
	}
	rec := uploadSnapshot(t, router, token, snapshot)
	var up snapshotUploadResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, http.MethodDelete, "/api/v1/admin/backups/server-snapshot/"+up.Token, token, "", ""); rec.Code != http.StatusOK {
		t.Errorf("cancel: %d", rec.Code)
	}
	if _, err := os.Stat(srv.snapshotRoot()); !os.IsNotExist(err) {
		t.Errorf("the cancelled snapshot is still there: %v", err)
	}
}

// A normal server has none of it: the admin's full restore stays as it is (outside the app).
func TestSnapshotTakeOverNotOnServer(t *testing.T) {
	snapshot, _, _ := serverSnapshot(t)
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{User: "root", Password: initialAdminPassword}, false)
	router := srv.Router()
	adminToken := loginToken(t, router, "root", initialAdminPassword)
	if rec := uploadSnapshot(t, router, adminToken, snapshot); rec.Code != http.StatusNotFound {
		t.Errorf("upload on a server: %d", rec.Code)
	}
}

func hasTitle(docs []domain.Document, title string) bool {
	for _, d := range docs {
		if d.Title == title {
			return true
		}
	}
	return false
}

func titles(docs []domain.Document) []string {
	out := []string{}
	for _, d := range docs {
		out = append(out, d.Title)
	}
	return out
}
