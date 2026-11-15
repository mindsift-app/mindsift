package storage

import (
	"reflect"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func st(id, title string, done bool) domain.SubTask {
	return domain.SubTask{ID: id, Title: title, IsCompleted: done}
}

func linked(s domain.SubTask, block string) domain.SubTask {
	s.BlockID = block
	return s
}

// A change of the subtasks merges into what is stored now instead of replacing it: base is what the task
// view showed, ours what it sends, theirs what the note (or another view) stored meanwhile.
func TestMergeSubtasks(t *testing.T) {
	a, b, c := st("a", "Rahmen", false), st("b", "Glas", false), st("c", "Fensterbank", false)
	cases := []struct {
		name               string
		base, ours, theirs []domain.SubTask
		want               []domain.SubTask
	}{
		{
			name:   "rename one, the other ticked meanwhile",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{st("a", "Rahmen gründlich", false), b},
			theirs: []domain.SubTask{a, st("b", "Glas", true)},
			want:   []domain.SubTask{st("a", "Rahmen gründlich", false), st("b", "Glas", true)},
		},
		{
			name:   "tick and rename of the same subtask",
			base:   []domain.SubTask{a},
			ours:   []domain.SubTask{st("a", "Rahmen", true)},
			theirs: []domain.SubTask{st("a", "Rahmen abwischen", false)},
			want:   []domain.SubTask{st("a", "Rahmen abwischen", true)},
		},
		{
			name:   "both change the same field: ours wins",
			base:   []domain.SubTask{a},
			ours:   []domain.SubTask{st("a", "Von hier", false)},
			theirs: []domain.SubTask{st("a", "Von dort", false)},
			want:   []domain.SubTask{st("a", "Von hier", false)},
		},
		{
			name:   "added here and added there: both stay, each after the one it followed",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{a, st("n", "Neu hier", false), b},
			theirs: []domain.SubTask{a, b, c},
			want:   []domain.SubTask{a, st("n", "Neu hier", false), b, c},
		},
		{
			name:   "removed here while ticked there: removed",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{a},
			theirs: []domain.SubTask{a, st("b", "Glas", true)},
			want:   []domain.SubTask{a},
		},
		{
			name:   "removed there, untouched here: stays removed",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{st("a", "Rahmen", true), b},
			theirs: []domain.SubTask{a},
			want:   []domain.SubTask{st("a", "Rahmen", true)},
		},
		{
			name:   "removed there, renamed here: comes back with the new text",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{a, st("b", "Glas polieren", false)},
			theirs: []domain.SubTask{a},
			want:   []domain.SubTask{a, st("b", "Glas polieren", false)},
		},
		{
			name:   "reordered here, one added there",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{b, a},
			theirs: []domain.SubTask{a, b, c},
			// ours gives the order; c, new there, follows b as it did there
			want: []domain.SubTask{b, c, a},
		},
		{
			name:   "the checkbox link is always the stored one",
			base:   []domain.SubTask{a},
			ours:   []domain.SubTask{st("a", "Rahmen", true)},
			theirs: []domain.SubTask{linked(a, "blk1")},
			want:   []domain.SubTask{linked(st("a", "Rahmen", true), "blk1")},
		},
		{
			name:   "nothing changed here: the stored list as it is",
			base:   []domain.SubTask{a, b},
			ours:   []domain.SubTask{a, b},
			theirs: []domain.SubTask{st("b", "Glas", true), a, c},
			want:   []domain.SubTask{st("b", "Glas", true), a, c},
		},
	}
	for _, tc := range cases {
		got := MergeSubtasks(tc.base, tc.ours, tc.theirs)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
