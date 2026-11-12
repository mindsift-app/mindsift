package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Two-factor sign-in. With an authenticator app or a passkey (passkeys.go), the password alone gives no
// session: POST /auth/login answers {mfaRequired, mfaToken, methods} instead of a token, and POST
// /auth/login/mfa trades the mfaToken plus a code of the app (or a recovery code) for the session, POST
// /auth/login/mfa/passkey the mfaToken plus the answer of a passkey. The mfaToken is no
// session: it lives in memory, for mfaChallengeTTL, bound to the account and its token_version, and is
// dropped after mfaMaxAttempts wrong codes. Wrong codes count in the loginGuard like wrong passwords, and
// the password step clears no counters while the code is still to come, so the lock cannot be dodged by
// entering the password again between guesses.
//
// "Trust this device": the second step can hand out a token that spares the code on this device for 30
// days (storage.TrustedDeviceLifetime). The app keeps it in localStorage beside the session token and
// sends it with the password (trustTokens); there are no cookies anywhere in MindSift. Ending all
// sessions, a new password and switching the last second factor off end the trust (storage/mfa.go).
//
// methods lists the ways the second step can be done: "totp", "passkey" (while passkeys are on), and
// "recovery". An account with only passkeys is asked for one after the password like one with the app;
// recovery codes and trusted devices belong to the account and stay while one second factor is left.

const (
	mfaChallengeTTL = 5 * time.Minute
	mfaMaxAttempts  = 5
	// maxTrustTokens: how many trust tokens of one browser (several accounts) a login looks at
	maxTrustTokens = 10
	mfaMethodTOTP  = "totp"
	mfaMethodCode  = "recovery"
)

type mfaChallenge struct {
	userID       string
	tokenVersion int
	expires      time.Time
	attempts     int
	// passkey: the challenge of the last POST /auth/login/mfa/passkey/options, used up by the answer
	passkey *webauthn.SessionData
}

type mfaChallenges struct {
	mu   sync.Mutex
	list map[string]*mfaChallenge
}

func (c *mfaChallenges) issue(user *domain.User, now time.Time) (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := "mfa_" + hex.EncodeToString(buf)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.list == nil {
		c.list = map[string]*mfaChallenge{}
	}
	for k, v := range c.list {
		if !now.Before(v.expires) {
			delete(c.list, k)
		}
	}
	c.list[id] = &mfaChallenge{userID: user.ID, tokenVersion: user.TokenVersion, expires: now.Add(mfaChallengeTTL)}
	return id, nil
}

// get returns a copy of the challenge while it is valid.
func (c *mfaChallenges) get(id string, now time.Time) (mfaChallenge, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.list[id]
	if !ok || !now.Before(ch.expires) {
		delete(c.list, id)
		return mfaChallenge{}, false
	}
	return *ch, true
}

// failed counts a wrong code; after mfaMaxAttempts the challenge is gone and the password is asked again.
func (c *mfaChallenges) failed(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ch, ok := c.list[id]; ok {
		ch.attempts++
		if ch.attempts >= mfaMaxAttempts {
			delete(c.list, id)
		}
	}
}

// consume removes the challenge; false when it was used in the meantime (two answers at once).
func (c *mfaChallenges) consume(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.list[id]; !ok {
		return false
	}
	delete(c.list, id)
	return true
}

// setPasskey keeps the passkey challenge of a waiting sign-in (replacing an earlier one).
func (c *mfaChallenges) setPasskey(id string, session *webauthn.SessionData) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.list[id]
	if ok {
		ch.passkey = session
	}
	return ok
}

// takePasskey returns the passkey challenge of a waiting sign-in and forgets it: one answer per challenge.
func (c *mfaChallenges) takePasskey(id string) *webauthn.SessionData {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.list[id]
	if !ok {
		return nil
	}
	session := ch.passkey
	ch.passkey = nil
	return session
}

// mfaMethods: the ways of the second step for this account. Passkeys only while they are on: without
// them (BASE_URL changed) an account that has nothing else signs in with a recovery code.
func (s *Server) mfaMethods(userID string) []string {
	var methods []string
	if s.store.TOTPActive(userID) {
		methods = append(methods, mfaMethodTOTP)
	}
	if s.passkeysOn() && s.store.HasPasskeys(userID) {
		methods = append(methods, mfaMethodPasskey)
	}
	return append(methods, mfaMethodCode)
}

// trustedDevice reports whether one of the tokens the browser sent trusts this device for the account.
func (s *Server) trustedDevice(user *domain.User, tokens []string) bool {
	for i, t := range tokens {
		if i >= maxTrustTokens {
			break
		}
		if t != "" && s.store.TrustedDeviceValid(user.ID, user.TokenVersion, t, s.now()) {
			return true
		}
	}
	return false
}

