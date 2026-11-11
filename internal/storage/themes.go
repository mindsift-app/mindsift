package storage

import (
	"errors"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// MaxThemeCSSBytes limits a custom theme; the shipped themes are around 3 KB.
const MaxThemeCSSBytes = 200 * 1024

// GetUserThemes returns the user's own CSS themes, oldest first.
func (s *Store) GetUserThemes(userID string) ([]domain.UserTheme, error) {
	rows, err := s.db.Query(
		`SELECT id, name, css_content, created_at, updated_at FROM user_themes WHERE user_id = ? ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return []domain.UserTheme{}, err
	}
	defer rows.Close()
	themes := make([]domain.UserTheme, 0)
	for rows.Next() {
		var t domain.UserTheme
		if err := rows.Scan(&t.ID, &t.Name, &t.CSS, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return []domain.UserTheme{}, err
		}
		themes = append(themes, t)
	}
	return themes, rows.Err()
}

// SaveUserTheme creates a theme (empty themeID) or updates one of the user's themes.
func (s *Store) SaveUserTheme(userID, themeID, name, css string) (*domain.UserTheme, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("Name des Themes ist erforderlich")
	}
	if len([]rune(name)) > 60 {
		return nil, errors.New("Name des Themes ist zu lang (max. 60 Zeichen)")
	}
	if strings.TrimSpace(css) == "" {
		return nil, errors.New("Das Theme enthält kein CSS")
	}
	if len(css) > MaxThemeCSSBytes {
		return nil, errors.New("Das Theme ist zu groß (max. 200 KB)")
	}
	now := domain.NowISO()
	if themeID == "" {
		t := &domain.UserTheme{ID: domain.NewID("thm"), Name: name, CSS: css, CreatedAt: now, UpdatedAt: now}
		if _, err := s.db.Exec(
			`INSERT INTO user_themes (id, user_id, name, css_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			t.ID, userID, t.Name, t.CSS, t.CreatedAt, t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		return t, nil
	}
	res, err := s.db.Exec(
		`UPDATE user_themes SET name = ?, css_content = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		name, css, now, themeID, userID,
	)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, errors.New("Theme nicht gefunden")
	}
	t := &domain.UserTheme{ID: themeID, Name: name, CSS: css, UpdatedAt: now}
	logDBErr(s.db.QueryRow(`SELECT created_at FROM user_themes WHERE id = ?`, themeID).Scan(&t.CreatedAt))
	return t, nil
}

func (s *Store) DeleteUserTheme(userID, themeID string) error {
	res, err := s.db.Exec(`DELETE FROM user_themes WHERE id = ? AND user_id = ?`, themeID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("Theme nicht gefunden")
	}
	return nil
}
