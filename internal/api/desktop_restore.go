package api

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
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
// server's backup holds every account of that server: a copy of its data or backups folder as .zip, .tar or
// .tar.gz (with the pictures and recordings, desktop_restore_archive.go), or a database snapshot alone
// (backups/system/mindsift-db-….db.gz, without them); the local instance has one account and nothing to share. So the snapshot does not replace the instance's
// database: it is unpacked into a folder of its own next to it (restore-staging/<token>), opened as a store
// of its own (migrated there when it is older), and the person picks the account to take over. That
// account's data goes through the same export and import as a person's own backup (only what it owns;
// notes, lists and task lists others shared with it are listed as skipped), into the local account, and
// its personal settings follow (storage.TakeOverPersonSettings). The other accounts, the server's settings
// and its sharing never reach the instance. One snapshot is staged at a time; it is removed after the take
// over, when the person cancels, when another is uploaded, after an hour, and when the instance opens or
// closes.
//
// Values the server sealed with its key: the account's hidden values in notes come along when the backup
// carries the server's secrets.key (a complete backup, a copy of the data folder): opened with it and
// sealed again with the instance's key, as values of the new notes. Without that key, or where it does not
// open them, the notes come without them and are listed. The server's key is only read from the staging
// folder, never kept. The second factor, public links and calendar subscriptions stay out: the local
// instance has no sign-in, nothing public and no feeds (and the export does not carry them).

const (
	// maxSnapshotUploadBytes: the file the window sends (in-process, no network): a snapshot, or an archive
	// of a server's data folder with every account's media
	maxSnapshotUploadBytes = 32 << 30
	// maxSnapshotBytes: the unpacked database
	maxSnapshotBytes = 8 << 30
	// snapshotStageTTL: how long a staged snapshot waits for the person to pick an account
	snapshotStageTTL = time.Hour
	snapshotDBName   = "mindsift.db"
	// snapshotCheckTimeout: PRAGMA quick_check and the schema check of an uploaded snapshot (a few seconds
	// for a server's database; minutes only for the largest)
	snapshotCheckTimeout = 5 * time.Minute
	// snapshotQueryTimeout: listing the accounts of a snapshot
	snapshotQueryTimeout = time.Minute
)

var (
	errSnapshotNoFile   = errors.New("Keine Datei erhalten")
	errNotSnapshot      = errors.New("Die Datei ist kein Backup eines MindSift-Servers")
	errSnapshotTooLarge = i18n.NewError("Der Datenbank-Abzug ist zu groß (max. {gb} GB)", "gb", strconv.Itoa(maxSnapshotBytes>>30))
	errUploadTooLarge   = i18n.NewError("Die Datei ist zu groß (max. {gb} GB)", "gb", strconv.Itoa(maxSnapshotUploadBytes>>30))
	errSnapshotNewer    = errors.New("Der Datenbank-Abzug stammt von einer neueren MindSift-Version. Bitte zuerst die App aktualisieren.")
	errSnapshotNoUsers  = errors.New("Im Datenbank-Abzug ist kein Konto")
	errSnapshotGone     = errors.New("Der Datenbank-Abzug ist nicht mehr da. Bitte die Datei noch einmal wählen.")
	errSnapshotNoUser   = errors.New("Dieses Konto ist nicht im Datenbank-Abzug")
	errSnapshotRefused  = errors.New("Der Datenbank-Abzug ist beschädigt oder enthält etwas, das MindSift nicht anlegt, und wird nicht geöffnet")
)

// snapshotHiddenValues: why notes with hidden values are listed: the values are sealed with the server's key
// and the backup has no key that opens them (snapshotHiddenValuesOf)
const snapshotHiddenValues = "Versteckte Werte sind mit dem Schlüssel des Servers verschlüsselt und kommen nicht mit"

// snapshotStage is the snapshot waiting for the person's choice.
type snapshotStage struct {
	mu      sync.Mutex
	token   string
	created time.Time
	// busy: the folder a take-over is working in; nothing removes it until the take-over is done
	busy string
}

func (s *Server) snapshotRoot() string {
	return filepath.Join(filepath.Dir(s.cfg.DatabasePath), "restore-staging")
}

