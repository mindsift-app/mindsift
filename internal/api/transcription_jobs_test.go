package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// jobWhisper is a Whisper server whose answer the test decides: per call the text for the audio sent, or
// an error while fail is set. It counts the calls and can hold them until release is closed.
type jobWhisper struct {
	calls   atomic.Int32
	fail    atomic.Bool
	mu      sync.Mutex
	audios  []string
	release chan struct{}
}

func newJobWhisper(t *testing.T) (*jobWhisper, *httptest.Server) {
	t.Helper()
	jw := &jobWhisper{}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		jw.calls.Add(1)
		jw.mu.Lock()
		release := jw.release
		jw.mu.Unlock()
		if release != nil {
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		if jw.fail.Load() {
			http.Error(w, "model crashed", http.StatusInternalServerError)
			return
		}
		_ = r.ParseMultipartForm(10 << 20)
		f, _, _ := r.FormFile("file")
		audio, _ := io.ReadAll(f)
		jw.mu.Lock()
		jw.audios = append(jw.audios, string(audio))
		jw.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"text": "Text von " + string(audio)})
	}))
	t.Cleanup(ts.Close)
	return jw, ts
}

func jobServer(t *testing.T) (*Server, *storage.Store, string, string, *jobWhisper) {
	t.Helper()
	srv, store, token := setupTestServer(t)
	jw, ts := newJobWhisper(t)
	srv.cfg.Speech = config.SpeechConfig{URL: ts.URL, Model: "m", MaxParallel: 1, PerUserPerHour: 100, TimeoutSeconds: 10}
	srv.voice = newVoiceService(1)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	return srv, store, token, claims.UserID, jw
}

// eventually waits until cond holds (the worker runs on its own).
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting: %s", what)
}

