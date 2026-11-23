package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Transcriptions in the background (storage/transcriptions.go): "Transkribieren" on a recording in a note
// and recordings dictated into the inbox (holding the +) are not transcribed while the page waits, but as
// a job of the server. The recording is stored first (a note's recording is its media file; an inbox
// recording goes into the job), so it is safe before the Whisper server is asked, also when the person
// leaves the page, closes the app or the server restarts. The job writes the result itself: into the
// recording's caption through the note's log (open editors get it live), or as a new inbox entry. Each
// change of a job goes to the people concerned as TRANSCRIPTION_UPDATED, its end as TRANSCRIPTION_DONE.
//
// Jobs share the places of the Whisper server with direct transcriptions (voiceService.slots), behind them:
// a job takes a place only while no direct request waits (voice_slots.go). A failed
// attempt is tried again after a while (transcriptionRetryDelays); after the last one the job is failed,
// with its recording, until the person tries again or discards it. When the Whisper server could not be
// reached or had a problem of its own (not a time limit, not a recording it refused), the failed job is
// also tried again by itself a few more times, 5 minutes and then hours apart (transcriptionLaterDelays),
// in case the server is back by then. A failed job goes 30 days after its last attempt (storage.PurgeFailedTranscriptions,
// with the hourly retention work): a note's recording stays in the note, an inbox recording goes with it.

// transcriptionRetryDelays: the waits before the second and third attempt
var transcriptionRetryDelays = []time.Duration{30 * time.Second, 2 * time.Minute}

// transcriptionLaterDelays: the waits of a failed job before each of its later attempts by itself
// (5 minutes for a Whisper server that was only restarting, then hours for one that was down longer)
var transcriptionLaterDelays = []time.Duration{5 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour}

// transcriptionPoll: how often the worker looks for due jobs without being woken (retries)
const transcriptionPoll = 15 * time.Second

// transcriptionHeldWait: how long a result waits for a bullet someone is editing before it is written
// anyway, and how often it looks again meanwhile (variables for the tests)
var (
	transcriptionHeldWait  = 5 * time.Minute
	transcriptionHeldCheck = 2 * time.Second
)

// Error codes of a failed job; the app shows its own text for each (voiceJobs.error.* in triage.json)
const (
	transcriptionErrFailed  = "failed"  // the Whisper server answered with an error or not at all
	transcriptionErrTimeout = "timeout" // it took longer than the job's time limit
	transcriptionErrOff     = "off"     // speech recognition on the server is switched off
)

// transcriptionTimeout: the time limit of one request in a job. A whole recording in a note can be long
// and nobody waits for the answer, so at least 15 minutes (the setting is meant for direct requests).
func (s *Server) transcriptionTimeout() time.Duration {
	return max(time.Duration(s.speech().TimeoutSeconds)*time.Second, 15*time.Minute)
}

// wakeTranscriptions makes the worker look for jobs now.
func (s *Server) wakeTranscriptions() {
	select {
	case s.transcriptionWake <- struct{}{}:
	default:
	}
}

// runTranscriptionJobs is the worker (a background job): it takes due jobs one by one as long as the
// Whisper server has a free place, and ends with Close. Jobs that were running when the server stopped
// are queued again first.
func (s *Server) runTranscriptionJobs() {
	if n, err := s.store.RequeueTranscriptions(); err != nil {
		slog.Warn("Queueing interrupted transcriptions again failed", "error", err)
	} else if n > 0 {
		slog.Info("Transcriptions interrupted by the last stop are queued again", "count", n)
	}
	stopCtx, cancel := s.stopContext()
	defer cancel()
	// Without waiting jobs the worker first sleeps until it is woken or the next poll
	look := s.store.HasQueuedTranscriptions()
	for {
		if !look {
			t := time.NewTimer(transcriptionPoll)
			select {
			case <-s.stop:
				t.Stop()
				return
			case <-s.transcriptionWake:
			case <-t.C:
			}
			t.Stop()
		}
		look = false
		if s.voiceMode() != "server" {
			continue // jobs wait until speech recognition on the server is back
		}
		s.requeueLaterTranscriptions(time.Now())
		// A place of the Whisper server first, behind direct requests (voice_slots.go)
		slot, err := s.voice.slotsFor(s.speech().MaxParallel).acquire(stopCtx, true)
		if err != nil {
			return // the server stops
		}
		job, err := s.store.ClaimTranscription(time.Now())
		if err != nil {
			slog.Warn("Reading the transcription queue failed", "error", err)
		}
		if job == nil {
			slot.release()
			continue
		}
		s.transcriptionChanged(job)
		s.background(func() {
			defer slot.release()
			s.runTranscription(stopCtx, slot, job)
		})
		look = true // there may be more
	}
}

