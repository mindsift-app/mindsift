package storage

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Transcriptions done by the server in the background (api/transcription_jobs.go): a recording in a note
// whose text goes into its caption ("note"), or a recording dictated into the inbox that becomes an entry
// there ("inbox"). The job is stored before the work starts, so it outlives the page that asked for it and
// a restart of the server: a job that was running when the server stopped is queued again at the start.
// An inbox recording keeps its audio here (transcription_audio) until its entry exists, so nothing spoken
// is lost when the Whisper server fails; a note's recording is its media file anyway.
//
// A failed job goes FailedTranscriptionKeep after its last attempt (PurgeFailedTranscriptions, hourly; one
// with a later attempt planned only once that one failed too): a note's recording stays in the note and
// can be transcribed again any time, a failed inbox job goes together with its audio. While speech
// recognition is not in server mode, nothing works on the jobs: then waiting ones and failed ones with a
// later attempt planned go as well, FailedTranscriptionKeep after they were queued or last tried.

const (
	TranscriptionNote  = "note"
	TranscriptionInbox = "inbox"

	TranscriptionQueued  = "queued"
	TranscriptionRunning = "running"
	TranscriptionFailed  = "failed"
)

// FailedTranscriptionKeep: how long a failed job stays after its last attempt (and, while no worker runs,
// a waiting one after it was queued or last tried).
const FailedTranscriptionKeep = 30 * 24 * time.Hour

// ErrTranscriptionNotFound: no such job of this person.
var ErrTranscriptionNotFound = errors.New("transcription not found")

// Transcription is one job, without its audio.
type Transcription struct {
	ID      string `json:"id"`
	UserID  string `json:"userId"`
	Kind    string `json:"kind"`
	DocID   string `json:"docId,omitempty"`
	BlockID string `json:"blockId,omitempty"`
	MediaID string `json:"mediaId,omitempty"`
	// Caption: the recording's caption when the job was started; a different one at the end means someone
	// wrote one meanwhile, and the text is added after it instead of replacing it
	Caption  string `json:"-"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	Attempts int    `json:"attempts"`
	// NextAt: when the job is tried again by itself (RFC 3339, UTC): a failed job's later attempt, or the
	// retry a waiting job waits for; empty when none is planned
	NextAt    string `json:"nextAt,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	// Pieces: how many parts the recording of an inbox job has
	Pieces int `json:"pieces,omitempty"`
}

// AudioPiece is one part of an inbox recording (the app cuts a recording while it is spoken). Text is set
// once the part is transcribed, so a job that is tried again only sends the parts still missing.
type AudioPiece struct {
	Mime string
	Data []byte
	Text *string
}

func (s *Store) migrateTranscriptions() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS transcriptions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			doc_id TEXT NOT NULL DEFAULT '',
			block_id TEXT NOT NULL DEFAULT '',
			media_id TEXT NOT NULL DEFAULT '',
			caption TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			error TEXT NOT NULL DEFAULT '',
			attempts INTEGER NOT NULL DEFAULT 0,
			next_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_transcriptions_user ON transcriptions(user_id)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_transcriptions_doc ON transcriptions(doc_id) WHERE doc_id != ''`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status, next_at)`),
		stmt(`CREATE TABLE IF NOT EXISTS transcription_audio (
			job_id TEXT NOT NULL,
			idx INTEGER NOT NULL,
			mime TEXT NOT NULL,
			data BLOB NOT NULL,
			text TEXT,
			PRIMARY KEY (job_id, idx)
		)`),
	)
}

const transcriptionCols = `t.id, t.user_id, t.kind, t.doc_id, t.block_id, t.media_id, t.caption, t.status, t.error, t.attempts,
	t.next_at, t.created_at, t.updated_at, (SELECT COUNT(*) FROM transcription_audio a WHERE a.job_id = t.id)`

