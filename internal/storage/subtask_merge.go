package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// MergeSubtasks merges a change of a task's subtasks into their current state: base is the list the
// change was made on (what the task view showed), ours the list it sends, theirs the list as stored now.
// The subtasks are one field, so writing ours as it is would undo whatever happened to theirs since base
// (a subtask ticked in the note while another one is renamed in the task view). Instead every subtask
// takes, field by field, what ours changed from base, and everything else from theirs:
//   - title and tick separately (a tick here and a rename there both stay),
//   - a subtask ours added is added, one ours removed is removed,
//   - a subtask added since base (theirs) stays; one removed since base stays removed unless ours
//     changed it (then it comes back with that change, nothing typed is lost),
//   - the checkbox link (BlockID) is always the stored one (only the server links subtasks),
//   - the order is ours when ours reordered, else theirs, each with the other side's new subtasks next to
//     the one they followed.
func MergeSubtasks(base, ours, theirs []domain.SubTask) []domain.SubTask {
	baseBy := subtasksByID(base)
	oursBy := subtasksByID(ours)
	theirsBy := subtasksByID(theirs)

	merged := map[string]domain.SubTask{}
	for _, t := range theirs {
		b, inBase := baseBy[t.ID]
		o, inOurs := oursBy[t.ID]
		switch {
		case inBase && !inOurs:
			continue // removed here
		case inBase && inOurs:
			if o.Title != b.Title {
				t.Title = o.Title
			}
			if o.IsCompleted != b.IsCompleted {
				t.IsCompleted = o.IsCompleted
			}
		case inOurs:
			// Not in base but sent (an older client, or the same subtask added twice): ours gives the fields
			t.Title, t.IsCompleted = o.Title, o.IsCompleted
		}
		merged[t.ID] = t
	}
	for _, o := range ours {
		if _, ok := merged[o.ID]; ok {
			continue
		}
		if _, stored := theirsBy[o.ID]; stored {
			continue // removed here (handled above)
		}
		b, inBase := baseBy[o.ID]
		if inBase && o.Title == b.Title && o.IsCompleted == b.IsCompleted {
			continue // removed since base and not changed here
		}
		o.BlockID = "" // its checkbox link went with it (or never existed)
		merged[o.ID] = o
	}

	// Order: whoever moved the subtasks around gives it
	primary, secondary := theirs, ours
	if reorderedFrom(base, ours) {
		primary, secondary = ours, theirs
	}
	out := make([]domain.SubTask, 0, len(merged))
	placed := map[string]bool{}
	for _, st := range primary {
		if m, ok := merged[st.ID]; ok && !placed[st.ID] {
			out = append(out, m)
			placed[st.ID] = true
		}
	}
	// The other side's subtasks not placed yet go right after the one they follow there
	for i, st := range secondary {
		m, ok := merged[st.ID]
		if !ok || placed[st.ID] {
			continue
		}
		at := 0
		for j := i - 1; j >= 0; j-- {
			if idx := indexOfSubtask(out, secondary[j].ID); idx >= 0 {
				at = idx + 1
				break
			}
		}
		out = append(out[:at], append([]domain.SubTask{m}, out[at:]...)...)
		placed[st.ID] = true
	}
	return out
}

func subtasksByID(list []domain.SubTask) map[string]domain.SubTask {
	m := make(map[string]domain.SubTask, len(list))
	for _, st := range list {
		m[st.ID] = st
	}
	return m
}

func indexOfSubtask(list []domain.SubTask, id string) int {
	for i, st := range list {
		if st.ID == id {
			return i
		}
	}
	return -1
}

// reorderedFrom: the subtasks both lists hold stand in another order in ours than in base.
func reorderedFrom(base, ours []domain.SubTask) bool {
	inOurs := subtasksByID(ours)
	inBase := subtasksByID(base)
	var a, b []string
	for _, st := range base {
		if _, ok := inOurs[st.ID]; ok {
			a = append(a, st.ID)
		}
	}
	for _, st := range ours {
		if _, ok := inBase[st.ID]; ok {
			b = append(b, st.ID)
		}
	}
	for i := range a {
		if i >= len(b) || a[i] != b[i] {
			return true
		}
	}
	return false
}
