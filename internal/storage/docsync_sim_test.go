package storage

import (
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
)

// The simulation drives several clients against the real store over an unreliable network and checks
// that everyone converges to the server state without losing text or applying anything twice.

type simClient struct {
	actor     collab.Actor
	confirmed *collab.Doc
	lastSeq   int64
	pending   []collab.Op // not sent yet; base versions are filled in when a batch is formed
	inflight  []collab.Op // sent, response not received; resent unchanged (same op IDs)
	holds     map[string]bool
	offline   bool
	counter   int
}

type simWorld struct {
	t           *testing.T
	r           *rand.Rand
	store       *Store
	docID       string
	leases      *collab.LeaseManager
	now         time.Time
	clients     []*simClient
	sent        map[string]collab.Op     // every op ever sent, by ID
	results     map[string]collab.Result // first result received per op ID
	fullLog     []DocLogEntry            // copy of the log taken before each compaction, for the final checks
	logSeen     int64
	compactions int
}

func (w *simWorld) newOpID(c *simClient) string {
	c.counter++
	return fmt.Sprintf("%s-%d", c.actor.ClientID, c.counter)
}

// localView is what the client's editor shows: confirmed state plus its own unconfirmed operations.
func (c *simClient) localView() *collab.Doc {
	v := c.confirmed.Clone()
	for _, op := range append(append([]collab.Op{}, c.inflight...), c.pending...) {
		if op.Kind == collab.OpSetContent {
			if b, ok := v.Blocks[op.BlockID]; ok {
				op.BaseVersion = b.Version
			}
		}
		if op.Kind == collab.OpSetTitle {
			op.BaseVersion = v.TitleVersion
		}
		collab.Apply(v, op, c.actor, collab.Env{})
	}
	return v
}

func pick[T any](r *rand.Rand, list []T) (T, bool) {
	var zero T
	if len(list) == 0 {
		return zero, false
	}
	return list[r.Intn(len(list))], true
}

// edit lets a client perform one random editor action on its local view.
func (w *simWorld) edit(c *simClient) {
	v := c.localView()
	flat := v.Flatten()
	var target *collab.Block
	if fb, ok := pick(w.r, flat); ok {
		target = fb.Block
	}
	switch n := w.r.Intn(100); {
	case n < 45 && target != nil: // typing
		content := target.Content + fmt.Sprintf(" %s%d", c.actor.ClientID, c.counter)
		// Base = the version the user sees while typing (like the browser engine)
		c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpSetContent, BlockID: target.ID, BaseVersion: target.Version, Content: &content})
		c.holds[target.ID] = true
	case n < 65: // Enter: new block after target (or first block)
		parent, after := "", ""
		if target != nil {
			parent, after = target.ParentID, target.OrderKey
		}
		next := ""
		for _, s := range v.Children(parent) {
			if s.OrderKey > after {
				next = s.OrderKey
				break
			}
		}
		key, err := collab.KeyBetween(after, next)
		if err != nil {
			return
		}
		id := fmt.Sprintf("blk_%s_%d", c.actor.ClientID, c.counter)
		content := "neu von " + c.actor.ClientID
		c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpInsert, BlockID: id, ParentID: &parent, OrderKey: key, Content: &content})
		c.holds[id] = true
	case n < 73 && target != nil: // indent under previous sibling
		siblings := v.Children(target.ParentID)
		for i, s := range siblings {
			if s.ID == target.ID && i > 0 {
				prev := siblings[i-1]
				last := ""
				if kids := v.Children(prev.ID); len(kids) > 0 {
					last = kids[len(kids)-1].OrderKey
				}
				key, _ := collab.KeyBetween(last, "")
				c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpMove, BlockID: target.ID, ParentID: &prev.ID, OrderKey: key})
			}
		}
	case n < 80 && target != nil: // outdent
		if p, ok := v.Blocks[target.ParentID]; ok {
			key, err := collab.KeyBetween(p.OrderKey, "")
			if err == nil {
				for _, s := range v.Children(p.ParentID) {
					if s.OrderKey > p.OrderKey {
						key, _ = collab.KeyBetween(p.OrderKey, s.OrderKey)
						break
					}
				}
				grand := p.ParentID
				c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpMove, BlockID: target.ID, ParentID: &grand, OrderKey: key})
			}
		}
	case n < 87 && target != nil: // delete branch
		c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpDelete, BlockID: target.ID})
	case n < 93 && target != nil: // tick checkbox
		checked := !target.Props.Checked
		c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpSetProps, BlockID: target.ID, Patch: &collab.PropsPatch{Checked: &checked}})
	case n < 96: // rename note
		title := fmt.Sprintf("Titel %s%d", c.actor.ClientID, c.counter)
		c.pending = append(c.pending, collab.Op{OpID: w.newOpID(c), Kind: collab.OpSetTitle, BaseVersion: v.TitleVersion, Title: &title})
	default: // stop editing some block
		for id := range c.holds {
			delete(c.holds, id)
			break
		}
	}
}

