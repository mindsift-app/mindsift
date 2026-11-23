package shell

import (
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var guardIDPattern = regexp.MustCompile(`mindsift:shell-action:([0-9a-f]+):`)

// testGuard: a guard whose page is the test; asked receives every script it would run in the page
func testGuard(wait, insist time.Duration) (*Guard, chan string) {
	asked := make(chan string, 8)
	return &Guard{Ask: func(s string) { asked <- s }, Wait: wait, Insist: insist}, asked
}

func askedID(t *testing.T, asked chan string, action string) string {
	t.Helper()
	select {
	case s := <-asked:
		if !strings.Contains(s, `"mindsift:desktop-shell-action"`) || !strings.Contains(s, `action:"`+action+`"`) {
			t.Fatalf("script does not ask for %q: %s", action, s)
		}
		m := guardIDPattern.FindStringSubmatch(s)
		if m == nil {
			t.Fatalf("no id in the script: %s", s)
		}
		return m[1]
	case <-time.After(time.Second):
		t.Fatal("the page was not asked")
	}
	return ""
}

func ranWithin(ran chan struct{}, d time.Duration) bool {
	select {
	case <-ran:
		return true
	case <-time.After(d):
		return false
	}
}

func TestGuardRunsWhenThePageSaysGo(t *testing.T) {
	g, asked := testGuard(time.Hour, time.Hour)
	ran := make(chan struct{}, 1)
	g.Request("reload", func() { ran <- struct{}{} })
	id := askedID(t, asked, "reload")
	if !g.Message("mindsift:shell-action:" + id + ":go") {
		t.Fatal("the answer was not taken")
	}
	if !ranWithin(ran, time.Second) {
		t.Fatal("the action did not run")
	}
}

func TestGuardDropsTheActionWhenThePersonStays(t *testing.T) {
	g, asked := testGuard(50*time.Millisecond, time.Hour)
	var asking atomic.Int32
	g.Asking = func() { asking.Add(1) }
	ran := make(chan struct{}, 1)
	g.Request("switch", func() { ran <- struct{}{} })
	id := askedID(t, asked, "switch")
	g.Message("mindsift:shell-action:" + id + ":wait")
	// Waiting for the person: Wait no longer counts
	if ranWithin(ran, 150*time.Millisecond) {
		t.Fatal("the action ran while the person was asked")
	}
	if asking.Load() != 1 {
		t.Fatalf("Asking ran %d times, want 1", asking.Load())
	}
	g.Message("mindsift:shell-action:" + id + ":stay")
	if ranWithin(ran, 100*time.Millisecond) {
		t.Fatal("the action ran although the person stayed")
	}
	// The next action asks again
	g.Request("switch", func() { ran <- struct{}{} })
	askedID(t, asked, "switch")
}

func TestGuardRunsWhenThePageDoesNotAnswer(t *testing.T) {
	g, asked := testGuard(30*time.Millisecond, time.Hour)
	ran := make(chan struct{}, 1)
	g.Request("close", func() { ran <- struct{}{} })
	askedID(t, asked, "close")
	if !ranWithin(ran, time.Second) {
		t.Fatal("the action did not run after the page kept silent")
	}
	// A late answer does nothing
	g.Message("mindsift:shell-action:whatever:go")
	if ranWithin(ran, 50*time.Millisecond) {
		t.Fatal("the action ran twice")
	}
}

func TestGuardIgnoresForeignAnswers(t *testing.T) {
	g, asked := testGuard(time.Hour, time.Hour)
	ran := make(chan struct{}, 1)
	g.Request("quit", func() { ran <- struct{}{} })
	askedID(t, asked, "quit")
	if !g.Message("mindsift:shell-action:0123:go") || !g.Message("mindsift:shell-action:broken") {
		t.Fatal("messages with the prefix belong to the guard")
	}
	if g.Message("mindsift:page") {
		t.Fatal("other messages are not the guard's")
	}
	if ranWithin(ran, 50*time.Millisecond) {
		t.Fatal("an answer with another id ran the action")
	}
}

func TestGuardRepeatWhileAskingInsists(t *testing.T) {
	g, asked := testGuard(time.Hour, 80*time.Millisecond)
	first := make(chan struct{}, 1)
	second := make(chan struct{}, 1)
	g.Request("reload", func() { first <- struct{}{} })
	id := askedID(t, asked, "reload")
	g.Message("mindsift:shell-action:" + id + ":wait")
	// At once again (a double press): dropped, nothing asked again
	g.Request("reload", func() { second <- struct{}{} })
	if ranWithin(second, 30*time.Millisecond) {
		t.Fatal("a repeat right away ran the action")
	}
	select {
	case s := <-asked:
		t.Fatalf("a repeat right away asked again: %s", s)
	default:
	}
	// Later, while the question is still open: runs at once, the open question is dropped
	time.Sleep(100 * time.Millisecond)
	g.Request("close", func() { second <- struct{}{} })
	if !ranWithin(second, time.Second) {
		t.Fatal("insisting did not run the action")
	}
	g.Message("mindsift:shell-action:" + id + ":go")
	if ranWithin(first, 50*time.Millisecond) {
		t.Fatal("the dropped question still ran its action")
	}
}

func TestGuardPageChangedDropsOnlyAnOpenQuestion(t *testing.T) {
	g, asked := testGuard(40*time.Millisecond, time.Hour)
	ran := make(chan struct{}, 1)
	// Not answered yet: stays and runs after Wait
	g.Request("switch", func() { ran <- struct{}{} })
	askedID(t, asked, "switch")
	g.PageChanged()
	if !ranWithin(ran, time.Second) {
		t.Fatal("an unanswered action was lost with the page")
	}
	// Asked the person, then the page went: the question went with it, the next action asks again
	g.Request("switch", func() { ran <- struct{}{} })
	id := askedID(t, asked, "switch")
	g.Message("mindsift:shell-action:" + id + ":wait")
	g.PageChanged()
	g.Message("mindsift:shell-action:" + id + ":go")
	if ranWithin(ran, 50*time.Millisecond) {
		t.Fatal("the gone page's question ran its action")
	}
	g.Request("switch", func() { ran <- struct{}{} })
	askedID(t, asked, "switch")
}

func TestGuardScriptQuotesItsValues(t *testing.T) {
	s := guardScript("ab12", `x"</script>`)
	if !strings.Contains(s, `action:"x\"`) || strings.Contains(s, "</script>") {
		t.Fatalf("action not quoted: %s", s)
	}
	if !strings.Contains(s, `var p="mindsift:shell-action:ab12:"`) {
		t.Fatalf("prefix missing: %s", s)
	}
}
