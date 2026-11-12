package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Passkeys (WebAuthn, github.com/go-webauthn/webauthn). A passkey is
//   - a second factor after the password (POST /auth/login/mfa/passkey, beside the codes of mfa.go),
//   - a sign-in without password (POST /auth/login/passkey/options and /auth/login/passkey): user
//     verification (PIN, fingerprint, face) is required, so the passkey alone counts as both factors,
//   - a confirmation of sensitive changes instead of a code (confirmWithSecondFactor).
//
// Passkeys are bound to a host name: the relying party is the host of BASE_URL and the only origin
// accepted is BASE_URL's (https, or http://localhost for tests). Without BASE_URL, with plain http or an
// IP address they are off; the host is never guessed from request headers. Not in the demo.
//
// Every ceremony has a challenge that lives passkeyChallengeTTL in memory and is used up by the first
// answer, right or wrong: registration and confirmation are bound to the account (and its token_version),
// the sign-in without password to the ticket handed to that browser, the second step of a sign-in to its
// mfaToken. Passkeys are discoverable credentials (resident keys), the user handle is the account's id.
// The signature counter of a passkey only goes up; one that goes back (a copied authenticator, or two
// answers at once) is refused and logged.

const (
	passkeyChallengeTTL = 5 * time.Minute
	mfaMethodPasskey    = "passkey"
	// Anybody can ask for a sign-in challenge: at most this many wait, the oldest go first …
	maxPasskeyChallenges = 5000
	// … and one address holds at most this many of them
	maxPasskeyChallengesPerIP = 20

	ceremonyRegister = "register"
	ceremonyConfirm  = "confirm"
	ceremonyLogin    = "login"
)

var errPasskeysOff = errors.New("Passkeys sind auf diesem Server nicht eingerichtet")

type passkeyChallenge struct {
	kind         string
	userID       string // empty for the sign-in without password
	tokenVersion int
	ip           string
	session      webauthn.SessionData
	created      time.Time
}

type passkeyChallenges struct {
	mu   sync.Mutex
	list map[string]*passkeyChallenge
}

func (c *passkeyChallenges) issue(ch *passkeyChallenge, now time.Time) (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := "pkc_" + hex.EncodeToString(buf)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.list == nil {
		c.list = map[string]*passkeyChallenge{}
	}
	sameIP := 0
	for k, v := range c.list {
		if now.Sub(v.created) >= passkeyChallengeTTL {
			delete(c.list, k)
		} else if v.ip == ch.ip {
			sameIP++
		}
	}
	if ch.kind == ceremonyLogin && sameIP >= maxPasskeyChallengesPerIP {
		c.dropOldestLocked(ch.ip)
	}
	if len(c.list) >= maxPasskeyChallenges {
		c.dropOldestLocked("")
	}
	ch.created = now
	c.list[id] = ch
	return id, nil
}

// dropOldestLocked removes the oldest challenge (of that address, when ip is given).
func (c *passkeyChallenges) dropOldestLocked(ip string) {
	oldest := ""
	for k, v := range c.list {
		if (ip == "" || v.ip == ip) && (oldest == "" || v.created.Before(c.list[oldest].created)) {
			oldest = k
		}
	}
	delete(c.list, oldest)
}

// take removes the challenge and returns it while it is valid and of this kind: every answer uses it up.
func (c *passkeyChallenges) take(id, kind string, now time.Time) (passkeyChallenge, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.list[id]
	delete(c.list, id)
	if !ok || ch.kind != kind || now.Sub(ch.created) >= passkeyChallengeTTL {
		return passkeyChallenge{}, false
	}
	return *ch, true
}

