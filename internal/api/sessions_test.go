package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func sessionCall(router http.Handler, method, path, token, body, ua string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", ua)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func sessionLogin(t *testing.T, router http.Handler, login, pw, ua string) string {
	t.Helper()
	rec := sessionCall(router, "POST", "/api/v1/auth/login", "", `{"login":"`+login+`","password":"`+pw+`"}`, ua)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	var res struct{ Token string }
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	return res.Token
}

func TestSessionsListEndAndLogout(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	_, _ = store.CreateUser("sess@example.com", mustHash(t, "richtig123"), "Sess", "member")
	laptop := sessionLogin(t, router, "sess@example.com", "richtig123", "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0")
	phone := sessionLogin(t, router, "sess@example.com", "richtig123", "Mozilla/5.0 (iPhone) Safari/604.1")

	rec := sessionCall(router, "GET", "/api/v1/auth/sessions", laptop, "", "")
	var list []storage.Session
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != http.StatusOK || len(list) != 2 {
		t.Fatalf("want 2 sessions, got %d %s", rec.Code, rec.Body.String())
	}
	var other string
	for _, s := range list {
		if s.Current != strings.Contains(s.UserAgent, "Firefox") {
			t.Fatalf("current flag wrong: %+v", s)
		}
		if !s.Current {
			other = s.ID
		}
	}

	// Ending the phone's session logs the phone out, the laptop stays
	if rec := sessionCall(router, "DELETE", "/api/v1/auth/sessions/"+other, laptop, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("end session: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", phone, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("ended session must be rejected, got %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", laptop, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("other session must stay, got %d", rec.Code)
	}
	// Other users' sessions cannot be ended
	_, strangerToken := newTestUser(t, store, "stranger@example.com")
	list = nil
	_ = json.Unmarshal(sessionCall(router, "GET", "/api/v1/auth/sessions", laptop, "", "").Body.Bytes(), &list)
	if rec := sessionCall(router, "DELETE", "/api/v1/auth/sessions/"+list[0].ID, strangerToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign session: want 404, got %d", rec.Code)
	}

	if rec := sessionCall(router, "POST", "/api/v1/auth/logout", laptop, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("logout: %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", laptop, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("token must be dead after logout, got %d", rec.Code)
	}
}

func TestSessionTokenRenewedWhenOld(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", token, "", ""); rec.Header().Get("X-Session-Token") != "" {
		t.Fatal("fresh token must not be renewed")
	}
	claims, err := auth.ValidateToken(srv.cfg.JWTSecret, token)
	if err != nil {
		t.Fatal(err)
	}
	claims.IssuedAt = jwt.NewNumericDate(time.Now().Add(-48 * time.Hour))
	old, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(srv.cfg.JWTSecret))
	rec := sessionCall(router, "GET", "/api/v1/auth/me", old, "", "")
	renewed := rec.Header().Get("X-Session-Token")
	if rec.Code != http.StatusOK || renewed == "" {
		t.Fatalf("old token must be renewed, got %d %q", rec.Code, renewed)
	}
	fresh, err := auth.ValidateToken(srv.cfg.JWTSecret, renewed)
	if err != nil || fresh.ID != claims.ID {
		t.Fatalf("renewed token must keep the session: %v", err)
	}
	_ = store
}

func TestPasswordChangeNeedsCurrentPassword(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	_, _ = store.CreateUser("pw@example.com", mustHash(t, "richtig123"), "Pw", "member")
	me := sessionLogin(t, router, "pw@example.com", "richtig123", "laptop")
	other := sessionLogin(t, router, "pw@example.com", "richtig123", "phone")

	for _, body := range []string{
		`{"password":"neuesPasswort1"}`,
		`{"password":"neuesPasswort1","currentPassword":"falsch"}`,
		`{"email":"neu@example.com"}`,
	} {
		if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", me, body, ""); rec.Code != http.StatusForbidden {
			t.Fatalf("%s: want 403, got %d", body, rec.Code)
		}
	}
	// Harmless changes need no password
	if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", me, `{"displayName":"Neu"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("display name: %d %s", rec.Code, rec.Body.String())
	}

	rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", me, `{"password":"neuesPasswort1","currentPassword":"richtig123"}`, "")
	renewed := rec.Header().Get("X-Session-Token")
	if rec.Code != http.StatusOK || renewed == "" {
		t.Fatalf("password change: want 200 with new token, got %d %q", rec.Code, renewed)
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", renewed, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("this device must stay logged in, got %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", other, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("other device must be logged out, got %d", rec.Code)
	}
}
