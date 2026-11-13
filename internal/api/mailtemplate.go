package api

import (
	_ "embed"
	"html"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// One look for every mail MindSift sends: logo centred on top, a white card with greeting, intro and
// the actual content, an optional button, and a footer saying why the mail came. Colours follow the
// app's light "Klassik" theme. Mail clients ignore <style> blocks and external CSS, so everything is
// inline and laid out with tables. The logo travels inside the mail (cid:), so it shows without
// loading remote images and without BASE_URL.

//go:embed maillogo.png
var mailLogoPNG []byte

const mailLogoCID = "logo@mindsift"

// Theme colours (frontend/src/themes/theme-light.css), as solid values: many clients drop rgba()
const (
	mailBg       = "#f3f4f6"
	mailPanel    = "#ffffff"
	mailBorder   = "#dcdfe4"
	mailText     = "#111827"
	mailMuted    = "#374151"
	mailFaint    = "#6b7280"
	mailAccent   = "#2563eb"
	mailDanger   = "#b91c1c"
	mailWarning  = "#b45309"
	mailItemBg   = "#f8fafc"
	mailFontList = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

// mailItem is one entry, e.g. a task: title, a line of details, optional text below.
type mailItem struct {
	Title string
	Meta  string // "Heute, 15:30 Uhr · Haushalt"
	Body  string // notes, several lines allowed
	Tone  string // "" (accent), "danger", "warning", "muted"
}

// mailSection groups entries under a small heading ("Overdue", "Today").
type mailSection struct {
	Title string
	Tone  string
	Items []mailItem
}

type mailButton struct{ Label, URL string }

type mailContent struct {
	Lang      string // language of the recipient (html lang, tagline); the texts come translated
	Preheader string // preview line in the inbox
	Greeting  string // "Guten Morgen, Anna"
	Intro     string
	Notice    string // highlighted box, e.g. a security hint
	Sections  []mailSection
	Outro     string // text after the content
	Button    *mailButton
	Note      string // small print under the button
	Footer    string // why this mail came / where to change it
}

// greeting for the time of day in the server's time zone: the daily summary in the morning says
// "Guten Morgen".
func mailGreeting(lang string, now time.Time, name string) string {
	g := "Hallo"
	switch h := clock.In(now).Hour(); {
	case h >= 4 && h < 11:
		g = "Guten Morgen"
	case h >= 18 || h < 4:
		g = "Guten Abend"
	}
	if name = strings.TrimSpace(name); name != "" {
		return i18n.T(lang, g+", {name}", "name", name)
	}
	return i18n.T(lang, g)
}

func mailLang(lang string) string {
	if lang == "" {
		return i18n.Fallback
	}
	return lang
}

func toneColor(tone string) string {
	switch tone {
	case "danger":
		return mailDanger
	case "warning":
		return mailWarning
	case "muted":
		return mailFaint
	}
	return mailAccent
}

// esc escapes text for HTML and keeps line breaks.
func esc(s string) string {
	return strings.ReplaceAll(html.EscapeString(s), "\n", "<br>")
}

// renderMail returns the plain-text and the HTML version of the same content.
func renderMail(c mailContent) (text, htmlBody string) {
	return renderMailText(c), renderMailHTML(c)
}

func renderMailText(c mailContent) string {
	var b strings.Builder
	if c.Greeting != "" {
		b.WriteString(c.Greeting + "\n\n")
	}
	if c.Intro != "" {
		b.WriteString(c.Intro + "\n\n")
	}
	if c.Notice != "" {
		b.WriteString("! " + c.Notice + "\n\n")
	}
	for _, sec := range c.Sections {
		if sec.Title != "" {
			b.WriteString(strings.ToUpper(sec.Title) + "\n")
		}
		for _, it := range sec.Items {
			b.WriteString("• " + it.Title)
			if it.Meta != "" {
				b.WriteString(" (" + it.Meta + ")")
			}
			b.WriteString("\n")
			if it.Body != "" {
				b.WriteString("  " + strings.ReplaceAll(it.Body, "\n", "\n  ") + "\n")
			}
		}
		b.WriteString("\n")
	}
	if c.Outro != "" {
		b.WriteString(c.Outro + "\n\n")
	}
	if c.Button != nil && c.Button.URL != "" {
		b.WriteString(c.Button.Label + ": " + c.Button.URL + "\n\n")
	}
	if c.Note != "" {
		b.WriteString(c.Note + "\n\n")
	}
	b.WriteString("-- \nMindSift")
	if c.Footer != "" {
		b.WriteString("\n" + c.Footer)
	}
	b.WriteString("\n")
	return b.String()
}

func renderMailHTML(c mailContent) string {
	var b strings.Builder
	p := func(s string) { b.WriteString(s) }

	p(`<!doctype html><html lang="` + html.EscapeString(mailLang(c.Lang)) + `"><head><meta charset="utf-8">`)
	p(`<meta name="viewport" content="width=device-width,initial-scale=1">`)
	// Light only: clients that invert colours on their own would otherwise turn the card grey
	p(`<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`)
	p(`<title>MindSift</title></head>`)
	p(`<body style="margin:0;padding:0;background:` + mailBg + `;font-family:` + mailFontList + `;color:` + mailText + `">`)
	if c.Preheader != "" {
		p(`<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">` + esc(c.Preheader) + `</div>`)
	}
	p(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:` + mailBg + `"><tr><td align="center" style="padding:32px 16px">`)
	p(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">`)

	// Header: logo and name, centred
	p(`<tr><td align="center" style="padding-bottom:20px">`)
	p(`<img src="cid:` + mailLogoCID + `" width="56" height="56" alt="MindSift" style="display:block;width:56px;height:56px;border:0;border-radius:12px">`)
	p(`<div style="padding-top:10px;font-size:15px;font-weight:700;letter-spacing:0.2px;color:` + mailText + `">MindSift</div>`)
	p(`</td></tr>`)

	// Card
	p(`<tr><td style="background:` + mailPanel + `;border:1px solid ` + mailBorder + `;border-radius:8px;padding:28px 28px 24px">`)
	if c.Greeting != "" {
		p(`<div style="font-size:20px;font-weight:700;line-height:1.3;color:` + mailText + `;padding-bottom:8px">` + esc(c.Greeting) + `</div>`)
	}
	if c.Intro != "" {
		p(`<div style="font-size:15px;line-height:1.55;color:` + mailMuted + `;padding-bottom:16px">` + esc(c.Intro) + `</div>`)
	}
	if c.Notice != "" {
		p(`<div style="margin:4px 0 18px;padding:12px 14px;border:1px solid #f5c2c2;border-left:3px solid ` + mailDanger + `;border-radius:6px;background:#fdf2f2;font-size:14px;line-height:1.5;color:` + mailDanger + `">` + esc(c.Notice) + `</div>`)
	}
	for _, sec := range c.Sections {
		if sec.Title != "" {
			p(`<div style="padding:10px 0 8px;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:` + toneColor(sec.Tone) + `">` + esc(sec.Title) + `</div>`)
		}
		for _, it := range sec.Items {
			tone := it.Tone
			if tone == "" {
				tone = sec.Tone
			}
			p(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px"><tr>`)
			p(`<td style="background:` + mailItemBg + `;border:1px solid ` + mailBorder + `;border-left:3px solid ` + toneColor(tone) + `;border-radius:6px;padding:11px 14px">`)
			p(`<div style="font-size:15px;font-weight:600;line-height:1.4;color:` + mailText + `">` + esc(it.Title) + `</div>`)
			if it.Meta != "" {
				p(`<div style="padding-top:3px;font-size:13px;line-height:1.4;color:` + mailFaint + `">` + esc(it.Meta) + `</div>`)
			}
			if it.Body != "" {
				p(`<div style="padding-top:8px;font-size:14px;line-height:1.5;color:` + mailMuted + `">` + esc(it.Body) + `</div>`)
			}
			p(`</td></tr></table>`)
		}
	}
	if c.Outro != "" {
		p(`<div style="padding-top:8px;font-size:14px;line-height:1.55;color:` + mailMuted + `">` + esc(c.Outro) + `</div>`)
	}
	if c.Button != nil && c.Button.URL != "" {
		p(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr>`)
		p(`<td style="border-radius:6px;background:` + mailAccent + `"><a href="` + html.EscapeString(c.Button.URL) + `" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">` + esc(c.Button.Label) + `</a></td>`)
		p(`</tr></table>`)
	}
	if c.Note != "" {
		p(`<div style="padding-top:14px;font-size:12px;line-height:1.5;color:` + mailFaint + `">` + esc(c.Note) + `</div>`)
	}
	p(`</td></tr>`)

	// Footer
	p(`<tr><td align="center" style="padding:18px 12px 0;font-size:12px;line-height:1.5;color:` + mailFaint + `">`)
	if c.Footer != "" {
		p(esc(c.Footer) + `<br>`)
	}
	p(esc(i18n.T(c.Lang, "MindSift – Notizen, Aufgaben und ein freier Kopf, selbst gehostet.")))
	p(`</td></tr>`)

	p(`</table></td></tr></table></body></html>`)
	return b.String()
}
