package storage

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/mindsift-app/mindsift/internal/importer"
)

// The plan keeps no note in memory: blocks are read again when it is applied, and the import still
// creates every note with its blocks and pictures.
func TestImportPlanReadsNotesWhenApplied(t *testing.T) {
	store, anna, ben := newImportStore(t)
	data := zipOf(t, map[string]string{
		"Vault/Eins.md":  "# Eins\n- Punkt\n\n![[bild.png]]",
		"Vault/Zwei.md":  "- Zwei",
		"Vault/bild.png": string(pngBytes(t, 4)),
	})
	plan, err := importer.PlanObsidianImport(bytes.NewReader(data), int64(len(data)), "Vault.zip")
	if err != nil {
		t.Fatalf("plan: %v", err)
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
	jplan, err := importer.PlanMindSiftJSONImport(raw)
	if err != nil {
		t.Fatalf("plan JSON: %v", err)
	}
	if _, err := store.ApplyImport(ben.ID, jplan); err != nil {
		t.Fatalf("apply JSON: %v", err)
	}
	if docs, _ := store.GetDocuments(ben.ID); len(docs) != 3 {
		t.Fatalf("want 3 notes after the JSON backup, got %d", len(docs))
	}
}