// noteWithRecording makes a note with a recording bullet (caption as given) and returns note and media id.
func noteWithRecording(t *testing.T, srv *Server, store *storage.Store, token, userID, caption string) (string, string) {
	t.Helper()
	srv.cfg.Media.MaxAudioMB = 2
	src, _ := store.CreateDocument(userID, "", "Ablage", "", "", nil, nil, false)
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, []byte("aufnahme-im-block")...)
	rec := mediaUpload(t, srv.Router(), token, src.ID, webm, "audio/webm")
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var up struct{ ID string }
	_ = json.Unmarshal(rec.Body.Bytes(), &up)
	doc, err := store.CreateDocument(userID, "", "Sprachnotizen", "", "", []domain.DocumentBlock{
		{ID: "blk_audio", Type: "audio", Content: storage.MediaContent("audio", up.ID, caption)},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	return doc.ID, up.ID
}

func blockContent(t *testing.T, store *storage.Store, docID, blockID string) string {
	t.Helper()
	snap, err := store.GetDocSnapshot(docID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range snap.Blocks {
		if b.ID == blockID {
			return b.Content
		}
	}
	return ""
}

// "Transkribieren" on a recording is a job of the server: the request returns at once, the text comes
// into the caption through the note's log while nobody waits for it.
func TestTranscribeBlockInBackground(t *testing.T) {
	srv, store, token, userID, jw := jobServer(t)
	docID, mediaID := noteWithRecording(t, srv, store, token, userID, "")
	router := srv.Router()
	jw.mu.Lock()
	jw.release = make(chan struct{})
	jw.mu.Unlock()

	rec := sessionCall(router, "POST", "/api/v1/documents/"+docID+"/blocks/blk_audio/transcribe", token, "", "")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("transcribe: %d %s", rec.Code, rec.Body.String())
	}
	var job storage.Transcription
	_ = json.Unmarshal(rec.Body.Bytes(), &job)
	if job.Kind != storage.TranscriptionNote || job.BlockID != "blk_audio" || job.MediaID != mediaID {
		t.Fatalf("job: %+v", job)
	}
	// Asked twice while it runs: still one job
	rec = sessionCall(router, "POST", "/api/v1/documents/"+docID+"/blocks/blk_audio/transcribe", token, "", "")
	var again storage.Transcription
	_ = json.Unmarshal(rec.Body.Bytes(), &again)
	if again.ID != job.ID {
		t.Fatalf("a second job for the same bullet: %s vs %s", again.ID, job.ID)
	}
	// While it runs, the note lists it (a reload shows "wird transkribiert…")
	eventually(t, "job running", func() bool {
		rec := sessionCall(router, "GET", "/api/v1/documents/"+docID+"/transcriptions", token, "", "")
		var jobs []storage.Transcription
		_ = json.Unmarshal(rec.Body.Bytes(), &jobs)
		return len(jobs) == 1 && jobs[0].Status == storage.TranscriptionRunning
	})
	close(jw.release)

	want := storage.MediaContent("audio", mediaID, "Text von "+string(append([]byte{0x1A, 0x45, 0xDF, 0xA3}, []byte("aufnahme-im-block")...)))
	eventually(t, "caption written", func() bool { return blockContent(t, store, docID, "blk_audio") == want })
	eventually(t, "job gone", func() bool {
		jobs, _ := store.DocTranscriptions(docID)
		return len(jobs) == 0
	})
	if n := jw.calls.Load(); n != 1 {
		t.Fatalf("Whisper asked %d times", n)
	}
}

// A caption written while the job ran is kept; the text goes after it. A bullet someone is editing waits
// until they leave it.
func TestTranscribeBlockKeepsCaptionAndWaitsForEditor(t *testing.T) {
	srv, store, token, userID, _ := jobServer(t)
	docID, mediaID := noteWithRecording(t, srv, store, token, userID, "")
	oldCheck := transcriptionHeldCheck
	transcriptionHeldCheck = 20 * time.Millisecond
	t.Cleanup(func() { transcriptionHeldCheck = oldCheck })

	editor := collab.Actor{UserID: userID, ClientID: "tab-1"}
	if granted, _ := srv.leases.Hold(docID, editor, []string{"blk_audio"}); len(granted) != 1 {
		t.Fatal("lease not granted")
	}
	// The editor wrote a caption meanwhile
	snap, _ := store.GetDocSnapshot(docID)
	version := 0
	for _, b := range snap.Blocks {
		if b.ID == "blk_audio" {
			version = b.Version
		}
	}
	content := storage.MediaContent("audio", mediaID, "Besprechung")
	if _, _, err := store.ApplyDocOps(docID, editor, []collab.Op{{OpID: "op-cap", Kind: collab.OpSetContent, BlockID: "blk_audio", BaseVersion: version, Content: &content}}, srv.leases.View(docID)); err != nil {
		t.Fatal(err)
	}
	job, err := store.CreateNoteTranscription(userID, docID, "blk_audio", mediaID, "")
	if err != nil {
		t.Fatal(err)
	}
	srv.wakeTranscriptions()
	eventually(t, "job ran", func() bool {
		jw, _ := store.GetTranscription(job.ID)
		return jw != nil && jw.Status == storage.TranscriptionRunning
	})
	time.Sleep(200 * time.Millisecond)
	if got := blockContent(t, store, docID, "blk_audio"); got != content {
		t.Fatalf("written into a bullet held by an editor: %q", got)
	}
	srv.leases.Release(docID, editor.ClientID, []string{"blk_audio"})
	eventually(t, "caption written after the editor left", func() bool {
		return strings.HasPrefix(blockContent(t, store, docID, "blk_audio"), "[Besprechung Text von ")
	})
}

// Holding the + with the own Whisper server: the recording is stored on the server first, the parts the
// app recognised already are not sent again, and the server makes the inbox entry.
func TestVoiceCaptureMakesInboxEntry(t *testing.T) {
	srv, store, token, userID, jw := jobServer(t)
	router := srv.Router()

	rec := captureUpload(t, router, token, []string{"teil-eins", "teil-zwei"}, `["Schon erkannt.", null]`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("capture: %d %s", rec.Code, rec.Body.String())
	}
	var job storage.Transcription
	_ = json.Unmarshal(rec.Body.Bytes(), &job)
	if job.Kind != storage.TranscriptionInbox || job.Pieces != 2 {
		t.Fatalf("job: %+v", job)
	}
	eventually(t, "inbox entry", func() bool {
		ts, _ := store.GetThoughts(userID, "inbox", 50)
		for _, th := range ts {
			if th.Content == "Schon erkannt. Text von teil-zwei" {
				return th.Source == "voice"
			}
		}
		return false
	})
	eventually(t, "job gone", func() bool {
		jobs, _ := store.UserTranscriptions(userID)
		return len(jobs) == 0
	})
	jw.mu.Lock()
	defer jw.mu.Unlock()
	if len(jw.audios) != 1 || jw.audios[0] != "teil-zwei" {
		t.Fatalf("Whisper got %v, want only the part without text", jw.audios)
	}
}

// A Whisper server that fails: the job is tried again by itself, then stays failed with its recording
// (listen to it, try again, discard); trying again later makes the entry.
func TestVoiceCaptureFailureKeepsRecording(t *testing.T) {
	srv, store, token, userID, jw := jobServer(t)
	router := srv.Router()
	oldDelays := transcriptionRetryDelays
	transcriptionRetryDelays = []time.Duration{0}
	t.Cleanup(func() { transcriptionRetryDelays = oldDelays })
	jw.fail.Store(true)

	rec := captureUpload(t, router, token, []string{"wichtig"}, "")
	var job storage.Transcription
	_ = json.Unmarshal(rec.Body.Bytes(), &job)
	srv.wakeTranscriptions()
	eventually(t, "job failed after the automatic retry", func() bool {
		got, _ := store.GetTranscription(job.ID)
		if got != nil && got.Status == storage.TranscriptionQueued && got.Error != "" {
			srv.wakeTranscriptions() // the retry is due at once
		}
		return got != nil && got.Status == storage.TranscriptionFailed
	})
	if n := jw.calls.Load(); n != 2 {
		t.Fatalf("Whisper asked %d times, want 2 (one retry)", n)
	}
	rec = sessionCall(router, "GET", "/api/v1/voice/jobs", token, "", "")
	var jobs []storage.Transcription
	_ = json.Unmarshal(rec.Body.Bytes(), &jobs)
	if len(jobs) != 1 || jobs[0].Error != transcriptionErrFailed {
		t.Fatalf("jobs: %s", rec.Body.String())
	}
	rec = sessionCall(router, "GET", "/api/v1/voice/jobs/"+job.ID+"/audio/0", token, "", "")
	if rec.Code != http.StatusOK || rec.Body.String() != "wichtig" {
		t.Fatalf("audio: %d %q", rec.Code, rec.Body.String())
	}
	// Someone else sees nothing of it
	_, otherToken := newTestUser(t, store, "andere@example.com")
	if rec := sessionCall(router, "GET", "/api/v1/voice/jobs/"+job.ID+"/audio/0", otherToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("other user's audio: %d", rec.Code)
	}
	if rec := sessionCall(router, "POST", "/api/v1/voice/jobs/"+job.ID+"/retry", otherToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("other user's retry: %d", rec.Code)
	}

	jw.fail.Store(false)
	if rec := sessionCall(router, "POST", "/api/v1/voice/jobs/"+job.ID+"/retry", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
	eventually(t, "entry after the retry", func() bool {
		ts, _ := store.GetThoughts(userID, "inbox", 50)
		for _, th := range ts {
			if th.Content == "Text von wichtig" {
				return true
			}
		}
		return false
	})
}

// Discarding a failed recording removes it; a running job of the server's last run is queued again at the
// start, so a restart loses nothing.
func TestTranscriptionDiscardAndRequeue(t *testing.T) {
	srv, store, token, userID, _ := jobServer(t)
	router := srv.Router()
	srv.cfg.Speech.URL = "" // no Whisper server: jobs wait
	rec := captureUpload(t, router, token, []string{"a"}, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("capture without speech recognition: %d", rec.Code)
	}
	job, err := store.CreateInboxTranscription(userID, []storage.AudioPiece{{Mime: "audio/webm", Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimTranscription(time.Now())
	if err != nil || claimed == nil || claimed.ID != job.ID {
		t.Fatalf("claim: %v %+v", err, claimed)
	}
	if n, _ := store.RequeueTranscriptions(); n != 1 {
		t.Fatalf("requeued %d", n)
	}
	if got, _ := store.GetTranscription(job.ID); got.Status != storage.TranscriptionQueued {
		t.Fatalf("after restart: %s", got.Status)
	}
	if rec := sessionCall(router, "DELETE", "/api/v1/voice/jobs/"+job.ID, token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("discard: %d", rec.Code)
	}
	if _, err := store.GetTranscription(job.ID); err == nil {
		t.Fatal("discarded job still there")
	}
	if pieces, _ := store.TranscriptionAudio(job.ID); len(pieces) != 0 {
		t.Fatal("audio of a discarded job still there")
	}
}

// After the quick retries a failed job is tried again by itself after 5 minutes, 1, 6 and 24 hours, but
// only when the Whisper server was down or had a problem of its own; a time limit or a refused recording
// would fail again.
func TestTranscriptionRetryTimes(t *testing.T) {
	now := time.Date(2026, 3, 29, 1, 30, 0, 0, time.FixedZone("CET", 3600)) // the night the clocks change
	down := errors.New("dial tcp: connection refused")
	if want := []time.Duration{5 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour}; !slices.Equal(transcriptionLaterDelays, want) {
		t.Fatalf("later attempts after %v, want %v", transcriptionLaterDelays, want)
	}
	cases := []struct {
		attempt      int
		err          error
		retry, later time.Duration
	}{
		{1, down, transcriptionRetryDelays[0], 0},
		{1, context.DeadlineExceeded, transcriptionRetryDelays[0], 0},
		{2, down, transcriptionRetryDelays[1], 0},
		{3, down, 0, transcriptionLaterDelays[0]},
		{3, &sttStatusError{Status: 503}, 0, transcriptionLaterDelays[0]},
		{3, &sttStatusError{Status: 429}, 0, transcriptionLaterDelays[0]},
		{4, down, 0, transcriptionLaterDelays[1]},
		{5, down, 0, transcriptionLaterDelays[2]},
		{6, down, 0, transcriptionLaterDelays[3]},
		{7, down, 0, 0},
		{4, &sttStatusError{Status: 400}, 0, 0},
		{3, context.DeadlineExceeded, 0, 0},
		{3, &sttStatusError{Status: 400}, 0, 0},
		{3, &sttStatusError{Status: 413}, 0, 0},
	}
	for _, c := range cases {
		retryAt, laterAt := transcriptionRetryTimes(c.attempt, c.err, now)
		var gotRetry, gotLater time.Duration
		if !retryAt.IsZero() {
			gotRetry = retryAt.Sub(now)
		}
		if !laterAt.IsZero() {
			gotLater = laterAt.Sub(now)
		}
		if gotRetry != c.retry || gotLater != c.later {
			t.Errorf("attempt %d, %v: retry %v later %v, want %v %v", c.attempt, c.err, gotRetry, gotLater, c.retry, c.later)
		}
	}
}

// A failed job waiting for a later attempt stays failed until then and is queued again with its error;
// failed jobs go 30 days after their last attempt, the recording of a note stays in the note.
func TestFailedTranscriptionsLaterAndCleanup(t *testing.T) {
	srv, store, token, userID, _ := jobServer(t)
	docID, mediaID := noteWithRecording(t, srv, store, token, userID, "")
	srv.cfg.Speech.URL = "" // no worker run in between
	note, err := store.CreateNoteTranscription(userID, docID, "blk_audio", mediaID, "")
	if err != nil {
		t.Fatal(err)
	}
	inbox, err := store.CreateInboxTranscription(userID, []storage.AudioPiece{{Mime: "audio/webm", Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := store.FailTranscription(note.ID, transcriptionErrFailed, time.Time{}, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.FailTranscription(inbox.ID, transcriptionErrFailed, time.Time{}, time.Time{}); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.GetTranscription(note.ID); got.Status != storage.TranscriptionFailed {
		t.Fatalf("waiting for a later attempt: %s", got.Status)
	}
	// The app reads when the later attempt comes; a job without one has no nextAt
	rec := sessionCall(srv.Router(), "GET", "/api/v1/voice/jobs", token, "", "")
	var listed []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	nextAt := map[string]any{}
	for _, j := range listed {
		nextAt[j["id"].(string)] = j["nextAt"]
	}
	if want := now.Add(time.Hour).UTC().Format(time.RFC3339); nextAt[note.ID] != want {
		t.Fatalf("nextAt of the note's job = %v, want %s (%s)", nextAt[note.ID], want, rec.Body.String())
	}
	if v, ok := nextAt[inbox.ID]; !ok || v != nil {
		t.Fatalf("inbox job without a later attempt: nextAt %v (%s)", v, rec.Body.String())
	}
	if ids, err := store.RequeueDueTranscriptions(now.Add(59 * time.Minute)); err != nil || len(ids) != 0 {
		t.Fatalf("requeued before it is due: %v %v", ids, err)
	}
	ids, err := store.RequeueDueTranscriptions(now.Add(time.Hour))
	if err != nil || len(ids) != 1 || ids[0] != note.ID {
		t.Fatalf("requeued when due: %v %v", ids, err)
	}
	if got, _ := store.GetTranscription(note.ID); got.Status != storage.TranscriptionQueued || got.Error != transcriptionErrFailed {
		t.Fatalf("after the requeue: %+v", got)
	}
	if got, _ := store.GetTranscription(inbox.ID); got.Status != storage.TranscriptionFailed {
		t.Fatalf("failed job without a later attempt was queued: %s", got.Status)
	}

	// The last attempt fails for good
	if err := store.FailTranscription(note.ID, transcriptionErrFailed, time.Time{}, time.Time{}); err != nil {
		t.Fatal(err)
	}
	now = time.Now()
	if jobs, err := store.PurgeFailedTranscriptions(now.Add(29 * 24 * time.Hour)); err != nil || len(jobs) != 0 {
		t.Fatalf("purged before 30 days: %v %v", jobs, err)
	}
	srv.runFailedTranscriptionCleanup(now.Add(storage.FailedTranscriptionKeep + time.Minute))
	if _, err := store.GetTranscription(note.ID); err == nil {
		t.Fatal("failed job of a note still there after 30 days")
	}
	if snap := blockContent(t, store, docID, "blk_audio"); !strings.Contains(snap, mediaID) {
		t.Fatalf("recording gone from the note: %q", snap)
	}
	if _, err := store.GetMedia(mediaID); err != nil {
		t.Fatalf("recording's file gone: %v", err)
	}
	if _, err := store.GetTranscription(inbox.ID); err == nil {
		t.Fatal("failed inbox recording still there after 30 days")
	}
	if pieces, _ := store.TranscriptionAudio(inbox.ID); len(pieces) != 0 {
		t.Fatal("audio of the failed inbox recording still there")
	}
}

// Only a recording bullet of a note one may edit can be transcribed.
func TestTranscribeBlockChecks(t *testing.T) {
	srv, store, token, userID, _ := jobServer(t)
	docID, _ := noteWithRecording(t, srv, store, token, userID, "")
	router := srv.Router()
	text, _ := store.CreateDocument(userID, "", "Text", "", "", []domain.DocumentBlock{{ID: "blk_text", Type: "text", Content: "Hallo"}}, nil, false)
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+text.ID+"/blocks/blk_text/transcribe", token, "", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("text bullet: %d", rec.Code)
	}
	other, otherToken := newTestUser(t, store, "leser@example.com")
	if _, err := store.CreateDocShare(userID, docID, other.ID, "read"); err != nil {
		t.Fatal(err)
	}
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+docID+"/blocks/blk_audio/transcribe", otherToken, "", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("read-only share: %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/documents/"+docID+"/transcriptions", otherToken, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("reader lists jobs: %d", rec.Code)
	}
}

func captureUpload(t *testing.T, router http.Handler, token string, parts []string, texts string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, p := range parts {
		fw, _ := mw.CreateFormFile("file", "aufnahme.webm")
		_, _ = fw.Write([]byte(p))
	}
	if texts != "" {
		_ = mw.WriteField("texts", texts)
	}
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/voice/captures", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}