// runTranscription does one attempt of a job, on the Whisper server's place slot.
func (s *Server) runTranscription(ctx context.Context, slot *sttSlot, job *storage.Transcription) {
	started := time.Now()
	var err error
	switch job.Kind {
	case storage.TranscriptionNote:
		err = s.runNoteTranscription(ctx, slot, job)
	case storage.TranscriptionInbox:
		err = s.runInboxTranscription(ctx, slot, job)
	default:
		err = s.store.FinishTranscription(job.ID)
	}
	if err == nil {
		slog.Debug("Transcription done", "job", job.ID, "kind", job.Kind, "duration_ms", time.Since(started).Milliseconds())
		return
	}
	if ctx.Err() != nil {
		return // the server stops: the job is queued again at the next start (still "running")
	}
	code := transcriptionErrFailed
	if errors.Is(err, context.DeadlineExceeded) {
		code = transcriptionErrTimeout
	}
	retryAt, laterAt := transcriptionRetryTimes(job.Attempts, err, time.Now())
	slog.Warn("Transcription failed", "job", job.ID, "kind", job.Kind, "attempt", job.Attempts, "retry", !retryAt.IsZero(),
		"retry_later", !laterAt.IsZero(), "url", s.sttEndpoint("/v1/audio/transcriptions"),
		"duration_ms", time.Since(started).Milliseconds(), "error", err)
	if ferr := s.store.FailTranscription(job.ID, code, retryAt, laterAt); ferr != nil {
		slog.Warn("Recording the failed transcription failed", "job", job.ID, "error", ferr)
	}
	if t, gerr := s.store.GetTranscription(job.ID); gerr == nil {
		s.transcriptionChanged(t)
	}
}

// transcriptionRetryTimes: when a job that failed on its attempt-th try (counted from 1) is tried again,
// as of now. retryAt: soon, the job keeps waiting; laterAt: the job is failed, and queued again then
// (only when the Whisper server was down or had a problem of its own). Both zero: not by itself.
func transcriptionRetryTimes(attempt int, err error, now time.Time) (retryAt, laterAt time.Time) {
	if attempt >= 1 && attempt <= len(transcriptionRetryDelays) {
		return now.Add(transcriptionRetryDelays[attempt-1]), time.Time{}
	}
	if late := attempt - len(transcriptionRetryDelays) - 1; late >= 0 && late < len(transcriptionLaterDelays) && transcriptionErrPasses(err) {
		return time.Time{}, now.Add(transcriptionLaterDelays[late])
	}
	return time.Time{}, time.Time{}
}

// transcriptionErrPasses: whether a failure may go away by itself: the Whisper server could not be
// reached, answered 5xx, 408 or 429. A time limit (the recording is too long for it) or another refusal
// (4xx: the recording or the settings) would fail again the same way.
func transcriptionErrPasses(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var status *sttStatusError
	if errors.As(err, &status) {
		return status.Status >= 500 || status.Status == http.StatusRequestTimeout || status.Status == http.StatusTooManyRequests
	}
	return true
}

// requeueLaterTranscriptions queues the failed jobs again whose later attempt is due (the worker, before
// it looks for jobs).
func (s *Server) requeueLaterTranscriptions(now time.Time) {
	ids, err := s.store.RequeueDueTranscriptions(now)
	if err != nil {
		slog.Warn("Queueing failed transcriptions again failed", "error", err)
	}
	for _, id := range ids {
		if t, err := s.store.GetTranscription(id); err == nil {
			s.transcriptionChanged(t)
		}
	}
}

// runFailedTranscriptionCleanup removes failed jobs past storage.FailedTranscriptionKeep (hourly, with the
// other retention work): recordings of notes stay in the notes, inbox recordings go with their jobs.
func (s *Server) runFailedTranscriptionCleanup(now time.Time) {
	jobs, err := s.store.PurgeFailedTranscriptions(now)
	if err != nil {
		slog.Warn("Removing old failed transcriptions failed", "error", err)
	}
	for i := range jobs {
		s.transcriptionDone(&jobs[i], "", "")
	}
	if len(jobs) > 0 {
		slog.Info("Old failed transcriptions removed", "count", len(jobs))
	}
}

