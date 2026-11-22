package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// takeSlot acquires a place in the background and reports it on the returned channel.
func takeSlot(l *sttSlots, ctx context.Context, background bool) chan *sttSlot {
	got := make(chan *sttSlot, 1)
	go func() {
		s, err := l.acquire(ctx, background)
		if err == nil {
			got <- s
		}
	}()
	return got
}

func waiting(l *sttSlots) (interactive, background int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.interactive), len(l.background)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting: %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func gotSlot(t *testing.T, what string, ch chan *sttSlot) *sttSlot {
	t.Helper()
	select {
	case s := <-ch:
		return s
	case <-time.After(5 * time.Second):
		t.Fatalf("no place: %s", what)
		return nil
	}
}

func noSlot(t *testing.T, what string, ch chan *sttSlot) {
	t.Helper()
	select {
	case <-ch:
		t.Fatalf("got a place too early: %s", what)
	case <-time.After(30 * time.Millisecond):
	}
}

// With one place, a freed place goes to the waiting direct request, not to the job that waited longer.
func TestSTTSlotsDirectFirst(t *testing.T) {
	l := newSTTSlots(1)
	ctx := context.Background()
	running, _ := l.acquire(ctx, true)
	job := takeSlot(l, ctx, true)
	waitFor(t, "job waits", func() bool { _, b := waiting(l); return b == 1 })
	direct := takeSlot(l, ctx, false)
	waitFor(t, "direct waits", func() bool { i, _ := waiting(l); return i == 1 })

	running.release()
	d := gotSlot(t, "direct request", direct)
	noSlot(t, "job while the direct request runs", job)
	d.release()
	gotSlot(t, "job after the direct request", job).release()
}

// With more places, jobs leave one free for direct requests.
func TestSTTSlotsJobsLeaveOneFree(t *testing.T) {
	l := newSTTSlots(3)
	ctx := context.Background()
	a, _ := l.acquire(ctx, true)
	b, _ := l.acquire(ctx, true)
	third := takeSlot(l, ctx, true)
	noSlot(t, "third job with 3 places", third)
	d := gotSlot(t, "direct request", takeSlot(l, ctx, false))
	a.release()
	j := gotSlot(t, "third job once a job is done", third)
	b.release()
	j.release()
	d.release()
	if l.inUse != 0 || l.bgInUse != 0 {
		t.Fatalf("places left taken: %d / %d", l.inUse, l.bgInUse)
	}
}

// Direct requests that keep coming do not hold a job back for ever: after sttBackgroundTurn of them it
// gets its turn.
func TestSTTSlotsJobNotStarved(t *testing.T) {
	l := newSTTSlots(1)
	ctx := context.Background()
	cur, _ := l.acquire(ctx, false)
	job := takeSlot(l, ctx, true)
	waitFor(t, "job waits", func() bool { _, b := waiting(l); return b == 1 })
	for i := range sttBackgroundTurn {
		next := takeSlot(l, ctx, false)
		waitFor(t, "direct waits", func() bool { n, _ := waiting(l); return n == 1 })
		cur.release()
		cur = gotSlot(t, "direct request "+string(rune('1'+i)), next)
	}
	next := takeSlot(l, ctx, false)
	waitFor(t, "direct waits", func() bool { n, _ := waiting(l); return n == 1 })
	cur.release()
	j := gotSlot(t, "job after its turn came", job)
	noSlot(t, "direct request while the job runs", next)
	j.release()
	gotSlot(t, "direct request after the job", next).release()
}

// A direct request that gives up stops holding the job back; a job's yield lets a direct request in
// between its parts.
func TestSTTSlotsGiveUpAndYield(t *testing.T) {
	l := newSTTSlots(1)
	other, _ := l.acquire(context.Background(), false)
	job := takeSlot(l, context.Background(), true)
	ctx, cancel := context.WithCancel(context.Background())
	direct := takeSlot(l, ctx, false)
	waitFor(t, "both wait", func() bool { i, b := waiting(l); return i == 1 && b == 1 })
	cancel()
	waitFor(t, "direct gave up", func() bool { i, _ := waiting(l); return i == 0 })
	noSlot(t, "cancelled direct request", direct)
	other.release()
	j := gotSlot(t, "job", job)

	if err := j.yield(context.Background()); err != nil || !j.held {
		t.Fatalf("yield without a direct request: %v, held %v", err, j.held)
	}
	direct = takeSlot(l, context.Background(), false)
	waitFor(t, "direct waits", func() bool { i, _ := waiting(l); return i == 1 })
	yielded := make(chan error, 1)
	go func() { yielded <- j.yield(context.Background()) }()
	d := gotSlot(t, "direct request between the parts", direct)
	select {
	case <-yielded:
		t.Fatal("the job went on while the direct request runs")
	case <-time.After(30 * time.Millisecond):
	}
	d.release()
	if err := <-yielded; err != nil || !j.held {
		t.Fatalf("yield: %v, held %v", err, j.held)
	}
	j.release()
	j.release() // a second release does nothing
	if l.inUse != 0 {
		t.Fatalf("places taken: %d", l.inUse)
	}
}

