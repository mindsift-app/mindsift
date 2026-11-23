package storage

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// taskQueryFixture is a database of realistic size for the task queries: two people (a and b) with ten
// task lists each, some shared with the other directly or through a group, and further people whose
// tasks neither may see.
type taskQueryFixture struct {
	s          *Store
	a, b       string   // user ids
	lists      []string // every task list of a and b
	foreignTL  string   // a list of a third person, shared with nobody
	otherUsers []string
}

// newTaskQueryFixture fills a fresh store with perPerson thoughts for a and b each and perOther for every
// one of others further people; with stats it takes statistics as the server does (Optimize).
func newTaskQueryFixture(tb testing.TB, perPerson, others, perOther int, stats bool) *taskQueryFixture {
	tb.Helper()
	s, err := NewStore(filepath.Join(tb.TempDir(), "tasks.db"))
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() { _ = s.Close() })
	f := &taskQueryFixture{s: s}
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.db.Begin()
	if err != nil {
		tb.Fatal(err)
	}
	exec := func(q string, args ...any) {
		tb.Helper()
		if _, err := tx.Exec(q, args...); err != nil {
			tb.Fatalf("%v\n%s", err, q)
		}
	}
	addUser := func(name string) string {
		id := "usr_" + name
		exec(`INSERT INTO users (id, email, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, 'x', ?, 'member', ?)`,
			id, name+"@example.com", name, name, now)
		return id
	}
	f.a, f.b = addUser("a"), addUser("b")
	for i := 0; i < others; i++ {
		f.otherUsers = append(f.otherUsers, addUser(fmt.Sprintf("o%d", i)))
	}
	exec(`INSERT INTO teams (id, name, created_at) VALUES ('team_ab', 'Team', ?)`, now)
	exec(`INSERT INTO team_members (team_id, user_id, joined_at) VALUES ('team_ab', ?, ?), ('team_ab', ?, ?)`, f.a, now, f.b, now)
	addList := func(id, owner string) {
		exec(`INSERT INTO task_lists (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, id, owner, id, now, now)
	}
	share := func(list, typ, target string) {
		exec(`INSERT INTO task_list_shares (id, task_list_id, target_type, target_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'x')`,
			"tls_"+list+"_"+target, list, typ, target, now)
	}
	for i := 0; i < 10; i++ {
		la, lb := fmt.Sprintf("tkl_a%d", i), fmt.Sprintf("tkl_b%d", i)
		addList(la, f.a)
		addList(lb, f.b)
		f.lists = append(f.lists, la, lb)
		switch {
		case i < 3:
			share(la, "user", f.b) // a's first three lists: shared with b directly
		case i < 5:
			share(lb, "team", "team_ab") // b's lists 3 and 4: shared with the group of a and b
		case i == 5:
			share(lb, "user", f.a)
		}
	}
	f.foreignTL = "tkl_foreign"
	if others > 0 {
		addList(f.foreignTL, f.otherUsers[0])
		for i, o := range f.otherUsers {
			addList(fmt.Sprintf("tkl_o%d", i), o)
		}
	}
	rnd := rand.New(rand.NewSource(1))
	statuses := []string{"kept", "kept", "kept", "converted", "inbox", "discarded"}
	n := 0
	addThought := func(owner string, lists []string) {
		n++
		status := statuses[rnd.Intn(len(statuses))]
		conv := ""
		if status == "converted" {
			conv = []string{"task", "task", "document"}[rnd.Intn(3)]
		}
		list := ""
		if status != "inbox" && rnd.Intn(3) > 0 && len(lists) > 0 {
			list = lists[rnd.Intn(len(lists))]
		}
		due := ""
		if rnd.Intn(2) == 0 {
			due = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, rnd.Intn(60)).Format("2006-01-02")
		}
		// Few distinct created_at and sort_order values, so the order relies on every key
		created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(rnd.Intn(5000)) * time.Minute).Format(time.RFC3339)
		exec(`INSERT INTO thoughts (id, user_id, content, status, is_completed, converted_type, due_date, task_list_id, created_at, sort_order)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			fmt.Sprintf("th_%07d", n), owner, fmt.Sprintf("Aufgabe %d", n), status, rnd.Intn(3)/2, conv, due, list, created, rnd.Intn(50))
	}
	var aLists, bLists []string
	for _, l := range f.lists {
		if l[4] == 'a' {
			aLists = append(aLists, l)
		} else {
			bLists = append(bLists, l)
		}
	}
	for i := 0; i < perPerson; i++ {
		// Mostly in own lists, some in the other's lists (b's tasks in a's shared lists and the reverse)
		if rnd.Intn(10) == 0 {
			addThought(f.a, bLists[3:6])
			addThought(f.b, aLists[:3])
		} else {
			addThought(f.a, aLists)
			addThought(f.b, bLists)
		}
	}
	for i, o := range f.otherUsers {
		for j := 0; j < perOther; j++ {
			addThought(o, []string{fmt.Sprintf("tkl_o%d", i), f.foreignTL})
		}
	}
	if err := tx.Commit(); err != nil {
		tb.Fatal(err)
	}
	if stats {
		if err := s.Optimize(); err != nil {
			tb.Fatal(err)
		}
	}
	return f
}

