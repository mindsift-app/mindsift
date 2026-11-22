package api

// System notifications of the desktop app. A local instance's server runs inside the app's process (desktop/),
// so its alarms need no push service: the app's shell hands them to the operating system (D-Bus on Linux,
// toasts on Windows) while the app is open. The shell sets the notifier right after NewServer
// (SetDesktopNotifier); without one (every normal server, the app's tests) the channel "desktop" has nothing
// to deliver to and the capability desktopNotify is off.

// DesktopNotification is one notification for the operating system.
type DesktopNotification struct {
	Title string
	Body  string
	// TaskID: the task a click on the notification opens (empty: a click only brings the window up)
	TaskID string
	// Tag: a later notification with the same tag replaces this one where the system can (one per task)
	Tag string
}

// DesktopNotifier shows notifications of the operating system; the desktop app's shell implements it.
type DesktopNotifier interface {
	Notify(DesktopNotification) error
}

// DesktopNotifierFunc lets a function be a DesktopNotifier.
type DesktopNotifierFunc func(DesktopNotification) error

func (f DesktopNotifierFunc) Notify(n DesktopNotification) error { return f(n) }

// desktopNotifierBox: atomic.Pointer needs a concrete type
type desktopNotifierBox struct{ n DesktopNotifier }

// SetDesktopNotifier gives the server the app's system notifications (nil takes them away). Only in desktop
// mode: a normal server never shows notifications on the machine it runs on.
func (s *Server) SetDesktopNotifier(n DesktopNotifier) {
	if n == nil || !s.desktopMode() {
		s.desktopNotifier.Store(nil)
		return
	}
	s.desktopNotifier.Store(&desktopNotifierBox{n: n})
}

// desktopNotifierOf: the notifier, nil without one
func (s *Server) desktopNotifierOf() DesktopNotifier {
	if b := s.desktopNotifier.Load(); b != nil {
		return b.n
	}
	return nil
}

// notifyDesktop shows n through the app; errChannelNotSetUp without a notifier.
func (s *Server) notifyDesktop(n DesktopNotification) error {
	notifier := s.desktopNotifierOf()
	if notifier == nil {
		return errChannelNotSetUp
	}
	return notifier.Notify(n)
}
