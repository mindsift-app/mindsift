package storage

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// An image sized by hand carries its width after the caption (![caption|320](media:…)); old content
// and captions with a "|" stay what they were.
func TestMediaContentWidth(t *testing.T) {
	cases := []struct {
		in      string
		caption string
		width   int
	}{
		{"![Hafen](media:med_ab)", "Hafen", 0},
		{"![Hafen|320](media:med_ab)", "Hafen", 320},
		{"![|48](media:med_ab)", "", 48},
		{`![A\|5](media:med_ab)`, "A|5", 0},
		{`![A\|5|640](media:med_ab)`, "A|5", 640},
		{"![A|B](media:med_ab)", "A|B", 0},
		{"![Riesig|99999](media:med_ab)", "Riesig", maxMediaWidth},
		{"[Spur|2](media:med_ab)", "Spur|2", 0}, // recordings have no width
	}
	for _, c := range cases {
		ref, ok := ParseMediaContent(c.in)
		if !ok || ref.ID != "med_ab" || ref.Caption != c.caption || ref.Width != c.width {
			t.Errorf("%q: got %+v %v, want caption %q width %d", c.in, ref, ok, c.caption, c.width)
		}
	}
	for _, caption := range []string{"", "Hafen", "A|B", "Seite|12", `C:\|5`, "Plan [Entwurf]"} {
		for _, width := range []int{0, 320} {
			ref, ok := ParseMediaContent(MediaContentSized("image", "med_ab", caption, width))
			if !ok || ref.Caption != caption || ref.Width != width {
				t.Errorf("round trip %q %d: %+v", caption, width, ref)
			}
		}
	}
	if got := MediaContentSized("image", "med_ab", "Hafen", 320); got != "![Hafen|320](media:med_ab)" {
		t.Errorf("sized: %q", got)
	}
	if got := MediaContentSized("audio", "med_ab", "Notiz", 320); got != "[Notiz](media:med_ab)" {
		t.Errorf("audio with width: %q", got)
	}
}

// A file the writer may not show leaves its caption behind, without the width.
func TestMediaGateDropsWidthWithFile(t *testing.T) {
	s, anna, ben := newImportStore(t)
	annaDoc, _ := s.CreateDocument(anna.ID, "", "Annas", "", "", nil, nil, false)
	private := storeTestMedia(t, s, annaDoc.ID, anna.ID, pngBytes(t, 3))
	g := s.newMediaGate(ben.ID, nil)
	typ, got, _ := g.cleanBlock("image", MediaContentSized("image", private.ID, "Foto", 320))
	if typ != "bullet" || got != "Foto" {
		t.Errorf("got %s %q", typ, got)
	}
}

// Markdown export writes the size the way Obsidian reads it, and the import takes it back (also from
// Obsidian's ![[file|400]] and ![caption|400x300](…)).
func TestMarkdownVaultKeepsImageWidth(t *testing.T) {
	store, anna, ben := newImportStore(t)
	doc, _ := store.CreateDocument(anna.ID, "", "Platzhalter", "", "", nil, nil, false)
	m := storeTestMedia(t, store, doc.ID, anna.ID, pngBytes(t, 5))
	_, _ = store.CreateDocument(anna.ID, "", "Plan", "", "", []domain.DocumentBlock{
		{ID: "blk_p", Type: "image", Content: MediaContentSized("image", m.ID, "Grundriss", 320)},
	}, nil, false)

	var buf bytes.Buffer
	if err := store.WriteMarkdownVault(anna.ID, &buf); err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	var note string
	for _, f := range zr.File {
		if f.Name == "Plan.md" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			note = string(b)
		}
	}
	if !strings.Contains(note, "![Grundriss|320](../attachments/"+m.ID+".png)") && !strings.Contains(note, "![Grundriss|320](attachments/"+m.ID+".png)") {
		t.Fatalf("note:\n%s", note)
	}

	plan, err := PlanMindSiftImport(bytes.NewReader(buf.Bytes()), int64(buf.Len()), "vault.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatal(err)
	}
	if w := imageWidths(t, store, ben.ID); w["Grundriss"] != 320 {
		t.Fatalf("re-imported widths: %v", w)
	}
}

func TestObsidianImageSizeIsImported(t *testing.T) {
	store, _, ben := newImportStore(t)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name string, data []byte) {
		w, _ := zw.Create(name)
		_, _ = w.Write(data)
	}
	add("Vault/Rom.md", []byte("# Rom\n\n- ![[kolosseum.png|400]]\n- ![Brunnen|250x100](trevi.png)\n- ![Forum](forum.png)\n"))
	add("Vault/kolosseum.png", pngBytes(t, 3))
	add("Vault/trevi.png", pngBytes(t, 4))
	add("Vault/forum.png", pngBytes(t, 6))
	_ = zw.Close()

	plan, err := PlanObsidianImport(bytes.NewReader(buf.Bytes()), int64(buf.Len()), "Vault.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatal(err)
	}
	w := imageWidths(t, store, ben.ID)
	if w[""] != 400 || w["Brunnen"] != 250 || w["Forum"] != 0 || len(w) != 3 {
		t.Fatalf("widths: %v", w)
	}
}

// imageWidths: caption → width of the image bullets of the user's notes.
func imageWidths(t *testing.T, store *Store, userID string) map[string]int {
	t.Helper()
	docs, _ := store.GetDocuments(userID)
	out := map[string]int{}
	for _, d := range docs {
		for _, b := range d.Blocks {
			if b.Type != "image" {
				continue
			}
			ref, ok := ParseMediaContent(b.Content)
			if !ok {
				t.Fatalf("no media reference: %q", b.Content)
			}
			out[ref.Caption] = ref.Width
		}
	}
	return out
}