// clearSnapshots removes the staged snapshots (also leftovers of a crash) except the folder keep (an
// upload that is about to be staged) and the one a running take-over works in.
func (s *Server) clearSnapshots(keep string) {
	s.snapshot.mu.Lock()
	defer s.snapshot.mu.Unlock()
	s.snapshot.token = ""
	s.removeSnapshotsLocked(keep)
}

func (s *Server) removeSnapshotsLocked(keep string) {
	if keep == "" && s.snapshot.busy == "" {
		logFailed("Removing staged database snapshots", os.RemoveAll(s.snapshotRoot()))
		return
	}
	entries, err := os.ReadDir(s.snapshotRoot())
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.Name() == keep || e.Name() == s.snapshot.busy {
			continue
		}
		logFailed("Removing staged database snapshots", os.RemoveAll(filepath.Join(s.snapshotRoot(), e.Name())))
	}
}

// claimSnapshot marks the staged snapshot token as in use by a take-over (false: it is gone or replaced);
// the returned function releases it.
func (s *Server) claimSnapshot(token string) (release func(), ok bool) {
	s.snapshot.mu.Lock()
	defer s.snapshot.mu.Unlock()
	if token == "" || s.snapshot.token != token {
		return nil, false
	}
	s.snapshot.busy = token
	return func() {
		s.snapshot.mu.Lock()
		defer s.snapshot.mu.Unlock()
		if s.snapshot.busy == token {
			s.snapshot.busy = ""
		}
	}, true
}

// stagedSnapshotDir: the folder of the staged snapshot with this token, "" when there is none (or it expired).
func (s *Server) stagedSnapshotDir(token string) string {
	s.snapshot.mu.Lock()
	defer s.snapshot.mu.Unlock()
	if s.snapshot.token == "" || token != s.snapshot.token {
		return ""
	}
	if time.Since(s.snapshot.created) > snapshotStageTTL && s.snapshot.busy != token {
		s.snapshot.token = ""
		s.removeSnapshotsLocked("")
		return ""
	}
	return filepath.Join(s.snapshotRoot(), token)
}

// checkSnapshot looks at an uploaded snapshot before it is opened as a store (storage.CheckUntrustedDatabase):
// not damaged, and no trigger or view this instance's schema does not have, all within snapshotCheckTimeout.
func (s *Server) checkSnapshot(ctx context.Context, dir string) error {
	known, err := s.store.SchemaObjects()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, snapshotCheckTimeout)
	defer cancel()
	if err := storage.CheckUntrustedDatabase(ctx, filepath.Join(dir, snapshotDBName), known); err != nil {
		slog.Warn("Database snapshot refused", "error", err)
		return errSnapshotRefused
	}
	return nil
}

// openSnapshot opens a staged snapshot's database (checked by checkSnapshot when it was uploaded) with its
// schema code distrusted; migrations run on the first open.
func openSnapshot(dir string) (*storage.Store, error) {
	st, err := storage.NewStore(filepath.Join(dir, snapshotDBName), storage.WithUntrustedFile())
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

// handleSnapshotUpload: POST /admin/backups/server-snapshot (multipart field file: an archive of a server's
// data or backups folder, .db.gz or .db). Stages the database (and the archive) and answers {token, accounts}.
func (s *Server) handleSnapshotUpload(w http.ResponseWriter, r *http.Request) {
	allowLongTransfer(w)
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
	// Only now, with the import gate held: a take-over of the snapshot staged before cannot be running, and
	// the folder of this upload stays
	s.clearSnapshots(token)
	allowLongTransfer(w) // reading through an archive of a whole data folder takes a while
	if err := stageUpload(raw, dir); err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	if err := s.checkSnapshot(r.Context(), dir); err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	st, err := openSnapshot(dir)
	if err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), snapshotQueryTimeout)
	accounts, err := st.SnapshotAccountsContext(ctx)
	cancel()
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
			return errUploadTooLarge
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
	// Media: the account's pictures and recordings found in the backup; MediaMissing: those it lacks (all of
	// them in a database snapshot alone)
	Media        int `json:"media"`
	MediaMissing int `json:"mediaMissing"`
}

