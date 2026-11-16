package storage

import (
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// The demo accounts get the journal on the first start, relative to today, and both see the same days.
func TestEnsureDemoAccountsSeedsJournal(t *testing.T) {
	s, _ := newSyncTestStore(t)
	if err := s.EnsureDemoAccounts(); err != nil {
		t.Fatal(err)
	}
	admin, _ := s.GetUserByLogin("admin")
	member, _ := s.GetUserByLogin("user")
	adminDays, err := s.JournalDays(admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	memberDays, _ := s.JournalDays(member.ID)
	if len(adminDays) < 12 || len(memberDays) != len(adminDays) {
		t.Fatalf("journal days: admin %d, demo user %d", len(adminDays), len(memberDays))
	}
	if want := clock.Now().AddDate(0, 0, -1).Format("2006-01-02"); adminDays[0].Date != want {
		t.Errorf("newest journal day %s, want %s", adminDays[0].Date, want)
	}
	if doc, err := s.GetDocumentByID(member.ID, memberDays[0].DocID); err != nil || len(doc.Blocks) == 0 {
		t.Errorf("demo user cannot open the journal note: %v", err)
	}
}

// The demo's journal: entries for most of the last three weeks counted back from the time passed in (so it
// looks current after every reset), in both languages, titled like the app titles a day, and every [[link]]
// finds its note.
func TestSeedDemoJournal(t *testing.T) {
	for _, lang := range []string{"de", "en"} {
		// Two different "now"s: the days must follow the passed time, not a fixed date
		for _, now := range []time.Time{
			time.Date(2027, 3, 2, 23, 50, 0, 0, time.UTC),
			time.Date(2026, 12, 31, 0, 10, 0, 0, time.UTC),
		} {
			s, u := newSyncTestStore(t)
			if err := s.SetLanguage(u.ID, lang); err != nil {
				t.Fatal(err)
			}
			if err := s.SeedStarterContent(u); err != nil {
				t.Fatal(err)
			}
			s.seedDemoJournal(u, lang, now)

			days, err := s.JournalDays(u.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(days) < 12 || len(days) > 16 {
				t.Fatalf("%s: %d journal days, want 12 to 16", lang, len(days))
			}
			today := now.Format("2006-01-02")
			if want := now.AddDate(0, 0, -1).Format("2006-01-02"); days[0].Date != want {
				t.Errorf("%s: newest day %s, want %s (yesterday)", lang, days[0].Date, want)
			}
			if last := days[len(days)-1].Date; last < now.AddDate(0, 0, -21).Format("2006-01-02") || last > now.AddDate(0, 0, -18).Format("2006-01-02") {
				t.Errorf("%s: oldest day %s does not reach back about three weeks", lang, last)
			}
			var checked, open, tagged int
			for _, d := range days {
				if d.Empty || d.Date >= today {
					t.Errorf("%s: day %s is empty or not in the past", lang, d.Date)
				}
				doc, err := s.GetDocumentByID(u.ID, d.DocID)
				if err != nil {
					t.Fatal(err)
				}
				day, _ := time.Parse("2006-01-02", d.Date)
				if want := i18n.LongDate(lang, day); doc.Title != want {
					t.Errorf("%s: day %s is titled %q, want %q", lang, d.Date, doc.Title, want)
				}
				if n := len(doc.Blocks); n < 3 || n > 10 {
					t.Errorf("%s: %s has %d bullets, want 3 to 10", lang, d.Date, n)
				}
				for _, b := range doc.Blocks {
					if b.Type == "todo" {
						if b.Checked {
							checked++
						} else {
							open++
						}
					}
					if strings.Contains(b.Content, "#") {
						tagged++
					}
					links, _ := wikiLinks(b.Content)
					for _, l := range links {
						if l.DocID == "" {
							t.Errorf("%s: %s links to %q, which is no note (or not unique)", lang, d.Date, l.Title)
						}
					}
				}
			}
			if checked < 8 || open < 8 || tagged < 15 {
				t.Errorf("%s: %d ticked and %d open to-dos, %d lines with hashtags", lang, checked, open, tagged)
			}
		}
	}
}
