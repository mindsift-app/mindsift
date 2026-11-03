package api

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSMTP is a minimal ESMTP server with STARTTLS (self-signed) and AUTH PLAIN.
type fakeSMTP struct {
	addr     string
	rcptCode string // e.g. "451 4.3.2 Internal server error" to refuse RCPT TO
	// AUTH behaviour: mechanisms announced, and per mechanism a reply code to fail with ("" = accept)
	authMechs string
	authFail  map[string]string

	mu       sync.Mutex
	authUsed []string // mechanisms tried, in order
	authUser string   // decoded user of a successful LOGIN
	ehlo     string
	mailFrom string
	rcptTo   string
	data     string
}

func selfSignedCert(t *testing.T) tls.Certificate {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "mail.intern"},
		DNSNames:     []string{"mail.intern"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("cert: %v", err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func startFakeSMTP(t *testing.T, rcptCode string) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	f := &fakeSMTP{addr: ln.Addr().String(), rcptCode: rcptCode, authMechs: "PLAIN", authFail: map[string]string{}}
	tlsCfg := &tls.Config{Certificates: []tls.Certificate{selfSignedCert(t)}}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn, tlsCfg)
		}
	}()
	return f
}

func (f *fakeSMTP) serve(conn net.Conn, tlsCfg *tls.Config) {
	defer conn.Close()
	r, w := bufio.NewReader(conn), bufio.NewWriter(conn)
	reply := func(s string) { _, _ = w.WriteString(s + "\r\n"); _ = w.Flush() }
	reply("220 fake ESMTP")
	secure := false
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.TrimRight(line, "\r\n")
		upper := strings.ToUpper(cmd)
		switch {
		case strings.HasPrefix(upper, "EHLO "):
			f.mu.Lock()
			f.ehlo = cmd[5:]
			f.mu.Unlock()
			if secure {
				reply("250-fake\r\n250 AUTH " + f.authMechs)
			} else {
				reply("250-fake\r\n250-STARTTLS\r\n250 AUTH " + f.authMechs)
			}
		case upper == "STARTTLS":
			reply("220 go ahead")
			tlsConn := tls.Server(conn, tlsCfg)
			if err := tlsConn.Handshake(); err != nil {
				return
			}
			conn, secure = tlsConn, true
			r, w = bufio.NewReader(conn), bufio.NewWriter(conn)
		case strings.HasPrefix(upper, "AUTH "):
			mech := strings.Fields(upper)[1]
			f.mu.Lock()
			f.authUsed = append(f.authUsed, mech)
			fail := f.authFail[mech]
			f.mu.Unlock()
			if mech == "LOGIN" {
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
				u, _ := r.ReadString('\n')
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
				_, _ = r.ReadString('\n')
				if dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(u)); err == nil {
					f.mu.Lock()
					f.authUser = string(dec)
					f.mu.Unlock()
				}
			}
			if fail != "" {
				reply(fail)
			} else {
				reply("235 ok")
			}
		case strings.HasPrefix(upper, "MAIL FROM"):
			f.mu.Lock()
			f.mailFrom = strings.TrimSpace(cmd[len("MAIL FROM:"):])
			f.mu.Unlock()
			reply("250 ok")
		case strings.HasPrefix(upper, "RCPT TO"):
			f.mu.Lock()
			f.rcptTo = strings.TrimSpace(cmd[len("RCPT TO:"):])
			f.mu.Unlock()
			if f.rcptCode != "" {
				reply(f.rcptCode)
			} else {
				reply("250 ok")
			}
		case upper == "DATA":
			reply("354 go")
			var sb strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				sb.WriteString(l)
			}
			f.mu.Lock()
			f.data = sb.String()
			f.mu.Unlock()
			reply("250 queued")
		case upper == "QUIT":
			reply("221 bye")
			return
		default:
			reply("250 ok")
		}
	}
}

