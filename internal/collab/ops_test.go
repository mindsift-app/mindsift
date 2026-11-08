package collab

import (
	"testing"
	"time"
)

var (
	anna = Actor{UserID: "u_anna", ClientID: "c_anna", Name: "Anna"}
	ben  = Actor{UserID: "u_ben", ClientID: "c_ben", Name: "Ben"}
)

func str(s string) *string { return &s }

type fixedLeases map[string]string

func (f fixedLeases) HolderOf(id string) (string, bool) { c, ok := f[id]; return c, ok }

// docWith builds a doc via real operations so versions and keys are realistic.
func docWith(t *testing.T, blocks ...[3]string) *Doc { // {id, parent, content}
	t.Helper()
	d := NewDoc()
	keys := map[string]string{}
	for i, b := range blocks {
		k, _ := KeyBetween(keys[b[1]], "")
		keys[b[1]] = k
		_, res := Apply(d, Op{OpID: "seed" + string(rune('a'+i)), Kind: OpInsert, BlockID: b[0], ParentID: str(b[1]), OrderKey: k, Content: str(b[2])}, anna, Env{})
		if res.Status != StatusApplied {
			t.Fatalf("seed %v: %+v", b, res)
		}
	}
	return d
}

func mustValid(t *testing.T, d *Doc) {
	t.Helper()
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestSetContentAppliesOnMatchingVersion(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Hallo"})
	_, res := Apply(d, Op{OpID: "1", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Hallo Welt")}, anna, Env{})
	if res.Status != StatusApplied || d.Blocks["a"].Content != "Hallo Welt" || d.Blocks["a"].Version != 2 {
		t.Fatalf("got %+v, block %+v", res, d.Blocks["a"])
	}
}

func TestStaleVersionCreatesConflictCopy(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Start"}, [3]string{"b", "", "Danach"})
	Apply(d, Op{OpID: "1", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Von Anna")}, anna, Env{})
	_, res := Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Von Ben")}, ben, Env{})

	if res.Status != StatusConflict || res.ConflictBlockID == "" {
		t.Fatalf("want conflict, got %+v", res)
	}
	if d.Blocks["a"].Content != "Von Anna" {
		t.Fatal("first writer must keep the block")
	}
	flat := d.Flatten()
	if len(flat) != 3 || flat[1].ID != res.ConflictBlockID || flat[1].Content != "Von Ben" || flat[2].ID != "b" {
		t.Fatalf("conflict copy must sit directly below the block: %+v", flat)
	}
	if c := d.Blocks[res.ConflictBlockID].Props; c.ConflictOf != "a" || c.ConflictAuthor != "Ben" {
		t.Fatalf("conflict props wrong: %+v", c)
	}
	mustValid(t, d)
}

func TestForeignLeaseCreatesConflictCopy(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Start"})
	_, res := Apply(d, Op{OpID: "1", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Ben tippt")}, ben, Env{Leases: fixedLeases{"a": "c_anna"}})
	if res.Status != StatusConflict || d.Blocks["a"].Content != "Start" {
		t.Fatalf("lease holder must win: %+v", res)
	}
	// The lease holder itself may write
	_, res = Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Anna tippt")}, anna, Env{Leases: fixedLeases{"a": "c_anna"}})
	if res.Status != StatusApplied {
		t.Fatalf("lease holder rejected: %+v", res)
	}
}

func TestIdenticalContentIsNoConflict(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Gleich"})
	Apply(d, Op{OpID: "1", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Neu")}, anna, Env{})
	_, res := Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("Neu")}, ben, Env{})
	if res.Status != StatusApplied || len(d.Blocks) != 1 {
		t.Fatalf("same text must not produce a conflict copy: %+v", res)
	}
}

func TestEditOnDeletedBlockRestoresIt(t *testing.T) {
	d := docWith(t, [3]string{"p", "", "Eltern"}, [3]string{"c", "p", "Kind"})
	Apply(d, Op{OpID: "1", Kind: OpDelete, BlockID: "p"}, anna, Env{})
	_, res := Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "c", BaseVersion: 1, Content: str("Spät getippt")}, ben, Env{})
	if res.Status != StatusApplied {
		t.Fatalf("got %+v", res)
	}
	c := d.Blocks["c"]
	if c.Deleted || c.Content != "Spät getippt" || c.ParentID != "" {
		t.Fatalf("block must be restored at the nearest live ancestor: %+v", c)
	}
	mustValid(t, d)
}

func TestDeleteIsBlockedByForeignLeaseInSubtree(t *testing.T) {
	d := docWith(t, [3]string{"p", "", "Ast"}, [3]string{"c", "p", "Unterpunkt"})
	_, res := Apply(d, Op{OpID: "1", Kind: OpDelete, BlockID: "p"}, anna, Env{Leases: fixedLeases{"c": "c_ben"}})
	if res.Status != StatusRejected || res.Reason != "locked" || d.Blocks["p"].Deleted {
		t.Fatalf("got %+v", res)
	}
	_, res = Apply(d, Op{OpID: "2", Kind: OpDelete, BlockID: "p"}, anna, Env{})
	if res.Status != StatusApplied || !d.Blocks["c"].Deleted {
		t.Fatal("delete must tombstone the whole subtree")
	}
}

func TestMoveRejectsCyclesAndLockedBlocks(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "A"}, [3]string{"b", "a", "B"})
	if _, res := Apply(d, Op{OpID: "1", Kind: OpMove, BlockID: "a", ParentID: str("b"), OrderKey: "a0"}, anna, Env{}); res.Reason != "cycle" {
		t.Fatalf("want cycle, got %+v", res)
	}
	if _, res := Apply(d, Op{OpID: "2", Kind: OpMove, BlockID: "b", ParentID: str(""), OrderKey: "a5"}, anna, Env{Leases: fixedLeases{"b": "c_ben"}}); res.Reason != "locked" {
		t.Fatalf("want locked, got %+v", res)
	}
	if _, res := Apply(d, Op{OpID: "3", Kind: OpMove, BlockID: "b", ParentID: str(""), OrderKey: "a5"}, anna, Env{}); res.Status != StatusApplied {
		t.Fatalf("got %+v", res)
	}
	mustValid(t, d)
}

func TestInsertIntoDeletedParentGoesToLiveAncestor(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "A"}, [3]string{"b", "a", "B"})
	Apply(d, Op{OpID: "1", Kind: OpDelete, BlockID: "b"}, anna, Env{})
	_, res := Apply(d, Op{OpID: "2", Kind: OpInsert, BlockID: "n", ParentID: str("b"), OrderKey: "a0", Content: str("neu")}, ben, Env{})
	if res.Status != StatusApplied || d.Blocks["n"].ParentID != "a" {
		t.Fatalf("got %+v parent=%q", res, d.Blocks["n"].ParentID)
	}
}

func TestInsertRejectsTakenIDs(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "A"})
	if _, res := Apply(d, Op{OpID: "1", Kind: OpInsert, BlockID: "a", OrderKey: "a5"}, anna, Env{}); res.Reason != "exists" {
		t.Fatalf("got %+v", res)
	}
	env := Env{IDTaken: func(id string) bool { return id == "other_doc_block" }}
	if _, res := Apply(d, Op{OpID: "2", Kind: OpInsert, BlockID: "other_doc_block", OrderKey: "a5"}, anna, env); res.Reason != "exists" {
		t.Fatalf("block IDs of other documents must be rejected: %+v", res)
	}
}

