package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
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

var (
	ErrPasswordTooShort = fmt.Errorf("Das Passwort muss mindestens %d Zeichen lang sein", MinPasswordLength)
	// bcrypt only uses the first 72 bytes and rejects longer input
	ErrPasswordTooLong = errors.New("Das Passwort darf höchstens 72 Bytes lang sein")
)

// ValidatePassword checks a new password: at least MinPasswordLength characters, not only whitespace.
func ValidatePassword(password string) error {
	if strings.TrimSpace(password) == "" || utf8.RuneCountInString(password) < MinPasswordLength {
		return ErrPasswordTooShort
	}
	if len(password) > 72 {
		return ErrPasswordTooLong
	}
	return nil
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
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
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
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