func (f *fakeSMTP) settings(skipVerify bool) smtpSettings {
	host, port, _ := net.SplitHostPort(f.addr)
	return smtpSettings{Host: host, Port: port, User: "alarm@firma.de", Pass: "geheim", From: "alarm@firma.de", TLS: true, SkipVerify: skipVerify}
}

func TestSendMailStartTLSWithSelfSignedCertificate(t *testing.T) {
	f := startFakeSMTP(t, "")

	// The certificate is self-signed: refused unless verification is switched off
	err := sendMail(f.settings(false), "anna@example.com", "Test", "Hallo", "")
	var stepErr *smtpStepError
	if !errors.As(err, &stepErr) || stepErr.Step != "STARTTLS" {
		t.Fatalf("expected a STARTTLS error with verification on, got %v", err)
	}

	if err := sendMail(f.settings(true), "anna@example.com", "⏰ Aufgabe fällig: Müll", "Zeile 1\nZeile 2 mit Ümlaut", ""); err != nil {
		t.Fatalf("send with SkipVerify failed: %v", err)
	}
	f.mu.Lock()
	ehlo, data := f.ehlo, f.data
	f.mu.Unlock()

	if ehlo != "firma.de" {
		t.Errorf("EHLO should name the sender domain, got %q", ehlo)
	}
	for _, header := range []string{"Date: ", "Message-ID: <", "Content-Transfer-Encoding: quoted-printable"} {
		if !strings.Contains(data, header) {
			t.Errorf("message lacks %q:\n%s", header, data)
		}
	}
	if !strings.Contains(data, "Subject: =?utf-8?q?") {
		t.Errorf("subject with emoji/umlauts must be RFC 2047 encoded:\n%s", data)
	}
	if strings.Contains(data, "fällig") {
		t.Errorf("raw non-ASCII must not appear in the message:\n%s", data)
	}
}

func TestSendMailReportsTheRefusingStep(t *testing.T) {
	f := startFakeSMTP(t, "451 4.3.2 Internal server error")
	err := sendMail(f.settings(true), "anna@example.com", "Test", "Hallo", "")
	var stepErr *smtpStepError
	if !errors.As(err, &stepErr) || stepErr.Step != "RCPT TO" || !strings.Contains(err.Error(), "451") {
		t.Fatalf("expected the 451 to be reported at RCPT TO, got %v", err)
	}
}