// Many requests of both kinds never run more at the same time than there are places, also when the
// number shrinks meanwhile, and all of them get through.
func TestSTTSlotsLimit(t *testing.T) {
	l := newSTTSlots(3)
	var cur, done atomic.Int32
	var wg sync.WaitGroup
	for i := range 60 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, err := l.acquire(context.Background(), i%3 == 0)
			if err != nil {
				t.Error(err)
				return
			}
			n := cur.Add(1)
			if n > 3 {
				t.Errorf("%d requests at the same time", n)
			}
			time.Sleep(time.Millisecond)
			cur.Add(-1)
			done.Add(1)
			s.release()
		}()
		if i == 30 {
			l.setCapacity(2)
		}
	}
	wg.Wait()
	if done.Load() != 60 || l.inUse != 0 || l.bgInUse != 0 {
		t.Fatalf("done %d, places taken %d / %d", done.Load(), l.inUse, l.bgInUse)
	}
}

// gateWhisper holds every call until the test lets one through (gate) and records the order of the
// audio sent and the most calls at the same time.
type gateWhisper struct {
	gate    chan struct{}
	mu      sync.Mutex
	started []string
	cur     int
	peak    int
}

func newGateWhisper(t *testing.T) (*gateWhisper, *httptest.Server) {
	t.Helper()
	gw := &gateWhisper{gate: make(chan struct{})}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(10 << 20)
		f, _, _ := r.FormFile("file")
		raw, _ := io.ReadAll(f)
		audio := string(raw)
		if strings.Contains(audio, "aufnahme-im-block") {
			audio = "notiz"
		}
		gw.mu.Lock()
		gw.started = append(gw.started, audio)
		gw.cur++
		gw.peak = max(gw.peak, gw.cur)
		gw.mu.Unlock()
		select {
		case <-gw.gate:
		case <-r.Context().Done():
		}
		gw.mu.Lock()
		gw.cur--
		gw.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"text": "Text von " + audio})
	}))
	t.Cleanup(func() {
		close(gw.gate)
		ts.Close()
	})
	return gw, ts
}

func (gw *gateWhisper) order() []string {
	gw.mu.Lock()
	defer gw.mu.Unlock()
	return append([]string(nil), gw.started...)
}

func gateServer(t *testing.T, parallel int) (*Server, *storage.Store, string, string, *gateWhisper) {
	t.Helper()
	srv, store, token, userID, _ := jobServer(t)
	gw, ts := newGateWhisper(t)
	srv.cfg.Speech = config.SpeechConfig{URL: ts.URL, Model: "m", MaxParallel: parallel, PerUserPerHour: 100, TimeoutSeconds: 10}
	srv.voice = newVoiceService(parallel)
	return srv, store, token, userID, gw
}

