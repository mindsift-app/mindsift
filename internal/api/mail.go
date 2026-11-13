package api

import (
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// smtpSettings is the effective mail server configuration (admin settings, else environment).
type smtpSettings struct {
	Host, Port, User, Pass, From string
	FromName                     string // display name when From is a bare address
	TLS                          bool   // 465: implicit TLS, otherwise STARTTLS (required when set)
	SkipVerify                   bool   // accept self-signed / mismatching certificates

	authMech string // "" = automatic; "LOGIN" forces AUTH LOGIN (fallback after a refused PLAIN)
}

// smtpStepError names the protocol step at which the mail server refused, e.g. "RCPT TO".
type smtpStepError struct {
	Step string
	Err  error
}

func (e *smtpStepError) Error() string { return e.Localize(i18n.Fallback) }

func (e *smtpStepError) Localize(lang string) string {
	return i18n.T(lang, "SMTP-Schritt {step} fehlgeschlagen", "step", i18n.T(lang, e.Step)) + ": " + i18n.Text(lang, e.Err)
}

func (e *smtpStepError) Unwrap() error { return e.Err }

const smtpTimeout = 30 * time.Second

var errSMTPPassUnreadable = i18n.NewError("Das gespeicherte SMTP-Passwort lässt sich nicht entschlüsseln (SECRETS_KEY oder secrets.key geändert?); bitte in der Administration unter E-Mail neu eingeben")

func (s *Server) smtpSettings() (smtpSettings, error) {
	cfg := smtpSettings{Port: "587", TLS: true}
	if sys, _ := s.store.GetSystemSettings(); sys != nil && strings.TrimSpace(sys.SMTPHost) != "" {
		// The stored password does not decrypt (logged when it was read): no attempt without it
		if sys.SMTPPassUnreadable {
			return cfg, errSMTPPassUnreadable
		}
		cfg = smtpSettings{
			Host: strings.TrimSpace(sys.SMTPHost), Port: strings.TrimSpace(sys.SMTPPort),
			User: strings.TrimSpace(sys.SMTPUser), Pass: sys.SMTPPass, From: strings.TrimSpace(sys.SMTPFrom),
			FromName: strings.TrimSpace(sys.SMTPFromName),
			TLS:      sys.SMTPTLS, SkipVerify: sys.SMTPSkipVerify,
		}
	} else if strings.TrimSpace(s.cfg.SMTPHost) != "" {
		cfg = smtpSettings{
			Host: strings.TrimSpace(s.cfg.SMTPHost), Port: strings.TrimSpace(s.cfg.SMTPPort),
			User: strings.TrimSpace(s.cfg.SMTPUser), Pass: s.cfg.SMTPPass, From: strings.TrimSpace(s.cfg.SMTPFrom),
			FromName: strings.TrimSpace(s.cfg.SMTPFromName),
			TLS:      s.cfg.SMTPTLS, SkipVerify: s.cfg.SMTPSkipVerify,
		}
	}
	if cfg.Host == "" {
		return cfg, fmt.Errorf("kein SMTP-Server konfiguriert (bitte in den Administratoreinstellungen oder per Docker-Env hinterlegen)")
	}
	return cfg.withDefaults(), nil
}

// smtpViaEnv: SMTP_HOST is set. Admin settings with a host of their own still take precedence.
func (s *Server) smtpViaEnv() bool { return strings.TrimSpace(s.cfg.SMTPHost) != "" }

// withDefaults fills what may be left out: port 587, the sender name MindSift, the sender address from
// the SMTP user (or a placeholder).
func (cfg smtpSettings) withDefaults() smtpSettings {
	if cfg.Port == "" {
		cfg.Port = "587"
	}
	if cfg.FromName == "" {
		cfg.FromName = "MindSift"
	}
	if cfg.From == "" {
		if strings.Contains(cfg.User, "@") {
			cfg.From = cfg.User
		} else {
			cfg.From = "noreply@mindsift.local"
		}
	}
	return cfg
}

// ehloName is how MindSift introduces itself (EHLO). It must name the sending side, never "localhost",
// which strict servers (Exchange/O365, Postfix with HELO checks) refuse: the sender's mail domain,
// else the machine's hostname.
func ehloName(from string) string {
	if at := strings.LastIndex(from, "@"); at >= 0 {
		if domain := strings.Trim(from[at+1:], " >"); strings.Contains(domain, ".") {
			return domain
		}
	}
	if h, err := os.Hostname(); err == nil && strings.Contains(h, ".") {
		return h
	}
	return "mindsift.local"
}

// splitAddress turns "MindSift <alarm@firma.de>" into the bare address for the SMTP envelope
// (MAIL FROM / RCPT TO only accept that) and the header form with an encoded display name.
func splitAddress(raw string) (envelope, header string, err error) {
	addr, err := mail.ParseAddress(strings.TrimSpace(raw))
	if err != nil {
		return "", "", errors.New("ungültige E-Mail-Adresse: " + raw)
	}
	return addr.Address, addr.String(), nil
}

// senderAddress is splitAddress for the sender: a bare address gets the display name, so mail clients
// show "MindSift" instead of only the address. A name already in SMTP_FROM wins.
func senderAddress(raw, name string) (envelope, header string, err error) {
	addr, err := mail.ParseAddress(strings.TrimSpace(raw))
	if err != nil {
		return "", "", errors.New("ungültige E-Mail-Adresse: " + raw)
	}
	if addr.Name == "" {
		addr.Name = strings.TrimSpace(name)
	}
	return addr.Address, addr.String(), nil
}

// buildMessage creates an RFC 5322 message: Date and Message-ID headers, RFC 2047 encoded subject
// (umlauts, emoji) and a quoted-printable UTF-8 body with CRLF line endings.
func buildMessage(from, to, subject, body, html string, now time.Time) []byte {
	idBytes := make([]byte, 12)
	_, _ = rand.Read(idBytes)
	domain := ehloName(from)

	var buf bytes.Buffer
	fmt.Fprintf(&buf, "From: %s\r\n", from)
	fmt.Fprintf(&buf, "To: %s\r\n", to)
	fmt.Fprintf(&buf, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", subject))
	fmt.Fprintf(&buf, "Date: %s\r\n", now.Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "Message-ID: <%s@%s>\r\n", hex.EncodeToString(idBytes), domain)
	buf.WriteString("MIME-Version: 1.0\r\n")
	part := func(contentType, text string) {
		fmt.Fprintf(&buf, "Content-Type: %s; charset=\"utf-8\"\r\n", contentType)
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		qp := quotedprintable.NewWriter(&buf)
		_, _ = qp.Write([]byte(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")))
		_ = qp.Close()
		buf.WriteString("\r\n")
	}
	if html == "" {
		part("text/plain", body)
		return buf.Bytes()
	}
	// Text for simple clients, HTML for the rest
	boundary := "ms-" + hex.EncodeToString(idBytes)
	fmt.Fprintf(&buf, "Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", boundary)
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	part("text/plain", body)
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	if strings.Contains(html, "cid:"+mailLogoCID) {
		// The HTML shows the logo from inside the mail: HTML and image together as multipart/related
		related := boundary + "-rel"
		fmt.Fprintf(&buf, "Content-Type: multipart/related; boundary=\"%s\"\r\n\r\n", related)
		fmt.Fprintf(&buf, "--%s\r\n", related)
		part("text/html", html)
		fmt.Fprintf(&buf, "--%s\r\n", related)
		buf.WriteString("Content-Type: image/png; name=\"mindsift.png\"\r\n")
		buf.WriteString("Content-Transfer-Encoding: base64\r\n")
		fmt.Fprintf(&buf, "Content-ID: <%s>\r\n", mailLogoCID)
		buf.WriteString("Content-Disposition: inline; filename=\"mindsift.png\"\r\n\r\n")
		enc := base64.StdEncoding.EncodeToString(mailLogoPNG)
		for len(enc) > 76 {
			buf.WriteString(enc[:76] + "\r\n")
			enc = enc[76:]
		}
		buf.WriteString(enc + "\r\n")
		fmt.Fprintf(&buf, "--%s--\r\n", related)
	} else {
		part("text/html", html)
	}
	fmt.Fprintf(&buf, "--%s--\r\n", boundary)
	return buf.Bytes()
}

// loginAuth implements AUTH LOGIN (username and password as separate Base64 challenges). Some servers,
// e.g. Postfix with Dovecot SASL or Exchange, fail on PLAIN but accept LOGIN.
type loginAuth struct{ user, pass, host string }

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	// Same rule as smtp.PlainAuth: never send credentials unencrypted to a remote host
	if !server.TLS && a.host != "localhost" && a.host != "127.0.0.1" && a.host != "::1" {
		return "", nil, fmt.Errorf("unverschlüsselte Verbindung – Anmeldung verweigert")
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch prompt := strings.ToLower(strings.TrimSpace(string(fromServer))); {
	case strings.Contains(prompt, "username"), strings.Contains(prompt, "user"):
		return []byte(a.user), nil
	case strings.Contains(prompt, "password"), strings.Contains(prompt, "pass"):
		return []byte(a.pass), nil
	default:
		return nil, fmt.Errorf("unexpected AUTH LOGIN challenge %q", prompt)
	}
}

// authAttemptError records which mechanism failed and whether LOGIN would have been an alternative.
type authAttemptError struct {
	mech         string
	loginOffered bool
	err          error
}

func (e *authAttemptError) Error() string { return e.mech + ": " + e.err.Error() }
func (e *authAttemptError) Unwrap() error { return e.err }

// authenticate uses PLAIN, or LOGIN when the server offers only that (or when cfg.authMech forces it).
// net/smtp closes the connection after a failed AUTH, so a fallback needs a new connection (sendMail).
func authenticate(client *smtp.Client, cfg smtpSettings) error {
	_, mechs := client.Extension("AUTH")
	offered := " " + strings.ToUpper(mechs) + " "
	hasLogin := strings.Contains(offered, " LOGIN ")
	mech := cfg.authMech
	if mech == "" {
		mech = "PLAIN"
		if hasLogin && !strings.Contains(offered, " PLAIN ") {
			mech = "LOGIN"
		}
	}
	a := smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)
	if mech == "LOGIN" {
		a = &loginAuth{user: cfg.User, pass: cfg.Pass, host: cfg.Host}
	}
	if err := client.Auth(a); err != nil {
		return &authAttemptError{mech: mech, loginOffered: hasLogin, err: err}
	}
	return nil
}

// sendMail sends one mail. If AUTH PLAIN is refused and the server also offers LOGIN, it reconnects once
// and tries LOGIN; a 451 on both points to the mail server's SASL backend.
func sendMail(cfg smtpSettings, to, subject, body, html string) error {
	err := sendMailOnce(cfg, to, subject, body, html)
	var first *authAttemptError
	if cfg.authMech != "" || !errors.As(err, &first) || first.mech != "PLAIN" || !first.loginOffered {
		return err
	}
	cfg.authMech = "LOGIN"
	retryErr := sendMailOnce(cfg, to, subject, body, html)
	var second *authAttemptError
	if retryErr == nil || !errors.As(retryErr, &second) {
		return retryErr
	}
	combined := fmt.Errorf("%v; %v", first, second)
	if strings.Contains(first.err.Error(), "451") && strings.Contains(second.err.Error(), "451") {
		combined = fmt.Errorf("der Mailserver meldet einen internen Fehler bei der Anmeldung, bitte dessen SASL/Dovecot-Logs prüfen: %w", combined)
	}
	return &smtpStepError{"AUTH", combined}
}

// sendMailOnce runs the SMTP dialogue step by step instead of smtp.SendMail, so it can introduce itself
// properly, honour SkipVerify and report the exact step a server refuses.
func sendMailOnce(cfg smtpSettings, to, subject, body, html string) error {
	fromAddr, fromHeader, err := senderAddress(cfg.From, cfg.FromName)
	if err != nil {
		return &smtpStepError{"Absender", err}
	}
	toAddr, toHeader, err := splitAddress(to)
	if err != nil {
		return &smtpStepError{"Empfänger", err}
	}
	addr := net.JoinHostPort(cfg.Host, cfg.Port)
	tlsCfg := &tls.Config{ServerName: cfg.Host, InsecureSkipVerify: cfg.SkipVerify} //nolint:gosec // admin opt-in for self-signed certificates
	dialer := &net.Dialer{Timeout: smtpTimeout}
	implicitTLS := cfg.Port == "465" && cfg.TLS

	var conn net.Conn
	if implicitTLS {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return &smtpStepError{"Verbindung", err}
	}
	_ = conn.SetDeadline(time.Now().Add(2 * smtpTimeout))

	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		_ = conn.Close()
		return &smtpStepError{"Begrüßung", err}
	}
	defer client.Close()

	if err := client.Hello(ehloName(cfg.From)); err != nil {
		return &smtpStepError{"EHLO", err}
	}
	if cfg.TLS && !implicitTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return &smtpStepError{"STARTTLS", fmt.Errorf("der Server bietet kein STARTTLS an (TLS deaktivieren oder Port 465 nutzen)")}
		}
		if err := client.StartTLS(tlsCfg); err != nil {
			return &smtpStepError{"STARTTLS", err}
		}
	}
	if cfg.User != "" || cfg.Pass != "" {
		if err := authenticate(client, cfg); err != nil {
			return &smtpStepError{"AUTH", err}
		}
	}
	if err := client.Mail(fromAddr); err != nil {
		return &smtpStepError{"MAIL FROM", err}
	}
	if err := client.Rcpt(toAddr); err != nil {
		return &smtpStepError{"RCPT TO", err}
	}
	wc, err := client.Data()
	if err != nil {
		return &smtpStepError{"DATA", err}
	}
	if _, err := wc.Write(buildMessage(fromHeader, toHeader, subject, body, html, time.Now())); err != nil {
		_ = wc.Close()
		return &smtpStepError{"DATA", err}
	}
	if err := wc.Close(); err != nil {
		// The server answers after the final "." – content filters reject here
		return &smtpStepError{"Nachricht annehmen", err}
	}
	_ = client.Quit()
	return nil
}
