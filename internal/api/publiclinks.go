package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Public links: the owner shares one note read only with anyone who has the address /p/<token>,
// optionally behind a password, always for a limited time (at most publicLinkMaxDays). The page polls
// for changes, so visitors see the note as it is being written. Visitors get no names, no hidden values
// and no links into other notes (storage.PublicBlocks). The owner routes sit among the note routes, so
// API keys and MCP cannot create links (apikey_access.go).

// publicLinkHours are the durations the owner can pick.
var publicLinkHours = []int{1, 24, 72, 168, 336}

// publicKeyTTL: how long a visitor stays unlocked after entering the password.
const publicKeyTTL = 12 * time.Hour

// publicPasswordTries: wrong passwords per link and address before a pause (loginGuard window).
const publicPasswordTries = 10

func hashPublicToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// publicKey signs "unlocked until" for one link and its password; a new password or link voids it.
func (s *Server) publicKey(l *storage.PublicLink, until time.Time) string {
	exp := strconv.FormatInt(until.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte("public-link:" + l.ID + ":" + l.PasswordHash + ":" + exp))
	return exp + "." + hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) validPublicKey(l *storage.PublicLink, key string, now time.Time) bool {
	exp, _, ok := strings.Cut(key, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !ok || err != nil || now.Unix() >= n {
		return false
	}
	return hmac.Equal([]byte(key), []byte(s.publicKey(l, time.Unix(n, 0))))
}

// publicHeaders keep a public answer out of search engines, caches and other sites' referrers.
func publicHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
}

// publicLink finds the link of the request's token; with checkKey a password-protected link also needs
// the visitor's key (header X-Public-Key). Writes the error itself.
func (s *Server) publicLink(w http.ResponseWriter, r *http.Request, checkKey bool) *storage.PublicLink {
	publicHeaders(w)
	if !s.publicLinksEnabled() {
		writeError(w, http.StatusNotFound, storage.ErrPublicLinkNotFound.Error())
		return nil
	}
	l, err := s.store.PublicLinkByTokenHash(hashPublicToken(chi.URLParam(r, "token")), time.Now())
	if err != nil {
		writeError(w, http.StatusNotFound, storage.ErrPublicLinkNotFound.Error())
		return nil
	}
	if checkKey && l.PasswordHash != "" && !s.validPublicKey(l, r.Header.Get("X-Public-Key"), time.Now()) {
		writeErrorCode(w, http.StatusUnauthorized, "password_required", "Passwort erforderlich")
		return nil
	}
	return l
}

// handlePublicNote: GET /public/{token}[?since=<headSeq>] – the note for visitors; 204 when nothing
// changed since the given log position.
func (s *Server) handlePublicNote(w http.ResponseWriter, r *http.Request) {
	l := s.publicLink(w, r, true)
	if l == nil {
		return
	}
	snap, err := s.store.GetDocSnapshotCtx(r.Context(), l.DocID)
	if r.Context().Err() != nil {
		return
	}
	if err != nil {
		writeError(w, http.StatusNotFound, storage.ErrPublicLinkNotFound.Error())
		return
	}
	if since := r.URL.Query().Get("since"); since != "" && since == strconv.FormatInt(snap.HeadSeq, 10) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"title":        snap.Title,
		"icon":         s.store.DocIcon(l.DocID),
		"expiresAt":    l.ExpiresAt,
		"headSeq":      snap.HeadSeq,
		"titleVersion": snap.TitleVersion,
		"blocks":       storage.PublicBlocks(snap.Blocks),
	})
}

