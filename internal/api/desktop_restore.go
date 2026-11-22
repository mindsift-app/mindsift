package api

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Taking one account of a server over into a local instance of the desktop app (desktop mode only). A
// server's database snapshot (backups/system/mindsift-db-….db.gz) holds every account of that server; the
// local instance has one account and nothing to share. So the snapshot does not replace the instance's
// database: it is unpacked into a folder of its own next to it (restore-staging/<token>), opened as a store
// of its own (migrated there when it is older), and the person picks the account to take over. That
// account's data goes through the same export and import as a person's own backup (only what it owns;
// notes, lists and task lists others shared with it are listed as skipped), into the local account, and
// its personal settings follow (storage.TakeOverPersonSettings). The other accounts, the server's settings
// and its sharing never reach the instance. One snapshot is staged at a time; it is removed after the take
// over, when the person cancels, when another is uploaded, after an hour, and when the instance opens or
// closes.

const (
	// maxSnapshotUploadBytes: the packed snapshot the window sends (in-process, no network)
	maxSnapshotUploadBytes = 2 << 30
	// maxSnapshotBytes: the unpacked database
	maxSnapshotBytes = 8 << 30
	// snapshotStageTTL: how long a staged snapshot waits for the person to pick an account
	snapshotStageTTL = time.Hour
	snapshotDBName   = "mindsift.db"
)

var (
	errSnapshotNoFile   = errors.New("Keine Datei erhalten")
	errNotSnapshot      = errors.New("Die Datei ist kein Datenbank-Abzug von MindSift (mindsift-db-….db.gz)")
	errSnapshotTooLarge = i18n.NewError("Der Datenbank-Abzug ist zu groß (max. {gb} GB)", "gb", strconv.Itoa(maxSnapshotBytes>>30))
	errSnapshotNewer    = errors.New("Der Datenbank-Abzug stammt von einer neueren MindSift-Version. Bitte zuerst die App aktualisieren.")
	errSnapshotNoUsers  = errors.New("Im Datenbank-Abzug ist kein Konto")
	errSnapshotGone     = errors.New("Der Datenbank-Abzug ist nicht mehr da. Bitte die Datei noch einmal wählen.")
	errSnapshotNoUser   = errors.New("Dieses Konto ist nicht im Datenbank-Abzug")
)

// snapshotHiddenValues: why notes with hidden values are listed (the values are sealed with the server's key)
const snapshotHiddenValues = "Versteckte Werte sind mit dem Schlüssel des Servers verschlüsselt und kommen nicht mit"

// snapshotStage is the snapshot waiting for the person's choice.
type snapshotStage struct {
	mu      sync.Mutex
	token   string
	created time.Time
}

func (s *Server) snapshotRoot() string {
	return filepath.Join(filepath.Dir(s.cfg.DatabasePath), "restore-staging")
}

// clearSnapshots removes every staged snapshot (also leftovers of a crash).
func (s *Server) clearSnapshots() {
	s.snapshot.mu.Lock()
	defer s.snapshot.mu.Unlock()
	s.snapshot.token = ""
	logFailed("Removing staged database snapshots", os.RemoveAll(s.snapshotRoot()))
}

// stagedSnapshotDir: the folder of the staged snapshot with this token, "" when there is none (or it expired).
func (s *Server) stagedSnapshotDir(token string) string {
	s.snapshot.mu.Lock()
	defer s.snapshot.mu.Unlock()
	if s.snapshot.token == "" || token != s.snapshot.token {
		return ""
	}
	if time.Since(s.snapshot.created) > snapshotStageTTL {
		s.snapshot.token = ""
		logFailed("Removing an expired database snapshot", os.RemoveAll(s.snapshotRoot()))
		return ""
	}
	return filepath.Join(s.snapshotRoot(), token)
}

// openSnapshot opens a staged snapshot's database; migrations run on the first open.
func openSnapshot(dir string) (*storage.Store, error) {
	st, err := storage.NewStore(filepath.Join(dir, snapshotDBName))
	var newer *storage.NewerDatabaseError
	switch {
	case errors.As(err, &newer):
		return nil, errSnapshotNewer
	case err != nil:
		slog.Warn("Database snapshot could not be opened", "error", err)
		return nil, errNotSnapshot
	}
	return st, nil
}