func TestTitleConflictBecomesTopBlock(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Erster"})
	Apply(d, Op{OpID: "1", Kind: OpSetTitle, BaseVersion: 0, Title: str("Titel Anna")}, anna, Env{})
	_, res := Apply(d, Op{OpID: "2", Kind: OpSetTitle, BaseVersion: 0, Title: str("Titel Ben")}, ben, Env{})
	if res.Status != StatusConflict || d.Title != "Titel Anna" {
		t.Fatalf("got %+v title=%q", res, d.Title)
	}
	if flat := d.Flatten(); flat[0].ID != res.ConflictBlockID || flat[0].Props.ConflictOf != "title" {
		t.Fatalf("title conflict must be the first block: %+v", flat[0])
	}
}

func TestSetPropsDoesNotBumpContentVersion(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Todo"})
	Apply(d, Op{OpID: "1", Kind: OpSetProps, BlockID: "a", Patch: &PropsPatch{Checked: new(bool)}}, anna, Env{})
	yes := true
	Apply(d, Op{OpID: "2", Kind: OpSetProps, BlockID: "a", Patch: &PropsPatch{Checked: &yes}}, ben, Env{Leases: fixedLeases{"a": "c_anna"}})
	if !d.Blocks["a"].Props.Checked || d.Blocks["a"].Version != 1 {
		t.Fatalf("props must apply independently of text and leases: %+v", d.Blocks["a"])
	}
}