// formBatch takes pending operations and keeps only the last text change per block; its base version is
// the one of the first change, i.e. what the user saw when starting to type.
func (c *simClient) formBatch() []collab.Op {
	lastText := map[string]int{}
	firstBase := map[string]int{}
	lastTitle, firstTitleBase := -1, 0
	for i, op := range c.pending {
		switch op.Kind {
		case collab.OpSetContent:
			if _, ok := lastText[op.BlockID]; !ok {
				firstBase[op.BlockID] = op.BaseVersion
			}
			lastText[op.BlockID] = i
		case collab.OpSetTitle:
			if lastTitle < 0 {
				firstTitleBase = op.BaseVersion
			}
			lastTitle = i
		}
	}
	var batch []collab.Op
	for i, op := range c.pending {
		switch op.Kind {
		case collab.OpSetContent:
			if lastText[op.BlockID] != i {
				continue
			}
			op.BaseVersion = firstBase[op.BlockID]
		case collab.OpSetTitle:
			if i != lastTitle {
				continue
			}
			op.BaseVersion = firstTitleBase
		}
		batch = append(batch, op)
	}
	c.pending = nil
	return batch
}

// serverSync is what POST /sync does, minus HTTP.
func (w *simWorld) serverSync(c *simClient, batch []collab.Op, holds []string) []collab.Result {
	w.leases.Touch(w.docID, c.actor)
	w.leases.ReleaseAllExcept(w.docID, c.actor.ClientID, holds)
	w.leases.Hold(w.docID, c.actor, holds)
	results, _, err := w.store.ApplyDocOps(w.docID, c.actor, batch, w.leases.View(w.docID))
	if err != nil {
		w.t.Fatalf("ApplyDocOps: %v", err)
	}
	var own []string
	for i, res := range results {
		if res.Status == collab.StatusApplied && batch[i].Kind == collab.OpInsert {
			own = append(own, batch[i].BlockID)
		}
		if res.ConflictBlockID != "" {
			own = append(own, res.ConflictBlockID)
		}
	}
	w.leases.Hold(w.docID, c.actor, own)
	return results
}

// pull fetches the log after lastSeq in small pages (to exercise paging) and replays it.
func (w *simWorld) pull(c *simClient) {
	for {
		entries, head, err := w.store.GetDocOpsSince(w.docID, c.lastSeq, 7)
		if errors.Is(err, ErrLogCompacted) {
			// Too far behind: reload the snapshot, unsent operations stay queued
			w.loadSnapshot(c)
			continue
		}
		if err != nil {
			w.t.Fatalf("GetDocOpsSince: %v", err)
		}
		if len(entries) == 0 && c.lastSeq < head {
			w.t.Fatalf("%s: stuck at seq %d, head %d, no log entries", c.actor.ClientID, c.lastSeq, head)
		}
		for _, e := range entries {
			if e.Seq != c.lastSeq+1 {
				w.t.Fatalf("%s: log gap, expected seq %d got %d", c.actor.ClientID, c.lastSeq+1, e.Seq)
			}
			c.confirmed.ApplyEffect(e.Effect)
			c.lastSeq = e.Seq
		}
		if c.lastSeq >= head {
			return
		}
	}
}