// handleSnapshotUpload: POST /admin/backups/server-snapshot (multipart field file: .db.gz or .db). Stages
// the snapshot and answers {token, accounts}.
func (s *Server) handleSnapshotUpload(w http.ResponseWriter, r *http.Request) {
	allowLongTransfer(w)
	s.clearSnapshots()
	token, err := randomToken(16)
	if err != nil {
		writeInternal(w, err)
		return
	}
	dir := filepath.Join(s.snapshotRoot(), token)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeInternal(w, err)
		return
	}
	failed := func(status int, err error) {
		logFailed("Removing a staged database snapshot", os.RemoveAll(dir))
		writeErrorFrom(w, status, err)
	}
	// The upload goes to disk first; the import gate is claimed once it is in (see startImport)
	raw := filepath.Join(dir, "upload")
	if err := receiveSnapshot(r, raw); err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	done, ok := s.startImport(w, r)
	if !ok {
		logFailed("Removing a staged database snapshot", os.RemoveAll(dir))
		return
	}
	defer done()
	allowLongWork(w)
	err = unpackSnapshot(raw, filepath.Join(dir, snapshotDBName))
	logFailed("Removing the uploaded database snapshot", os.Remove(raw))
	if err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	st, err := openSnapshot(dir)
	if err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	accounts, err := st.SnapshotAccounts()
	logFailed("Closing a database snapshot", st.Close())
	if err != nil {
		slog.Warn("Accounts of a database snapshot could not be read", "error", err)
		failed(http.StatusBadRequest, errNotSnapshot)
		return
	}
	if len(accounts) == 0 {
		failed(http.StatusBadRequest, errSnapshotNoUsers)
		return
	}
	s.snapshot.mu.Lock()
	s.snapshot.token, s.snapshot.created = token, time.Now()
	s.snapshot.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "accounts": accounts})
}

// receiveSnapshot writes the multipart field file to dst.
func receiveSnapshot(r *http.Request, dst string) error {
	mr, err := r.MultipartReader()
	if err != nil {
		return errSnapshotNoFile
	}
	for {
		part, err := mr.NextPart()
		if err != nil {
			return errSnapshotNoFile
		}
		if part.FormName() != "file" {
			continue
		}
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		n, err := io.Copy(out, io.LimitReader(part, maxSnapshotUploadBytes+1))
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		var tooLarge *http.MaxBytesError
		switch {
		case n > maxSnapshotUploadBytes || errors.As(err, &tooLarge):
			return errSnapshotTooLarge
		case err != nil:
			return err
		case n == 0:
			return errSnapshotNoFile
		}
		return nil
	}
}

// sqliteHeader starts every SQLite database file.
var sqliteHeader = []byte("SQLite format 3\x00")

