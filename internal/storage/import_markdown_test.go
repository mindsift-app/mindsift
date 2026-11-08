package storage

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func newImportStore(t *testing.T) (*Store, *domain.User, *domain.User) {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "import.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	return store, anna, ben
}

// seedAnna creates one of everything the import has to bring back.
func seedAnna(t *testing.T, store *Store, anna *domain.User) {
	t.Helper()
	blocks := []domain.DocumentBlock{
		{ID: "b1", Type: "h2", Content: "Warum", Level: 0},
		{ID: "b2", Type: "bullet", Content: "Strom sparen #homelab", Level: 1},
		{ID: "b3", Type: "todo", Content: "Backup", Checked: true, Level: 2},
		{ID: "b4", Type: "code", Content: "docker compose up", Lang: "bash", Level: 2},
	}
	if _, err := store.CreateDocument(anna.ID, "", "Umzug", "🚀", "Projekte/Server", blocks, nil, false); err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Fenster putzen", "urgent", "manual", "2026-11-02", tl.ID, "todo", "Leiter im Keller")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "2026-11-02", tl.ID)
	subs := []domain.SubTask{{ID: "s1", Title: "Leiter holen", IsCompleted: true}}
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, nil, nil, nil, nil, nil, &subs, nil)
	_ = store.SetTaskRecurrence(anna.ID, task.ID, "monthly")
	list, _ := store.CreateList(anna.ID, "Einkauf", "🛒", "shopping")
	item, _ := store.CreateListItem(list.ID, "Milch", "Kühlregal", "2L", 0, anna.ID)
	_, _ = store.ToggleListItem(item.ID, true, anna.ID, "Anna")
}

func checkRestored(t *testing.T, store *Store, ben *domain.User) {
	t.Helper()
	docs, _ := store.GetDocuments(ben.ID)
	if len(docs) != 1 || docs[0].Title != "Umzug" || docs[0].FolderPath != "Projekte/Server" || docs[0].Icon != "🚀" {
		t.Fatalf("note not restored: %+v", docs)
	}
	got := []string{}
	for _, b := range docs[0].Blocks {
		got = append(got, b.Type+"@"+string(rune('0'+b.Level))+":"+b.Content)
	}
	want := []string{"h2@0:Warum", "bullet@1:Strom sparen #homelab", "todo@2:Backup", "code@2:docker compose up"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("blocks differ:\n got %v\nwant %v", got, want)
	}
	lists, _ := store.GetTaskLists(ben.ID)
	tasks, _ := store.GetTasks(ben.ID, "")
	if len(lists) != 1 || lists[0].Title != "Haushalt" || len(tasks) != 1 {
		t.Fatalf("task list not restored: %+v / %+v", lists, tasks)
	}
	tk := tasks[0]
	if tk.Content != "Fenster putzen" || tk.Priority != "urgent" || tk.DueDate != "2026-11-02" || tk.Notes != "Leiter im Keller" || tk.Recurrence != "monthly" ||
		len(tk.Subtasks) != 1 || !tk.Subtasks[0].IsCompleted || tk.TaskListID != lists[0].ID {
		t.Errorf("task not restored: %+v", tk)
	}
	shop, _ := store.GetAllListsForUser(ben.ID)
	if len(shop) != 1 || len(shop[0].Items) != 1 {
		t.Fatalf("list not restored: %+v", shop)
	}
	it := shop[0].Items[0]
	if it.Content != "Milch" || it.Quantity != "2L" || it.Category != "Kühlregal" || !it.IsCompleted {
		t.Errorf("list item not restored: %+v", it)
	}
}