// Replaying the effects of every operation on an empty doc must give exactly the same state.
func TestEffectsReplayToSameState(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "A"}, [3]string{"b", "a", "B"})
	replay := d.Clone()
	ops := []struct {
		op Op
		a  Actor
	}{
		{Op{OpID: "1", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("A2")}, anna},
		{Op{OpID: "2", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("A3")}, ben},
		{Op{OpID: "3", Kind: OpDelete, BlockID: "a"}, anna},
		{Op{OpID: "4", Kind: OpSetContent, BlockID: "b", BaseVersion: 1, Content: str("B2")}, ben},
		{Op{OpID: "5", Kind: OpSetTitle, Title: str("T")}, anna},
	}
	for _, o := range ops {
		effects, _ := Apply(d, o.op, o.a, Env{})
		for _, e := range effects {
			replay.ApplyEffect(e)
		}
	}
	if !docsEqual(d, replay) {
		t.Fatal("replayed effects differ from server state")
	}
}

func docsEqual(a, b *Doc) bool {
	if a.Title != b.Title || a.TitleVersion != b.TitleVersion || len(a.Blocks) != len(b.Blocks) {
		return false
	}
	for id, x := range a.Blocks {
		y, ok := b.Blocks[id]
		if !ok || *x != *y {
			return false
		}
	}
	return true
}

func TestLeaseManager(t *testing.T) {
	now := time.Unix(1000, 0)
	m := NewLeaseManager(func() time.Time { return now })

	g, den := m.Hold("d", anna, []string{"a", "b"})
	if len(g) != 2 || len(den) != 0 {
		t.Fatalf("anna: granted=%v denied=%v", g, den)
	}
	if g, den = m.Hold("d", ben, []string{"a", "c"}); len(g) != 1 || den[0] != "a" {
		t.Fatalf("ben: granted=%v denied=%v", g, den)
	}
	if others := m.Others("d", "c_ben"); len(others) != 2 || others[0].Name != "Anna" {
		t.Fatalf("others: %+v", others)
	}

	now = now.Add(LeaseTTL + time.Second)
	if g, _ = m.Hold("d", ben, []string{"a"}); len(g) != 1 {
		t.Fatal("expired lease must be available")
	}

	m.ReleaseAllExcept("d", "c_ben", []string{"a"})
	if _, held := m.View("d").HolderOf("c"); held {
		t.Fatal("lease not in keep set must be released")
	}

	m.Touch("d", anna)
	m.Touch("d", ben)
	if n, people := m.Sessions("d"); n != 2 || len(people) != 2 {
		t.Fatalf("sessions: %d %+v", n, people)
	}
	m.Leave("d", "c_ben")
	if _, held := m.View("d").HolderOf("a"); held {
		t.Fatal("leaving must drop the client's leases")
	}
}

// A sync that only renews what the client already holds changes nothing for the others: telling them
// made every open client sync again at once, without end
func TestLeaseExchangeReportsOnlyChanges(t *testing.T) {
	now := time.Unix(1000, 0)
	m := NewLeaseManager(func() time.Time { return now })
	if !m.Touch("d", anna) || m.Touch("d", anna) {
		t.Fatal("only the first sync of a client is a new session")
	}
	if _, _, changed := m.Exchange("d", anna, nil, nil); changed {
		t.Fatal("holding nothing, again: no change")
	}
	if _, _, changed := m.Exchange("d", anna, []string{"a"}, nil); !changed {
		t.Fatal("a new lease is a change")
	}
	now = now.Add(5 * time.Second)
	if _, _, changed := m.Exchange("d", anna, []string{"a"}, nil); changed {
		t.Fatal("renewing a lease is no change")
	}
	if g, den, changed := m.Exchange("d", ben, []string{"a"}, nil); changed || len(g) != 0 || len(den) != 1 {
		t.Fatalf("denied lease: granted=%v denied=%v changed=%v", g, den, changed)
	}
	if _, _, changed := m.Exchange("d", anna, nil, nil); !changed {
		t.Fatal("giving a block up is a change")
	}
}

