package api

import (
	"context"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Link previews for notes: the server fetches the page once (https only, never into its own network,
// like alarm webhooks), reads title, description, picture and icon, and keeps them. Readers' browsers
// only talk to MindSift. Off in the demo, which must not send anything out.

const (
	previewTTL        = 7 * 24 * time.Hour
	previewFailTTL    = 24 * time.Hour
	previewMaxHTML    = 1 << 20
	previewMaxImage   = 2 << 20
	previewMaxIcon    = 100 << 10
	previewPerAddress = 300 // fetches per address in 15 minutes (cached answers do not count)
)

var previewLocks sync.Map // URL -> *sync.Mutex, one fetch per page at a time

var (
	metaTagRe  = regexp.MustCompile(`(?is)<meta\s[^>]*>`)
	linkTagRe  = regexp.MustCompile(`(?is)<link\s[^>]*>`)
	titleTagRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	attrRe     = regexp.MustCompile(`(?is)([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`)
	headEndRe  = regexp.MustCompile(`(?i)</head>|<body[\s>]`)
	spacesRe   = regexp.MustCompile(`\s+`)
)

func tagAttrs(tag string) map[string]string {
	out := map[string]string{}
	for _, m := range attrRe.FindAllStringSubmatch(tag, -1) {
		v := m[3]
		if v == "" {
			v = m[4]
		}
		if v == "" {
			v = m[5]
		}
		out[strings.ToLower(m[1])] = html.UnescapeString(v)
	}
	return out
}

func cleanText(s string, max int) string {
	s = strings.TrimSpace(spacesRe.ReplaceAllString(html.UnescapeString(s), " "))
	if utf8.RuneCountInString(s) > max {
		r := []rune(s)
		s = strings.TrimSpace(string(r[:max-1])) + "…"
	}
	return s
}

// latin1ToUTF8 for pages that still declare ISO-8859-1/windows-1252.
func latin1ToUTF8(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// pageMeta reads the head of an HTML page: Open Graph/Twitter tags, <title>, icon link.
type pageMeta struct {
	title, description, siteName, image, icon string
}

func parsePageMeta(doc string) pageMeta {
	if loc := headEndRe.FindStringIndex(doc); loc != nil {
		doc = doc[:loc[0]]
	}
	var m pageMeta
	for _, tag := range metaTagRe.FindAllString(doc, -1) {
		a := tagAttrs(tag)
		key := strings.ToLower(a["property"])
		if key == "" {
			key = strings.ToLower(a["name"])
		}
		v := a["content"]
		switch key {
		case "og:title", "twitter:title":
			if m.title == "" {
				m.title = v
			}
		case "og:description", "twitter:description", "description":
			if m.description == "" {
				m.description = v
			}
		case "og:site_name", "application-name":
			if m.siteName == "" {
				m.siteName = v
			}
		case "og:image", "og:image:url", "og:image:secure_url", "twitter:image":
			if m.image == "" {
				m.image = v
			}
		}
	}
	if m.title == "" {
		if t := titleTagRe.FindStringSubmatch(doc); t != nil {
			m.title = t[1]
		}
	}
	for _, tag := range linkTagRe.FindAllString(doc, -1) {
		a := tagAttrs(tag)
		rel := " " + strings.ToLower(a["rel"]) + " "
		if (strings.Contains(rel, " icon ") || strings.Contains(rel, "apple-touch-icon")) && a["href"] != "" && !strings.HasSuffix(strings.ToLower(a["href"]), ".svg") {
			if m.icon == "" || strings.Contains(rel, "apple-touch-icon") {
				m.icon = a["href"]
			}
		}
	}
	m.title, m.description, m.siteName = cleanText(m.title, 200), cleanText(m.description, 300), cleanText(m.siteName, 80)
	return m
}

// fetchLimited GETs a public https URL and reads at most limit bytes.
func fetchLimited(ctx context.Context, raw string, limit int64, accept string) ([]byte, http.Header, error) {
	if err := validateWebhookURL(raw, false, false); err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; MindSift link preview)")
	req.Header.Set("Accept-Language", "de,en;q=0.8")
	resp, err := guardedClient(false).Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, errors.New(resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(data)) > limit {
		return nil, nil, errors.New("zu groß")
	}
	return data, resp.Header, nil
}

func resolveRef(base *url.URL, ref string) string {
	u, err := base.Parse(strings.TrimSpace(ref))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	if u.Scheme == "http" {
		u.Scheme = "https" // only https is fetched; most sites answer there as well
	}
	return u.String()
}

// buildLinkPreview fetches the page and its pictures.
func buildLinkPreview(ctx context.Context, pageURL string) *storage.LinkPreview {
	p := &storage.LinkPreview{URL: pageURL}
	base, err := url.Parse(pageURL)
	if err != nil {
		return p
	}
	body, hdr, err := fetchLimited(ctx, pageURL, previewMaxHTML, "text/html,application/xhtml+xml")
	if err != nil {
		return p
	}
	ct := strings.ToLower(hdr.Get("Content-Type"))
	if !strings.Contains(ct, "html") {
		// A direct link to an image: the image itself is the preview
		if _, kind, ok := storage.DetectMedia(body, ""); ok && kind == "image" && len(body) <= previewMaxImage {
			p.Image, p.ImageMime, p.OK = body, http.DetectContentType(body), true
			p.Title = cleanText(strings.TrimSuffix(base.Path[strings.LastIndex(base.Path, "/")+1:], "/"), 200)
			p.SiteName = base.Hostname()
		}
		return p
	}
	text := string(body)
	if strings.Contains(ct, "iso-8859-1") || strings.Contains(ct, "windows-1252") || !utf8.Valid(body) {
		text = latin1ToUTF8(body)
	}
	meta := parsePageMeta(text)
	p.Title, p.Description, p.SiteName = meta.title, meta.description, meta.siteName
	if p.SiteName == "" {
		p.SiteName = strings.TrimPrefix(base.Hostname(), "www.")
	}
	if img := resolveRef(base, meta.image); img != "" {
		if data, _, err := fetchLimited(ctx, img, previewMaxImage, "image/*"); err == nil {
			if mime, kind, ok := storage.DetectMedia(data, ""); ok && kind == "image" {
				p.Image, p.ImageMime = data, mime
			}
		}
	}
	iconURL := resolveRef(base, meta.icon)
	if iconURL == "" {
		iconURL = resolveRef(base, "/favicon.ico")
	}
	if data, _, err := fetchLimited(ctx, iconURL, previewMaxIcon, "image/*"); err == nil {
		if mime := http.DetectContentType(data); strings.HasPrefix(mime, "image/") && mime != "image/svg+xml" {
			p.Icon, p.IconMime = data, mime
		}
	}
	p.OK = p.Title != "" || p.Description != "" || len(p.Image) > 0
	return p
}

func previewFresh(p *storage.LinkPreview, now time.Time) bool {
	at, err := time.Parse(time.RFC3339, p.FetchedAt)
	if err != nil {
		return false
	}
	ttl := previewTTL
	if !p.OK {
		ttl = previewFailTTL
	}
	return now.Sub(at) < ttl
}

// handleLinkPreview: GET /link-preview?url=https://…
func (s *Server) handleLinkPreview(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(raw) > 2000 {
		writeError(w, http.StatusUnprocessableEntity, "Vorschau nur für https-Links")
		return
	}
	pageURL := u.String()
	key := storage.LinkPreviewKey(pageURL)
	if p, err := s.store.GetLinkPreview(key); err == nil && previewFresh(p, time.Now()) {
		writeJSON(w, http.StatusOK, p)
		return
	}

	lock, _ := previewLocks.LoadOrStore(pageURL, &sync.Mutex{})
	mu := lock.(*sync.Mutex)
	mu.Lock()
	defer func() {
		mu.Unlock()
		previewLocks.Delete(pageURL)
	}()
	// Someone else may have fetched it while this request waited
	if p, err := s.store.GetLinkPreview(key); err == nil && previewFresh(p, time.Now()) {
		writeJSON(w, http.StatusOK, p)
		return
	}
	if wait := s.loginGuard.throttle("preview", clientIPFrom(r), previewPerAddress); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	p := buildLinkPreview(ctx, pageURL)
	if err := s.store.SaveLinkPreview(p); err != nil {
		writeError(w, http.StatusInternalServerError, "Vorschau konnte nicht gespeichert werden")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleLinkPreviewPicture: GET /link-preview/{key}/image or /icon
func (s *Server) handleLinkPreviewPicture(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetLinkPreview(chi.URLParam(r, "key"))
	if err != nil {
		writeError(w, http.StatusNotFound, "Kein Bild")
		return
	}
	data, mime := p.Image, p.ImageMime
	if chi.URLParam(r, "kind") == "icon" {
		data, mime = p.Icon, p.IconMime
	}
	if len(data) == 0 {
		writeError(w, http.StatusNotFound, "Kein Bild")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = w.Write(data)
}
