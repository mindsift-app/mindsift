package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

type contextKey string

const UserIDContextKey contextKey = "mindsift_user_id"

type Claims struct {
	UserID       string `json:"userId"`
	Email        string `json:"email"`
	DisplayName  string `json:"displayName"`
	TokenVersion int    `json:"tokenVersion"`
	jwt.RegisteredClaims
}

// MinPasswordLength applies wherever a password is set (setup, registration, profile, admin, reset).
// Existing shorter passwords keep working for login.
const MinPasswordLength = 8

// MaxPasswordLength: long passphrases are welcome (the whole password counts, see HashPassword), but
// not without end.
const MaxPasswordLength = 1024

var (
	ErrPasswordTooShort = i18n.NewError("Das Passwort muss mindestens {min} Zeichen lang sein", "min", strconv.Itoa(MinPasswordLength))
	ErrPasswordTooLong  = i18n.NewError("Das Passwort darf höchstens {max} Zeichen lang sein", "max", strconv.Itoa(MaxPasswordLength))
)

// ValidatePassword checks a new password: at least MinPasswordLength characters, not only whitespace,
// at most MaxPasswordLength characters.
func ValidatePassword(password string) error {
	n := utf8.RuneCountInString(password)
	if strings.TrimSpace(password) == "" || n < MinPasswordLength {
		return ErrPasswordTooShort
	}
	if n > MaxPasswordLength {
		return ErrPasswordTooLong
	}
	return nil
}

// Password hashes. bcrypt reads only the first 72 bytes of its input, so a long passphrase used to count
// only up to there. New hashes therefore run bcrypt over the SHA-256 of the password (base64, 44 bytes,
// none of the NUL bytes a raw digest may hold) and carry passwordPrehashPrefix in front of the bcrypt
// string. Hashes without it are the plain bcrypt of earlier versions: they keep working, and
// PasswordNeedsRehash tells the login to store the new form once the password is known to be right.
const passwordPrehashPrefix = "sha256-bcrypt:"

func prehashPassword(password string) []byte {
	sum := sha256.Sum256([]byte(password))
	return []byte(base64.StdEncoding.EncodeToString(sum[:]))
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword(prehashPassword(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return passwordPrehashPrefix + string(bytes), nil
}

func CheckPassword(password, hash string) bool {
	if rest, ok := strings.CutPrefix(hash, passwordPrehashPrefix); ok {
		return bcrypt.CompareHashAndPassword([]byte(rest), prehashPassword(password)) == nil
	}
	// A hash of an earlier version: bcrypt over the password itself (never longer than 72 bytes then)
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// PasswordNeedsRehash: the hash is of the earlier form (plain bcrypt) and is replaced by HashPassword
// after the next successful check.
func PasswordNeedsRehash(hash string) bool {
	return hash != "" && !strings.HasPrefix(hash, passwordPrehashPrefix) && HasPassword(hash)
}

// noPasswordPrefix marks the hash of an account without a password of its own (created at the first sign-in
// through an OpenID Connect provider): the bcrypt hash of a random value nobody knows, behind a prefix no
// bcrypt string has, so CheckPassword never matches and HasPassword can tell.
const noPasswordPrefix = "none:"

// NoPasswordHash gives the hash for an account without a password (see noPasswordPrefix).
func NoPasswordHash() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	h, err := HashPassword(hex.EncodeToString(buf))
	if err != nil {
		return "", err
	}
	return noPasswordPrefix + h, nil
}

// HasPassword: the account has a password it can sign in with (not one from NoPasswordHash).
func HasPassword(hash string) bool {
	return hash != "" && !strings.HasPrefix(hash, noPasswordPrefix)
}

// TokenLifetime is the absolute lifetime of a session token; while the session is used the token is
// renewed long before (see api.authMiddleware), idle sessions end after 30 days on the server side.
const TokenLifetime = 30 * 24 * time.Hour

// GenerateToken signs a session token; sessionID (the JWT ID) names the server-side session row.
func GenerateToken(secret, userID, email, displayName string, tokenVersion int, sessionID string) (string, error) {
	if tokenVersion <= 0 {
		tokenVersion = 1
	}
	jti := sessionID

	now := time.Now()
	claims := &Claims{
		UserID:       userID,
		Email:        email,
		DisplayName:  displayName,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(now.Add(TokenLifetime)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "mindsift",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ValidateToken(secret, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}
	return claims, nil
}

// GenerateAPIKey creates a new webhook/ingestion API key (e.g. mindsift_sec_...) and returns rawKey, prefix, sha256Hash
func GenerateAPIKey() (string, string, string) {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	raw := "mindsift_sec_" + hex.EncodeToString(b)
	prefix := raw[:20] + "..."
	return raw, prefix, HashAPIKey(raw)
}

func HashAPIKey(rawKey string) string {
	sum := sha256.Sum256([]byte(rawKey))
	return hex.EncodeToString(sum[:])
}

func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, UserIDContextKey, userID)
}

func GetUserID(ctx context.Context) string {
	if val, ok := ctx.Value(UserIDContextKey).(string); ok {
		return val
	}
	return ""
}