func TestNotifier(t *testing.T) {
	n := NewNotifier()
	ch := n.Changed("d")
	select {
	case <-ch:
		t.Fatal("must not fire before Notify")
	default:
	}
	n.Notify("d")
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("Notify must wake waiters")
	}
}

func TestClearConflictMarking(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "Start"})
	Apply(d, Op{OpID: "1", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("A")}, anna, Env{})
	_, res := Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "a", BaseVersion: 1, Content: str("B")}, ben, Env{})
	yes := true
	Apply(d, Op{OpID: "3", Kind: OpSetProps, BlockID: res.ConflictBlockID, Patch: &PropsPatch{ClearConflict: &yes}}, ben, Env{})
	if p := d.Blocks[res.ConflictBlockID].Props; p.ConflictOf != "" || p.ConflictAuthor != "" {
		t.Fatalf("conflict marking not cleared: %+v", p)
	}
}

func TestPurgeKeepsTreeValid(t *testing.T) {
	d := docWith(t, [3]string{"p", "", "Eltern"}, [3]string{"c", "p", "Kind"}, [3]string{"x", "", "Anderer"})
	Apply(d, Op{OpID: "1", Kind: OpDelete, BlockID: "c"}, anna, Env{})
	Apply(d, Op{OpID: "2", Kind: OpDelete, BlockID: "p"}, anna, Env{})
	// Only "p" is old enough: it must stay because its deleted child "c" still points to it
	if e := Purge(d, []string{"p"}); e != nil {
		t.Fatalf("parent of a remaining tombstone must not be purged: %+v", e)
	}
	e := Purge(d, []string{"p", "c"})
	if e == nil || len(e.IDs) != 2 || len(d.Blocks) != 1 {
		t.Fatalf("both tombstones must go: %+v, blocks %d", e, len(d.Blocks))
	}
	mustValid(t, d)
}

func TestTextForPurgedBlockBecomesNewBlock(t *testing.T) {
	d := docWith(t, [3]string{"a", "", "A"}, [3]string{"b", "", "B"})
	Apply(d, Op{OpID: "1", Kind: OpDelete, BlockID: "b"}, anna, Env{})
	Purge(d, []string{"b"})
	_, res := Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "b", BaseVersion: 1, Content: str("Wochen offline getippt")}, ben, Env{})
	if res.Status != StatusApplied {
		t.Fatalf("late text must not be lost: %+v", res)
	}
	flat := d.Flatten()
	if len(flat) != 2 || flat[1].Content != "Wochen offline getippt" {
		t.Fatalf("text must be revived at the end: %+v", flat)
	}
	mustValid(t, d)
}

func TestDrawingBlocksOnlyTakeDrawings(t *testing.T) {
	d := NewDoc()
	k, _ := KeyBetween("", "")
	empty := `{"v":1,"els":[]}`
	_, res := Apply(d, Op{OpID: "1", Kind: OpInsert, BlockID: "z", ParentID: str(""), OrderKey: k, Type: "drawing", Content: str(empty)}, anna, Env{})
	if res.Status != StatusApplied {
		t.Fatalf("insert: %+v", res)
	}
	_, res = Apply(d, Op{OpID: "2", Kind: OpSetContent, BlockID: "z", BaseVersion: 1, Content: str("Einfach Text")}, anna, Env{})
	if res.Status != StatusRejected || d.Blocks["z"].Content != empty {
		t.Fatalf("text in a drawing must be rejected: %+v", res)
	}
	// Empty is fine: turning the drawing back into a bullet may send the content first
	_, res = Apply(d, Op{OpID: "3", Kind: OpSetContent, BlockID: "z", BaseVersion: 1, Content: str("")}, anna, Env{})
	if res.Status != StatusApplied {
		t.Fatalf("empty content: %+v", res)
	}
	k2, _ := KeyBetween(k, "")
	_, res = Apply(d, Op{OpID: "4", Kind: OpInsert, BlockID: "y", ParentID: str(""), OrderKey: k2, Type: "drawing", Content: str("kaputt")}, anna, Env{})
	if res.Status != StatusRejected {
		t.Fatalf("insert of a broken drawing: %+v", res)
	}
}