func scanTranscription(row interface{ Scan(...any) error }) (*Transcription, error) {
	var t Transcription
	err := row.Scan(&t.ID, &t.UserID, &t.Kind, &t.DocID, &t.BlockID, &t.MediaID, &t.Caption, &t.Status, &t.Error,
		&t.Attempts, &t.NextAt, &t.CreatedAt, &t.UpdatedAt, &t.Pieces)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) queryTranscriptions(q string, args ...any) ([]Transcription, error) {
	rows, err := s.db.Query(`SELECT `+transcriptionCols+` FROM transcriptions t `+q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transcription{}
	for rows.Next() {
		t, err := scanTranscription(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// GetTranscription reads one job.
func (s *Store) GetTranscription(id string) (*Transcription, error) {
	t, err := scanTranscription(s.db.QueryRow(`SELECT `+transcriptionCols+` FROM transcriptions t WHERE t.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrTranscriptionNotFound
	}
	return t, err
}

// CreateNoteTranscription queues the transcription of a recording in a note. A job for the same bullet that
// is still waiting or running is returned instead of a second one; a failed one starts again.
func (s *Store) CreateNoteTranscription(userID, docID, blockID, mediaID, caption string) (*Transcription, error) {
	var existing string
	err := s.db.QueryRow(`SELECT id FROM transcriptions WHERE doc_id = ? AND block_id = ? AND media_id = ?`, docID, blockID, mediaID).Scan(&existing)
	switch {
	case err == nil:
		t, err := s.GetTranscription(existing)
		if err != nil || t.Status != TranscriptionFailed {
			return t, err
		}
		now := nowUTC()
		if _, err := s.db.Exec(`UPDATE transcriptions SET status = ?, error = '', attempts = 0, next_at = '', user_id = ?, caption = ?, updated_at = ? WHERE id = ?`,
			TranscriptionQueued, userID, caption, now, existing); err != nil {
			return nil, err
		}
		return s.GetTranscription(existing)
	case !errors.Is(err, sql.ErrNoRows):
		return nil, err
	}
	id, now := domain.NewID("trs"), nowUTC()
	_, err = s.db.Exec(`INSERT INTO transcriptions (id, user_id, kind, doc_id, block_id, media_id, caption, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, userID, TranscriptionNote, docID, blockID, mediaID, caption, TranscriptionQueued, now, now)
	if err != nil {
		return nil, err
	}
	return s.GetTranscription(id)
}

// CreateInboxTranscription stores a recording for the inbox with its parts and queues it, in one write.
func (s *Store) CreateInboxTranscription(userID string, pieces []AudioPiece) (*Transcription, error) {
	id, now := domain.NewID("trs"), nowUTC()
	stmts := []sqlStmt{stmt(`INSERT INTO transcriptions (id, user_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, userID, TranscriptionInbox, TranscriptionQueued, now, now)}
	for i, p := range pieces {
		var text any
		if p.Text != nil {
			text = *p.Text
		}
		stmts = append(stmts, stmt(`INSERT INTO transcription_audio (job_id, idx, mime, data, text) VALUES (?, ?, ?, ?, ?)`, id, i, p.Mime, p.Data, text))
	}
	if err := s.execInTx(stmts...); err != nil {
		return nil, err
	}
	return s.GetTranscription(id)
}

// TranscriptionAudio returns the parts of an inbox recording in order.
func (s *Store) TranscriptionAudio(jobID string) ([]AudioPiece, error) {
	rows, err := s.db.Query(`SELECT mime, data, text FROM transcription_audio WHERE job_id = ? ORDER BY idx`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AudioPiece
	for rows.Next() {
		var p AudioPiece
		var text sql.NullString
		if err := rows.Scan(&p.Mime, &p.Data, &text); err != nil {
			return nil, err
		}
		if text.Valid {
			p.Text = &text.String
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetTranscriptionPieceText keeps the text of one part, so a retry does not send it again.
func (s *Store) SetTranscriptionPieceText(jobID string, idx int, text string) error {
	_, err := s.db.Exec(`UPDATE transcription_audio SET text = ? WHERE job_id = ? AND idx = ?`, text, jobID, idx)
	return err
}

// ClaimTranscription marks the oldest waiting job that is due as running and returns it (nil: none).
func (s *Store) ClaimTranscription(now time.Time) (*Transcription, error) {
	due := now.UTC().Format(time.RFC3339)
	for {
		var id string
		err := s.db.QueryRow(`SELECT id FROM transcriptions WHERE status = ? AND next_at <= ? ORDER BY created_at, id LIMIT 1`,
			TranscriptionQueued, due).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		res, err := s.db.Exec(`UPDATE transcriptions SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = ?`,
			TranscriptionRunning, nowUTC(), id, TranscriptionQueued)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			return s.GetTranscription(id)
		}
		// Taken or removed meanwhile: look for the next one
	}
}

// RequeueTranscriptions queues the jobs again that were running when the server stopped (at the start).
func (s *Store) RequeueTranscriptions() (int64, error) {
	res, err := s.db.Exec(`UPDATE transcriptions SET status = ?, next_at = '', updated_at = ? WHERE status = ?`,
		TranscriptionQueued, nowUTC(), TranscriptionRunning)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// FailTranscription records why a job failed: with retryAt it waits until then and is tried again,
// without it stays failed until the person tries again (RetryTranscription). With laterAt (and no
// retryAt) it is shown as failed, but queued again at that time by RequeueDueTranscriptions.
func (s *Store) FailTranscription(id, reason string, retryAt, laterAt time.Time) error {
	status, next := TranscriptionFailed, ""
	switch {
	case !retryAt.IsZero():
		status, next = TranscriptionQueued, retryAt.UTC().Format(time.RFC3339)
	case !laterAt.IsZero():
		next = laterAt.UTC().Format(time.RFC3339)
	}
	_, err := s.db.Exec(`UPDATE transcriptions SET status = ?, error = ?, next_at = ?, updated_at = ? WHERE id = ?`, status, reason, next, nowUTC(), id)
	return err
}

// RequeueDueTranscriptions queues the failed jobs again whose later attempt (FailTranscription's laterAt)
// is due, and returns their ids. The error stays, so the app shows them as waiting for a retry.
func (s *Store) RequeueDueTranscriptions(now time.Time) ([]string, error) {
	due := now.UTC().Format(time.RFC3339)
	rows, err := s.db.Query(`SELECT id FROM transcriptions WHERE status = ? AND next_at != '' AND next_at <= ?`, TranscriptionFailed, due)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []string
	for _, id := range ids {
		res, err := s.db.Exec(`UPDATE transcriptions SET status = ?, updated_at = ? WHERE id = ? AND status = ? AND next_at != '' AND next_at <= ?`,
			TranscriptionQueued, nowUTC(), id, TranscriptionFailed, due)
		if err != nil {
			return out, err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			out = append(out, id)
		}
	}
	return out, nil
}

// PurgeFailedTranscriptions removes the failed jobs whose last attempt is longer ago than
// FailedTranscriptionKeep, an inbox job together with its audio, and returns them (a note's recording
// stays in its note). A job still waiting for a later attempt (next_at) is left alone until that attempt
// failed too. idle: no worker takes jobs (speech recognition not in server mode), so waiting jobs and
// failed ones with a later attempt planned would never be tried; those go as well once nothing has
// happened to them for FailedTranscriptionKeep (updated_at: queued, or the last attempt). A running job is
// never touched. Audio rows whose job is gone are removed as well.
func (s *Store) PurgeFailedTranscriptions(now time.Time, idle bool) ([]Transcription, error) {
	cutoff := now.Add(-FailedTranscriptionKeep).UTC().Format(time.RFC3339)
	jobs, err := s.queryTranscriptions(`WHERE `+purgeableTranscription("t.", idle)+` ORDER BY t.created_at, t.id`, purgeableArgs(cutoff, idle)...)
	if err != nil {
		return nil, err
	}
	var out []Transcription
	for _, j := range jobs {
		gone, err := s.purgeTranscription(j.ID, cutoff, idle)
		if err != nil {
			return out, err
		}
		if gone {
			out = append(out, j)
		}
	}
	// Audio of jobs removed some other way, so no recording stays behind without its job
	if _, err := s.db.Exec(`DELETE FROM transcription_audio WHERE job_id NOT IN (SELECT id FROM transcriptions)`); err != nil {
		return out, err
	}
	return out, nil
}

// purgeableTranscription: the condition of PurgeFailedTranscriptions on a job (columns with prefix p),
// with the arguments of purgeableArgs
func purgeableTranscription(p string, idle bool) string {
	if idle {
		return `(` + p + `status = ? OR ` + p + `status = ?) AND ` + p + `updated_at < ?`
	}
	return p + `status = ? AND ` + p + `next_at = '' AND ` + p + `updated_at < ?`
}

func purgeableArgs(cutoff string, idle bool) []any {
	if idle {
		return []any{TranscriptionFailed, TranscriptionQueued, cutoff}
	}
	return []any{TranscriptionFailed, cutoff}
}

// purgeTranscription removes a job with its audio in one step; the condition is checked again, so a job
// that was claimed, tried or queued again meanwhile stays (false).
func (s *Store) purgeTranscription(id, cutoff string, idle bool) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM transcriptions WHERE id = ? AND `+purgeableTranscription("", idle), append([]any{id}, purgeableArgs(cutoff, idle)...)...)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return false, nil
	}
	if _, err := tx.Exec(`DELETE FROM transcription_audio WHERE job_id = ?`, id); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// FinishTranscription removes a job with its audio (done, or its recording is gone).
func (s *Store) FinishTranscription(id string) error {
	return s.execInTx(
		stmt(`DELETE FROM transcription_audio WHERE job_id = ?`, id),
		stmt(`DELETE FROM transcriptions WHERE id = ?`, id),
	)
}

// RetryTranscription queues a failed job of the person again.
func (s *Store) RetryTranscription(userID, id string) (*Transcription, error) {
	res, err := s.db.Exec(`UPDATE transcriptions SET status = ?, error = '', attempts = 0, next_at = '', updated_at = ? WHERE id = ? AND user_id = ? AND status = ?`,
		TranscriptionQueued, nowUTC(), id, userID, TranscriptionFailed)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		t, err := s.GetTranscription(id)
		if err != nil || t.UserID != userID {
			return nil, ErrTranscriptionNotFound
		}
		return t, nil // waiting or running already
	}
	return s.GetTranscription(id)
}

// UserTranscriptions lists the person's jobs, oldest first.
func (s *Store) UserTranscriptions(userID string) ([]Transcription, error) {
	return s.queryTranscriptions(`WHERE t.user_id = ? ORDER BY t.created_at, t.id`, userID)
}

// DocTranscriptions lists the jobs for recordings in a note.
func (s *Store) DocTranscriptions(docID string) ([]Transcription, error) {
	return s.queryTranscriptions(`WHERE t.doc_id = ? ORDER BY t.created_at, t.id`, docID)
}

// deleteUserTranscriptions: statements that remove a person's jobs with their audio (account deletion).
func deleteUserTranscriptions(userID string) []sqlStmt {
	return []sqlStmt{
		stmt(`DELETE FROM transcription_audio WHERE job_id IN (SELECT id FROM transcriptions WHERE user_id = ?)`, userID),
		stmt(`DELETE FROM transcriptions WHERE user_id = ?`, userID),
	}
}

// TranscriptWrite is what WriteAudioTranscript did.
type TranscriptWrite struct {
	// Held: someone is editing the bullet right now; nothing was written, try again later
	Held bool
	// Gone: the bullet is deleted, no recording any more, or shows another file; nothing to write
	Gone    bool
	Ops     []collab.Op
	Results []collab.Result
}

// WriteAudioTranscript puts a transcript into the caption of a recording in a note, through the note's log
// like any change (open editors get it with their next sync). It replaces the caption the recording had
// when the job started (captionBefore); one written meanwhile is kept and the text added after it. With
// leases, a bullet someone holds is left alone (Held), so their editor gets no conflict copy.
func (s *Store) WriteAudioTranscript(userID, docID, blockID, mediaID, captionBefore, text string, leases collab.LeaseView) (TranscriptWrite, error) {
	var out TranscriptWrite
	a := collab.Actor{UserID: userID, ClientID: collab.ServerHolder}
	results, _, err := s.applyDocChange(docID, a, nil, func(d *collab.Doc) []collab.Op {
		b, ok := d.Blocks[blockID]
		ref, isMedia := MediaRef{}, false
		if ok && !b.Deleted && b.Type == "audio" {
			ref, isMedia = ParseMediaContent(b.Content)
		}
		if !isMedia || ref.ID != mediaID {
			out.Gone = true
			return nil
		}
		if leases != nil {
			if _, held := leases.HolderOf(blockID); held {
				out.Held = true
				return nil
			}
		}
		caption := text
		if current := strings.TrimSpace(ref.Caption); current != "" && current != strings.TrimSpace(captionBefore) {
			if strings.Contains(current, text) {
				return nil
			}
			caption = current + " " + text
		}
		content := MediaContent("audio", mediaID, caption)
		out.Ops = []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: blockID, BaseVersion: b.Version, Content: &content}}
		return out.Ops
	})
	if errors.Is(err, ErrDocNotFound) {
		out.Gone = true
		return out, nil
	}
	out.Results = results
	return out, err
}

// HasQueuedTranscriptions: whether any job waits (at the start, so the worker begins without sleeping).
func (s *Store) HasQueuedTranscriptions() bool {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM transcriptions WHERE status = ?`, TranscriptionQueued).Scan(&n)
	return err == nil && n > 0
}
