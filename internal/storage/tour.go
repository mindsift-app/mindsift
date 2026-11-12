package storage

// The app offers new accounts the guided tour once (features/tour/TourOfferCard.tsx); whatever the answer,
// the account remembers that it was asked, on every device. Accounts that existed before the offer are
// marked as asked, so nobody is surprised by it after an update. The demo's shared accounts do not use
// the flag: there each browser remembers it, and the API ignores setting it.

func (s *Store) migrateTourOffer() error {
	if err := s.addColumnIfMissing("users", "tour_offered", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	_, err := s.db.Exec(`UPDATE users SET tour_offered = 1`)
	return err
}

// TourOffered reports whether the user was already asked about the guided tour. When the database
// fails it answers yes: better no offer than one that keeps coming back.
func (s *Store) TourOffered(userID string) bool {
	var v int
	if dbFailed(s.db.QueryRow(`SELECT tour_offered FROM users WHERE id = ?`, userID).Scan(&v)) {
		return true
	}
	return v != 0
}

func (s *Store) SetTourOffered(userID string, offered bool) error {
	v := 0
	if offered {
		v = 1
	}
	_, err := s.db.Exec(`UPDATE users SET tour_offered = ? WHERE id = ?`, v, userID)
	return err
}