// handlePublicUnlock: POST /public/{token}/unlock {password} – a key for a password-protected link.
func (s *Server) handlePublicUnlock(w http.ResponseWriter, r *http.Request) {
	l := s.publicLink(w, r, false)
	if l == nil {
		return
	}
	if l.PasswordHash == "" {
		writeJSON(w, http.StatusOK, map[string]string{"key": ""})
		return
	}
	if wait := s.loginGuard.throttle("public:"+l.ID, clientIPFrom(r), publicPasswordTries); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !auth.CheckPassword(req.Password, l.PasswordHash) {
		writeErrorCode(w, http.StatusUnauthorized, "password_wrong", "Falsches Passwort")
		return
	}
	until := time.Now().Add(publicKeyTTL)
	if exp, err := time.Parse(time.RFC3339, l.ExpiresAt); err == nil && exp.Before(until) {
		until = exp
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": s.publicKey(l, until)})
}

// handlePublicMedia: GET /public/{token}/media/{mediaId} – an image or recording the note shows.
func (s *Server) handlePublicMedia(w http.ResponseWriter, r *http.Request) {
	l := s.publicLink(w, r, true)
	if l == nil {
		return
	}
	m, err := s.store.GetMedia(chi.URLParam(r, "mediaId"))
	if err != nil || !s.store.DocShowsMedia(l.DocID, m.ID) {
		writeError(w, http.StatusNotFound, storage.ErrMediaNotFound.Error())
		return
	}
	f, err := os.Open(s.mediaPath(m))
	if err != nil {
		writeError(w, http.StatusNotFound, storage.ErrMediaNotFound.Error())
		return
	}
	defer f.Close()
	s.serveMediaFile(w, r, m, f) // no-store from publicHeaders: a revoked link leaves nothing behind
}

// --- The owner's side ---

type publicLinkView struct {
	Token       string `json:"token"`
	ExpiresAt   string `json:"expiresAt"`
	HasPassword bool   `json:"hasPassword"`
}

// ownPublicLink: only the note's owner manages its link. Writes the error itself.
func (s *Server) ownPublicLink(w http.ResponseWriter, r *http.Request) (userID, docID string, ok bool) {
	userID = auth.GetUserID(r.Context())
	docID = chi.URLParam(r, "id")
	if s.store.DocOwner(docID) != userID {
		writeError(w, http.StatusNotFound, storage.ErrDocNotFound.Error())
		return "", "", false
	}
	return userID, docID, true
}

func (s *Server) writePublicLinkState(w http.ResponseWriter, l *storage.PublicLink) {
	out := map[string]interface{}{
		"enabled": s.publicLinksEnabled(),
		"maxDays": s.publicLinkMaxDays(),
		"link":    nil,
	}
	if l != nil {
		if token, err := s.openSecret(l.ID, l.TokenSealed); err == nil {
			out["link"] = publicLinkView{Token: token, ExpiresAt: l.ExpiresAt, HasPassword: l.PasswordHash != ""}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetPublicLink: GET /documents/{id}/public-link – whether the note has a link, and the limits.
func (s *Server) handleGetPublicLink(w http.ResponseWriter, r *http.Request) {
	_, docID, ok := s.ownPublicLink(w, r)
	if !ok {
		return
	}
	l, err := s.store.PublicLinkOfDoc(docID, time.Now())
	if err != nil {
		l = nil
	}
	s.writePublicLinkState(w, l)
}

// handleSetPublicLink: PUT /documents/{id}/public-link {hours, password} – a new link (the
// previous address stops working).
func (s *Server) handleSetPublicLink(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := s.ownPublicLink(w, r)
	if !ok {
		return
	}
	if !s.publicLinksEnabled() {
		writeError(w, http.StatusForbidden, "Öffentliche Links sind auf diesem Server abgeschaltet")
		return
	}
	var req struct {
		Hours    int    `json:"hours"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	allowed := false
	for _, h := range publicLinkHours {
		allowed = allowed || h == req.Hours
	}
	if !allowed || req.Hours > s.publicLinkMaxDays()*24 {
		writeError(w, http.StatusBadRequest, "Diese Laufzeit ist nicht erlaubt")
		return
	}
	pwHash := ""
	if req.Password != "" {
		if len(req.Password) > 200 {
			writeError(w, http.StatusBadRequest, "Das Passwort ist zu lang")
			return
		}
		h, err := auth.HashPassword(req.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Passwort-Hash fehlgeschlagen")
			return
		}
		pwHash = h
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	now := time.Now().UTC()
	l := &storage.PublicLink{
		ID:           storage.NewPublicLinkID(),
		DocID:        docID,
		CreatedBy:    userID,
		TokenHash:    hashPublicToken(token),
		PasswordHash: pwHash,
		ExpiresAt:    now.Add(time.Duration(req.Hours) * time.Hour).Format(time.RFC3339),
		CreatedAt:    now.Format(time.RFC3339),
	}
	sealed, err := s.sealSecret(l.ID, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	l.TokenSealed = sealed
	if err := s.store.SavePublicLink(l); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writePublicLinkState(w, l)
}

// handleDeletePublicLink: DELETE /documents/{id}/public-link – the address stops working at once.
func (s *Server) handleDeletePublicLink(w http.ResponseWriter, r *http.Request) {
	_, docID, ok := s.ownPublicLink(w, r)
	if !ok {
		return
	}
	if err := s.store.DeletePublicLink(docID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writePublicLinkState(w, nil)
}

// runPublicLinkCleanup removes expired links (hourly, with the other retention work).
func (s *Server) runPublicLinkCleanup(now time.Time) {
	_, _ = s.store.PurgePublicLinks(now)
}
