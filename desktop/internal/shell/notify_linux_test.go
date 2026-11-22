//go:build linux

package shell

import (
	"testing"

	"github.com/godbus/dbus/v5"
)

// The signals of the notification server and the portal, without a bus: only a click on one of this app's
// notes counts; a server without actions reports a click as "dismissed".
func TestDBusNotesClicks(t *testing.T) {
	var got []string
	d := &DBusNotes{OnClick: func(data string) { got = append(got, data) }, shown: map[uint32]string{}, byNote: map[string]uint32{}, actions: true}
	d.shown[7], d.byNote["mindsift-task-1"] = `{"i":"a","t":"1"}`, 7
	d.shown[8] = `{"i":"a","t":"2"}`

	d.handle(&dbus.Signal{Name: fdoName + ".ActionInvoked", Body: []any{uint32(99), fdoDefault}}) // another app's
	d.handle(&dbus.Signal{Name: fdoName + ".ActionInvoked", Body: []any{uint32(7), fdoDefault}})
	d.handle(&dbus.Signal{Name: fdoName + ".ActionInvoked", Body: []any{uint32(7), fdoDefault}}) // gone after the click
	d.handle(&dbus.Signal{Name: fdoName + ".NotificationClosed", Body: []any{uint32(8), uint32(2)}})
	if len(got) != 1 || got[0] != `{"i":"a","t":"1"}` {
		t.Fatalf("clicks with actions: %q", got)
	}
	if len(d.shown) != 0 || len(d.byNote) != 0 {
		t.Errorf("closed notes still tracked: %v %v", d.shown, d.byNote)
	}

	// Without actions (some servers): closed by the user = clicked; expired (1) is no click
	d.actions = false
	d.shown[9], d.shown[10] = `{"i":"a","t":"3"}`, `{"i":"a","t":"4"}`
	d.handle(&dbus.Signal{Name: fdoName + ".NotificationClosed", Body: []any{uint32(9), uint32(1)}})
	d.handle(&dbus.Signal{Name: fdoName + ".NotificationClosed", Body: []any{uint32(10), uint32(2)}})
	if len(got) != 2 || got[1] != `{"i":"a","t":"4"}` {
		t.Fatalf("clicks without actions: %q", got)
	}

	// The portal sends the target back with its own action
	d.handle(&dbus.Signal{Name: portalIface + ".ActionInvoked", Body: []any{"mindsift-task-5", portalOpen, []dbus.Variant{dbus.MakeVariant(`{"i":"a","t":"5"}`)}}})
	d.handle(&dbus.Signal{Name: portalIface + ".ActionInvoked", Body: []any{"mindsift-task-5", "other", []dbus.Variant{dbus.MakeVariant("x")}}})
	d.handle(&dbus.Signal{Name: portalIface + ".ActionInvoked", Body: []any{"broken"}})
	if len(got) != 3 || got[2] != `{"i":"a","t":"5"}` {
		t.Fatalf("portal clicks: %q", got)
	}
}

// What goes over the bus: the app's name, icon and desktop entry; markup escaped only where the server
// reads markup; the portal's click target.
func TestDBusNoteArguments(t *testing.T) {
	n := Note{ID: "mindsift-task-1", Title: "⏰ Aufgabe fällig", Body: "Brot & <Butter>", Data: "d"}
	args := fdoArgs(n, 3, true)
	if args[0] != "MindSift" || args[1] != uint32(3) || args[2] != DesktopEntryID || args[3] != n.Title || args[4] != "Brot &amp; &lt;Butter&gt;" {
		t.Errorf("Notify arguments: %v", args)
	}
	if actions := args[5].([]string); len(actions) != 2 || actions[0] != fdoDefault {
		t.Errorf("actions: %v", actions)
	}
	if hints := args[6].(map[string]dbus.Variant); hints["desktop-entry"].Value() != DesktopEntryID {
		t.Errorf("hints: %v", hints)
	}
	if args := fdoArgs(n, 0, false); args[4] != "Brot & <Butter>" {
		t.Errorf("plain body: %v", args[4])
	}
	p := portalNotification(n)
	if p["title"].Value() != n.Title || p["body"].Value() != n.Body || p["default-action"].Value() != portalOpen || p["default-action-target"].Value() != "d" {
		t.Errorf("portal notification: %v", p)
	}
}
