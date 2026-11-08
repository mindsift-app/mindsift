package storage

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func pngBytes(t *testing.T, w int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, 2))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// storeTestMedia creates a media row with its file and returns it.
func storeTestMedia(t *testing.T, store *Store, docID, ownerID string, data []byte) *Media {
	t.Helper()
	mime, kind, ok := DetectMedia(data, "")
	if !ok {
		t.Fatal("test data not recognised")
	}
	m, err := store.CreateMedia(docID, ownerID, kind, mime, int64(len(data)), "")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Dir(store.MediaFilePath(m)), 0o755)
	if err := os.WriteFile(store.MediaFilePath(m), data, 0o644); err != nil {
		t.Fatal(err)
	}
	return m
}

// mediaBlocksOf returns the image/audio blocks of the user's notes and the bytes of their files.
func mediaBlocksOf(t *testing.T, store *Store, userID string) map[string][]byte {
	t.Helper()
	docs, _ := store.GetDocuments(userID)
	out := map[string][]byte{}
	for _, d := range docs {
		for _, b := range d.Blocks {
			if b.Type != "image" && b.Type != "audio" {
				continue
			}
			ref, ok := ParseMediaContent(b.Content)
			if !ok {
				t.Fatalf("block content is no media reference: %q", b.Content)
			}
			m, err := store.GetMedia(ref.ID)
			if err != nil || m.OwnerID != userID || m.DocID != d.ID {
				t.Fatalf("media row of %s: %+v %v", ref.ID, m, err)
			}
			data, err := os.ReadFile(store.MediaFilePath(m))
			if err != nil {
				t.Fatal(err)
			}
			out[ref.Caption] = data
		}
	}
	return out
}

func TestBackupZipCarriesMedia(t *testing.T) {
	store, anna, ben := newImportStore(t)
	doc, _ := store.CreateDocument(anna.ID, "", "Urlaub", "🏖️", "Reisen", nil, nil, false)
	img := pngBytes(t, 7)
	m := storeTestMedia(t, store, doc.ID, anna.ID, img)
	_, _ = store.CreateDocument(anna.ID, "", "Urlaub", "🏖️", "Reisen", []domain.DocumentBlock{
		{ID: "blk_t", Type: "bullet", Content: "Strand"},
		{ID: "blk_i", Type: "image", Content: MediaContent("image", m.ID, "Sonnenuntergang [Süd]")},
	}, nil, false)

	exp, _ := store.ExportUserData(anna.ID)
	var buf bytes.Buffer
	if err := store.WriteBackupZip(anna.ID, exp, &buf); err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	// The image once, in the vault next to the JSON; the note as Markdown that embeds it
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	all := strings.Join(names, "|")
	if !strings.Contains(all, "Obsidian/attachments/"+m.ID+".png") || strings.Contains(all, "media/") {
		t.Fatalf("backup ZIP must hold the image once in the vault: %v", names)
	}
	if !strings.Contains(all, "Obsidian/Reisen/Urlaub.md") {
		t.Fatalf("backup ZIP must hold the note as Markdown: %v", names)
	}

	plan, err := PlanMindSiftImport(buf.Bytes(), "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatal(err)
	}
	got := mediaBlocksOf(t, store, ben.ID)
	if !bytes.Equal(got["Sonnenuntergang [Süd]"], img) {
		t.Fatalf("restored image missing or different: %v", keysOf(got))
	}
}

// Backups from before the vault carry the images as media/<id><ext> next to the JSON
func TestOldBackupZipMediaStillRestores(t *testing.T) {
	store, anna, ben := newImportStore(t)
	doc, _ := store.CreateDocument(anna.ID, "", "Urlaub", "🏖️", "", nil, nil, false)
	img := pngBytes(t, 3)
	m := storeTestMedia(t, store, doc.ID, anna.ID, img)
	_, _ = store.CreateDocument(anna.ID, "", "Urlaub", "🏖️", "", []domain.DocumentBlock{
		{ID: "blk_i", Type: "image", Content: MediaContent("image", m.ID, "Alt")},
	}, nil, false)
	exp, _ := store.ExportUserData(anna.ID)
	raw, _ := json.Marshal(exp)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range map[string][]byte{BackupFileName: raw, "media/" + m.ID + ".png": img} {
		f, _ := zw.Create(name)
		_, _ = f.Write(data)
	}
	_ = zw.Close()

	plan, err := PlanMindSiftImport(buf.Bytes(), "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatal(err)
	}
	if got := mediaBlocksOf(t, store, ben.ID); !bytes.Equal(got["Alt"], img) {
		t.Fatalf("restored image missing or different: %v", keysOf(got))
	}
}

func TestMarkdownVaultCarriesMedia(t *testing.T) {
	store, anna, ben := newImportStore(t)
	doc, _ := store.CreateDocument(anna.ID, "", "Platzhalter", "", "", nil, nil, false)
	img := pngBytes(t, 5)
	m := storeTestMedia(t, store, doc.ID, anna.ID, img)
	_, _ = store.CreateDocument(anna.ID, "", "Plan", "", "Projekte/Haus", []domain.DocumentBlock{
		{ID: "blk_p", Type: "image", Content: MediaContent("image", m.ID, "Grundriss")},
	}, nil, false)

	var buf bytes.Buffer
	if err := store.WriteMarkdownVault(anna.ID, &buf); err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	var note string
	hasFile := false
	for _, f := range zr.File {
		if f.Name == "attachments/"+m.ID+".png" {
			hasFile = true
		}
		if f.Name == "Projekte/Haus/Plan.md" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			note = string(b)
		}
	}
	if !hasFile || !strings.Contains(note, "![Grundriss](../../attachments/"+m.ID+".png)") {
		t.Fatalf("vault: attachment %v, note:\n%s", hasFile, note)
	}

	plan, err := PlanMindSiftImport(buf.Bytes(), "vault.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatal(err)
	}
	if got := mediaBlocksOf(t, store, ben.ID); !bytes.Equal(got["Grundriss"], img) {
		t.Fatalf("re-imported image missing: %v", keysOf(got))
	}
}

func TestObsidianVaultImagesAreImported(t *testing.T) {
	store, _, ben := newImportStore(t)
	img1, img2 := pngBytes(t, 3), pngBytes(t, 4)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name string, data []byte) {
		w, _ := zw.Create(name)
		_, _ = w.Write(data)
	}
	add("Vault/Reisen/Rom.md", []byte("# Rom\n\n- ![[kolosseum.png|400]]\n- ![Brunnen](bilder/trevi%20brunnen.png)\n- Text mit ![[kolosseum.png]] mittendrin\n"))
	add("Vault/Anhänge/kolosseum.png", img1)
	add("Vault/Reisen/bilder/trevi brunnen.png", img2)
	add("Vault/Anhänge/handbuch.pdf", []byte("%PDF-1.4"))
	_ = zw.Close()

	plan, err := PlanObsidianImport(bytes.NewReader(buf.Bytes()), int64(buf.Len()), "Vault.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatal(err)
	}
	got := mediaBlocksOf(t, store, ben.ID)
	if !bytes.Equal(got[""], img1) || !bytes.Equal(got["Brunnen"], img2) || len(got) != 2 {
		t.Fatalf("obsidian images: %v", keysOf(got))
	}
	skippedPDF := false
	for _, s := range plan.Skipped {
		skippedPDF = skippedPDF || strings.HasSuffix(s.Path, "handbuch.pdf")
	}
	if !skippedPDF {
		t.Fatal("PDF must be reported as skipped")
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
