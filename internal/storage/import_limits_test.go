package storage

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// prose is Markdown that packs like real notes (a few times, not hundreds).
func prose(size int) string {
	var sb strings.Builder
	for i := 0; sb.Len() < size; i++ {
		fmt.Fprintf(&sb, "- Punkt %d mit etwas Text, Nummer %x und %d\n", i, i*7919, i*i)
	}
	return sb.String()
}

func skippedFor(sum ImportSummary, path string) string {
	for _, s := range sum.Skipped {
		if strings.HasSuffix(s.Path, path) {
			return s.Reason
		}
	}
	return ""
}

func TestImportSkipsOversizedNote(t *testing.T) {
	data := zipOf(t, map[string]string{
		"Vault/Gross.md": prose(maxImportNoteBytes + 1000),
		"Vault/Klein.md": "- Inhalt",
	})
	plan, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sum := plan.Summary(false)
	if sum.Notes != 1 || skippedFor(sum, "Gross.md") != "zu groß (max. 2 MB pro Notiz)" {
		t.Fatalf("the oversized note should be skipped with its reason: %+v", sum)
	}
}

func TestImportSkipsZipBombEntries(t *testing.T) {
	zeros := string(make([]byte, 3*importRatioFrom/2))
	data := zipOf(t, map[string]string{
		"Vault/Bombe.md":  zeros,
		"Vault/bild.png":  zeros,
		"Vault/Normal.md": prose(importRatioFrom + 1000), // as large, but packs like a note
	})
	plan, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sum := plan.Summary(false)
	for _, name := range []string{"Bombe.md", "bild.png"} {
		if got := skippedFor(sum, name); got != "ungewöhnlich stark gepackt, wird nicht entpackt" {
			t.Errorf("%s: skipped with %q, want the ratio reason", name, got)
		}
	}
	if sum.Notes != 1 {
		t.Errorf("a large but ordinary note must still be imported: %+v", sum)
	}
}

// rawZip writes entries with the sizes they declare, not the ones they have.
type rawEntry struct {
	name           string
	data           []byte // stored as is (Store) or deflated
	deflate        bool
	declaredUnpack uint64
}

func rawZip(t *testing.T, entries []rawEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		packed := e.data
		method := zip.Store
		if e.deflate {
			var c bytes.Buffer
			fw, _ := flate.NewWriter(&c, flate.BestCompression)
			_, _ = fw.Write(e.data)
			_ = fw.Close()
			packed, method = c.Bytes(), zip.Deflate
		}
		w, err := zw.CreateRaw(&zip.FileHeader{Name: e.name, Method: method, CRC32: crc32.ChecksumIEEE(e.data),
			CompressedSize64: uint64(len(packed)), UncompressedSize64: e.declaredUnpack})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(packed)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// The sizes the entries declare are added up before anything is unpacked.
func TestImportRefusesArchiveDeclaringTooMuch(t *testing.T) {
	var entries []rawEntry
	for i := 0; uint64(i)*maxImportNoteBytes <= maxImportUnpackedBytes; i++ {
		// Packs no better than 100:1 on paper, so only the total can refuse it
		entries = append(entries, rawEntry{name: fmt.Sprintf("Vault/N%03d.md", i), data: make([]byte, maxImportNoteBytes/maxImportRatio+100), declaredUnpack: maxImportNoteBytes})
	}
	data := rawZip(t, entries)
	if _, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip"); err == nil || !strings.Contains(err.Error(), "zu groß") {
		t.Fatalf("an archive declaring more than %d MB must be refused before reading, got %v", maxImportUnpackedBytes>>20, err)
	}
}

// An entry that unpacks to more than it declares is cut off while reading, not trusted.
func TestImportDoesNotTrustDeclaredSizes(t *testing.T) {
	data := rawZip(t, []rawEntry{
		{name: "Vault/Luege.md", data: []byte(prose(3 * maxImportNoteBytes)), deflate: true, declaredUnpack: 1000},
		{name: "Vault/Echt.md", data: []byte("- Inhalt"), deflate: true, declaredUnpack: 8},
	})
	plan, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sum := plan.Summary(false)
	if sum.Notes != 1 || skippedFor(sum, "Luege.md") == "" {
		t.Fatalf("the entry lying about its size must be skipped: %+v", sum)
	}
}

