package config

// Desktop mode: the server runs inside the desktop app (desktop/), for one person, and its router answers
// only the app's own window (no port, not even on localhost). The app switches it on with ApplyDesktop after
// Load; there is no environment variable for it, so a normal server cannot be put into this mode by its
// environment.

// Desktop platforms (Desktop.Platform)
const (
	DesktopLinux   = "linux"
	DesktopWindows = "windows"
)

// Desktop describes the app the server runs in.
type Desktop struct {
	// Platform: DesktopLinux or DesktopWindows; decides the realtime transport the window uses
	Platform string
	// Origin: the origin of the app's window (wails://localhost on Linux, http://wails.localhost on Windows);
	// the only one the server answers cross-origin requests for, and the only one that may get a session
	Origin string
	// Username and DisplayName: the account created on the first start, from the system's user (login name
	// and full name); a username MindSift does not accept becomes "me"
	Username    string
	DisplayName string
}

// Realtime is the transport the window uses for live updates: no WebSocket in the app (its webview hands
// requests to the server in-process and has no WebSocket upgrade), server-sent events where the webview
// streams responses (Linux), long polling where it buffers whole responses (Windows).
func (d Desktop) Realtime() string {
	if d.Platform == DesktopWindows {
		return "poll"
	}
	return "sse"
}

// ApplyDesktop puts the server into desktop mode and switches off what a single-person app inside a window
// cannot use, whatever the environment says: the demo, registration, mail, sign-in through a provider, public
// links and calendar feeds (both would need an address others can reach), metrics and the first administrator
// from ADMIN_USER (the server creates the one account itself).
func (c *Config) ApplyDesktop(d Desktop) {
	c.Desktop = &d
	c.DemoMode = false
	c.DemoResetMinutes = 0
	c.AllowRegistration = false
	c.RegistrationMode = "closed"
	c.RegistrationDomains = ""
	c.RegistrationVerifyEmail = "false"
	c.SMTPDisabled = true
	c.SMTPHost, c.SMTPUser, c.SMTPPass, c.SMTPFrom = "", "", "", ""
	c.OIDC = OIDCConfig{}
	c.InitialAdmin = InitialAdmin{}
	c.BaseURLSet = false
	c.MetricsToken = ""
	c.TrustedProxies = "none"
	c.VAPIDPublicKey, c.VAPIDPrivateKey, c.VAPIDSubject = "", "", ""
	off, noCalendar := false, false
	c.PublicLinks = &off
	c.CalendarFeeds = &noCalendar
}