// writeMFAChallenge answers a right password of an account with a second factor.
func (s *Server) writeMFAChallenge(w http.ResponseWriter, user *domain.User) {
	id, err := s.mfaChallenges.issue(user, s.now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mfaRequired": true,
		"mfaToken":    id,
		"methods":     s.mfaMethods(user.ID),
		"expiresIn":   int(mfaChallengeTTL.Seconds()),
	})
}

var sixDigits = regexp.MustCompile(`^[0-9]{6}$`)

// checkSecondFactor checks a code of the account's app or one of its recovery codes (told apart by the
// form: six digits are the app's) and uses it up. method says which one it was.
func (s *Server) checkSecondFactor(userID, code string) (method string, ok bool) {
	now := s.now()
	if clean := auth.NormalizeOTP(code); sixDigits.MatchString(clean) {
		t, err := s.store.GetTOTP(userID)
		if err != nil || !t.Active() {
			return mfaMethodTOTP, false
		}
		secret, err := s.openSecret(totpSealID(userID), t.SecretSealed)
		if err != nil {
			slog.Warn("The authenticator secret could not be decrypted (SECRETS_KEY or secrets.key changed?); recovery codes still work", "user_id", userID)
			return mfaMethodTOTP, false
		}
		key, err := auth.DecodeTOTPSecret(secret)
		if err != nil {
			return mfaMethodTOTP, false
		}
		step, ok := auth.VerifyTOTP(key, clean, now, t.LastStep)
		if !ok {
			return mfaMethodTOTP, false
		}
		used, err := s.store.UseTOTPStep(userID, step)
		logFailed("Recording the used code step", err, "user_id", userID)
		return mfaMethodTOTP, used
	}
	used, err := s.store.UseRecoveryCode(userID, code, now)
	logFailed("Using a recovery code", err, "user_id", userID)
	return mfaMethodCode, used
}

// totpSealID: the additional data the account's secret is sealed with, so it opens for no other row.
func totpSealID(userID string) string { return "totp:" + userID }