func (w *simWorld) loadSnapshot(c *simClient) {
	snap, err := w.store.GetDocSnapshot(w.docID)
	if err != nil {
		w.t.Fatal(err)
	}
	c.confirmed = collab.NewDoc()
	c.confirmed.Title, c.confirmed.TitleVersion = snap.Title, snap.TitleVersion
	for _, b := range snap.Blocks {
		b := b
		c.confirmed.Blocks[b.ID] = &b
	}
	c.lastSeq = snap.HeadSeq
}

// captureLog copies log entries the simulation has not seen yet, before compaction removes them.
func (w *simWorld) captureLog() {
	entries, _, err := w.store.GetDocOpsSince(w.docID, w.logSeen, 1_000_000)
	if err != nil {
		w.t.Fatalf("captureLog: %v", err)
	}
	for _, e := range entries {
		w.fullLog = append(w.fullLog, e)
		w.logSeen = e.Seq
	}
}

// compact ages the whole log and every tombstone past their retention and runs the compaction job.
func (w *simWorld) compact() {
	w.captureLog()
	old := time.Now().Add(-40 * 24 * time.Hour).UTC().Format(time.RFC3339)
	w.store.db.Exec(`UPDATE doc_ops SET created_at = ? WHERE doc_id = ?`, old, w.docID)
	w.store.db.Exec(`UPDATE blocks SET deleted_at = ? WHERE document_id = ? AND deleted = 1`, old, w.docID)
	if _, err := w.store.CompactDocs(time.Now()); err != nil {
		w.t.Fatalf("CompactDocs: %v", err)
	}
	w.compactions++
}

// sync runs one round trip over the unreliable (or, with reliable=true, a perfect) network.
func (w *simWorld) sync(c *simClient, reliable bool) {
	if c.inflight == nil {
		c.inflight = c.formBatch()
		for _, op := range c.inflight {
			w.sent[op.OpID] = op
		}
	}
	holds := make([]string, 0, len(c.holds))
	for id := range c.holds {
		holds = append(holds, id)
	}
	sort.Strings(holds)

	fate := 100
	if !reliable {
		fate = w.r.Intn(100)
	}
	switch {
	case fate < 10: // request lost
		return
	case fate < 20: // server applied it, response lost
		w.serverSync(c, c.inflight, holds)
		return
	case fate < 25: // request duplicated by a retrying proxy
		w.serverSync(c, c.inflight, holds)
	}
	results := w.serverSync(c, c.inflight, holds)
	for _, res := range results {
		if prev, ok := w.results[res.OpID]; ok && prev != res {
			w.t.Fatalf("op %s answered differently on retry: %+v vs %+v", res.OpID, prev, res)
		}
		w.results[res.OpID] = res
	}
	c.inflight = nil
	w.pull(c)
}