// passkeyRP: the relying party passkeys are bound to, the host of BASE_URL and its origin; reason says why
// passkeys are off ("" when they are on): demo, no_base_url, not_https or ip_address.
func (s *Server) passkeyRP() (rpID, origin, reason string) {
	if s.cfg.DemoMode {
		return "", "", "demo"
	}
	if !s.cfg.BaseURLSet {
		return "", "", "no_base_url"
	}
	u, err := url.Parse(strings.TrimSpace(s.cfg.BaseURL))
	if err != nil || u.Hostname() == "" {
		return "", "", "no_base_url"
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil {
		return "", "", "ip_address"
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && (scheme != "http" || host != "localhost") {
		return "", "", "not_https"
	}
	// The origin as browsers write it: without the scheme's default port
	origin = scheme + "://" + host
	if port := u.Port(); port != "" && !(scheme == "https" && port == "443") && !(scheme == "http" && port == "80") {
		origin += ":" + port
	}
	return host, origin, ""
}

func (s *Server) passkeysOn() bool {
	_, _, reason := s.passkeyRP()
	return reason == ""
}

// webAuthn: the relying party for one ceremony (the instance name may have changed in between).
func (s *Server) webAuthn() (*webauthn.WebAuthn, error) {
	rpID, origin, reason := s.passkeyRP()
	if reason != "" {
		return nil, errPasskeysOff
	}
	required := true
	return webauthn.New(&webauthn.Config{
		RPID:                  rpID,
		RPDisplayName:         s.instanceName(),
		RPOrigins:             []string{origin},
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: &required,
			UserVerification:   protocol.VerificationRequired,
		},
		Timeouts: webauthn.TimeoutsConfig{
			Login:        webauthn.TimeoutConfig{Timeout: passkeyChallengeTTL, TimeoutUVD: passkeyChallengeTTL},
			Registration: webauthn.TimeoutConfig{Timeout: passkeyChallengeTTL, TimeoutUVD: passkeyChallengeTTL},
		},
	})
}

// passkeysOnly answers 404 while passkeys are off (demo, no https BASE_URL).
func (s *Server) passkeysOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.passkeysOn() {
			writeErrorCode(w, http.StatusNotFound, "passkeys_off", errPasskeysOff.Error())
			return
		}
		next(w, r)
	}
}

// passkeyUser: an account as the WebAuthn library sees it.
type passkeyUser struct {
	user *domain.User
	keys []storage.Passkey
}

func (u passkeyUser) WebAuthnID() []byte { return []byte(u.user.ID) }

func (u passkeyUser) WebAuthnName() string {
	if u.user.Email != "" {
		return u.user.Email
	}
	return u.user.Username
}

func (u passkeyUser) WebAuthnDisplayName() string {
	if u.user.DisplayName != "" {
		return u.user.DisplayName
	}
	return u.WebAuthnName()
}

func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential {
	out := make([]webauthn.Credential, len(u.keys))
	for i, p := range u.keys {
		transports := make([]protocol.AuthenticatorTransport, len(p.Transports))
		for j, t := range p.Transports {
			transports[j] = protocol.AuthenticatorTransport(t)
		}
		out[i] = webauthn.Credential{
			ID:              p.CredentialID,
			PublicKey:       p.PublicKey,
			AttestationType: p.AttestationType,
			Transport:       transports,
			Flags:           webauthn.CredentialFlags{UserPresent: true, UserVerified: true, BackupEligible: p.BackupEligible, BackupState: p.Synced},
			Authenticator:   webauthn.Authenticator{AAGUID: p.AAGUID, SignCount: p.SignCount, Attachment: protocol.AuthenticatorAttachment(p.Attachment)},
		}
	}
	return out
}

func (s *Server) passkeyUserOf(user *domain.User) (passkeyUser, error) {
	keys, err := s.store.ListPasskeys(user.ID)
	return passkeyUser{user: user, keys: keys}, err
}

// recordPasskeyUse stores the counter and backup state of a passkey that answered rightly; false when the
// counter went back, then the sign-in is refused.
func (s *Server) recordPasskeyUse(u passkeyUser, cred *webauthn.Credential) bool {
	var key *storage.Passkey
	for i := range u.keys {
		if string(u.keys[i].CredentialID) == string(cred.ID) {
			key = &u.keys[i]
		}
	}
	if key == nil {
		return false
	}
	if cred.Authenticator.CloneWarning {
		slog.Warn("Passkey refused: its signature counter went back (copied authenticator?)", "user_id", u.user.ID, "passkey_id", key.ID, "stored", key.SignCount)
		return false
	}
	ok, err := s.store.UsePasskey(key.ID, cred.Authenticator.SignCount, cred.Flags.BackupState, s.now())
	logFailed("Recording the use of a passkey", err, "user_id", u.user.ID)
	if !ok && err == nil {
		slog.Warn("Passkey refused: its signature counter is not above the stored one", "user_id", u.user.ID, "passkey_id", key.ID)
	}
	return ok
}

