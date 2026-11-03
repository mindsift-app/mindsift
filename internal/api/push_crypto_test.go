package api

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/hkdf"
)

// A push sent by the server can be decrypted like a browser does (RFC 8291, aes128gcm) and carries
// a VAPID authorization; a device the push service no longer knows (410) is forgotten.
func TestPushPayloadDecryptsLikeABrowser(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	me, _ := newTestUser(t, store, "geraet@example.com")

	// The "browser": its key pair and auth secret
	recv, _ := ecdh.P256().GenerateKey(rand.Reader)
	authSecret := make([]byte, 16)
	_, _ = rand.Read(authSecret)
	b64 := base64.RawURLEncoding

	var body []byte
	var authz string
	status := http.StatusCreated
	push := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		authz = r.Header.Get("Authorization")
		w.WriteHeader(status)
	}))
	defer push.Close()
	srv.pushHTTPClient = push.Client()

	endpoint := push.URL + "/send/geraet-1"
	if err := store.SavePushSubscription(me.ID, endpoint, b64.EncodeToString(recv.PublicKey().Bytes()), b64.EncodeToString(authSecret), "Test"); err != nil {
		t.Fatal(err)
	}
	if err := srv.sendPush(me.ID, pushMessage{Title: "MindSift", Body: "Steuer fällig", URL: "/"}); err != nil {
		t.Fatalf("send: %v", err)
	}
	if !strings.HasPrefix(authz, "vapid t=") || !strings.Contains(authz, ", k=") {
		t.Fatalf("missing VAPID authorization: %q", authz)
	}

	// aes128gcm header: salt(16) | record size(4) | key id length(1) | sender public key
	salt, idLen := body[:16], int(body[20])
	senderPub, cipherText := body[21:21+idLen], body[21+idLen:]
	sender, err := ecdh.P256().NewPublicKey(senderPub)
	if err != nil {
		t.Fatalf("sender key: %v", err)
	}
	shared, _ := recv.ECDH(sender)
	info := append(append([]byte("WebPush: info\x00"), recv.PublicKey().Bytes()...), senderPub...)
	ikm := make([]byte, 32)
	_, _ = io.ReadFull(hkdf.New(sha256.New, shared, authSecret, info), ikm)
	cek := make([]byte, 16)
	nonce := make([]byte, 12)
	_, _ = io.ReadFull(hkdf.New(sha256.New, ikm, salt, []byte("Content-Encoding: aes128gcm\x00")), cek)
	_, _ = io.ReadFull(hkdf.New(sha256.New, ikm, salt, []byte("Content-Encoding: nonce\x00")), nonce)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, cipherText, nil)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	plain = plain[:strings.LastIndexByte(string(plain), 2)] // padding delimiter
	var got pushMessage
	if err := json.Unmarshal(plain, &got); err != nil || got.Body != "Steuer fällig" {
		t.Fatalf("payload %q: %v", plain, err)
	}

	// The push service says the device is gone: it is removed
	status = http.StatusGone
	_ = srv.sendPush(me.ID, pushMessage{Title: "x"})
	if subs, _ := store.PushSubscriptions(me.ID); len(subs) != 0 {
		t.Fatalf("gone device must be forgotten, still %d", len(subs))
	}
}