func TestImportMindSiftArchiveRoundTrip(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	var buf bytes.Buffer
	if err := store.WriteMarkdownVault(anna.ID, &buf); err != nil {
		t.Fatalf("export: %v", err)
	}
	plan, err := PlanMindSiftArchiveImport(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if sum := plan.Summary(false); sum.Notes != 1 || sum.TaskLists != 1 || sum.Tasks != 1 || sum.Lists != 1 || sum.ListItems != 1 {
		t.Fatalf("preview counts wrong: %+v", sum)
	}
	// The preview alone writes nothing
	if docs, _ := store.GetDocuments(ben.ID); len(docs) != 0 {
		t.Fatalf("preview must not import")
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	checkRestored(t, store, ben)
}

func TestImportMindSiftJSONRoundTrip(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	exp, _ := store.ExportUserData(anna.ID)
	data, _ := json.Marshal(exp)
	plan, err := PlanMindSiftJSONImport(data)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	checkRestored(t, store, ben)

	if _, err := PlanMindSiftJSONImport([]byte(`{"foo":1}`)); err == nil {
		t.Errorf("foreign JSON must be rejected")
	}
}

// A backup changed by hand cannot raise the importer's role or reach other accounts: the profile in it
// (role, id) is ignored, and notes and blocks get new IDs and no task links.
func TestImportIgnoresProfileAndForeignIDs(t *testing.T) {
	store, anna, ben := newImportStore(t)
	annaDoc, _ := store.CreateDocument(anna.ID, "", "Annas Notiz", "", "", []domain.DocumentBlock{{ID: "blk_anna", Type: "bullet", Content: "Original"}}, nil, false)
	annaTask, _ := store.CreateThoughtWithDetails(anna.ID, "Annas Aufgabe", "normal", "manual", "", "", "todo", "")

	exp := domain.FullExport{
		ExportedAt: "2026-11-02T00:00:00Z",
		Version:    "manipuliert",
		User:       domain.User{ID: anna.ID, Email: anna.Email, Role: "admin", IsActive: true},
		Documents: []domain.Document{{
			ID:    annaDoc.ID,
			Title: "Übernommen?",
			Blocks: []domain.DocumentBlock{
				{ID: "blk_anna", Type: "bullet", Content: "Überschrieben?"},
				{ID: "blk_x", Type: "todo", Content: "Verknüpft?", TaskID: annaTask.ID},
			},
		}},
	}
	data, _ := json.Marshal(exp)
	plan, err := PlanMindSiftJSONImport(data)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}

	if u, _ := store.GetUserByID(ben.ID); u.Role != "member" {
		t.Errorf("import must not change the role, got %q", u.Role)
	}
	if u, _ := store.GetUserByID(anna.ID); u.Role != anna.Role {
		t.Errorf("import must not touch the account named in the backup, role now %q", u.Role)
	}
	if d, err := store.GetDocumentByID(anna.ID, annaDoc.ID); err != nil || d.Title != "Annas Notiz" || d.Blocks[0].Content != "Original" {
		t.Errorf("Anna's note must stay as it was: %+v %v", d, err)
	}
	docs, _ := store.GetDocuments(ben.ID)
	if len(docs) != 1 || docs[0].ID == annaDoc.ID || docs[0].Title != "Übernommen?" {
		t.Fatalf("the note should be Ben's own copy with a new ID: %+v", docs)
	}
	got, _ := store.GetDocumentByID(ben.ID, docs[0].ID)
	for _, b := range got.Blocks {
		if b.ID == "blk_anna" || b.ID == "blk_x" || b.TaskID != "" {
			t.Errorf("imported blocks need new IDs and no task links: %+v", b)
		}
	}
}

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	_ = zw.Close()
	return buf.Bytes()
}

