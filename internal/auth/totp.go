package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Time-based one-time passwords (RFC 6238) as authenticator apps make them: HMAC-SHA1 over the number
// of 30-second steps since 1970, 6 digits. The code of the step before and after counts as well, so a
// clock a little off or a code typed at the end of its step still works.

const (
	TOTPPeriod = 30 // seconds per step
	TOTPDigits = 6
	// TOTPSkew: steps before and after the current one that are accepted
	TOTPSkew = 1
	// totpSecretBytes: 160 bits, the length RFC 4226 recommends for HMAC-SHA1
	totpSecretBytes = 20
)

var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret returns a random secret, base32 without padding as apps expect it.
func NewTOTPSecret() (string, error) {
	b := make([]byte, totpSecretBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return totpBase32.EncodeToString(b), nil
}

// DecodeTOTPSecret reads a base32 secret; spaces and lower case (as typed from a screen) are fine.
func DecodeTOTPSecret(secret string) ([]byte, error) {
	clean := strings.ToUpper(strings.ReplaceAll(strings.TrimRight(secret, "="), " ", ""))
	return totpBase32.DecodeString(clean)
}

// TOTPStep is the number of the 30-second step t falls into.
func TOTPStep(t time.Time) int64 {
	return t.Unix() / TOTPPeriod
}

// HOTP is the code of one counter value (RFC 4226 section 5.3) with the given number of digits.
func HOTP(key []byte, counter int64, digits int) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	mod := uint32(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	code := strconv.FormatUint(uint64(bin%mod), 10)
	return strings.Repeat("0", digits-len(code)) + code
}

// TOTPCode is the 6-digit code of the step t falls into.
func TOTPCode(key []byte, t time.Time) string {
	return HOTP(key, TOTPStep(t), TOTPDigits)
}

// NormalizeOTP strips what people type around a code (spaces, a dash in the middle).
func NormalizeOTP(code string) string {
	return strings.NewReplacer(" ", "", "-", "", "\u00a0", "").Replace(strings.TrimSpace(code))
}

// VerifyTOTP checks code against the steps around now. A step at or before lastStep was already used and
// does not count again, so a code seen over somebody's shoulder cannot be replayed. It returns the step
// the code belongs to, which the caller stores as the new lastStep.
func VerifyTOTP(key []byte, code string, now time.Time, lastStep int64) (int64, bool) {
	code = NormalizeOTP(code)
	if len(code) != TOTPDigits {
		return 0, false
	}
	current := TOTPStep(now)
	for step := current - TOTPSkew; step <= current+TOTPSkew; step++ {
		if step <= lastStep {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(HOTP(key, step, TOTPDigits)), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

// TOTPURI is the otpauth:// address an authenticator app reads from the QR code (Key Uri Format of
// Google Authenticator, understood by the others): label "Issuer:account", the secret and the parameters.
func TOTPURI(issuer, account, secret string) string {
	label := url.PathEscape(issuer) + ":" + url.PathEscape(account)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", strconv.Itoa(TOTPDigits))
	q.Set("period", strconv.Itoa(TOTPPeriod))
	return "otpauth://totp/" + label + "?" + q.Encode()
}
