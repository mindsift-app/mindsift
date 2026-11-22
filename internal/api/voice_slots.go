package api

import (
	"context"
	"slices"
	"sync"
)

// The places of the Whisper server (STT_MAX_PARALLEL): never more requests at the same time than that, it
// may be a small box. Two kinds of requests share them:
//
//   - direct ones (POST /voice/transcribe: live dictation, the pieces sent while speaking), where someone
//     waits for the text, and
//   - background jobs (transcription_jobs.go), where nobody waits.
//
// A direct request goes first: when a place frees up, it goes to the longest waiting direct request, and a
// job only gets one while no direct request waits. With more than one place, jobs use at most all but one,
// so a direct request always finds one free once the requests before it are done. So that jobs still get
// on while direct requests keep coming, a waiting job gets the next place after sttBackgroundTurn direct
// requests went before it. A running request is never stopped for another: a Whisper call broken off is
// work lost, and the job would start again from the beginning. A job of several parts (an inbox recording)
// gives its place back between the parts while a direct request waits (sttSlot.yield), so a direct request
// waits for at most one part, or one recording of a note, with a single place.

// sttBackgroundTurn: direct requests served before a waiting job while it could have run
const sttBackgroundTurn = 3

type sttSlots struct {
	mu          sync.Mutex
	capacity    int
	inUse       int // places taken, of either kind
	bgInUse     int // of them by jobs
	interactive []*sttWaiter
	background  []*sttWaiter
	passed      int // direct requests served while a job waited and could have run
}

type sttWaiter struct {
	ready chan struct{} // closed when the place is the waiter's
}

func newSTTSlots(capacity int) *sttSlots {
	return &sttSlots{capacity: max(capacity, 1)}
}

// setCapacity changes the number of places (the administration changed it); with fewer, requests under way
// finish, and new ones start only once below the new number.
func (l *sttSlots) setCapacity(n int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.capacity = max(n, 1)
	l.dispatch()
}

// bgLimit: the places jobs may take at the same time
func (l *sttSlots) bgLimit() int {
	return max(l.capacity-1, 1)
}

// dispatch hands free places to waiters (with l.mu held).
func (l *sttSlots) dispatch() {
	for l.inUse < l.capacity {
		bgCanRun := len(l.background) > 0 && l.bgInUse < l.bgLimit()
		var w *sttWaiter
		switch {
		case bgCanRun && (len(l.interactive) == 0 || l.passed >= sttBackgroundTurn):
			w, l.background = l.background[0], l.background[1:]
			l.bgInUse++
			l.passed = 0
		case len(l.interactive) > 0:
			w, l.interactive = l.interactive[0], l.interactive[1:]
			if bgCanRun {
				l.passed++
			}
		default:
			return
		}
		l.inUse++
		close(w.ready)
	}
}

// acquire waits for a place; background says which kind of request it is. Without one before ctx ends it
// returns ctx's error.
func (l *sttSlots) acquire(ctx context.Context, background bool) (*sttSlot, error) {
	w := &sttWaiter{ready: make(chan struct{})}
	l.mu.Lock()
	if background {
		l.background = append(l.background, w)
	} else {
		l.interactive = append(l.interactive, w)
	}
	l.dispatch()
	l.mu.Unlock()
	select {
	case <-w.ready:
		return &sttSlot{slots: l, background: background, held: true}, nil
	case <-ctx.Done():
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	select {
	case <-w.ready: // got the place just now: give it back
		l.releaseLocked(background)
	default:
		if background {
			l.background = slices.DeleteFunc(l.background, func(x *sttWaiter) bool { return x == w })
		} else {
			l.interactive = slices.DeleteFunc(l.interactive, func(x *sttWaiter) bool { return x == w })
		}
		l.dispatch() // a direct request that stops waiting may have held a job back
	}
	return nil, ctx.Err()
}

func (l *sttSlots) releaseLocked(background bool) {
	l.inUse--
	if background {
		l.bgInUse--
	}
	l.dispatch()
}

// sttSlot is a place taken; release gives it back (once, later calls do nothing).
type sttSlot struct {
	slots      *sttSlots
	background bool
	held       bool
}

func (s *sttSlot) release() {
	if !s.held {
		return
	}
	s.held = false
	s.slots.mu.Lock()
	defer s.slots.mu.Unlock()
	s.slots.releaseLocked(s.background)
}

// yield gives a job's place to a waiting direct request and waits for a place again (between the parts of
// a job); without a waiting direct request it keeps the place. On an error the place is no longer held.
func (s *sttSlot) yield(ctx context.Context) error {
	l := s.slots
	l.mu.Lock()
	if len(l.interactive) == 0 {
		l.mu.Unlock()
		return nil
	}
	s.held = false
	l.releaseLocked(s.background)
	l.mu.Unlock()
	// The new place is of the same kind; s stands for it from now on
	if _, err := l.acquire(ctx, s.background); err != nil {
		return err
	}
	s.held = true
	return nil
}