// The admin UI suggests "MindSift <alerts@domain>" as sender; the envelope must carry the bare address
func TestSendMailWithDisplayNameSender(t *testing.T) {
	f := startFakeSMTP(t, "")
	cfg := f.settings(true)
	cfg.From = "MindSift Alarme <alarm@firma.de>"
	if err := sendMail(cfg, "Anna <anna@example.com>", "Test", "Hallo", ""); err != nil {
		t.Fatalf("send failed: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.mailFrom != "<alarm@firma.de>" || f.rcptTo != "<anna@example.com>" {
		t.Errorf("envelope must hold bare addresses, got MAIL FROM %q, RCPT TO %q", f.mailFrom, f.rcptTo)
	}
	if !strings.Contains(f.data, `From: "MindSift Alarme" <alarm@firma.de>`) {
		t.Errorf("header From should keep the display name:\n%s", f.data)
	}
}

func TestEHLONameNeverLocalhost(t *testing.T) {
	if got := ehloName("Alarm <alarm@mail.example.org>"); got != "mail.example.org" {
		t.Errorf("got %q", got)
	}
	if got := ehloName("noreply"); got == "localhost" || got == "" {
		t.Errorf("fallback must not be localhost, got %q", got)
	}
}

func TestAuthFallsBackToLogin(t *testing.T) {
	f := startFakeSMTP(t, "")
	f.authMechs = "PLAIN LOGIN"
	f.authFail["PLAIN"] = "451 4.3.2 Internal server error"
	if err := sendMail(f.settings(true), "anna@example.com", "Test", "Hallo", ""); err != nil {
		t.Fatalf("LOGIN fallback should succeed: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if strings.Join(f.authUsed, ",") != "PLAIN,LOGIN" || f.authUser != "alarm@firma.de" {
		t.Fatalf("expected PLAIN then LOGIN with the user, got %v / %q", f.authUsed, f.authUser)
	}
}

func TestAuthLoginOnlyAndBothFailing(t *testing.T) {
	f := startFakeSMTP(t, "")
	f.authMechs = "LOGIN"
	if err := sendMail(f.settings(true), "anna@example.com", "Test", "Hallo", ""); err != nil {
		t.Fatalf("LOGIN-only server: %v", err)
	}

	g := startFakeSMTP(t, "")
	g.authMechs = "PLAIN LOGIN"
	g.authFail["PLAIN"] = "451 4.3.2 Internal server error"
	g.authFail["LOGIN"] = "451 4.3.2 Internal server error"
	err := sendMail(g.settings(true), "anna@example.com", "Test", "Hallo", "")
	if err == nil || !strings.Contains(err.Error(), "PLAIN") || !strings.Contains(err.Error(), "LOGIN") || !strings.Contains(err.Error(), "SASL") {
		t.Fatalf("expected both mechanisms and the server hint in the error, got %v", err)
	}
}

func TestSenderAddressGetsDisplayName(t *testing.T) {
	cases := []struct{ raw, name, envelope, header string }{
		{"alerts@example.com", "MindSift", "alerts@example.com", `"MindSift" <alerts@example.com>`},
		{`"Mein Dienst" <alerts@example.com>`, "MindSift", "alerts@example.com", `"Mein Dienst" <alerts@example.com>`},
		{"alerts@example.com", "Büro Müller", "alerts@example.com", "=?utf-8?q?B=C3=BCro_M=C3=BCller?= <alerts@example.com>"},
	}
	for _, c := range cases {
		env, hdr, err := senderAddress(c.raw, c.name)
		if err != nil || env != c.envelope || hdr != c.header {
			t.Fatalf("senderAddress(%q, %q) = %q, %q, %v", c.raw, c.name, env, hdr, err)
		}
	}
}

// HTML mails carry the logo as an inline part (multipart/related), plain mails stay single-part
func TestMailLayoutEmbedsLogo(t *testing.T) {
	text, htmlBody := renderMail(mailContent{
		Greeting: "Hallo Anna",
		Intro:    "Eine Aufgabe ist fällig <jetzt>:",
		Sections: []mailSection{{Title: "Heute", Items: []mailItem{{Title: "Zahnarzt & Co", Meta: "15:30 Uhr"}}}},
		Button:   &mailButton{Label: "Öffnen", URL: "https://mindsift.example/"},
		Footer:   "Fußzeile",
	})
	if !strings.Contains(text, "HEUTE\n• Zahnarzt & Co (15:30 Uhr)") || !strings.Contains(text, "Öffnen: https://mindsift.example/") {
		t.Fatalf("text version wrong:\n%s", text)
	}
	if !strings.Contains(htmlBody, "Zahnarzt &amp; Co") || !strings.Contains(htmlBody, "&lt;jetzt&gt;") {
		t.Fatalf("HTML must escape content")
	}
	msg := string(buildMessage("MindSift <a@example.com>", "b@example.com", "Test", text, htmlBody, time.Now()))
	for _, want := range []string{"multipart/alternative", "multipart/related", "Content-ID: <" + mailLogoCID + ">", "Content-Type: image/png"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message lacks %q", want)
		}
	}
	plain := string(buildMessage("a@example.com", "b@example.com", "Test", "nur Text", "", time.Now()))
	if strings.Contains(plain, "multipart") || strings.Contains(plain, "image/png") {
		t.Fatalf("plain mail must stay single-part")
	}
}