// runNoteTranscription transcribes a recording in a note and writes the text into its caption.
func (s *Server) runNoteTranscription(ctx context.Context, slot *sttSlot, job *storage.Transcription) error {
	m, err := s.store.GetMedia(job.MediaID)
	if err != nil {
		return s.dropTranscription(job, "") // the recording is gone
	}
	audio, err := os.ReadFile(s.store.MediaFilePath(m))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s.dropTranscription(job, "")
		}
		return err
	}
	tctx, cancel := context.WithTimeout(ctx, s.transcriptionTimeout())
	text, err := s.transcribe(tctx, audio, "aufnahme"+storage.MediaExt(m.Mime), m.Mime, s.sttLanguage(job.UserID))
	cancel()
	slot.release() // the Whisper server is done; not held while the result waits for an editor below
	if err != nil {
		return err
	}
	if text == "" {
		return s.dropTranscription(job, "")
	}
	// Someone is editing the bullet: wait until they leave it (their editor would get a conflict copy),
	// after transcriptionHeldWait it is written anyway
	deadline := time.Now().Add(transcriptionHeldWait)
	for {
		if _, err := s.store.GetTranscription(job.ID); err != nil {
			return nil // discarded meanwhile
		}
		leases := s.leases.View(job.DocID)
		if time.Now().After(deadline) {
			leases = nil
		}
		res, err := s.store.WriteAudioTranscript(job.UserID, job.DocID, job.BlockID, job.MediaID, job.Caption, text, leases)
		if err != nil {
			return err
		}
		if res.Held {
			if !s.wait(transcriptionHeldCheck) {
				return ctx.Err()
			}
			continue
		}
		if len(res.Ops) > 0 {
			s.afterDocChange(job.UserID, job.DocID, res.Ops, res.Results)
			_, head, _ := s.store.GetDocOpsSince(job.DocID, 0, 0)
			s.notifyDocChanged(job.DocID, head)
		}
		return s.dropTranscription(job, text)
	}
}

// runInboxTranscription transcribes the parts of an inbox recording still without text and makes the
// entry. Each part's text is kept at once, so a retry only sends what is missing. Between the parts a
// waiting direct request gets the place first.
func (s *Server) runInboxTranscription(ctx context.Context, slot *sttSlot, job *storage.Transcription) error {
	pieces, err := s.store.TranscriptionAudio(job.ID)
	if err != nil {
		return err
	}
	language := s.sttLanguage(job.UserID)
	texts := make([]string, 0, len(pieces))
	sent := false
	for i, p := range pieces {
		if p.Text == nil {
			if sent {
				if err := slot.yield(ctx); err != nil {
					return err
				}
			}
			sent = true
			tctx, cancel := context.WithTimeout(ctx, s.transcriptionTimeout())
			text, err := s.transcribe(tctx, p.Data, "aufnahme"+storage.MediaExt(p.Mime), p.Mime, language)
			cancel()
			if err != nil {
				return err
			}
			if err := s.store.SetTranscriptionPieceText(job.ID, i, text); err != nil {
				return err
			}
			p.Text = &text
		}
		if t := strings.TrimSpace(*p.Text); t != "" {
			texts = append(texts, t)
		}
	}
	slot.release()
	if _, err := s.store.GetTranscription(job.ID); err != nil {
		return nil // discarded meanwhile
	}
	text := strings.Join(texts, " ")
	if text == "" {
		return s.dropTranscription(job, "")
	}
	// The entry first, then the job: a stop in between makes the entry twice at worst, never loses it
	thought, err := s.store.CreateThoughtWithDetails(job.UserID, text, "normal", "voice", "", "", "todo", "")
	if err != nil {
		return err
	}
	s.assignCreator(job.UserID, thought)
	s.wsHub.BroadcastToUsers(s.taskAudience(thought), "TASK_CREATED", thought)
	s.notifyTaskAdded(job.UserID, thought, nil)
	if err := s.store.FinishTranscription(job.ID); err != nil {
		return err
	}
	s.transcriptionDone(job, text, thought.ID)
	return nil
}

// dropTranscription ends a job (done, nothing heard, or its recording is gone) and tells the app.
func (s *Server) dropTranscription(job *storage.Transcription, text string) error {
	if err := s.store.FinishTranscription(job.ID); err != nil {
		return err
	}
	s.transcriptionDone(job, text, "")
	return nil
}

// transcriptionAudience: who sees a job: its owner, for a note everyone who may read it.
func (s *Server) transcriptionAudience(job *storage.Transcription) []string {
	users := []string{job.UserID}
	if job.DocID != "" {
		if others, err := s.store.GetAuthorizedDocUsers(job.DocID); err == nil {
			for _, u := range others {
				if u != job.UserID {
					users = append(users, u)
				}
			}
		}
	}
	return users
}

