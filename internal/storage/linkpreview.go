package storage

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// Link previews: title, description, a small picture and the site icon of a web page, fetched once by
// the server and kept for a while, so readers' browsers never contact the page themselves.

type LinkPreview struct {
	Key         string `json:"key"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SiteName    string `json:"siteName"`
	HasImage    bool   `json:"hasImage"`
	HasIcon     bool   `json:"hasIcon"`
	OK          bool   `json:"ok"` // false: the page gave nothing usable (kept shorter, then tried again)
	FetchedAt   string `json:"fetchedAt"`

	Image, Icon         []byte `json:"-"`
	ImageMime, IconMime string `json:"-"`
}

// LinkPreviewKey identifies the preview of a URL (also used in the picture URLs).
func LinkPreviewKey(url string) string {
	sum := sha256.Sum256([]byte(url))
	return hex.EncodeToString(sum[:12])
}

func (s *Store) migrateLinkPreviews() error {
	return s.execInTx(stmt(`CREATE TABLE IF NOT EXISTS link_previews (
		key TEXT PRIMARY KEY,
		url TEXT NOT NULL,
		title TEXT NOT NULL DEFAULT '',
		description TEXT NOT NULL DEFAULT '',
		site_name TEXT NOT NULL DEFAULT '',
		image BLOB,
		image_mime TEXT NOT NULL DEFAULT '',
		icon BLOB,
		icon_mime TEXT NOT NULL DEFAULT '',
		ok INTEGER NOT NULL DEFAULT 0,
		fetched_at TEXT NOT NULL
	)`))
}

var ErrLinkPreviewNotFound = errors.New("Keine Vorschau vorhanden")

func (s *Store) GetLinkPreview(key string) (*LinkPreview, error) {
	var p LinkPreview
	var ok int
	err := s.db.QueryRow(`SELECT key, url, title, description, site_name, image, image_mime, icon, icon_mime, ok, fetched_at
		FROM link_previews WHERE key = ?`, key).
		Scan(&p.Key, &p.URL, &p.Title, &p.Description, &p.SiteName, &p.Image, &p.ImageMime, &p.Icon, &p.IconMime, &ok, &p.FetchedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLinkPreviewNotFound
	}
	if err != nil {
		return nil, err
	}
	p.OK = ok == 1
	p.HasImage, p.HasIcon = len(p.Image) > 0, len(p.Icon) > 0
	return &p, nil
}

func (s *Store) SaveLinkPreview(p *LinkPreview) error {
	p.Key = LinkPreviewKey(p.URL)
	p.FetchedAt = time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`INSERT INTO link_previews (key, url, title, description, site_name, image, image_mime, icon, icon_mime, ok, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET url = excluded.url, title = excluded.title, description = excluded.description,
			site_name = excluded.site_name, image = excluded.image, image_mime = excluded.image_mime, icon = excluded.icon,
			icon_mime = excluded.icon_mime, ok = excluded.ok, fetched_at = excluded.fetched_at`,
		p.Key, p.URL, p.Title, p.Description, p.SiteName, p.Image, p.ImageMime, p.Icon, p.IconMime, boolInt(p.OK), p.FetchedAt)
	p.HasImage, p.HasIcon = len(p.Image) > 0, len(p.Icon) > 0
	return err
}

// PruneLinkPreviews forgets previews older than the given time (they are fetched again when needed).
func (s *Store) PruneLinkPreviews(olderThan time.Time) error {
	_, err := s.db.Exec(`DELETE FROM link_previews WHERE fetched_at < ?`, olderThan.UTC().Format(time.RFC3339))
	return err
}