// checkPasskey verifies the browser's answer (the PublicKeyCredential as JSON) to a challenge of this
// account and records the use; false when it is no valid answer of one of the account's passkeys.
func (s *Server) checkPasskey(user *domain.User, session webauthn.SessionData, raw json.RawMessage) bool {
	wa, err := s.webAuthn()
	if err != nil || len(raw) == 0 {
		return false
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(raw)
	if err != nil {
		slog.Debug("Passkey answer not readable", "user_id", user.ID, "error", err)
		return false
	}
	u, err := s.passkeyUserOf(user)
	if err != nil {
		logFailed("Reading the passkeys", err, "user_id", user.ID)
		return false
	}
	cred, err := wa.ValidateLogin(u, session, parsed)
	if err != nil {
		slog.Info("Passkey answer refused", "user_id", user.ID, "error", err)
		return false
	}
	return s.recordPasskeyUse(u, cred)
}

// beginPasskeyAssertion: the options of navigator.credentials.get() for the passkeys of this account.
func (s *Server) beginPasskeyAssertion(user *domain.User) (*protocol.PublicKeyCredentialRequestOptions, *webauthn.SessionData, error) {
	wa, err := s.webAuthn()
	if err != nil {
		return nil, nil, err
	}
	u, err := s.passkeyUserOf(user)
	if err != nil {
		return nil, nil, err
	}
	if len(u.keys) == 0 {
		return nil, nil, storage.ErrPasskeyNotFound
	}
	assertion, session, err := wa.BeginLogin(u)
	if err != nil {
		return nil, nil, err
	}
	return &assertion.Response, session, nil
}

// --- Second factor and confirmation ---

// handlePasskeyChallenge: POST /auth/mfa/passkeys/challenge → {passkeyToken, options}: a passkey of the own
// account confirms a sensitive change (confirmWithSecondFactor) instead of a code.
func (s *Server) handlePasskeyChallenge(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	options, session, err := s.beginPasskeyAssertion(user)
	if errors.Is(err, storage.ErrPasskeyNotFound) {
		writeErrorFrom(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	id, err := s.passkeyChallenges.issue(&passkeyChallenge{kind: ceremonyConfirm, userID: user.ID, tokenVersion: user.TokenVersion,
		ip: clientIPFrom(r).ip, session: *session}, s.now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"passkeyToken": id, "options": options})
}

// confirmPasskey checks a passkey answer for a confirmation of this account.
func (s *Server) confirmPasskey(user *domain.User, token string, raw json.RawMessage) bool {
	ch, ok := s.passkeyChallenges.take(token, ceremonyConfirm, s.now())
	if !ok || ch.userID != user.ID || ch.tokenVersion != user.TokenVersion {
		return false
	}
	return s.checkPasskey(user, ch.session, raw)
}

// handleMFAPasskeyOptions: POST /auth/login/mfa/passkey/options {mfaToken} → {options}: the second step of
// a sign-in with a passkey. A new call replaces the challenge of the one before.
func (s *Server) handleMFAPasskeyOptions(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MFAToken string `json:"mfaToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	expired := func() {
		writeErrorCode(w, http.StatusUnauthorized, "mfa_expired", "Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.")
	}
	ch, ok := s.mfaChallenges.get(req.MFAToken, s.now())
	if !ok {
		expired()
		return
	}
	user, err := s.store.GetUserByID(ch.userID)
	if err != nil || user == nil || !user.IsActive || user.TokenVersion != ch.tokenVersion {
		expired()
		return
	}
	options, session, err := s.beginPasskeyAssertion(user)
	if errors.Is(err, storage.ErrPasskeyNotFound) {
		writeErrorFrom(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	if !s.mfaChallenges.setPasskey(req.MFAToken, session) {
		expired()
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": options})
}

// handleLoginMFAPasskey: POST /auth/login/mfa/passkey {mfaToken, credential, trustDevice} → like
// /auth/login/mfa, with a passkey instead of a code.
func (s *Server) handleLoginMFAPasskey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MFAToken    string          `json:"mfaToken"`
		Credential  json.RawMessage `json:"credential"`
		TrustDevice bool            `json:"trustDevice"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	s.finishSecondStep(w, r, req.MFAToken, req.TrustDevice, func(user *domain.User) (string, bool) {
		session := s.mfaChallenges.takePasskey(req.MFAToken)
		return mfaMethodPasskey, session != nil && s.checkPasskey(user, *session, req.Credential)
	})
}

// --- Sign-in without password ---

// handlePasskeyLoginOptions: POST /auth/login/passkey/options → {token, options}: a challenge for any
// passkey of this server (the browser shows the ones it has; with mediation "conditional" in the login
// field). Says nothing about accounts.
func (s *Server) handlePasskeyLoginOptions(w http.ResponseWriter, r *http.Request) {
	wa, err := s.webAuthn()
	if err != nil {
		writeErrorCode(w, http.StatusNotFound, "passkeys_off", errPasskeysOff.Error())
		return
	}
	assertion, session, err := wa.BeginDiscoverableLogin()
	if err != nil {
		writeInternal(w, err)
		return
	}
	id, err := s.passkeyChallenges.issue(&passkeyChallenge{kind: ceremonyLogin, ip: clientIPFrom(r).ip, session: *session}, s.now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": id, "options": assertion.Response, "expiresIn": int(passkeyChallengeTTL.Seconds())})
}

// handlePasskeyLogin: POST /auth/login/passkey {token, credential} → {token, user}. The same checks as the
// password (account active, address confirmed, approved), failures count in the login protection.
func (s *Server) handlePasskeyLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token      string          `json:"token"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	wa, err := s.webAuthn()
	if err != nil {
		writeErrorCode(w, http.StatusNotFound, "passkeys_off", errPasskeysOff.Error())
		return
	}
	ch, ok := s.passkeyChallenges.take(req.Token, ceremonyLogin, s.now())
	if !ok {
		writeErrorCode(w, http.StatusUnauthorized, "passkey_expired", "Die Anmeldung mit dem Passkey ist abgelaufen. Bitte versuche es noch einmal.")
		return
	}
	refused := func() {
		writeErrorCode(w, http.StatusUnauthorized, "passkey_invalid", "Der Passkey wurde nicht angenommen")
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(req.Credential)
	if err != nil {
		refused()
		return
	}
	// Failures count for the passkey's account; unknown passkeys all under one name, as unknown logins do
	ip := clientIPFrom(r)
	account := "passkey:unknown"
	if key, err := s.store.PasskeyByCredentialID(parsed.RawID); err == nil {
		account = key.UserID
	}
	if wait := s.loginGuard.lockedFor(account, ip); wait > 0 {
		writeLoginLocked(w, wait)
		return
	}
	var owner passkeyUser
	_, cred, err := wa.ValidatePasskeyLogin(func(rawID, _ []byte) (webauthn.User, error) {
		key, err := s.store.PasskeyByCredentialID(rawID)
		if err != nil {
			return nil, err
		}
		user, err := s.store.GetUserByID(key.UserID)
		if err != nil || user == nil {
			return nil, storage.ErrPasskeyNotFound
		}
		if owner, err = s.passkeyUserOf(user); err != nil {
			return nil, err
		}
		return owner, nil
	}, ch.session, parsed)
	if err != nil || !s.recordPasskeyUse(owner, cred) {
		s.loginGuard.recordFailure(account, ip)
		slog.Warn("Sign-in failed: passkey refused", "account", account, "remote_addr", r.RemoteAddr, "error", err)
		refused()
		return
	}
	user := owner.user
	s.loginGuard.recordSuccess(user.ID, ip)
	if !s.signInAllowed(w, r, user) {
		return
	}
	token, err := s.startSession(r, user)
	if err != nil {
		slog.Error("Creating the sign-in token failed", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
		return
	}
	slog.Info("Sign-in successful", "user_id", user.ID, "display_name", user.DisplayName, "role", user.Role, "method", mfaMethodPasskey, "remote_addr", r.RemoteAddr)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

// --- The own passkeys ---

// handlePasskeyRegisterOptions: POST /auth/mfa/passkeys/register/options {password, code | passkeyToken +
// passkey} → {token, options} for navigator.credentials.create(). The password always, a second factor
// when the account has one: a new passkey signs in on its own, so it must not come from a stolen session
// and password alone.
func (s *Server) handlePasskeyRegisterOptions(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok || !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
		return
	}
	wa, err := s.webAuthn()
	if err != nil {
		writeInternal(w, err)
		return
	}
	u, err := s.passkeyUserOf(user)
	if err != nil {
		writeInternal(w, err)
		return
	}
	exclude := make([]protocol.CredentialDescriptor, 0, len(u.keys))
	for _, c := range u.WebAuthnCredentials() {
		exclude = append(exclude, c.Descriptor())
	}
	creation, session, err := wa.BeginRegistration(u, webauthn.WithExclusions(exclude),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired))
	if err != nil {
		writeInternal(w, err)
		return
	}
	id, err := s.passkeyChallenges.issue(&passkeyChallenge{kind: ceremonyRegister, userID: user.ID, tokenVersion: user.TokenVersion,
		ip: clientIPFrom(r).ip, session: *session}, s.now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": id, "options": creation.Response})
}

// handlePasskeyRegister: POST /auth/mfa/passkeys {token, name, credential} → 201 {passkey, recoveryCodes?}.
// The first second factor of an account (no app, no passkey yet) brings ten recovery codes, shown once.
func (s *Server) handlePasskeyRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token      string          `json:"token"`
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	name := storage.CleanPasskeyName(req.Name)
	if name == "" {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrPasskeyNameEmpty)
		return
	}
	ch, ok := s.passkeyChallenges.take(req.Token, ceremonyRegister, s.now())
	if !ok || ch.userID != user.ID || ch.tokenVersion != user.TokenVersion {
		writeErrorCode(w, http.StatusConflict, "passkey_expired", "Das Einrichten des Passkeys ist abgelaufen. Bitte beginne noch einmal.")
		return
	}
	wa, err := s.webAuthn()
	if err != nil {
		writeInternal(w, err)
		return
	}
	u, err := s.passkeyUserOf(user)
	if err != nil {
		writeInternal(w, err)
		return
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(req.Credential)
	var cred *webauthn.Credential
	if err == nil {
		cred, err = wa.CreateCredential(u, ch.session, parsed)
	}
	if err != nil {
		slog.Info("Passkey registration refused", "user_id", user.ID, "error", err)
		writeErrorCode(w, http.StatusBadRequest, "passkey_invalid", "Der Passkey konnte nicht eingerichtet werden")
		return
	}
	key := &storage.Passkey{
		UserID:          user.ID,
		Name:            name,
		CredentialID:    cred.ID,
		PublicKey:       cred.PublicKey,
		AttestationType: cred.AttestationType,
		AAGUID:          cred.Authenticator.AAGUID,
		Attachment:      string(cred.Authenticator.Attachment),
		SignCount:       cred.Authenticator.SignCount,
		BackupEligible:  cred.Flags.BackupEligible,
		Synced:          cred.Flags.BackupState,
	}
	for _, t := range cred.Transport {
		key.Transports = append(key.Transports, string(t))
	}
	var codes, hashes []string
	if !s.store.MFAActive(user.ID) {
		if codes, hashes, err = newRecoveryCodes(user.ID); err != nil {
			writeInternal(w, err)
			return
		}
	}
	err = s.store.AddPasskey(key, hashes, s.now())
	if errors.Is(err, storage.ErrPasskeyExists) || errors.Is(err, storage.ErrTooManyPasskeys) {
		writeErrorFrom(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	slog.Info("Passkey added", "user_id", user.ID, "passkey_id", key.ID, "synced", key.Synced, "first_second_factor", codes != nil)
	if codes != nil {
		s.notifySecurityChange(user, securityChangeOn)
	} else {
		s.notifySecurityChange(user, securityChangePasskeyAdded)
	}
	out := map[string]any{"passkey": key}
	if codes != nil {
		out["recoveryCodes"] = codes
	}
	writeJSON(w, http.StatusCreated, out)
}

// handleRenamePasskey: PATCH /auth/mfa/passkeys/{id} {name}.
func (s *Server) handleRenamePasskey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	err := s.store.RenamePasskey(auth.GetUserID(r.Context()), chi.URLParam(r, "id"), req.Name)
	switch {
	case errors.Is(err, storage.ErrPasskeyNotFound):
		writeErrorFrom(w, http.StatusNotFound, err)
	case errors.Is(err, storage.ErrPasskeyNameEmpty):
		writeErrorFrom(w, http.StatusBadRequest, err)
	case err != nil:
		writeInternal(w, err)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"name": storage.CleanPasskeyName(req.Name)})
	}
}

// handleRemovePasskey: DELETE /auth/mfa/passkeys/{id} {password, code | passkeyToken + passkey} →
// {removed, mfaOff}. The last second factor of the account switches two-factor sign-in off: the recovery
// codes and trusted devices go too (the app asks before).
func (s *Server) handleRemovePasskey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	keys, err := s.store.ListPasskeys(user.ID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	found := false
	for _, k := range keys {
		found = found || k.ID == id
	}
	if !found {
		writeErrorFrom(w, http.StatusNotFound, storage.ErrPasskeyNotFound)
		return
	}
	if !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
		return
	}
	mfaOff, err := s.store.RemovePasskey(user.ID, id)
	if errors.Is(err, storage.ErrPasskeyNotFound) {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	slog.Info("Passkey removed", "user_id", user.ID, "passkey_id", id, "two_factor_off", mfaOff)
	if mfaOff {
		s.notifySecurityChange(user, securityChangeOff)
	} else {
		s.notifySecurityChange(user, securityChangePasskeyGone)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true, "mfaOff": mfaOff})
}
