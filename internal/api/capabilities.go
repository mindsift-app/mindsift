package api

import (
	"net/http"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// Capabilities: what this instance offers, decided in this one place from the configuration and the
// administration's settings. /auth/status sends them, and the app asks them (frontend lib/capabilities.ts)
// instead of "am I the desktop app?". The desktop app (desktopMode) is just an instance that switches
// several of them off; a server switches some off too (sharing mode private, SMTP_DISABLED, no https
// BASE_URL for passkeys …). Routes that need one refuse with requires.
type capability string

const (
	// capAccounts: several accounts can exist: registration, invites, the administration's people,
	// organizations, roles and login names
	capAccounts capability = "accounts"
	// capSignIn: people sign in and out: passwords, a second factor, devices, the own address
	capSignIn capability = "signIn"
	// capSharing: notes, folders and lists can be shared with others: share buttons, groups, assignees,
	// mentions, muting shared lists (off in sharing mode private)
	capSharing capability = "sharing"
	// capEmail: the instance may send mail at all (e-mail alarms, invite mails); off with SMTP_DISABLED
	capEmail capability = "email"
	// capPush: web push to browsers and installed apps
	capPush capability = "push"
	// capPasskeys: signing in with a passkey (an https BASE_URL, not the demo)
	capPasskeys capability = "passkeys"
	// capPublicLinks: notes shareable by a public link
	capPublicLinks capability = "publicLinks"
	// capPublicAddress: others can reach the instance at an address: calendar feeds, connectors from
	// claude.ai or ChatGPT, Home Assistant, the imprint and privacy notice for visitors
	capPublicAddress capability = "publicAddress"
	// capLiveDrawing: drawing together live (needs a WebSocket connection)
	capLiveDrawing capability = "liveDrawing"
	// capInstall: the app runs in a browser: it can be installed as an app and keeps working offline
	capInstall capability = "install"
	// capDesktopNotify: alarms as notifications of the operating system: a local instance of the desktop
	// app, whose shell shows them (desktop_notify.go), in place of web push
	capDesktopNotify capability = "desktopNotify"
)

// allCapabilities: the ones /auth/status reports.
var allCapabilities = []capability{
	capAccounts, capSignIn, capSharing, capEmail, capPush, capPasskeys, capPublicLinks, capPublicAddress,
	capLiveDrawing, capInstall, capDesktopNotify,
}

// can says whether the instance offers c.
func (s *Server) can(c capability) bool {
	desktop := s.desktopMode()
	switch c {
	case capAccounts, capSignIn, capPush, capPublicAddress, capInstall:
		// The desktop app: one person on one computer, inside a webview that only the app reaches
		return !desktop
	case capLiveDrawing:
		// The desktop app's webview has no WebSocket upgrade (config.Desktop.Realtime)
		return !desktop
	case capSharing:
		return s.can(capAccounts) && s.store.SharingMode() != storage.SharingPrivate
	case capEmail:
		return !s.cfg.SMTPDisabled
	case capPasskeys:
		return s.passkeysOn()
	case capPublicLinks:
		return s.publicLinksEnabled()
	case capDesktopNotify:
		return desktop && s.desktopNotifierOf() != nil
	}
	return false
}

// capabilities: all of them for /auth/status.
func (s *Server) capabilities() map[capability]bool {
	out := make(map[capability]bool, len(allCapabilities))
	for _, c := range allCapabilities {
		out[c] = s.can(c)
	}
	return out
}

// requires refuses a route the instance does not offer (registration, invites, web push …). Only the
// desktop app switches these off, hence the code desktop_off the app knows.
func (s *Server) requires(c capability, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.can(c) {
			writeErrorCode(w, http.StatusForbidden, "desktop_off", "In der Desktop-App nicht verfügbar")
			return
		}
		h(w, r)
	}
}
