package storage

import "fmt"

// SealedSample is one value the server layer encrypted with SECRETS_KEY: the kind of value, the id it is
// bound to as additional data (see api/secrets.go) and the stored ciphertext.
type SealedSample struct {
	Kind       string
	SealID     string
	Ciphertext string
}

// Sealed value kinds of SealedSamples.
const (
	SealedNoteSecret = "note_secret"
	SealedTOTP       = "totp"
	SealedPublicLink = "public_link"
)

// SealedSamples returns up to perKind of the newest values of each kind encrypted with SECRETS_KEY, so the
// start can check that the current key still opens them. The TOTP rows carry the user id; the caller
// builds the seal id from it.
func (s *Store) SealedSamples(perKind int) ([]SealedSample, error) {
	queries := []struct{ kind, query string }{
		{SealedNoteSecret, `SELECT id, ciphertext FROM note_secrets ORDER BY updated_at DESC LIMIT ?`},
		{SealedTOTP, `SELECT user_id, secret_sealed FROM user_totp ORDER BY created_at DESC LIMIT ?`},
		{SealedPublicLink, `SELECT id, token_sealed FROM public_links ORDER BY created_at DESC LIMIT ?`},
	}
	var out []SealedSample
	for _, q := range queries {
		rows, err := s.db.Query(q.query, perKind)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", q.kind, err)
		}
		for rows.Next() {
			sample := SealedSample{Kind: q.kind}
			if err := rows.Scan(&sample.SealID, &sample.Ciphertext); err != nil {
				_ = rows.Close()
				return nil, fmt.Errorf("%s: %w", q.kind, err)
			}
			out = append(out, sample)
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", q.kind, err)
		}
	}
	return out, nil
}