// The task queries as they were before visibleTaskRowidsSQL ("user_id = ? OR task_list_id IN (…)"), to
// compare results and plans. Each takes the user ID four times first. rowid as the last key (now also in
// GetTasks and CalendarTasks) fixes the order of equal tasks to the one a scan of the table gave; before,
// it depended on the plan.
const (
	legacyTaskScope = `(user_id = ? OR task_list_id IN (` + accessibleTaskListsSQL + `))
		   AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`
	legacyGetTasksSQL = `SELECT id FROM thoughts WHERE ` + legacyTaskScope + `
		 ORDER BY is_completed ASC, sort_order ASC, created_at DESC, rowid`
	legacyGetTasksOfListSQL = `SELECT id FROM thoughts WHERE ` + legacyTaskScope + ` AND task_list_id = ?
		 ORDER BY is_completed ASC, sort_order ASC, created_at DESC, rowid`
	legacyTaskCountSQL = `SELECT COUNT(*) FROM thoughts WHERE ` + legacyTaskScope + ` AND is_completed = ?`
	legacyCalendarSQL  = `SELECT t.id FROM thoughts t
		 WHERE (t.user_id = ? OR t.task_list_id IN (` + accessibleTaskListsSQL + `))
		   AND (t.status = 'kept' OR (t.status = 'converted' AND t.converted_type = 'task'))
		   AND t.is_completed = 0 AND t.due_date >= ? AND t.due_date < ?
		 ORDER BY t.due_date, t.created_at, t.rowid LIMIT ?`
	// GetTasks without a list as it is now, ids only
	visibleTasksIDsSQL = `SELECT id FROM thoughts WHERE rowid IN (` + visibleTaskRowidsSQL + `)
		   AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))
		 ORDER BY is_completed ASC, sort_order ASC, created_at DESC, rowid`
)

