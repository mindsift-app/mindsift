package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The part of an address before the @ signs in only when exactly one account has it (P-06)
func TestLocalPartLoginOnlyWhenUnambiguous(t *testing.T) {
	_, store, _ := setupTestServer(t)
	a, _ := store.CreateUser("john@a.example", "hash", "Johnny A", "member")
	if u, err := store.GetUserByLogin("john"); err != nil || u.ID != a.ID {
		t.Fatalf("one account with the local part: %v %v", u, err)
	}
	_, _ = store.CreateUser("john@b.example", "hash", "Johnny B", "member")
	if u, err := store.GetUserByLogin("john"); err == nil {
		t.Fatalf("two accounts share the local part, %s must not be picked", u.Email)
	}
	if u, err := store.GetUserByLogin("john@b.example"); err != nil || u.Email != "john@b.example" {
		t.Fatalf("full address still signs in: %v %v", u, err)
	}
}

// With confirmation by mail a taken address gets the same answer as a new one, and accounts waiting
// for their link are locked from the start (SA-06, P-07)
func TestRegistrationDoesNotTellTakenAddresses(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	srv.cfg.BaseURL, srv.cfg.BaseURLSet = "https://ms.example", true
	sys, _ := store.GetSystemSettings()
	sys.RegistrationMode = storage.RegistrationOpen
	sys.AllowRegistration = true
	sys.RegistrationVerifyEmail = true
	sys.SMTPHost, sys.SMTPFrom = "127.0.0.1", "mindsift@ms.example"
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatalf("settings: %v", err)
	}
	router := srv.Router()
	_, _ = store.CreateUser("vergeben@example.com", "hash", "Vera", "member")

	taken := sendWith(t, router, http.MethodPost, "/api/v1/auth/register", "", map[string]string{"email": "vergeben@example.com", "password": "langes-passwort"})
	fresh := sendWith(t, router, http.MethodPost, "/api/v1/auth/register", "", map[string]string{"email": "neu@example.com", "password": "langes-passwort"})
	if taken.Code != http.StatusAccepted || fresh.Code != http.StatusAccepted {
		t.Fatalf("both answers must be 202: taken %d, fresh %d (%s)", taken.Code, fresh.Code, taken.Body)
	}
	if u, err := store.GetUserByEmail("neu@example.com"); err != nil || u.IsActive {
		t.Fatalf("new account must wait inactive: %v %v", u, err)
	}
}

// A token without version is not one of ours (SA-14)
func TestTokenWithoutVersionRefused(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	// GenerateToken never issues version 0, so the token is signed by hand
	claims := &auth.Claims{UserID: u.ID, Email: u.Email, RegisteredClaims: jwt.RegisteredClaims{
		ID: testSession(t, store, u.ID), ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), Issuer: "mindsift",
	}}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(srv.cfg.JWTSecret))
	if rec := getWith(t, srv.Router(), "/api/v1/auth/me", tok); rec.Code != http.StatusUnauthorized {
		t.Fatalf("token without version: want 401, got %d", rec.Code)
	}
}

// A list is always read for somebody; an empty person owns nothing (SA-15)
func TestListWithoutPersonIsNotFound(t *testing.T) {
	_, store, _ := setupTestServer(t)
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	l, err := store.CreateList(u.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if got, err := store.GetListByID("", l.ID); err == nil {
		t.Fatalf("list read for nobody: %+v", got)
	}
}