// handleSnapshotTakeOver: POST /admin/backups/server-snapshot/{token}?account=<id> with sections, mode
// (restore: the chosen sections of the local account are replaced; merge: added), settings=0 (keep the
// local settings) and preview=1 (only the summary). Without preview the snapshot is removed afterwards.
func (s *Server) handleSnapshotTakeOver(w http.ResponseWriter, r *http.Request) {
	allowLongTransfer(w) // the first call reads the account's media out of the archive
	token := chi.URLParam(r, "token")
	dir := s.stagedSnapshotDir(token)
	if dir == "" {
		writeErrorFrom(w, http.StatusNotFound, errSnapshotGone)
		return
	}
	done, ok := s.startImport(w, r)
	if !ok {
		return
	}
	defer done()
	// Claimed: cancelling, the expiry or a new upload no longer remove the folder under this take-over
	release, ok := s.claimSnapshot(token)
	if !ok {
		writeErrorFrom(w, http.StatusNotFound, errSnapshotGone)
		return
	}
	finished := false
	defer func() {
		release()
		if finished {
			s.clearSnapshots("")
		}
	}()
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
	ctx, cancel := context.WithTimeout(r.Context(), snapshotQueryTimeout)
	accounts, err := st.SnapshotAccountsContext(ctx)
	cancel()
	if err == nil {
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
	if errors.Is(err, errNotSnapshot) {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		slog.Error("Exporting an account of a database snapshot failed", "error", err)
		writeInternal(w, err)
		return
	}
	mediaFound, mediaMissing := snapshotMediaCounts(st, accountID)
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
	plan.CarryHiddenValues(s.snapshotHiddenValuesOf(st, dir, accountID, plan.HiddenValueIDs()), snapshotHiddenValues)
	settings := q.Get("settings") != "0"
	if q.Get("preview") == "1" {
		s.store.CheckImportMedia(userID, plan)
		writeJSON(w, http.StatusOK, snapshotSummary{trSummary(w, plan.Summary(false)), *account, settings, nil, mediaFound, mediaMissing})
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
	finished = true // the snapshot goes once released (deferred above), after the store on it is closed
	writeJSON(w, http.StatusOK, snapshotSummary{trSummary(w, sum), *account, settings, settingsSkipped, mediaFound, mediaMissing})
}

// snapshotHiddenValuesOf opens the account's hidden values among ids with the server's key from the backup
// (staged by stageServerKey) and returns them as id → plain text, for the import to seal again with this
// instance's key. Without a key in the backup, without a key of this instance, or for values the key does
// not open (another server's key, a key changed on the server) nothing comes back for them, and their
// notes are listed as before.
func (s *Server) snapshotHiddenValuesOf(st *storage.Store, dir, accountID string, ids []string) map[string]string {
	if len(ids) == 0 || len(s.cfg.SecretsKey) == 0 || len(s.store.SecretsKey()) == 0 {
		return nil
	}
	key, err := storage.ReadSecretsKeyFile(filepath.Join(dir, stagedServerKey))
	if err != nil {
		return nil
	}
	sealed, err := st.HiddenValuesOf(accountID, ids)
	if err != nil {
		slog.Warn("Hidden values of a database snapshot could not be read", "error", err)
		return nil
	}
	out := make(map[string]string, len(sealed))
	unreadable := 0
	for id, ct := range sealed {
		plain, err := storage.OpenValue(key, id, ct)
		if err != nil {
			unreadable++
			continue
		}
		out[id] = plain
	}
	if unreadable > 0 {
		slog.Warn("Some hidden values of the server's backup do not open with the secrets.key it carries; they stay behind", "unreadable", unreadable, "opened", len(out))
	}
	return out
}

// snapshotAccountBackup: the account's backup ZIP, as its daily backup on the server would be, written once
// per account into dir; with the pictures and recordings the uploaded archive has of it (none from a
// database snapshot alone).
func snapshotAccountBackup(st *storage.Store, dir, accountID string) (*os.File, error) {
	path := filepath.Join(dir, "account-"+hex.EncodeToString([]byte(accountID))+".zip")
	if f, err := os.Open(path); err == nil {
		return f, nil
	}
	if err := extractAccountMedia(st, dir, accountID); err != nil {
		return nil, err
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
		s.clearSnapshots("")
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
