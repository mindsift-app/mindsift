package auth

import (
	"strings"
	"testing"
	"time"
)

// The SHA-1 test vectors of RFC 6238 appendix B (8 digits, seed "12345678901234567890").
func TestTOTPRFC6238Vectors(t *testing.T) {
	key := []byte("12345678901234567890")
	for _, c := range []struct {
		unix int64
		want string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	} {
		at := time.Unix(c.unix, 0)
		if got := HOTP(key, TOTPStep(at), 8); got != c.want {
			t.Errorf("T=%d: got %s, want %s", c.unix, got, c.want)
		}
		// The 6-digit code apps show is the same number modulo 10^6
		if got := TOTPCode(key, at); got != c.want[2:] {
			t.Errorf("T=%d (6 digits): got %s, want %s", c.unix, got, c.want[2:])
		}
	}
}

// The test vectors of HOTP (RFC 4226 appendix D).
func TestHOTPRFC4226Vectors(t *testing.T) {
	key := []byte("12345678901234567890")
	want := []string{"755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"}
	for i, w := range want {
		if got := HOTP(key, int64(i), 6); got != w {
			t.Errorf("counter %d: got %s, want %s", i, got, w)
		}
	}
}

func TestVerifyTOTPWindowAndReplay(t *testing.T) {
	key := []byte("12345678901234567890")
	now := time.Unix(1700000000, 0)
	step := TOTPStep(now)
	for _, d := range []int64{-1, 0, 1} {
		code := HOTP(key, step+d, 6)
		got, ok := VerifyTOTP(key, code, now, 0)
		if !ok || got != step+d {
			t.Errorf("step %+d: ok=%v step=%d", d, ok, got)
		}
	}
	for _, d := range []int64{-2, 2} {
		if _, ok := VerifyTOTP(key, HOTP(key, step+d, 6), now, 0); ok {
			t.Errorf("step %+d must be outside the window", d)
		}
	}
	// Used once: the same step (and any earlier one) is refused, a later one still counts
	code := TOTPCode(key, now)
	if _, ok := VerifyTOTP(key, code, now, step); ok {
		t.Error("a used step must not count again")
	}
	if _, ok := VerifyTOTP(key, HOTP(key, step-1, 6), now, step); ok {
		t.Error("a step before the used one must not count")
	}
	if got, ok := VerifyTOTP(key, HOTP(key, step+1, 6), now, step); !ok || got != step+1 {
		t.Error("the next step must still count")
	}
	// Typed with a space or a dash in the middle
	if _, ok := VerifyTOTP(key, code[:3]+" "+code[3:], now, 0); !ok {
		t.Error("a code with a space must count")
	}
	for _, bad := range []string{"", "12345", "1234567", "abcdef"} {
		if _, ok := VerifyTOTP(key, bad, now, 0); ok {
			t.Errorf("%q must not count", bad)
		}
	}
}

func TestTOTPSecretAndURI(t *testing.T) {
	secret, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if len(secret) != 32 || strings.Contains(secret, "=") {
		t.Fatalf("secret %q: want 32 base32 characters without padding", secret)
	}
	key, err := DecodeTOTPSecret(strings.ToLower(secret[:4]) + " " + secret[4:])
	if err != nil || len(key) != 20 {
		t.Fatalf("decode: %v (%d bytes)", err, len(key))
	}
	uri := TOTPURI("MindSift Test", "ada@example.com", secret)
	for _, part := range []string{"otpauth://totp/MindSift%20Test:ada@example.com?", "secret=" + secret, "issuer=MindSift+Test", "digits=6", "period=30", "algorithm=SHA1"} {
		if !strings.Contains(uri, part) {
			t.Errorf("uri %q lacks %q", uri, part)
		}
	}
}