// One place: live dictation that comes while a slow note recording is transcribed in the background is
// served right after it, before the inbox recording queued earlier, whose parts let a second dictation in
// between; all jobs finish, and the Whisper server never gets two calls at once.
func TestDirectTranscriptionGoesBeforeJobs(t *testing.T) {
	srv, store, token, userID, gw := gateServer(t, 1)
	router := srv.Router()
	docID, _ := noteWithRecording(t, srv, store, token, userID, "")

	if rec := sessionCall(router, "POST", "/api/v1/documents/"+docID+"/blocks/blk_audio/transcribe", token, "", ""); rec.Code != http.StatusAccepted {
		t.Fatalf("transcribe: %d %s", rec.Code, rec.Body.String())
	}
	waitFor(t, "note job at Whisper", func() bool { return len(gw.order()) == 1 })
	if rec := captureUpload(t, router, token, []string{"teil-eins", "teil-zwei"}, ""); rec.Code != http.StatusAccepted {
		t.Fatalf("capture: %d %s", rec.Code, rec.Body.String())
	}
	waitFor(t, "inbox job waits", func() bool { _, b := waiting(srv.voice.slots); return b == 1 })

	direct := func(audio string) chan *httptest.ResponseRecorder {
		ch := make(chan *httptest.ResponseRecorder, 1)
		go func() { ch <- voiceUpload(t, router, token, []byte(audio)) }()
		return ch
	}
	first := direct("diktat-eins")
	waitFor(t, "dictation waits", func() bool { i, _ := waiting(srv.voice.slots); return i == 1 })

	gw.gate <- struct{}{} // the note recording is done
	waitFor(t, "dictation at Whisper", func() bool { return len(gw.order()) == 2 })
	gw.gate <- struct{}{}
	if rec := <-first; rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Text von diktat-eins") {
		t.Fatalf("dictation: %d %s", rec.Code, rec.Body.String())
	}

	waitFor(t, "first part at Whisper", func() bool { return len(gw.order()) == 3 })
	second := direct("diktat-zwei")
	waitFor(t, "second dictation waits", func() bool { i, _ := waiting(srv.voice.slots); return i == 1 })
	gw.gate <- struct{}{} // first part done: the job lets the dictation in
	waitFor(t, "second dictation at Whisper", func() bool { return len(gw.order()) == 4 })
	gw.gate <- struct{}{}
	if rec := <-second; rec.Code != http.StatusOK {
		t.Fatalf("second dictation: %d %s", rec.Code, rec.Body.String())
	}
	waitFor(t, "second part at Whisper", func() bool { return len(gw.order()) == 5 })
	gw.gate <- struct{}{}

	eventually(t, "jobs done", func() bool {
		jobs, _ := store.UserTranscriptions(userID)
		return len(jobs) == 0
	})
	if !strings.Contains(blockContent(t, store, docID, "blk_audio"), "Text von notiz") {
		t.Fatalf("caption: %s", blockContent(t, store, docID, "blk_audio"))
	}
	want := []string{"notiz", "diktat-eins", "teil-eins", "diktat-zwei", "teil-zwei"}
	if got := gw.order(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("order at Whisper %v, want %v", got, want)
	}
	if gw.peak != 1 {
		t.Fatalf("%d calls at the same time with one place", gw.peak)
	}
}

// Two places: a running job leaves the second to direct requests, so a dictation does not wait at all and
// a second job waits for the first.
func TestJobsLeaveAPlaceForDictation(t *testing.T) {
	srv, store, token, userID, gw := gateServer(t, 2)
	router := srv.Router()
	docID, _ := noteWithRecording(t, srv, store, token, userID, "")

	if rec := sessionCall(router, "POST", "/api/v1/documents/"+docID+"/blocks/blk_audio/transcribe", token, "", ""); rec.Code != http.StatusAccepted {
		t.Fatalf("transcribe: %d %s", rec.Code, rec.Body.String())
	}
	waitFor(t, "note job at Whisper", func() bool { return len(gw.order()) == 1 })
	if rec := captureUpload(t, router, token, []string{"teil-eins"}, ""); rec.Code != http.StatusAccepted {
		t.Fatalf("capture: %d %s", rec.Code, rec.Body.String())
	}
	waitFor(t, "inbox job waits", func() bool { _, b := waiting(srv.voice.slots); return b == 1 })

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- voiceUpload(t, router, token, []byte("diktat")) }()
	waitFor(t, "dictation at Whisper beside the job", func() bool { return len(gw.order()) == 2 })
	if _, b := waiting(srv.voice.slots); b != 1 {
		t.Fatal("the second job did not wait for the first")
	}
	// From here on every call may finish (which one first does not matter)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case gw.gate <- struct{}{}:
			case <-stop:
				return
			}
		}
	}()
	if rec := <-done; rec.Code != http.StatusOK {
		t.Fatalf("dictation: %d %s", rec.Code, rec.Body.String())
	}
	eventually(t, "jobs done", func() bool {
		jobs, _ := store.UserTranscriptions(userID)
		return len(jobs) == 0
	})
	if got := gw.order(); len(got) != 3 || got[0] != "notiz" || got[1] != "diktat" || got[2] != "teil-eins" {
		t.Fatalf("order at Whisper %v", got)
	}
	if gw.peak != 2 {
		t.Fatalf("%d calls at the same time with two places", gw.peak)
	}
}
