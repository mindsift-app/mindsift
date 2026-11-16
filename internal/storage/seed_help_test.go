package storage

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Namen der Hilfe-Ordner je Sprache
var helpFolders = map[string]string{
	"de": "MindSift-Hilfe", "en": "MindSift help", "es": "Ayuda de MindSift", "fr": "Aide MindSift", "it": "Aiuto di MindSift",
}

// Beispiel-Syntax in der Hilfe ("`[[Notiztitel]]`"), kein echter Link
var helpExampleLinks = map[string]bool{
	"Notiztitel": true, "Note title": true, "Título de la nota": true, "Titre de la note": true, "Titolo della nota": true,
}

// helpShape: die Notizen eines Kontos mit Symbol und Blocktypen (Typ und Ebene), ohne Texte, sortiert (die
// Reihenfolge der Notizen ist nicht festgehalten)
func helpShape(t *testing.T, s *Store, userID string) []string {
	t.Helper()
	docs, err := s.GetDocuments(userID)
	if err != nil {
		t.Fatal(err)
	}
	var shape []string
	for _, d := range docs {
		full, err := s.GetDocumentByID(userID, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		var types []string
		for _, b := range full.Blocks {
			types = append(types, fmt.Sprintf("%s:%d", b.Type, b.Level))
		}
		shape = append(shape, fmt.Sprintf("%s|%s", full.Icon, strings.Join(types, ",")))
	}
	slices.Sort(shape)
	return shape
}

// checkHelpLinks: jeder [[Link]] in den Notizen des Kontos führt zu einer Notiz (außer der Beispiel-Syntax)
func checkHelpLinks(t *testing.T, s *Store, userID, lang string) {
	t.Helper()
	docs, _ := s.GetDocuments(userID)
	for _, d := range docs {
		full, err := s.GetDocumentByID(userID, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, b := range full.Blocks {
			links, _ := wikiLinks(b.Content)
			for _, l := range links {
				if l.DocID == "" && !helpExampleLinks[l.Title] {
					t.Errorf("%s: %q verlinkt %q, das ist keine Notiz", lang, d.Title, l.Title)
				}
			}
		}
	}
}

// Die Einrichtung legt nur die Hilfe-Notizen an: keine Aufgabenlisten, Listen, Gedanken und keine Notizen
// außerhalb des Hilfe-Ordners; in jeder Sprache dieselben Notizen mit denselben Symbolen und Blöcken.
func TestHilfeNotizenAllerSprachen(t *testing.T) {
	var reference []string
	for _, lang := range []string{"en", "de", "es", "fr", "it"} {
		s, u := newSyncTestStore(t)
		if err := s.SetLanguage(u.ID, lang); err != nil {
			t.Fatal(err)
		}
		count := func(table string) (n int) {
			_ = s.db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, u.ID).Scan(&n)
			return n
		}
		thoughts, taskLists, lists := count("thoughts"), count("task_lists"), count("lists")
		if err := s.SeedHelpNotes(u); err != nil {
			t.Fatal(err)
		}
		if count("thoughts") != thoughts || count("task_lists") != taskLists || count("lists") != lists {
			t.Errorf("%s: die Hilfe darf keine Gedanken, Aufgabenlisten oder Listen anlegen", lang)
		}
		var inFolder, outside int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND folder_path = ?`, u.ID, helpFolders[lang]).Scan(&inFolder)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND folder_path != ?`, u.ID, helpFolders[lang]).Scan(&outside)
		if inFolder != 9 || outside != 0 {
			t.Errorf("%s: %d Hilfe-Notizen im Ordner %q, %d außerhalb (erwartet 9 und 0)", lang, inFolder, helpFolders[lang], outside)
		}
		checkHelpLinks(t, s, u.ID, lang)

		shape := helpShape(t, s, u.ID)
		if reference == nil {
			reference = shape
			continue
		}
		if len(shape) != len(reference) {
			t.Fatalf("%s: %d Notizen, Englisch %d", lang, len(shape), len(reference))
		}
		for i := range shape {
			if shape[i] != reference[i] {
				t.Errorf("%s: Notiz %d (sortiert) hat Symbol/Blöcke %q, Englisch %q", lang, i+1, shape[i], reference[i])
			}
		}
	}
}

// Die Demo behält alle Beispieldaten: neben der Hilfe Aufgabenlisten, Listen, Gedanken und weitere Notizen.
// In Spanisch, Französisch und Italienisch sind die Beispieldaten englisch, und mit ihnen die Hilfe: die
// Beispiel-Notizen verlinken die Hilfe-Notizen unter ihrem englischen Titel. Alle Verknüpfungen finden ihre Notiz.
func TestDemoBehaeltAlleBeispieldaten(t *testing.T) {
	for _, lang := range []string{"de", "en", "es", "fr", "it"} {
		s, u := newSyncTestStore(t)
		if err := s.SetLanguage(u.ID, lang); err != nil {
			t.Fatal(err)
		}
		if err := s.SeedStarterContent(u); err != nil {
			t.Fatal(err)
		}
		folder := helpFolders[lang]
		if lang != "de" {
			folder = helpFolders["en"]
		}
		var help, others, taskLists, lists, thoughts int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND folder_path = ?`, u.ID, folder).Scan(&help)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND folder_path != ?`, u.ID, folder).Scan(&others)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM task_lists WHERE user_id = ?`, u.ID).Scan(&taskLists)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM lists WHERE user_id = ?`, u.ID).Scan(&lists)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE user_id = ?`, u.ID).Scan(&thoughts)
		if help != 9 || others < 30 || taskLists < 2 || lists < 2 || thoughts < 10 {
			t.Errorf("%s: %d Hilfe-Notizen, %d weitere Notizen, %d Aufgabenlisten, %d Listen, %d Gedanken", lang, help, others, taskLists, lists, thoughts)
		}
		checkHelpLinks(t, s, u.ID, lang)
	}
}