func TestImportSkipsNoteWithTooManyBullets(t *testing.T) {
	data := zipOf(t, map[string]string{
		"Vault/Lang.md":   strings.Repeat("- x\n", collab.MaxNoteBlocks+1),
		"Vault/Kurz.md":   "- Inhalt",
		"Vault/Grenze.md": strings.Repeat("- y\n", collab.MaxNoteBlocks),
	})
	plan, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sum := plan.Summary(false)
	if sum.Notes != 2 || skippedFor(sum, "Lang.md") != "zu viele Punkte (max. 20.000 pro Notiz)" {
		t.Fatalf("only the note over the bullet limit should be skipped: %+v", sum)
	}
	if blocks, ok := markdownToBlocks(strings.Repeat("- z\n", 10*collab.MaxNoteBlocks), collab.MaxNoteBlocks); ok || blocks != nil {
		t.Errorf("conversion must stop at the limit, got %d blocks", len(blocks))
	}
}

func TestImportRefusesTooManyTasks(t *testing.T) {
	data := zipOf(t, map[string]string{
		"Aufgaben/Viele.md": strings.Repeat("- [ ] a\n", maxImportItems+1),
		"Notiz.md":          "- Inhalt",
	})
	if _, err := PlanMindSiftArchiveImport(bytes.NewReader(data), int64(len(data))); err == nil || !strings.Contains(err.Error(), "Zu viele Einträge") {
		t.Fatalf("an archive with more than %d tasks must be refused, got %v", maxImportItems, err)
	}
}

// The plan keeps no note in memory: blocks are read again when it is applied, and the import still
// creates every note with its blocks and pictures.
func TestImportPlanReadsNotesWhenApplied(t *testing.T) {
	store, anna, ben := newImportStore(t)
	data := zipOf(t, map[string]string{
		"Vault/Eins.md":  "# Eins\n- Punkt\n\n![[bild.png]]",
		"Vault/Zwei.md":  "- Zwei",
		"Vault/bild.png": string(pngBytes(t, 4)),
	})
	plan, err := PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	for _, d := range plan.Docs {
		if d.blocks != nil || d.src == nil {
			t.Fatalf("plan holds the blocks of %q", d.title)
		}
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	docs, _ := store.GetDocuments(ben.ID)
	if len(docs) != 2 {
		t.Fatalf("want 2 notes, got %d", len(docs))
	}
	images := 0
	for _, d := range docs {
		for _, b := range d.Blocks {
			if b.Type == "image" {
				images++
			}
		}
	}
	if images != 1 {
		t.Errorf("the picture should be imported once, got %d image blocks", images)
	}

	// A JSON backup is read again too
	seedAnna(t, store, anna)
	exp, _ := store.ExportUserData(anna.ID)
	raw, _ := json.Marshal(exp)
	jplan, err := PlanMindSiftJSONImport(raw)
	if err != nil {
		t.Fatalf("plan JSON: %v", err)
	}
	if len(jplan.Docs) != 1 || jplan.Docs[0].blocks != nil || jplan.jsonDocs == nil {
		t.Fatalf("the JSON plan should list the note without its blocks: %+v", jplan.Docs)
	}
}

// A note in a JSON backup over the bullet limit is skipped in the preview instead of ending the import.
func TestImportJSONSkipsOversizedNote(t *testing.T) {
	big := make([]domain.DocumentBlock, collab.MaxNoteBlocks+1)
	for i := range big {
		big[i] = domain.DocumentBlock{ID: fmt.Sprintf("b%d", i), Type: "bullet", Content: "x"}
	}
	exp := domain.FullExport{ExportedAt: "2026-11-13T00:00:00Z", Version: "1.0.0", Documents: []domain.Document{
		{Title: "Riesig", IsOwner: true, Blocks: big},
		{Title: "Normal", IsOwner: true, Blocks: []domain.DocumentBlock{{ID: "n1", Type: "bullet", Content: "Inhalt"}}},
	}}
	raw, _ := json.Marshal(exp)
	plan, err := PlanMindSiftJSONImport(raw)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if sum := plan.Summary(false); sum.Notes != 1 || skippedFor(sum, "Riesig") != "zu viele Punkte (max. 20.000 pro Notiz)" {
		t.Fatalf("the oversized note should be skipped: %+v", sum)
	}
}
