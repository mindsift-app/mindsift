package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/mindsift-app/mindsift/internal/auth"
)

// Web push: browsers and installed apps (Android, iOS from 16.4 as home screen app, desktop) subscribe
// with the server's VAPID key; notifications reach them even when MindSift is closed. Push is one more
// channel next to e-mail, Discord and the own webhook (notification settings). The VAPID key pair comes
// from VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY or is generated once and kept in the database.

type pushKeys struct {
	once         sync.Once
	public, priv string
	err          error
}

func (s *Server) vapidKeys() (string, string, error) {
	s.push.once.Do(func() {
		if s.cfg.VAPIDPublicKey != "" && s.cfg.VAPIDPrivateKey != "" {
			s.push.public, s.push.priv = s.cfg.VAPIDPublicKey, s.cfg.VAPIDPrivateKey
			return
		}
		s.push.public, s.push.priv, s.push.err = s.store.PushKeys(func() (string, string, error) {
			priv, pub, err := webpush.GenerateVAPIDKeys()
			return pub, priv, err
		})
	})
	return s.push.public, s.push.priv, s.push.err
}

// vapidSubject: contact for the push services (VAPID_SUBJECT, else the https base URL)
func (s *Server) vapidSubject() string {
	if s.cfg.VAPIDSubject != "" {
		return s.cfg.VAPIDSubject
	}
	if s.cfg.BaseURLSet && strings.HasPrefix(s.cfg.BaseURL, "https://") {
		return strings.TrimRight(s.cfg.BaseURL, "/")
	}
	return "mailto:push@mindsift.invalid"
}

type pushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag,omitempty"`
}

// sendPush delivers a message to every device of the user; devices the push service no longer knows
// are forgotten. Error when no device could be reached.
func (s *Server) sendPush(userID string, msg pushMessage) error {
	if s.notifyPushHook != nil {
		return s.notifyPushHook(userID, msg)
	}
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	subs, err := s.store.PushSubscriptions(userID)
	if err != nil || len(subs) == 0 {
		return err
	}
	pub, priv, err := s.vapidKeys()
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(msg)
	client := s.pushHTTPClient
	if client == nil {
		client = guardedClient(s.allowPrivateWebhooks())
	}
	var lastErr error
	sent := 0
	for _, sub := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
		}, &webpush.Options{
			HTTPClient:      client,
			Subscriber:      s.vapidSubject(),
			VAPIDPublicKey:  pub,
			VAPIDPrivateKey: priv,
			TTL:             24 * 3600,
			Urgency:         webpush.UrgencyHigh,
		})
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
			s.store.ForgetPushEndpoint(sub.Endpoint)
		case resp.StatusCode >= 400:
			lastErr = fmt.Errorf("Push-Dienst antwortet mit HTTP %d", resp.StatusCode)
		default:
			sent++
		}
	}
	if sent == 0 && lastErr != nil {
		return lastErr
	}
	return nil
}

func (s *Server) handlePushKey(w http.ResponseWriter, r *http.Request) {
	if s.cfg.DemoMode {
		writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": false})
		return
	}
	pub, _, err := s.vapidKeys()
	if err != nil {
		slog.Error("VAPID keys not available", "error", err)
		writeError(w, http.StatusInternalServerError, "Push ist auf diesem Server nicht verfügbar")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": true, "publicKey": pub})
}

func (s *Server) handlePushDevices(w http.ResponseWriter, r *http.Request) {
	subs, err := s.store.PushSubscriptions(auth.GetUserID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Geräte konnten nicht geladen werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"devices": subs})
}

func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	if s.cfg.DemoMode {
		writeError(w, http.StatusForbidden, "In der Demo deaktiviert")
		return
	}
	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
		Device string `json:"device"`
		// The subscription this browser had before (e.g. before a reinstall): it is dead now
		Replaces string `json:"replaces"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if err := validPushEndpoint(req.Endpoint); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Keys.P256dh == "" || req.Keys.Auth == "" {
		writeError(w, http.StatusBadRequest, "Schlüssel des Geräts fehlen")
		return
	}
	device := strings.TrimSpace(req.Device)
	if len(device) > 120 {
		device = device[:120]
	}
	userID := auth.GetUserID(r.Context())
	if err := s.store.SavePushSubscription(userID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth, device); err != nil {
		writeError(w, http.StatusInternalServerError, "Gerät konnte nicht gespeichert werden")
		return
	}
	if req.Replaces != "" && req.Replaces != req.Endpoint {
		_ = s.store.DeletePushSubscription(userID, req.Replaces) // only ever one of the own devices
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if err := s.store.DeletePushSubscription(auth.GetUserID(r.Context()), req.Endpoint); err != nil {
		writeError(w, http.StatusInternalServerError, "Gerät konnte nicht entfernt werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePushTest(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	subs, _ := s.store.PushSubscriptions(userID)
	if len(subs) == 0 {
		writeError(w, http.StatusBadRequest, "Auf keinem Gerät sind Push-Benachrichtigungen eingeschaltet")
		return
	}
	err := s.sendPush(userID, pushMessage{Title: "MindSift", Body: "Test: Push-Benachrichtigungen kommen an.", URL: "/", Tag: "test"})
	if err != nil {
		if errors.Is(err, errDemoOutgoing) {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		slog.Warn("Test push failed", "user_id", userID, "error", err)
		writeError(w, http.StatusBadGateway, "Push konnte nicht zugestellt werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"devices": len(subs)})
}

// validPushEndpoint: the push services of the browsers are https URLs on the public internet.
func validPushEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(endpoint) > 2048 {
		return errors.New("Ungültige Push-Adresse")
	}
	return nil
}
