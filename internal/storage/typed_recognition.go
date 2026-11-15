package storage

// Everyone decides whether the app reads due dates ("morgen 14 Uhr") and quantities ("2x Milch") from what
// they type or dictate (Kontoeinstellungen → Sprache, "Datum und Menge beim Tippen erkennen"). On by
// default; the recognition itself runs in the app (lib/naturalDate.ts, features/lists/itemQuantity.ts),
// the account only keeps the choice so it holds on every device.

// migrateTypedRecognition adds users.typed_recognition (1 = on), part of migration 67.
func (s *Store) migrateTypedRecognition() error {
	return s.addColumnIfMissing("users", "typed_recognition", "INTEGER NOT NULL DEFAULT 1")
}

// TypedRecognition: whether the app recognises dates and quantities in the person's typed text.
func (s *Store) TypedRecognition(userID string) bool {
	on := true
	logDBErr(s.db.QueryRow(`SELECT typed_recognition FROM users WHERE id = ?`, userID).Scan(&on))
	return on
}

func (s *Store) SetTypedRecognition(userID string, on bool) error {
	_, err := s.db.Exec(`UPDATE users SET typed_recognition = ? WHERE id = ?`, boolInt(on), userID)
	return err
}