func runSimulation(t *testing.T, seed int64, steps int) {
	store, u := newSyncTestStore(t)
	doc, err := store.CreateDocument(u.ID, "", "Sim", "🗒️", "", flatBlocks([3]any{"root", 0, "Start"}), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	w := &simWorld{t: t, r: rand.New(rand.NewSource(seed)), store: store, docID: doc.ID,
		now: time.Unix(1_700_000_000, 0), sent: map[string]collab.Op{}, results: map[string]collab.Result{}}
	w.leases = collab.NewLeaseManager(func() time.Time { return w.now })

	for i := 0; i < 4; i++ {
		snap, err := store.GetDocSnapshot(doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		c := &simClient{actor: collab.Actor{UserID: fmt.Sprintf("u%d", i%2), ClientID: fmt.Sprintf("c%d", i), Name: fmt.Sprintf("Client %d", i)},
			confirmed: collab.NewDoc(), lastSeq: snap.HeadSeq, holds: map[string]bool{}}
		c.confirmed.Title, c.confirmed.TitleVersion = snap.Title, snap.TitleVersion
		for _, b := range snap.Blocks {
			b := b
			c.confirmed.Blocks[b.ID] = &b
		}
		w.clients = append(w.clients, c)
	}

	for step := 0; step < steps; step++ {
		c := w.clients[w.r.Intn(len(w.clients))]
		switch n := w.r.Intn(100); {
		case n < 55:
			w.edit(c)
		case n < 90:
			if !c.offline {
				w.sync(c, false)
			}
		case n < 95:
			c.offline = !c.offline
		case n < 99:
			w.now = w.now.Add(time.Duration(w.r.Intn(25)) * time.Second) // leases may expire
		default:
			w.compact()
		}
	}

	// Everyone comes back online and syncs until nothing is left
	for round := 0; round < 10; round++ {
		for _, c := range w.clients {
			c.offline = false
			w.sync(c, true)
		}
	}
	for _, c := range w.clients {
		if len(c.pending) > 0 || len(c.inflight) > 0 {
			t.Fatalf("%s still has unsent operations", c.actor.ClientID)
		}
		w.pull(c)
	}

	server, head, err := loadCollabDoc(store.db, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Validate(); err != nil {
		t.Fatalf("seed %d: invalid tree: %v", seed, err)
	}
	for _, c := range w.clients {
		if c.lastSeq != head || !docsEqual(c.confirmed, server) {
			t.Fatalf("seed %d: %s diverged from the server (seq %d vs %d)", seed, c.actor.ClientID, c.lastSeq, head)
		}
	}

	// Every operation got exactly one stored result, and no text was lost
	var stored int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM doc_op_results WHERE doc_id = ? AND user_id IN ('u0', 'u1')`, doc.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != len(w.sent) {
		t.Fatalf("seed %d: %d operations sent but %d results stored", seed, len(w.sent), stored)
	}
	w.captureLog()
	log := w.fullLog
	bySeq := map[int64]collab.Effect{}
	inserted := map[string]string{}
	for _, e := range log {
		bySeq[e.Seq] = e.Effect
		// First insert only: a purged block that is edited again comes back with the same ID
		if _, seen := inserted[e.Effect.BlockID]; e.Effect.Kind == collab.OpInsert && !seen {
			inserted[e.Effect.BlockID] = e.Effect.Content
		}
	}
	conflicts := 0
	for id, op := range w.sent {
		res, ok := w.results[id]
		if !ok {
			continue // result only seen by the server (response lost, never retried after success) is covered by the count above
		}
		switch op.Kind {
		case collab.OpInsert, collab.OpSetContent, collab.OpSetTitle:
			// Clearing the text of a block that was purged meanwhile has nothing left to keep
			emptied := op.Kind == collab.OpSetContent && *op.Content == "" && res.Reason == "missing"
			if res.Status == collab.StatusRejected && !emptied {
				t.Fatalf("seed %d: text-carrying op %s was rejected: %+v", seed, id, res)
			}
		}
		if op.Kind == collab.OpSetContent && res.Status == collab.StatusApplied && res.Seq > 0 {
			want := collab.OpSetContent
			if res.Reason == "revived" { // block was purged: the text came back as a new block
				want = collab.OpInsert
			}
			if e := bySeq[res.Seq]; e.Kind != want || e.Content != *op.Content {
				t.Fatalf("seed %d: applied text of %s not in the log", seed, id)
			}
		}
		if res.Status == collab.StatusConflict {
			conflicts++
			text := ""
			if op.Content != nil {
				text = *op.Content
			} else if op.Title != nil {
				text = *op.Title
			}
			if got, ok := inserted[res.ConflictBlockID]; !ok || got != text {
				t.Fatalf("seed %d: conflict copy of %s missing or wrong: got %q (present %v), want %q", seed, id, got, ok, text)
			}
		}
	}
	t.Logf("seed %d: %d ops, %d log entries, %d conflict copies, %d blocks, %d compactions", seed, len(w.sent), len(log), conflicts, len(server.Blocks), w.compactions)
}

func docsEqual(a, b *collab.Doc) bool {
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

func TestSyncSimulationUnreliableNetwork(t *testing.T) {
	seeds := 25
	if testing.Short() {
		seeds = 3
	}
	for seed := int64(1); seed <= int64(seeds); seed++ {
		seed := seed
		t.Run(fmt.Sprintf("seed-%d", seed), func(t *testing.T) {
			runSimulation(t, seed, 600)
		})
	}
}
