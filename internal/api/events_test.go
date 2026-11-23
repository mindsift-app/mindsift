package api

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// realtimeEventsFile lists the event names for the app's side (a test there checks that the app handles
// and sends no others); the Dockerfile copies it into the Go build for this test.
const realtimeEventsFile = "../../frontend/src/lib/realtimeEvents.json"

// eventConsts reads the string constants of a Go file whose names start with one of the prefixes.
func eventConsts(t *testing.T, file string, prefixes ...string) map[string][]string {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]string{}
	for _, decl := range f.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			vs := spec.(*ast.ValueSpec)
			for i, name := range vs.Names {
				lit, ok := vs.Values[i].(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					continue
				}
				val, _ := strconv.Unquote(lit.Value)
				for _, p := range prefixes {
					if strings.HasPrefix(name.Name, p) {
						out[strings.ToLower(p)] = append(out[strings.ToLower(p)], val)
					}
				}
			}
		}
	}
	return out
}

// The events the server sends and the messages it takes are the ones the app's list names, both ways:
// a new event needs its constant (events.go, ws/events.go) and its line in realtimeEvents.json.
func TestRealtimeEventsMatchApp(t *testing.T) {
	raw, err := os.ReadFile(realtimeEventsFile)
	if err != nil {
		t.Fatal(err)
	}
	var app struct {
		Server []string `json:"server"`
		Client []string `json:"client"`
	}
	if err := json.Unmarshal(raw, &app); err != nil {
		t.Fatal(err)
	}
	api := eventConsts(t, "events.go", "event", "msg")
	hub := eventConsts(t, "../ws/events.go", "Event", "Msg")
	sorted := func(lists ...[]string) []string {
		var all []string
		for _, l := range lists {
			all = append(all, l...)
		}
		slices.Sort(all)
		return slices.Compact(all)
	}
	if got, want := sorted(api["event"], hub["event"]), sorted(app.Server); !slices.Equal(got, want) {
		t.Errorf("events the server sends:\n  Go:  %v\n  app: %v", got, want)
	}
	if got, want := sorted(api["msg"], hub["msg"]), sorted(app.Client); !slices.Equal(got, want) {
		t.Errorf("messages the server takes:\n  Go:  %v\n  app: %v", got, want)
	}
}

// eventLiteralRE: a string that names a realtime event (prefixes such as "TASK_" end in _ and are left out)
var eventLiteralRE = regexp.MustCompile(`"((?:TASK|DOC|LIST|ITEM|WORKSPACE|NOTIFICATION|TRANSCRIPTION|DRAW|USER_PRESENCE|SSE|DEMO|JOIN|LEAVE)[A-Z_]*[A-Z]|PING|PONG)"`)

// Handlers name events by their constant, so a renamed or new event cannot miss the list above.
func TestRealtimeEventsOnlyAsConstants(t *testing.T) {
	for _, dir := range []string{".", "../ws"} {
		files, err := filepath.Glob(filepath.Join(dir, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			if strings.HasSuffix(file, "_test.go") || filepath.Base(file) == "events.go" {
				continue
			}
			src, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			for i, line := range strings.Split(string(src), "\n") {
				if code, _, _ := strings.Cut(line, "//"); eventLiteralRE.MatchString(code) {
					t.Errorf("%s:%d names an event by a string, use its constant (events.go): %s", file, i+1, strings.TrimSpace(line))
				}
			}
		}
	}
}