func TestImportObsidianVault(t *testing.T) {
	store, _, ben := newImportStore(t)
	data := zipOf(t, map[string]string{
		"Mein Vault/Notizen/Idee.md": "---\ntags: [projekt, ideen]\naliases:\n  - X\n---\n" +
			"Ein Absatz mit [[Wikilink]]\nüber zwei Zeilen.\n\n" +
			"> [!tip] Wichtig\n> Callout-Text\n\n" +
			"## Liste\n- Punkt A\n  - Unterpunkt #projekt\n  - [x] Erledigt\n- Punkt B\n\n" +
			"```go\nfmt.Println(1)\n```\n",
		"Mein Vault/Willkommen.md":      "# Hallo\nText",
		"Mein Vault/bild.png":           "PNG",
		"Mein Vault/.obsidian/app.json": "{}",
		"Mein Vault/../../boese.md":     "- ausgebrochen?",
	})
	plan, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Mein Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sum := plan.Summary(false)
	if sum.Notes != 3 || len(sum.Skipped) != 1 || !strings.Contains(sum.Skipped[0].Path, "bild.png") {
		t.Fatalf("unexpected preview: %+v", sum)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	docs, _ := store.GetDocuments(ben.ID)
	byTitle := map[string]domain.Document{}
	for _, d := range docs {
		byTitle[d.Title] = d
		if !strings.HasPrefix(d.FolderPath, "Mein Vault") {
			t.Errorf("note %q outside the vault folder: %q", d.Title, d.FolderPath)
		}
	}
	idee, ok := byTitle["Idee"]
	if !ok || idee.FolderPath != "Mein Vault/Notizen" {
		t.Fatalf("Idee not in Mein Vault/Notizen: %+v", byTitle)
	}
	got := []string{}
	for _, b := range idee.Blocks {
		got = append(got, b.Type+"@"+string(rune('0'+b.Level))+":"+b.Content)
	}
	want := []string{
		"bullet@0:Ein Absatz mit [[Wikilink]]\nüber zwei Zeilen.",
		"callout@0:Wichtig\nCallout-Text",
		"h2@0:Liste",
		"bullet@1:Punkt A",
		"bullet@2:Unterpunkt #projekt",
		"todo@2:Erledigt",
		"bullet@1:Punkt B",
		"code@1:fmt.Println(1)",
		"bullet@0:#ideen", // front matter tag not yet in the text
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("blocks differ:\n got %q\nwant %q", got, want)
	}
	if _, ok := byTitle["boese"]; !ok {
		t.Errorf("a ../ path must be imported inside the vault, not dropped silently")
	}

	if _, err := PlanObsidianImport(bytes.NewReader([]byte("kein zip")), 8, "x.zip"); err == nil {
		t.Errorf("invalid archive must be rejected")
	}
}

func TestImportBackupZip(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	exp, _ := store.ExportUserData(anna.ID)
	var buf bytes.Buffer
	if err := store.WriteBackupZip(anna.ID, exp, &buf); err != nil {
		t.Fatalf("WriteBackupZip: %v", err)
	}
	if buf.Len() == 0 {
		t.Fatalf("empty archive")
	}
	plan, err := PlanMindSiftImport(buf.Bytes(), "mindsift-backup-2026-10-29.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	checkRestored(t, store, ben)
}

func TestMarkdownHeadingsNestTheirSections(t *testing.T) {
	blocks := MarkdownToBlocks("# Projekt\nEinleitung\n## Teil A\n- Punkt\n  - Unterpunkt\n## Teil B\n1. Erstens\n# Anhang\nText")
	var got []string
	for _, b := range blocks {
		got = append(got, fmt.Sprintf("%d:%s:%s", b.Level, b.Type, b.Content))
	}
	want := []string{
		"0:h1:Projekt", "1:bullet:Einleitung", "1:h2:Teil A", "2:bullet:Punkt", "3:bullet:Unterpunkt",
		"1:h2:Teil B", "2:numbered:Erstens", "0:h1:Anhang", "1:bullet:Text",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

func TestMarkdownListNestsUnderItsParagraph(t *testing.T) {
	blocks := MarkdownToBlocks("# Plan\nFolgende Punkte:\n\n- eins\n  - tiefer\n- zwei\n\nDanach Text\n\n1. a")
	var got []string
	for _, b := range blocks {
		got = append(got, fmt.Sprintf("%d:%s:%s", b.Level, b.Type, b.Content))
	}
	want := []string{"0:h1:Plan", "1:bullet:Folgende Punkte:", "2:bullet:eins", "3:bullet:tiefer", "2:bullet:zwei", "1:bullet:Danach Text", "2:numbered:a"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

func TestDrawingsSurviveExportAndImport(t *testing.T) {
	store, anna, ben := newImportStore(t)
	content := `{"v":1,"els":[{"id":"a","ver":1,"t":"ellipse","x":0,"y":0,"w":80,"h":40,"s":"green","f":"none","sw":2,"txt":"Idee"}]}`
	blocks := []domain.DocumentBlock{{ID: "d1", Type: "bullet", Content: "Davor"}, {ID: "d2", Type: "drawing", Content: content}}
	if _, err := store.CreateDocument(anna.ID, "", "Skizzen", "", "", blocks, nil, false); err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	var buf bytes.Buffer
	if err := store.WriteMarkdownVault(anna.ID, &buf); err != nil {
		t.Fatalf("export: %v", err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	var note string
	svgFound := false
	for _, f := range zr.File {
		data, _ := readZipFile(f, 1<<20)
		if strings.HasSuffix(f.Name, "d2.svg") && strings.Contains(string(data), "<svg") {
			svgFound = true
		}
		if strings.HasSuffix(f.Name, "Skizzen.md") {
			note = string(data)
		}
	}
	if !svgFound || !strings.Contains(note, "![Idee](attachments/d2.svg)") {
		t.Fatalf("drawing not exported as picture: svg=%v note=%q", svgFound, note)
	}
	plan, err := PlanMindSiftArchiveImport(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	docs, _ := store.GetDocuments(ben.ID)
	var got *domain.DocumentBlock
	for _, d := range docs {
		for i, b := range d.Blocks {
			if b.Type == "drawing" {
				got = &d.Blocks[i]
			}
		}
	}
	if got == nil || !strings.Contains(got.Content, `"txt":"Idee"`) {
		t.Fatalf("drawing not restored: %+v", got)
	}
}

func TestDrawingFenceBecomesADrawing(t *testing.T) {
	md := "Davor\n\n```mindsift-canvas\n{\"v\":1,\"els\":[]}\n```\n\n```mindsift-canvas\nkein JSON\n```"
	blocks := MarkdownToBlocks(md)
	if len(blocks) != 3 || blocks[1].Type != "drawing" || blocks[2].Type != "code" {
		t.Fatalf("got %+v", blocks)
	}
	if out := BlocksToVaultMarkdown(blocks[1:2]); !strings.Contains(out, "```mindsift-canvas\n{\"v\":1,\"els\":[]}\n```") {
		t.Fatalf("export without files: %q", out)
	}
}
