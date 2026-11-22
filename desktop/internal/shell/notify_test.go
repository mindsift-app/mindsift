package shell

import (
	"errors"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/api"
)

type fakeShower struct {
	notes []Note
	err   error
}

func (f *fakeShower) Show(n Note) error {
	if f.err != nil {
		return f.err
	}
	f.notes = append(f.notes, n)
	return nil
}

// An alarm of an instance becomes a note whose click names that instance and the task; foreign or broken
// click data does nothing.
func TestNotificationsNotifyAndClick(t *testing.T) {
	shower := &fakeShower{}
	var clicked [][2]string
	n := &Notifications{Shower: shower, Clicked: func(instance, task string) { clicked = append(clicked, [2]string{instance, task}) }}

	if err := n.Notify("inst-1", api.DesktopNotification{Title: "⏰ Aufgabe fällig", Body: "Zahnarzt anrufen – heute, 14:00", TaskID: "th_1", Tag: "task-th_1"}); err != nil {
		t.Fatal(err)
	}
	if len(shower.notes) != 1 {
		t.Fatalf("notes: %+v", shower.notes)
	}
	note := shower.notes[0]
	if note.ID != "mindsift-task-th_1" || note.Title != "⏰ Aufgabe fällig" || note.Body != "Zahnarzt anrufen – heute, 14:00" {
		t.Errorf("note: %+v", note)
	}
	n.Click(note.Data)
	n.Click("")
	n.Click(`{"t":"th_1"}`) // no instance
	n.Click("not json")
	if len(clicked) != 1 || clicked[0] != [2]string{"inst-1", "th_1"} {
		t.Errorf("clicks: %v", clicked)
	}

	// A long digest is cut; the platform's error comes back to the alarm (tried again in its next run)
	shower.err = errors.New("no notification server")
	if err := n.Notify("inst-1", api.DesktopNotification{Title: "x", Body: "y"}); err == nil {
		t.Error("the platform's error must come back")
	}
	shower.err = nil
	_ = n.Notify("inst-1", api.DesktopNotification{Title: "MindSift: Deine Aufgaben für heute", Body: strings.Repeat("• Aufgabe\n", 100)})
	if b := []rune(shower.notes[1].Body); len(b) > maxNoteBody || !strings.HasSuffix(string(b), "…") || shower.notes[1].ID != "mindsift" {
		t.Errorf("long body: %d runes, id %q", len(b), shower.notes[1].ID)
	}

	if err := (&Notifications{}).Notify("inst-1", api.DesktopNotification{}); err == nil {
		t.Error("without a platform's notifications Notify must fail")
	}
}

// The script that opens the task runs only on the window's own app pages and passes the id as a link
// query, escaped.
func TestOpenTaskScript(t *testing.T) {
	js := OpenTaskScript("wails://localhost", `th_1"&x=<y>`)
	for _, want := range []string{`"wails://localhost"`, `'/__desktop/'`, `mindsift:open-link`, `"?task=th_1%22%26x%3D%3Cy%3E"`} {
		if !strings.Contains(js, want) {
			t.Errorf("script lacks %s: %s", want, js)
		}
	}
	if strings.Contains(js, `<y>`) {
		t.Errorf("unescaped id: %s", js)
	}
}
