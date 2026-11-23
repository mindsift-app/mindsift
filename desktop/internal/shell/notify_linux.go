//go:build linux

package shell

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// Notifications on Linux, over the session bus. Under Flatpak through the notification portal
// (org.freedesktop.portal.Notification), which every Flatpak app may use without a permission; otherwise
// straight to the desktop's notification server (org.freedesktop.Notifications: GNOME Shell, KDE Plasma,
// dunst, mako …). Not Wails' notification service: it talks to org.freedesktop.Notifications only (a Flatpak
// would need --talk-name for it), stops the whole app when the bus is missing at its start, and gives the
// notification neither the app's icon nor its desktop entry.

const (
	fdoName     = "org.freedesktop.Notifications"
	fdoPath     = "/org/freedesktop/Notifications"
	portalName  = "org.freedesktop.portal.Desktop"
	portalPath  = "/org/freedesktop/portal/desktop"
	portalIface = "org.freedesktop.portal.Notification"
	// fdoDefault: the action a click on the notification itself invokes (Desktop Notifications spec)
	fdoDefault = "default"
	// portalOpen: the portal's default action; without the "app." prefix the portal answers with the
	// ActionInvoked signal instead of activating an action of the application over D-Bus
	portalOpen = "open"
	// dbusTimeout: a notification server that does not answer holds no alarm run for long
	dbusTimeout = 10 * time.Second
)

// DBusNotes shows notes over D-Bus; the connection is made at the first note (and again after it broke).
type DBusNotes struct {
	// Portal: through the notification portal (under Flatpak)
	Portal bool
	// OnClick gets a clicked note's Data
	OnClick func(data string)

	mu   sync.Mutex
	conn *dbus.Conn
	// What the notification server offers (org.freedesktop.Notifications only): actions (a click comes as
	// ActionInvoked) and markup in the body (then & and < are escaped)
	actions, markup bool
	// shown: the server's id of each note still shown → its Data; byNote: a note's ID → the server's id,
	// so a later note with the same ID replaces it
	shown  map[uint32]string
	byNote map[string]uint32
}

// NewDBusNotes: the portal under Flatpak (InFlatpak), the notification server otherwise.
func NewDBusNotes(onClick func(data string)) *DBusNotes {
	return &DBusNotes{Portal: InFlatpak(), OnClick: onClick}
}

// Show shows n.
func (d *DBusNotes) Show(n Note) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	conn, err := d.connect()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbusTimeout)
	defer cancel()
	if d.Portal {
		err = conn.Object(portalName, portalPath).CallWithContext(ctx, portalIface+".AddNotification", 0, n.ID, portalNotification(n)).Err
	} else {
		replaces := d.byNote[n.ID]
		var id uint32
		err = conn.Object(fdoName, fdoPath).CallWithContext(ctx, fdoName+".Notify", 0, fdoArgs(n, replaces, d.markup)...).Store(&id)
		if err == nil {
			delete(d.shown, replaces)
			d.shown[id] = n.Data
			d.byNote[n.ID] = id
		}
	}
	if err != nil && !conn.Connected() {
		d.conn = nil // connect again at the next note
	}
	return err
}

// Close closes the connection (when the app quits).
func (d *DBusNotes) Close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.conn != nil {
		_ = d.conn.Close()
		d.conn = nil
	}
}

