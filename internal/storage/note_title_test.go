package storage

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/mindsift-app/mindsift/internal/collab"
)

// A numbered title (" (2)") stays within the title limit: the base is shortened, not the number
func TestUniqueTitleStaysWithinTheLimit(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	long := strings.Repeat("ä", collab.MaxTitleRunes)
	if _, err := store.CreateDocument(alice.ID, "", long, "", "", nil, nil, false); err != nil {
		t.Fatal(err)
	}
	got := store.uniqueTitle(alice.ID, long)
	if n := utf8.RuneCountInString(got); n > collab.MaxTitleRunes {
		t.Fatalf("%q has %d characters, want at most %d", got, n, collab.MaxTitleRunes)
	}
	if !strings.HasSuffix(got, "… (2)") {
		t.Fatalf("want the shortened base with … (2), got %q", got)
	}
	if !titleFrom(got, long) {
		t.Fatalf("titleFrom does not recognise %q as made from the base", got)
	}
	if _, err := store.CreateDocument(alice.ID, "", got, "", "", nil, nil, false); err != nil {
		t.Fatal(err)
	}
	if third := store.uniqueTitle(alice.ID, long); third == got || utf8.RuneCountInString(third) > collab.MaxTitleRunes {
		t.Fatalf("third title %q", third)
	}
	// Short titles keep their full base
	if _, err := store.CreateDocument(alice.ID, "", "Einkauf", "", "", nil, nil, false); err != nil {
		t.Fatal(err)
	}
	if got := store.uniqueTitle(alice.ID, "Einkauf"); got != "Einkauf (2)" {
		t.Fatalf("got %q", got)
	}
	if titleFrom("Einkauf (x)", "Einkauf") || !titleFrom("einkauf (3)", "Einkauf") {
		t.Fatal("titleFrom")
	}
}

func TestFirstLineTitle(t *testing.T) {
	cases := map[string]string{
		"Einkauf\nMilch\nBrot":      "Einkauf",
		"\n  \n  Zweite Zeile  \nx": "Zweite Zeile",
		"  \n\t":                    "",
		"Ein Satz":                  "Ein Satz",
		"Zeile\r\nNächste":          "Zeile",
	}
	for in, want := range cases {
		if got := FirstLineTitle(in); got != want {
			t.Errorf("FirstLineTitle(%q) = %q, want %q", in, got, want)
		}
	}
	long := FirstLineTitle(strings.Repeat("x", 80) + "\nRest")
	if utf8.RuneCountInString(long) != collab.MaxTitleRunes || !strings.HasSuffix(long, "…") {
		t.Fatalf("long first line: %q", long)
	}
}

// Inbox → note: the title is the first line of the entry, without its line breaks
func TestInboxToNoteTakesTheFirstLineAsTitle(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	th, err := store.CreateThought(alice.ID, "\nWochenplan\nMontag: Sport\nDienstag: Kochen", "normal", "manual", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.UpdateThoughtTriage(alice.ID, th.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := store.GetDocumentByID(alice.ID, conv.ConvertedRefID)
	if err != nil || doc == nil {
		t.Fatalf("note: %v", err)
	}
	if doc.Title != "Wochenplan" {
		t.Fatalf("title %q, want Wochenplan", doc.Title)
	}
}