func queryIDs(tb testing.TB, s *Store, q string, args ...any) []string {
	tb.Helper()
	rows, err := s.db.Query(q, args...)
	if err != nil {
		tb.Fatalf("%v\n%s", err, q)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			tb.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

func taskIDs(tasks []domain.Thought) []string {
	ids := []string{}
	for _, t := range tasks {
		ids = append(ids, t.ID)
	}
	return ids
}

func userArgs(userID string, more ...any) []any {
	return append([]any{userID, userID, userID, userID}, more...)
}

// GetTasks, the task counts and the calendar feed find the same tasks in the same order as the queries
// with "user_id = ? OR task_list_id IN (…)" did: own tasks with and without a list, tasks of others in
// own and shared lists (directly and through a group), nothing of lists the person cannot see, inbox and
// discarded thoughts and notes left out, open and completed tasks.
func TestVisibleTaskQueriesMatchLegacy(t *testing.T) {
	for _, stats := range []bool{false, true} {
		f := newTaskQueryFixture(t, 1500, 4, 300, stats)
		people := append([]string{f.a, f.b, "usr_nobody"}, f.otherUsers...)
		lists := append([]string{"", f.foreignTL, "tkl_o1"}, f.lists...)
		now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
		today := clock.In(now)
		from := today.AddDate(0, 0, -CalendarFeedDaysBack).Format("2006-01-02")
		to := today.AddDate(0, 0, CalendarFeedDaysAhead+1).Format("2006-01-02")
		for _, u := range people {
			for _, l := range lists {
				got, err := f.s.GetTasks(u, l)
				if err != nil {
					t.Fatal(err)
				}
				want := queryIDs(t, f.s, legacyGetTasksSQL, userArgs(u)...)
				if l != "" {
					want = queryIDs(t, f.s, legacyGetTasksOfListSQL, userArgs(u, l)...)
				}
				if !reflect.DeepEqual(taskIDs(got), want) {
					t.Fatalf("stats %v, GetTasks(%s, %q): %d tasks, legacy query %d (or another order)", stats, u, l, len(got), len(want))
				}
			}
			st, err := f.s.GetDashboardStats(u)
			if err != nil {
				t.Fatal(err)
			}
			var open, done int
			if err := f.s.db.QueryRow(legacyTaskCountSQL, userArgs(u, 0)...).Scan(&open); err != nil {
				t.Fatal(err)
			}
			if err := f.s.db.QueryRow(legacyTaskCountSQL, userArgs(u, 1)...).Scan(&done); err != nil {
				t.Fatal(err)
			}
			if st.TasksOpenCount != open || st.TasksDoneCount != done {
				t.Fatalf("stats %v, %s: counts %d/%d, legacy %d/%d", stats, u, st.TasksOpenCount, st.TasksDoneCount, open, done)
			}
			cal, err := f.s.CalendarTasks(u, now)
			if err != nil {
				t.Fatal(err)
			}
			calIDs := []string{}
			for _, c := range cal {
				calIDs = append(calIDs, c.ID)
			}
			want := queryIDs(t, f.s, legacyCalendarSQL, userArgs(u, from, to, CalendarFeedMaxEntries)...)
			if !reflect.DeepEqual(calIDs, want) {
				t.Fatalf("stats %v, CalendarTasks(%s): %d tasks, legacy query %d (or another order)", stats, u, len(calIDs), len(want))
			}
			if u == f.a && (len(want) == 0 || open == 0 || done == 0) {
				t.Fatalf("fixture too thin: calendar %d, open %d, done %d", len(want), open, done)
			}
		}
	}
}

// The task queries search the indexes instead of reading every thought, also with statistics of a server
// where one person has far more tasks than the others: there the old OR condition made the planner read
// the whole table for everyone (sqlite_stat1 only knows the average per person).
func TestVisibleTaskQueriesUseIndexes(t *testing.T) {
	f := newTaskQueryFixture(t, 3000, 20, 50, true)
	light := f.otherUsers[1]
	scan := regexp.MustCompile(`\bSCAN (t|thoughts)\b`)
	if plan := strings.Join(queryPlan(t, f.s, legacyGetTasksSQL, userArgs(light)...), "; "); !scan.MatchString(plan) {
		t.Logf("the legacy query no longer scans with these statistics: %s", plan)
	} else {
		t.Logf("legacy GetTasks: %s", plan)
	}
	day := "2026-11-20"
	queryTasks := func(q TaskQuery) struct {
		sql  string
		args []any
	} {
		sql, args := taskQuerySQL("id", light, q)
		return struct {
			sql  string
			args []any
		}{sql, args}
	}
	for name, q := range map[string]struct {
		sql  string
		args []any
	}{
		"QueryTasks (list_tasks)":         queryTasks(TaskQuery{Status: "open", DueUntil: day, DueFirst: true, Limit: 100}),
		"QueryTasks of a list":            queryTasks(TaskQuery{TaskListID: "tkl_o1", Status: "done", Limit: 100}),
		"QueryTasks (GET /tasks?due=...)": queryTasks(TaskQuery{DueOn: day}),
		"GetTasks":                        {visibleTasksIDsSQL, visibleTaskArgs(light)},
		"GetTasks of a list (unchanged)":  {legacyGetTasksOfListSQL, userArgs(light, "tkl_o1")},
		"GetDashboardStats": {`SELECT COALESCE(SUM(is_completed = 0), 0) FROM thoughts
			WHERE rowid IN (` + visibleTaskRowidsSQL + `) AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`, visibleTaskArgs(light)},
		"CalendarTasks": {`SELECT t.id FROM thoughts t WHERE t.rowid IN (` + visibleTaskRowidsSQL + `)
			AND t.is_completed = 0 AND t.due_date >= ? AND t.due_date < ? ORDER BY t.due_date, t.created_at LIMIT 10`,
			append(visibleTaskArgs(light), day, day)},
	} {
		plan := queryPlan(t, f.s, q.sql, q.args...)
		t.Logf("%s: %s", name, strings.Join(plan, "; "))
		for _, step := range plan {
			if scan.MatchString(step) {
				t.Errorf("%s reads every thought: %s\n%s", name, step, strings.Join(plan, "\n"))
			}
		}
	}
}

// go test -run '^$' -bench VisibleTasks ./internal/storage/: the tasks of a person with many tasks and of
// one with few on the same server, legacy query against the new one (ids only), and GetTasks as a whole.
func BenchmarkVisibleTasks(b *testing.B) {
	f := newTaskQueryFixture(b, 10000, 20, 100, true)
	for _, who := range []struct{ name, id string }{{"heavy", f.a}, {"light", f.otherUsers[1]}} {
		b.Run(who.name+"/legacy", func(b *testing.B) {
			for b.Loop() {
				queryIDs(b, f.s, legacyGetTasksSQL, userArgs(who.id)...)
			}
		})
		b.Run(who.name+"/new", func(b *testing.B) {
			for b.Loop() {
				queryIDs(b, f.s, visibleTasksIDsSQL, visibleTaskArgs(who.id)...)
			}
		})
		b.Run(who.name+"/GetTasks", func(b *testing.B) {
			for b.Loop() {
				if _, err := f.s.GetTasks(who.id, ""); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// legacyFilterTasks is how GET /tasks and MCP list_tasks narrowed GetTasks in Go before QueryTasks did it
// in SQL: status, the due day (first ten characters) compared with op, tasks without due date left out
// by a due condition, and for dueFirst a stable sort with due dates first, the earliest on top.
func legacyFilterTasks(tasks []domain.Thought, status, op, day string, dueFirst bool, limit int) []string {
	out := []domain.Thought{}
	for _, t := range tasks {
		if (status == "open" && t.IsCompleted) || (status == "done" && !t.IsCompleted) {
			continue
		}
		if op != "" {
			if t.DueDate == "" {
				continue
			}
			d := t.DueDate[:min(10, len(t.DueDate))]
			if (op == "=" && d != day) || (op == "<" && d >= day) || (op == "<=" && d > day) {
				continue
			}
		}
		out = append(out, t)
	}
	if dueFirst {
		sort.SliceStable(out, func(i, j int) bool {
			if (out[i].DueDate == "") != (out[j].DueDate == "") {
				return out[i].DueDate != ""
			}
			return out[i].DueDate != "" && out[i].DueDate < out[j].DueDate
		})
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return taskIDs(out)
}

// QueryTasks finds exactly the tasks, in exactly the order, that GetTasks filtered and sorted in Go gave:
// every status, every kind of due condition (also due dates with a time, which count by their day), due
// dates first or list order, with and without a limit, for all lists and for single ones.
func TestQueryTasksMatchesFilteringInGo(t *testing.T) {
	f := newTaskQueryFixture(t, 1500, 4, 300, true)
	// Some due dates with a time, among them several on the same day and minute (order of equals)
	if _, err := f.s.db.Exec(`UPDATE thoughts SET due_date = due_date || CASE rowid % 3 WHEN 0 THEN 'T09:30' ELSE 'T18:05' END
		WHERE due_date != '' AND rowid % 4 = 0`); err != nil {
		t.Fatal(err)
	}
	people := []string{f.a, f.b, f.otherUsers[1], "usr_nobody"}
	lists := []string{"", f.lists[0], f.lists[7], f.foreignTL}
	days := []string{"2026-11-01", "2026-11-20", "2026-12-31"}
	checked := 0
	for _, u := range people {
		for _, l := range lists {
			all, err := f.s.GetTasks(u, l)
			if err != nil {
				t.Fatal(err)
			}
			for _, status := range []string{"", "all", "open", "done"} {
				for _, c := range []struct{ op, day string }{{"", ""}, {"=", days[1]}, {"<", days[1]}, {"<=", days[0]}, {"<=", days[1]}, {"<=", days[2]}} {
					for _, dueFirst := range []bool{false, true} {
						for _, limit := range []int{0, 1, 100} {
							q := TaskQuery{TaskListID: l, Status: status, DueFirst: dueFirst, Limit: limit}
							switch c.op {
							case "=":
								q.DueOn = c.day
							case "<":
								q.DueBefore = c.day
							case "<=":
								q.DueUntil = c.day
							}
							got, err := f.s.QueryTasks(u, q)
							if err != nil {
								t.Fatal(err)
							}
							want := legacyFilterTasks(all, status, c.op, c.day, dueFirst, limit)
							if !reflect.DeepEqual(taskIDs(got), want) {
								t.Fatalf("%s %+v: %d tasks, filtering in Go %d (or another order)\n%v\n%v", u, q, len(got), len(want), taskIDs(got), want)
							}
							if len(want) > 0 {
								checked++
							}
						}
					}
				}
			}
		}
	}
	if checked < 500 {
		t.Fatalf("fixture too thin: %d non-empty cases", checked)
	}
}
