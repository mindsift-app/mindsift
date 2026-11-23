package storage

import (
	"path/filepath"
	"testing"
	"time"
)

// Failed jobs go FailedTranscriptionKeep after their last attempt, inbox recordings with their audio; a job
// still waiting for a later attempt, a waiting job and a younger failed one stay, and audio without a job goes.
func TestPurgeFailedTranscriptions(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "transcriptions.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })

	last := time.Date(2026, 3, 29, 0, 30, 0, 0, time.UTC) // the night the clocks change in Europe
	stamp := func(at time.Time) string { return at.UTC().Format(time.RFC3339) }
	audio := []AudioPiece{{Mime: "audio/webm", Data: []byte("x")}, {Mime: "audio/webm", Data: []byte("y")}}
	job := func(status, nextAt string, at time.Time) string {
		t.Helper()
		j, err := s.CreateInboxTranscription("usr_a", audio)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec(`UPDATE transcriptions SET status = ?, next_at = ?, updated_at = ? WHERE id = ?`, status, nextAt, stamp(at), j.ID); err != nil {
			t.Fatal(err)
		}
		return j.ID
	}
	failed := job(TranscriptionFailed, "", last)
	later := job(TranscriptionFailed, stamp(last.Add(24*time.Hour)), last) // a later attempt is planned
	queued := job(TranscriptionQueued, "", last)
	younger := job(TranscriptionFailed, "", last.Add(48*time.Hour))
	note, err := s.CreateNoteTranscription("usr_a", "doc_a", "blk_a", "med_a", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE transcriptions SET status = ?, updated_at = ? WHERE id = ?`, TranscriptionFailed, stamp(last), note.ID); err != nil {
		t.Fatal(err)
	}
	// Audio left behind by a job removed some other way
	if _, err := s.db.Exec(`INSERT INTO transcription_audio (job_id, idx, mime, data) VALUES ('trj_gone', 0, 'audio/webm', x'00')`); err != nil {
		t.Fatal(err)
	}
	exists := func(id string) bool {
		_, err := s.GetTranscription(id)
		return err == nil
	}
	audioRows := func(id string) int {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM transcription_audio WHERE job_id = ?`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	zone := time.FixedZone("PST", -8*3600) // the time handed in is not UTC

	jobs, err := s.PurgeFailedTranscriptions(last.Add(FailedTranscriptionKeep-time.Minute).In(zone), false)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("purged before 30 days: %v %v", jobs, err)
	}
	if audioRows("trj_gone") != 0 {
		t.Fatal("audio without a job left")
	}

	jobs, err = s.PurgeFailedTranscriptions(last.Add(FailedTranscriptionKeep+time.Minute).In(zone), false)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, j := range jobs {
		got[j.ID] = j.Kind
	}
	if len(got) != 2 || got[failed] != TranscriptionInbox || got[note.ID] != TranscriptionNote {
		t.Fatalf("purged after 30 days: %v", got)
	}
	if exists(failed) || audioRows(failed) != 0 {
		t.Fatal("failed inbox recording or its audio still there")
	}
	for _, id := range []string{later, queued, younger} {
		if !exists(id) || audioRows(id) != 2 {
			t.Fatalf("job %s or its audio removed", id)
		}
	}

	// The later attempt failed for good: from then on its 30 days count
	if _, err := s.db.Exec(`UPDATE transcriptions SET next_at = '', updated_at = ? WHERE id = ?`, stamp(last.Add(24*time.Hour)), later); err != nil {
		t.Fatal(err)
	}
	if jobs, err := s.PurgeFailedTranscriptions(last.Add(24*time.Hour+FailedTranscriptionKeep-time.Minute), false); err != nil || len(jobs) != 0 {
		t.Fatalf("purged before 30 days after the later attempt: %v %v", jobs, err)
	}
	if jobs, err := s.PurgeFailedTranscriptions(last.Add(24*time.Hour+FailedTranscriptionKeep+time.Minute), false); err != nil || len(jobs) != 1 || jobs[0].ID != later {
		t.Fatalf("after the later attempt: %v %v", jobs, err)
	}
	if exists(later) || audioRows(later) != 0 || !exists(younger) || !exists(queued) {
		t.Fatal("wrong jobs removed after the later attempt")
	}
}

// While no worker takes jobs (speech recognition not in server mode), waiting jobs and failed ones with a
// later attempt planned go FailedTranscriptionKeep after they were queued or last tried; a running job and
// younger ones stay. In server mode the worker gets to them, so they stay there.
func TestPurgeStalledTranscriptions(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "transcriptions.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })

	last := time.Date(2026, 10, 25, 1, 30, 0, 0, time.UTC) // the night the clocks go back in Europe
	stamp := func(at time.Time) string { return at.UTC().Format(time.RFC3339) }
	job := func(status, nextAt string, at time.Time) string {
		t.Helper()
		j, err := s.CreateInboxTranscription("usr_a", []AudioPiece{{Mime: "audio/webm", Data: []byte("x")}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec(`UPDATE transcriptions SET status = ?, next_at = ?, updated_at = ? WHERE id = ?`, status, nextAt, stamp(at), j.ID); err != nil {
			t.Fatal(err)
		}
		return j.ID
	}
	queued := job(TranscriptionQueued, "", last)
	retrying := job(TranscriptionQueued, stamp(last.Add(2*time.Minute)), last) // waits for its retry
	later := job(TranscriptionFailed, stamp(last.Add(24*time.Hour)), last)     // a later attempt is planned
	running := job(TranscriptionRunning, "", last)
	younger := job(TranscriptionQueued, "", last.Add(time.Hour))
	exists := func(id string) bool {
		_, err := s.GetTranscription(id)
		return err == nil
	}
	after := last.Add(FailedTranscriptionKeep + time.Minute).In(time.FixedZone("JST", 9*3600))

	// Server mode: the worker takes them, nothing goes
	if jobs, err := s.PurgeFailedTranscriptions(after, false); err != nil || len(jobs) != 0 {
		t.Fatalf("purged in server mode: %v %v", jobs, err)
	}
	if jobs, err := s.PurgeFailedTranscriptions(last.Add(FailedTranscriptionKeep-time.Minute), true); err != nil || len(jobs) != 0 {
		t.Fatalf("purged before 30 days: %v %v", jobs, err)
	}

	jobs, err := s.PurgeFailedTranscriptions(after, true)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, j := range jobs {
		got[j.ID] = true
	}
	if len(got) != 3 || !got[queued] || !got[retrying] || !got[later] {
		t.Fatalf("purged while idle: %v", got)
	}
	for _, id := range []string{queued, retrying, later} {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM transcription_audio WHERE job_id = ?`, id).Scan(&n); err != nil || n != 0 || exists(id) {
			t.Fatalf("job %s or its audio still there", id)
		}
	}
	if !exists(running) || !exists(younger) {
		t.Fatal("running or younger job removed")
	}

	// A job claimed between reading and removing stays
	stale := job(TranscriptionQueued, "", last)
	cutoff := stamp(after.Add(-FailedTranscriptionKeep))
	if _, err := s.db.Exec(`UPDATE transcriptions SET status = ? WHERE id = ?`, TranscriptionRunning, stale); err != nil {
		t.Fatal(err)
	}
	if gone, err := s.purgeTranscription(stale, cutoff, true); err != nil || gone || !exists(stale) {
		t.Fatalf("claimed job removed: %v %v", gone, err)
	}
}