// unpackSnapshot writes the database of src (gzipped like the backups, or a plain database file) to dst.
func unpackSnapshot(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	br := bufio.NewReader(in)
	var body io.Reader = br
	if head, _ := br.Peek(2); len(head) == 2 && head[0] == 0x1f && head[1] == 0x8b {
		zr, err := gzip.NewReader(br)
		if err != nil {
			return errNotSnapshot
		}
		defer zr.Close()
		body = zr
	}
	head := make([]byte, len(sqliteHeader))
	if _, err := io.ReadFull(body, head); err != nil || !bytes.Equal(head, sqliteHeader) {
		return errNotSnapshot
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = out.Write(head)
	var n int64
	if err == nil {
		n, err = io.Copy(out, io.LimitReader(body, maxSnapshotBytes))
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	var gzErr bool
	if err != nil && (errors.Is(err, gzip.ErrChecksum) || errors.Is(err, gzip.ErrHeader) || errors.Is(err, io.ErrUnexpectedEOF)) {
		gzErr = true
	}
	switch {
	case gzErr:
		return errNotSnapshot
	case err != nil:
		return err
	case n >= maxSnapshotBytes:
		return errSnapshotTooLarge
	}
	return nil
}

// snapshotSummary: the preview or result of taking an account over: what the import creates and skips,
// whose data it is and whether the person's settings come along.
type snapshotSummary struct {
	storage.ImportSummary
	Account  storage.SnapshotAccount `json:"account"`
	Settings bool                    `json:"settings"`
	// SettingsSkipped: settings of the account left out as invalid (keys of PATCH /auth/settings)
	SettingsSkipped []string `json:"settingsSkipped,omitempty"`
}

// handleSnapshotTakeOver: POST /admin/backups/server-snapshot/{token}?account=<id> with sections, mode
// (restore: the chosen sections of the local account are replaced; merge: added), settings=0 (keep the
// local settings) and preview=1 (only the summary). Without preview the snapshot is removed afterwards.
func (s *Server) handleSnapshotTakeOver(w http.ResponseWriter, r *http.Request) {
	allowLongWork(w)
	dir := s.stagedSnapshotDir(chi.URLParam(r, "token"))
	if dir == "" {
		writeErrorFrom(w, http.StatusNotFound, errSnapshotGone)
		return
	}
	done, ok := s.startImport(w, r)
	if !ok {
		return
	}
	defer done()
	userID := auth.GetUserID(r.Context())
	q := r.URL.Query()
	accountID := q.Get("account")
	st, err := openSnapshot(dir)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	defer func() { logFailed("Closing a database snapshot", st.Close()) }()
	var account *storage.SnapshotAccount
	if accounts, err := st.SnapshotAccounts(); err == nil {
		for i := range accounts {
			if accounts[i].ID == accountID {
				account = &accounts[i]
			}
		}
	}
	if accountID == "" || account == nil || !st.HasAccount(accountID) {
		writeErrorFrom(w, http.StatusNotFound, errSnapshotNoUser)
		return
	}
	archive, err := snapshotAccountBackup(st, dir, accountID)
	if err != nil {
		slog.Error("Exporting an account of a database snapshot failed", "error", err)
		writeInternal(w, err)
		return
	}
	defer archive.Close()
	info, err := archive.Stat()
	if err != nil {
		writeInternal(w, err)
		return
	}
	plan, err := storage.PlanMindSiftImport(archive, info.Size(), filepath.Base(archive.Name()))
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	sections := storage.NormalizeSections(strings.Split(q.Get("sections"), ","))
	plan = plan.Only(sections)
	plan.SkipHiddenValues(snapshotHiddenValues)
	settings := q.Get("settings") != "0"
	if q.Get("preview") == "1" {
		s.store.CheckImportMedia(userID, plan)
		writeJSON(w, http.StatusOK, snapshotSummary{trSummary(w, plan.Summary(false)), *account, settings, nil})
		return
	}
	var replace map[string]bool
	if q.Get("mode") == "restore" {
		replace = sections
	}
	sum, err := s.store.RestoreImport(userID, plan, replace)
	if err != nil {
		slog.Error("Taking over an account of a database snapshot aborted", "user_id", userID, "error", err)
		writeError(w, http.StatusInternalServerError, "Import abgebrochen, nichts übernommen: "+clientMessage(err))
		return
	}
	var settingsSkipped []string
	if settings {
		// The alarm webhooks pass the same check as in PATCH /auth/settings; what fails is left out and named
		allowPrivate := s.allowPrivateWebhooks()
		check := func(raw string, discord bool) error { return validateWebhookURL(raw, discord, allowPrivate) }
		var err error
		settingsSkipped, err = s.store.TakeOverPersonSettings(st, accountID, userID, s.allowNeverRetention(), check)
		logFailed("Taking over the settings of the account", err, "user_id", userID)
		if len(settingsSkipped) > 0 {
			slog.Warn("Settings of a database snapshot left out as invalid", "user_id", userID, "settings", settingsSkipped)
		}
	}
	slog.Info("Account of a database snapshot taken over", "user_id", userID, "notes", sum.Notes, "tasks", sum.Tasks, "lists", sum.Lists, "settings", settings)
	s.clearSnapshots()
	writeJSON(w, http.StatusOK, snapshotSummary{trSummary(w, sum), *account, settings, settingsSkipped})
}

// snapshotAccountBackup: the account's backup ZIP, as its daily backup on the server would be (without
// images and recordings: their files are not in the snapshot), written once per account into dir.
func snapshotAccountBackup(st *storage.Store, dir, accountID string) (*os.File, error) {
	path := filepath.Join(dir, "account-"+hex.EncodeToString([]byte(accountID))+".zip")
	if f, err := os.Open(path); err == nil {
		return f, nil
	}
	exp, err := st.ExportUserData(accountID)
	if err != nil {
		return nil, err
	}
	tmp := path + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	err = st.WriteBackupZip(accountID, exp, out)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	return os.Open(path)
}

// handleSnapshotDiscard: DELETE /admin/backups/server-snapshot/{token}, the person cancelled.
func (s *Server) handleSnapshotDiscard(w http.ResponseWriter, r *http.Request) {
	if s.stagedSnapshotDir(chi.URLParam(r, "token")) != "" {
		s.clearSnapshots()
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
