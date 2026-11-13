package api

import (
	"log/slog"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// secretsKeySamples: how many of the newest values of each kind the start tries to open.
const secretsKeySamples = 5

// CheckSecretsKey tries the current SECRETS_KEY / secrets.key on a few stored encrypted values (hidden
// values in notes, authenticator secrets, public link tokens). A backup restored on a new machine without
// the old key starts with a newly generated one: notes and images work, but none of those values opens.
// MindSift still starts; the log says loudly what stops working and how to get it back. Returns the number
// of values tried and of those that did not open.
func (s *Server) CheckSecretsKey() (checked, unreadable int) {
	samples, err := s.store.SealedSamples(secretsKeySamples)
	if err != nil {
		slog.Warn("Checking the secrets key against the stored encrypted values failed", "error", err)
		return 0, 0
	}
	failedKinds := map[string]int{}
	for _, sample := range samples {
		id := sample.SealID
		if sample.Kind == storage.SealedTOTP {
			id = totpSealID(id)
		}
		checked++
		if _, err := s.openSecret(id, sample.Ciphertext); err != nil {
			unreadable++
			failedKinds[sample.Kind]++
		}
	}
	if unreadable == 0 {
		return checked, unreadable
	}
	attrs := []any{"key", s.cfg.SecretsKeySource, "checked", checked, "unreadable", unreadable}
	for _, kind := range []string{storage.SealedNoteSecret, storage.SealedTOTP, storage.SealedPublicLink} {
		if n := failedKinds[kind]; n > 0 {
			attrs = append(attrs, kind, n)
		}
	}
	if unreadable < checked {
		slog.Warn("Some stored encrypted values cannot be decrypted with the current secrets key; the affected hidden values, authenticator apps or public links need to be set up again", attrs...)
		return checked, unreadable
	}
	slog.Warn("THE SECRETS KEY DOES NOT MATCH THE DATA: none of the stored encrypted values can be decrypted. "+
		"Hidden values in notes cannot be revealed, codes from authenticator apps are refused (recovery codes still work) "+
		"and public links cannot be copied again. Notes, tasks and images are not affected. "+
		"Stop MindSift, restore the old SECRETS_KEY or data/secrets.key and start again "+
		"(Doku/operations.md, \"Restoring a whole server\"). Do not change those values in the meantime: values stored now use the new key.",
		attrs...)
	return checked, unreadable
}