func (s *Server) transcriptionChanged(job *storage.Transcription) {
	s.wsHub.BroadcastToUsers(s.transcriptionAudience(job), "TRANSCRIPTION_UPDATED", job)
}

// transcriptionDone: the job is over. text is empty when nothing was heard or the recording is gone;
// thoughtId names the inbox entry it became.
func (s *Server) transcriptionDone(job *storage.Transcription, text, thoughtID string) {
	payload := map[string]any{"id": job.ID, "kind": job.Kind, "userId": job.UserID, "text": text}
	if job.DocID != "" {
		payload["docId"], payload["blockId"] = job.DocID, job.BlockID
	}
	if thoughtID != "" {
		payload["thoughtId"] = thoughtID
	}
	s.wsHub.BroadcastToUsers(s.transcriptionAudience(job), "TRANSCRIPTION_DONE", payload)
}

// checkTranscriptionStart: the server mode and the person's hourly budget (one job counts once).
func (s *Server) checkTranscriptionStart(w http.ResponseWriter, userID string) bool {
	if s.voiceMode() != "server" {
		writeError(w, http.StatusNotFound, "Serverseitige Spracherkennung ist nicht eingerichtet")
		return false
	}
	if !s.voice.allowVoice(userID, s.speech().PerUserPerHour, time.Now()) {
		writeError(w, http.StatusTooManyRequests, "Stundenlimit für die Spracherkennung erreicht. Bitte später erneut versuchen.")
		return false
	}
	return true
}

// handleTranscribeBlock: POST /documents/{id}/blocks/{blockId}/transcribe queues the transcription of a
// recording in the note; its text becomes the caption. 202 with the job.
func (s *Server) handleTranscribeBlock(w http.ResponseWriter, r *http.Request) {
	userID, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	if !storage.CanEditDoc(role) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz (nur Lesen oder im Papierkorb)")
		return
	}
	blockID := chi.URLParam(r, "blockId")
	d, err := s.noteDoc(docID)
	if err != nil {
		writeError(w, http.StatusNotFound, storage.ErrDocNotFound.Error())
		return
	}
	b, ok := d.Blocks[blockID]
	if !ok || b.Deleted {
		writeError(w, http.StatusNotFound, "Punkt nicht gefunden")
		return
	}
	ref, isMedia := storage.ParseMediaContent(b.Content)
	if b.Type != "audio" || !isMedia {
		writeError(w, http.StatusBadRequest, "Dieser Punkt ist keine Sprachaufnahme")
		return
	}
	m, err := s.store.GetMedia(ref.ID)
	if err != nil || !s.store.CanReadMedia(userID, m) {
		writeError(w, http.StatusNotFound, "Datei nicht gefunden")
		return
	}
	if !s.checkTranscriptionStart(w, userID) {
		return
	}
	job, err := s.store.CreateNoteTranscription(userID, docID, blockID, ref.ID, ref.Caption)
	if err != nil {
		writeInternal(w, err)
		return
	}
	s.transcriptionChanged(job)
	s.wakeTranscriptions()
	writeJSON(w, http.StatusAccepted, job)
}