// handleLoginMFA: POST /auth/login/mfa {mfaToken, code, trustDevice} → {token, user, recoveryCodesLeft,
// trustToken?, trustedDeviceId?}. code is the app's six digits or a recovery code.
func (s *Server) handleLoginMFA(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MFAToken    string `json:"mfaToken"`
		Code        string `json:"code"`
		TrustDevice bool   `json:"trustDevice"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "Bitte gib den Code ein")
		return
	}
	s.finishSecondStep(w, r, req.MFAToken, req.TrustDevice, func(user *domain.User) (string, bool) {
		return s.checkSecondFactor(user.ID, req.Code)
	})
}

// finishSecondStep is the second step of a sign-in with the mfaToken: check says whether the code or
// passkey of the account was right (and which method it was). Then the session starts, with a trusted
// device when asked.
func (s *Server) finishSecondStep(w http.ResponseWriter, r *http.Request, mfaToken string, trustDevice bool, check func(user *domain.User) (method string, ok bool)) {
	expired := func() {
		writeErrorCode(w, http.StatusUnauthorized, "mfa_expired", "Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.")
	}
	ch, ok := s.mfaChallenges.get(mfaToken, s.now())
	if !ok {
		expired()
		return
	}
	user, err := s.store.GetUserByID(ch.userID)
	if err != nil || user == nil || !user.IsActive || user.TokenVersion != ch.tokenVersion {
		s.mfaChallenges.consume(mfaToken)
		expired()
		return
	}
	ip := clientIPFrom(r)
	if wait := s.loginGuard.lockedFor(user.ID, ip); wait > 0 {
		writeLoginLocked(w, wait)
		return
	}
	method, ok := check(user)
	if !ok {
		s.loginGuard.recordFailure(user.ID, ip)
		s.mfaChallenges.failed(mfaToken)
		slog.Warn("Sign-in failed: wrong second factor", "user_id", user.ID, "method", method, "remote_addr", r.RemoteAddr)
		if method == mfaMethodPasskey {
			writeErrorCode(w, http.StatusUnauthorized, "mfa_invalid", "Der Passkey wurde nicht angenommen")
		} else {
			writeErrorCode(w, http.StatusUnauthorized, "mfa_invalid", "Der Code ist falsch oder abgelaufen")
		}
		return
	}
	if !s.mfaChallenges.consume(mfaToken) {
		expired()
		return
	}
	s.loginGuard.recordSuccess(user.ID, ip)

	token, err := s.startSession(r, user)
	if err != nil {
		slog.Error("Creating the sign-in token failed", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
		return
	}
	out := map[string]any{
		"token":             token,
		"user":              user,
		"method":            method,
		"recoveryCodesLeft": s.store.RecoveryCodesLeft(user.ID),
	}
	if trustDevice {
		trust, device, err := s.store.CreateTrustedDevice(user.ID, user.TokenVersion, r.UserAgent(), s.now())
		if err != nil {
			logFailed("Trusting the device", err, "user_id", user.ID)
		} else {
			out["trustToken"] = trust
			out["trustedDeviceId"] = device.ID
		}
	}
	slog.Info("Sign-in successful", "user_id", user.ID, "display_name", user.DisplayName, "role", user.Role, "second_factor", method, "remote_addr", r.RemoteAddr)
	writeJSON(w, http.StatusOK, out)
}

// secondFactor: what a sensitive change sends beside the password: a code (app or recovery code), or the
// answer of a passkey to the challenge of POST /auth/mfa/passkeys/challenge.
type secondFactor struct {
	Code         string          `json:"code"`
	PasskeyToken string          `json:"passkeyToken"`
	Passkey      json.RawMessage `json:"passkey"`
}

// confirmWithSecondFactor checks the current password and, when the account has a second factor, a
// code or passkey of it for a sensitive change. Wrong guesses of either count like failed logins. Writes
// the error itself.
func (s *Server) confirmWithSecondFactor(w http.ResponseWriter, r *http.Request, user *domain.User, password string, f secondFactor) bool {
	if !s.checkCurrentPassword(w, r, user, password) {
		return false
	}
	if !s.store.MFAActive(user.ID) {
		return true
	}
	if f.PasskeyToken != "" {
		if !s.confirmPasskey(user, f.PasskeyToken, f.Passkey) {
			s.loginGuard.recordFailure(user.ID, clientIPFrom(r))
			writeErrorCode(w, http.StatusForbidden, "mfa_invalid", "Der Passkey wurde nicht angenommen")
			return false
		}
		return true
	}
	if f.Code == "" {
		if s.store.TOTPActive(user.ID) {
			writeErrorCode(w, http.StatusForbidden, "mfa_required", "Bitte gib zur Bestätigung einen Code deiner Authenticator-App ein")
		} else {
			writeErrorCode(w, http.StatusForbidden, "mfa_required", "Bitte bestätige mit deinem Passkey oder einem Wiederherstellungscode")
		}
		return false
	}
	if _, ok := s.checkSecondFactor(user.ID, f.Code); !ok {
		s.loginGuard.recordFailure(user.ID, clientIPFrom(r))
		writeErrorCode(w, http.StatusForbidden, "mfa_invalid", "Der Code ist falsch oder abgelaufen")
		return false
	}
	return true
}

// --- The own settings ---

func (s *Server) currentUser(w http.ResponseWriter, r *http.Request) (*domain.User, bool) {
	user, err := s.store.GetUserByID(auth.GetUserID(r.Context()))
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return nil, false
	}
	return user, true
}

// handleMFAStatus: GET /auth/mfa → whether the app is on, since when, the recovery codes left and the
// trusted devices. available is false in the demo, whose accounts everybody shares.
func (s *Server) handleMFAStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	totp := map[string]any{"enabled": false, "enabledAt": ""}
	if t, err := s.store.GetTOTP(user.ID); err == nil && t.Active() {
		totp = map[string]any{"enabled": true, "enabledAt": t.ConfirmedAt}
	}
	devices, err := s.store.ListTrustedDevices(user.ID, user.TokenVersion, s.now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	passkeys, err := s.store.ListPasskeys(user.ID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	_, _, passkeysOff := s.passkeyRP()
	writeJSON(w, http.StatusOK, map[string]any{
		"available": !s.cfg.DemoMode,
		// enabled: the account signs in with a second factor (app or passkey)
		"enabled":  totp["enabled"] == true || len(passkeys) > 0,
		"totp":     totp,
		"passkeys": passkeys,
		// Why passkeys cannot be used here (demo, no_base_url, not_https, ip_address); empty when they can
		"passkeysOff":       passkeysOff,
		"recoveryCodesLeft": s.store.RecoveryCodesLeft(user.ID),
		"trustedDevices":    devices,
		"trustDays":         int(storage.TrustedDeviceLifetime.Hours() / 24),
	})
}

// handleTOTPSetup: POST /auth/mfa/totp/setup {password, code | passkeyToken + passkey} → {secret, uri}. A
// new secret waiting for its first code; the password guards against somebody at an open session locking
// the owner out, a passkey of the account (when it has one) against a second factor added with a stolen
// password.
func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	if s.store.TOTPActive(user.ID) {
		writeErrorFrom(w, http.StatusConflict, storage.ErrTOTPAlreadyActive)
		return
	}
	if !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
		return
	}
	secret, err := auth.NewTOTPSecret()
	if err != nil {
		writeInternal(w, err)
		return
	}
	sealed, err := s.sealSecret(totpSealID(user.ID), secret)
	if err == nil {
		err = s.store.StartTOTPSetup(user.ID, sealed, s.now())
	}
	if errors.Is(err, storage.ErrTOTPAlreadyActive) {
		writeErrorFrom(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	account := user.Email
	if account == "" {
		account = user.Username
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"secret": secret,
		"uri":    auth.TOTPURI(s.instanceName(), account, secret),
	})
}

// handleTOTPConfirm: POST /auth/mfa/totp/confirm {code} → {recoveryCodes, enabledAt}. The first code of the
// app switches it on; the recovery codes are shown this once. An account that has passkeys keeps its
// recovery codes (recoveryCodes is empty then).
func (s *Server) handleTOTPConfirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	t, err := s.store.GetTOTP(user.ID)
	if errors.Is(err, storage.ErrTOTPNotFound) {
		writeErrorFrom(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	if t.Active() {
		writeErrorFrom(w, http.StatusConflict, storage.ErrTOTPAlreadyActive)
		return
	}
	secret, err := s.openSecret(totpSealID(user.ID), t.SecretSealed)
	if err != nil {
		writeInternal(w, err)
		return
	}
	key, err := auth.DecodeTOTPSecret(secret)
	if err != nil {
		writeInternal(w, err)
		return
	}
	now := s.now()
	step, ok := auth.VerifyTOTP(key, req.Code, now, 0)
	if !ok {
		writeErrorCode(w, http.StatusBadRequest, "mfa_invalid", "Der Code stimmt nicht. Prüfe, ob die Uhr des Geräts richtig geht, und gib den aktuellen Code ein.")
		return
	}
	codes, hashes := []string{}, []string(nil)
	if !s.store.HasPasskeys(user.ID) {
		if codes, hashes, err = newRecoveryCodes(user.ID); err != nil {
			writeInternal(w, err)
			return
		}
	}
	done, err := s.store.ConfirmTOTP(user.ID, step, hashes, now)
	if err != nil {
		writeInternal(w, err)
		return
	}
	if !done {
		writeErrorFrom(w, http.StatusConflict, storage.ErrTOTPAlreadyActive)
		return
	}
	slog.Info("Two-factor sign-in switched on", "user_id", user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes, "enabledAt": now.UTC().Format(time.RFC3339)})
}

func newRecoveryCodes(userID string) (codes, hashes []string, err error) {
	codes, err = storage.NewRecoveryCodes()
	if err != nil {
		return nil, nil, err
	}
	hashes = make([]string, len(codes))
	for i, c := range codes {
		hashes[i] = storage.HashRecoveryCode(userID, c)
	}
	return codes, hashes, nil
}

// handleTOTPDisable: POST /auth/mfa/totp/disable {password, code | passkeyToken + passkey} → {disabled,
// mfaOff}: the app goes; without a passkey the recovery codes and the trusted devices go too (mfaOff).
func (s *Server) handleTOTPDisable(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	if !s.store.TOTPActive(user.ID) {
		writeErrorFrom(w, http.StatusConflict, storage.ErrTOTPNotFound)
		return
	}
	if !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
		return
	}
	mfaOff, err := s.store.DisableTOTP(user.ID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	if mfaOff {
		slog.Info("Two-factor sign-in switched off", "user_id", user.ID)
	} else {
		slog.Info("Authenticator app removed, passkeys stay", "user_id", user.ID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"disabled": true, "mfaOff": mfaOff})
}

// handleNewRecoveryCodes: POST /auth/mfa/recovery-codes {password, code | passkeyToken + passkey} →
// {recoveryCodes}; the earlier codes stop working.
func (s *Server) handleNewRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	if !s.store.MFAActive(user.ID) {
		writeErrorFrom(w, http.StatusConflict, storage.ErrTOTPNotFound)
		return
	}
	if !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
		return
	}
	codes, hashes, err := newRecoveryCodes(user.ID)
	if err == nil {
		err = s.store.ReplaceRecoveryCodes(user.ID, hashes, s.now())
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// handleRemoveTrustedDevice: DELETE /auth/mfa/trusted-devices/{id} – that device is asked for a code again.
func (s *Server) handleRemoveTrustedDevice(w http.ResponseWriter, r *http.Request) {
	err := s.store.RemoveTrustedDevice(auth.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if errors.Is(err, storage.ErrTrustedDeviceNotFound) {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}

// handleRemoveTrustedDevices: DELETE /auth/mfa/trusted-devices – every device is asked for a code again.
func (s *Server) handleRemoveTrustedDevices(w http.ResponseWriter, r *http.Request) {
	if err := s.store.RemoveTrustedDevices(auth.GetUserID(r.Context())); err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}

// instanceName: the name of this server as the admin set it, shown as issuer in authenticator apps.
func (s *Server) instanceName() string {
	if sys, err := s.store.GetSystemSettings(); err == nil && sys != nil && sys.InstanceName != "" {
		return sys.InstanceName
	}
	return "MindSift"
}