// connect returns the connection, made now if there is none; d.mu is held.
func (d *DBusNotes) connect() (*dbus.Conn, error) {
	if d.conn != nil && d.conn.Connected() {
		return d.conn, nil
	}
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return nil, err
	}
	iface := fdoName
	if d.Portal {
		iface = portalIface
	}
	members := []string{"ActionInvoked"}
	if !d.Portal {
		members = append(members, "NotificationClosed")
	}
	for _, m := range members {
		if err := conn.AddMatchSignal(dbus.WithMatchInterface(iface), dbus.WithMatchMember(m)); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	if !d.Portal {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		var caps []string
		if err := conn.Object(fdoName, fdoPath).CallWithContext(ctx, fdoName+".GetCapabilities", 0).Store(&caps); err == nil {
			d.actions, d.markup = slices.Contains(caps, "actions"), slices.Contains(caps, "body-markup")
		} else {
			slog.Info("Desktop notifications: the notification server's capabilities are unknown", "error", err)
		}
		cancel()
	}
	d.shown, d.byNote = map[uint32]string{}, map[string]uint32{}
	signals := make(chan *dbus.Signal, 16)
	conn.Signal(signals)
	go func() {
		for sig := range signals { // closed when the connection closes
			d.handle(sig)
		}
	}()
	d.conn = conn
	return conn, nil
}

// handle: a signal of the notification server or the portal; a click on one of this app's notes goes to
// OnClick.
func (d *DBusNotes) handle(sig *dbus.Signal) {
	if data, ok := d.clicked(sig); ok && d.OnClick != nil {
		d.OnClick(data)
	}
}

// clicked: the Data of the note sig says was clicked
func (d *DBusNotes) clicked(sig *dbus.Signal) (string, bool) {
	switch sig.Name {
	case portalIface + ".ActionInvoked": // (s id, s action, av parameter): the target comes back
		if len(sig.Body) < 3 {
			return "", false
		}
		action, _ := sig.Body[1].(string)
		params, _ := sig.Body[2].([]dbus.Variant)
		if action != portalOpen || len(params) == 0 {
			return "", false
		}
		data, ok := params[0].Value().(string)
		return data, ok
	case fdoName + ".ActionInvoked": // (u id, s action): only ids of this app's notes count
		if len(sig.Body) < 2 {
			return "", false
		}
		id, _ := sig.Body[0].(uint32)
		action, _ := sig.Body[1].(string)
		data, ok := d.forget(id)
		return data, ok && action == fdoDefault
	case fdoName + ".NotificationClosed": // (u id, u reason)
		if len(sig.Body) < 2 {
			return "", false
		}
		id, _ := sig.Body[0].(uint32)
		reason, _ := sig.Body[1].(uint32)
		d.mu.Lock()
		actions := d.actions
		d.mu.Unlock()
		data, ok := d.forget(id)
		// A server without actions closes a note when it is clicked (reason 2, dismissed by the user):
		// that is the only click it reports
		return data, ok && reason == 2 && !actions
	}
	return "", false
}

// forget drops a note the server no longer shows; its Data, if it was one of this app's
func (d *DBusNotes) forget(id uint32) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	data, ok := d.shown[id]
	if !ok {
		return "", false
	}
	delete(d.shown, id)
	for note, sid := range d.byNote {
		if sid == id {
			delete(d.byNote, note)
		}
	}
	return data, true
}

// portalNotification: the portal's notification (title, body, a click invokes portalOpen with the Data)
func portalNotification(n Note) map[string]dbus.Variant {
	return map[string]dbus.Variant{
		"title":                 dbus.MakeVariant(n.Title),
		"body":                  dbus.MakeVariant(n.Body),
		"default-action":        dbus.MakeVariant(portalOpen),
		"default-action-target": dbus.MakeVariant(n.Data),
	}
}

// fdoArgs: the arguments of org.freedesktop.Notifications.Notify (app name, replaced id, icon, summary,
// body, actions, hints, timeout). The icon and the desktop entry are the app's own (app.mindsift.MindSift,
// installed by the loose binary itself or by the package), so the desktop shows MindSift's name and icon.
func fdoArgs(n Note, replaces uint32, markup bool) []any {
	body := n.Body
	if markup {
		body = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(body)
	}
	hints := map[string]dbus.Variant{
		"desktop-entry": dbus.MakeVariant(DesktopEntryID),
		"urgency":       dbus.MakeVariant(byte(1)), // normal
	}
	return []any{"MindSift", replaces, DesktopEntryID, n.Title, body, []string{fdoDefault, Text("openTask")}, hints, int32(-1)}
}