// handleDocTranscriptions: GET /documents/{id}/transcriptions, the jobs for recordings in the note (so the
// bullets show "wird transkribiert…" after a reload and on other devices).
func (s *Server) handleDocTranscriptions(w http.ResponseWriter, r *http.Request) {
	_, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	jobs, err := s.store.DocTranscriptions(docID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

// maxCapturePieces: parts of one inbox recording (the app cuts one every ~8 s; STT_MAX_SECONDS is 600 by
// default, a pause cuts earlier)
const maxCapturePieces = 400

// handleVoiceCapture: POST /voice/captures stores a recording for the inbox and queues its transcription;
// the server makes the entry once the text is there. multipart/form-data: the parts as "file" in their
// order, optionally "texts" (JSON array, one string or null per part) with what the app already
// recognised, so those parts are not sent to the Whisper server again. 202 with the job.
func (s *Server) handleVoiceCapture(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	cfg := s.speech()
	allowLongTransfer(w)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, tr(w, "Aufnahme zu groß (höchstens {mb} MB)", "mb", strconv.Itoa(cfg.MaxUploadMB)))
			return
		}
		writeError(w, http.StatusBadRequest, "Keine Aufnahme im Feld \"file\"")
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	files := r.MultipartForm.File["file"]
	if len(files) == 0 || len(files) > maxCapturePieces {
		writeError(w, http.StatusBadRequest, "Keine Aufnahme im Feld \"file\"")
		return
	}
	var texts []*string
	if raw := r.FormValue("texts"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &texts); err != nil {
			writeError(w, http.StatusBadRequest, "Ungültiges JSON")
			return
		}
	}
	pieces := make([]storage.AudioPiece, 0, len(files))
	for i, fh := range files {
		f, err := fh.Open()
		if err != nil {
			writeError(w, http.StatusBadRequest, "Aufnahme konnte nicht gelesen werden")
			return
		}
		data, err := io.ReadAll(f)
		_ = f.Close()
		if err != nil {
			writeError(w, http.StatusBadRequest, "Aufnahme konnte nicht gelesen werden")
			return
		}
		p := storage.AudioPiece{Mime: captureMime(data, fh.Header.Get("Content-Type")), Data: data}
		if i < len(texts) && texts[i] != nil {
			t := strings.TrimSpace(*texts[i])
			if len(t) > 100_000 {
				t = t[:100_000]
			}
			p.Text = &t
		}
		if len(data) == 0 && p.Text == nil {
			empty := ""
			p.Text = &empty // nothing recorded in this part
		}
		pieces = append(pieces, p)
	}
	if !s.checkTranscriptionStart(w, userID) {
		return
	}
	job, err := s.store.CreateInboxTranscription(userID, pieces)
	if err != nil {
		writeInternal(w, err)
		return
	}
	s.transcriptionChanged(job)
	s.wakeTranscriptions()
	writeJSON(w, http.StatusAccepted, job)
}

// captureMime: the recording's format as found in its first bytes (only a recording format, so a part is
// served as audio when someone listens to it); anything else is passed on as plain bytes.
func captureMime(data []byte, declared string) string {
	if mime, kind, ok := storage.DetectMedia(data, declared); ok && kind == "audio" {
		return strings.TrimSpace(strings.SplitN(mime, ";", 2)[0])
	}
	return "application/octet-stream"
}

// handleVoiceJobs: GET /voice/jobs, the person's waiting, running and failed transcriptions.
func (s *Server) handleVoiceJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.store.UserTranscriptions(auth.GetUserID(r.Context()))
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

// ownTranscription reads a job of the person; 404 for anyone else's.
func (s *Server) ownTranscription(w http.ResponseWriter, r *http.Request) *storage.Transcription {
	job, err := s.store.GetTranscription(chi.URLParam(r, "id"))
	if err != nil || job.UserID != auth.GetUserID(r.Context()) {
		writeError(w, http.StatusNotFound, "Transkription nicht gefunden")
		return nil
	}
	return job
}

// handleVoiceJobRetry: POST /voice/jobs/{id}/retry queues a failed job again (one that waits or runs
// stays as it is).
func (s *Server) handleVoiceJobRetry(w http.ResponseWriter, r *http.Request) {
	if s.ownTranscription(w, r) == nil {
		return
	}
	userID := auth.GetUserID(r.Context())
	if s.voiceMode() != "server" {
		writeError(w, http.StatusNotFound, "Serverseitige Spracherkennung ist nicht eingerichtet")
		return
	}
	job, err := s.store.RetryTranscription(userID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "Transkription nicht gefunden")
		return
	}
	s.transcriptionChanged(job)
	s.wakeTranscriptions()
	writeJSON(w, http.StatusOK, job)
}

// handleVoiceJobDelete: DELETE /voice/jobs/{id} discards a job with its recording (an inbox recording is
// gone then; a note's recording stays in the note).
func (s *Server) handleVoiceJobDelete(w http.ResponseWriter, r *http.Request) {
	job := s.ownTranscription(w, r)
	if job == nil {
		return
	}
	if err := s.store.FinishTranscription(job.ID); err != nil {
		writeInternal(w, err)
		return
	}
	s.transcriptionDone(job, "", "")
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleVoiceJobAudio: GET /voice/jobs/{id}/audio/{n}, part n of an inbox recording (to listen to one
// whose transcription failed).
func (s *Server) handleVoiceJobAudio(w http.ResponseWriter, r *http.Request) {
	job := s.ownTranscription(w, r)
	if job == nil {
		return
	}
	n, err := strconv.Atoi(chi.URLParam(r, "n"))
	pieces, perr := s.store.TranscriptionAudio(job.ID)
	if err != nil || perr != nil || n < 0 || n >= len(pieces) {
		writeError(w, http.StatusNotFound, "Datei nicht gefunden")
		return
	}
	w.Header().Set("Content-Type", pieces[n].Mime)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	allowLongTransfer(w)
	_, _ = w.Write(pieces[n].Data)
}
