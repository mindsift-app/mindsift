package collab

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
)

const (
	OpInsert     = "insert"
	OpSetContent = "set_content"
	OpSetProps   = "set_props"
	OpMove       = "move"
	OpDelete     = "delete"
	OpRestore    = "restore"
	OpSetTitle   = "set_title"
	// OpPurge is only produced by log compaction: deleted blocks older than the retention are removed for good
	OpPurge = "purge"

	StatusApplied  = "applied"
	StatusConflict = "conflict"
	StatusRejected = "rejected"

	maxContentLength = 100_000
	maxTypeLength    = 20
)

// PropsPatch changes selected block settings; nil fields stay as they are.
type PropsPatch struct {
	Type      *string `json:"type,omitempty"`
	Checked   *bool   `json:"checked,omitempty"`
	Collapsed *bool   `json:"collapsed,omitempty"`
	Lang      *string `json:"lang,omitempty"`
	// ClearConflict removes the conflict marking (after the user accepted or kept a conflict copy)
	ClearConflict *bool `json:"clearConflict,omitempty"`
}

// Op is a change requested by a client. OpID is chosen by the client and makes retries idempotent.
type Op struct {
	OpID        string      `json:"opId"`
	Kind        string      `json:"kind"`
	BlockID     string      `json:"blockId,omitempty"`
	BaseVersion int         `json:"baseVersion,omitempty"` // set_content, set_title
	ParentID    *string     `json:"parentId,omitempty"`    // insert, move ("" = top level)
	OrderKey    string      `json:"orderKey,omitempty"`    // insert, move
	Type        string      `json:"type,omitempty"`        // insert
	Content     *string     `json:"content,omitempty"`     // insert, set_content
	Props       *Props      `json:"props,omitempty"`       // insert
	Patch       *PropsPatch `json:"patch,omitempty"`       // set_props
	IDs         []string    `json:"ids,omitempty"`         // restore
	Title       *string     `json:"title,omitempty"`       // set_title
}

// Effect is a normalized, already validated change. The server log stores effects; replaying them in
// order on an empty Doc reproduces the server state exactly.
type Effect struct {
	Kind         string   `json:"kind"`
	BlockID      string   `json:"blockId,omitempty"`
	ParentID     string   `json:"parentId,omitempty"`
	OrderKey     string   `json:"orderKey,omitempty"`
	Type         string   `json:"type,omitempty"`
	Content      string   `json:"content,omitempty"`
	Props        *Props   `json:"props,omitempty"`
	Version      int      `json:"version,omitempty"`
	IDs          []string `json:"ids,omitempty"`
	Title        string   `json:"title,omitempty"`
	TitleVersion int      `json:"titleVersion,omitempty"`
	By           string   `json:"by,omitempty"`
}

type Result struct {
	OpID            string `json:"opId"`
	Status          string `json:"status"`
	Reason          string `json:"reason,omitempty"`
	Version         int    `json:"version,omitempty"`
	ConflictBlockID string `json:"conflictBlockId,omitempty"`
	Seq             int64  `json:"seq,omitempty"`
}

// Actor identifies who sends an operation. ClientID is one browser tab / sync engine instance.
type Actor struct {
	UserID   string
	ClientID string
	Name     string
}

// LeaseView answers which client currently holds the lease on a block.
type LeaseView interface {
	HolderOf(blockID string) (clientID string, held bool)
}

// Env provides outside knowledge needed to validate operations.
type Env struct {
	Leases  LeaseView            // nil = no leases (e.g. server-internal writes)
	IDTaken func(id string) bool // true if the block ID exists in another document
}

// ApplyEffect mutates the document with one effect. It never fails; effects are validated by Apply.
func (d *Doc) ApplyEffect(e Effect) {
	switch e.Kind {
	case OpInsert:
		b := &Block{ID: e.BlockID, ParentID: e.ParentID, OrderKey: e.OrderKey, Type: e.Type, Content: e.Content, Version: e.Version, UpdatedBy: e.By}
		if e.Props != nil {
			b.Props = *e.Props
		}
		d.Blocks[e.BlockID] = b
	case OpSetContent:
		if b, ok := d.Blocks[e.BlockID]; ok {
			b.Content, b.Version, b.UpdatedBy = e.Content, e.Version, e.By
		}
	case OpSetProps:
		if b, ok := d.Blocks[e.BlockID]; ok {
			b.Type = e.Type
			if e.Props != nil {
				b.Props = *e.Props
			}
		}
	case OpMove:
		if b, ok := d.Blocks[e.BlockID]; ok {
			b.ParentID, b.OrderKey = e.ParentID, e.OrderKey
		}
	case OpDelete:
		for _, id := range e.IDs {
			if b, ok := d.Blocks[id]; ok {
				b.Deleted = true
			}
		}
	case OpRestore:
		for _, id := range e.IDs {
			if b, ok := d.Blocks[id]; ok {
				b.Deleted = false
			}
		}
	case OpSetTitle:
		d.Title, d.TitleVersion = e.Title, e.TitleVersion
	case OpPurge:
		for _, id := range e.IDs {
			delete(d.Blocks, id)
		}
	}
}

// ConflictBlockID derives the ID of a conflict copy from the losing operation, so retries never duplicate it.
func ConflictBlockID(opID string) string {
	sum := sha256.Sum256([]byte("conflict:" + opID))
	return "blk_cf_" + hex.EncodeToString(sum[:8])
}

type applier struct {
	d       *Doc
	a       Actor
	env     Env
	effects []Effect
}

func (ap *applier) emit(e Effect) {
	e.By = ap.a.UserID
	ap.d.ApplyEffect(e)
	ap.effects = append(ap.effects, e)
}

func (ap *applier) foreignLease(blockID string) bool {
	if ap.env.Leases == nil {
		return false
	}
	holder, held := ap.env.Leases.HolderOf(blockID)
	return held && holder != ap.a.ClientID
}

func rejected(op Op, reason string) Result {
	return Result{OpID: op.OpID, Status: StatusRejected, Reason: reason}
}

// Apply validates op against d, mutates d and returns the produced effects. Rejected operations
// produce no effects; conflicting text is kept as a separate conflict block.
func Apply(d *Doc, op Op, a Actor, env Env) ([]Effect, Result) {
	ap := &applier{d: d, a: a, env: env}
	res := ap.apply(op)
	res.OpID = op.OpID
	return ap.effects, res
}

func (ap *applier) apply(op Op) Result {
	d := ap.d
	switch op.Kind {
	case OpInsert:
		if op.BlockID == "" || len(op.BlockID) > 64 {
			return rejected(op, "invalid_id")
		}
		if _, exists := d.Blocks[op.BlockID]; exists || (ap.env.IDTaken != nil && ap.env.IDTaken(op.BlockID)) {
			return rejected(op, "exists")
		}
		parent := ""
		if op.ParentID != nil {
			parent = *op.ParentID
		}
		if parent != "" {
			if _, ok := d.Blocks[parent]; ok {
				parent = d.liveAncestor(parent)
			} else {
				parent = "" // parent was purged after the retention period: keep the block at the top level
			}
		}
		if !ValidOrderKey(op.OrderKey) {
			return rejected(op, "invalid_order_key")
		}
		typ := op.Type
		if typ == "" {
			typ = "bullet"
		}
		if len(typ) > maxTypeLength {
			return rejected(op, "invalid_type")
		}
		content := ""
		if op.Content != nil {
			content = *op.Content
		}
		if len(content) > maxContentLength {
			return rejected(op, "too_long")
		}
		props := Props{}
		if op.Props != nil {
			props = *op.Props
		}
		ap.emit(Effect{Kind: OpInsert, BlockID: op.BlockID, ParentID: parent, OrderKey: op.OrderKey, Type: typ, Content: content, Props: &props, Version: 1})
		return Result{Status: StatusApplied, Version: 1}

	case OpSetContent:
		b, ok := d.Blocks[op.BlockID]
		if !ok {
			return ap.reviveAsNewBlock(op)
		}
		if op.Content == nil {
			return rejected(op, "no_content")
		}
		if len(*op.Content) > maxContentLength {
			return rejected(op, "too_long")
		}
		if b.Deleted {
			// A late edit on a deleted block brings it back instead of losing the text
			ap.restore([]string{b.ID})
		}
		if *op.Content == b.Content {
			return Result{Status: StatusApplied, Version: b.Version}
		}
		if ap.foreignLease(b.ID) || op.BaseVersion != b.Version {
			return ap.conflictCopy(op, b, *op.Content)
		}
		ap.emit(Effect{Kind: OpSetContent, BlockID: b.ID, Content: *op.Content, Version: b.Version + 1})
		return Result{Status: StatusApplied, Version: b.Version}

	case OpSetProps:
		b, ok := d.Blocks[op.BlockID]
		if !ok || b.Deleted {
			return rejected(op, "missing")
		}
		if op.Patch == nil {
			return rejected(op, "no_patch")
		}
		typ, props := b.Type, b.Props
		if p := op.Patch; p != nil {
			if p.Type != nil && *p.Type != "" && len(*p.Type) <= maxTypeLength {
				typ = *p.Type
			}
			if p.Checked != nil {
				props.Checked = *p.Checked
			}
			if p.Collapsed != nil {
				props.Collapsed = *p.Collapsed
			}
			if p.Lang != nil {
				props.Lang = *p.Lang
			}
			if p.ClearConflict != nil && *p.ClearConflict {
				props.ConflictOf, props.ConflictAuthor = "", ""
			}
		}
		if typ != b.Type || props != b.Props {
			ap.emit(Effect{Kind: OpSetProps, BlockID: b.ID, Type: typ, Props: &props})
		}
		return Result{Status: StatusApplied}

	case OpMove:
		b, ok := d.Blocks[op.BlockID]
		if !ok || b.Deleted {
			return rejected(op, "missing")
		}
		if ap.foreignLease(b.ID) {
			return rejected(op, "locked")
		}
		parent := ""
		if op.ParentID != nil {
			parent = *op.ParentID
		}
		if parent != "" {
			p, ok := d.Blocks[parent]
			if !ok || p.Deleted {
				return rejected(op, "parent_missing")
			}
			if d.isAncestor(b.ID, parent) {
				return rejected(op, "cycle")
			}
		}
		if !ValidOrderKey(op.OrderKey) {
			return rejected(op, "invalid_order_key")
		}
		if parent != b.ParentID || op.OrderKey != b.OrderKey {
			ap.emit(Effect{Kind: OpMove, BlockID: b.ID, ParentID: parent, OrderKey: op.OrderKey})
		}
		return Result{Status: StatusApplied}

	case OpDelete:
		b, ok := d.Blocks[op.BlockID]
		if !ok {
			return rejected(op, "missing")
		}
		if b.Deleted {
			return Result{Status: StatusApplied}
		}
		ids := d.subtree(b.ID, true)
		for _, id := range ids {
			if ap.foreignLease(id) {
				return rejected(op, "locked")
			}
		}
		ap.emit(Effect{Kind: OpDelete, IDs: ids})
		return Result{Status: StatusApplied}

	case OpRestore:
		ids := make([]string, 0, len(op.IDs))
		for _, id := range op.IDs {
			if b, ok := d.Blocks[id]; ok && b.Deleted {
				ids = append(ids, id)
			}
		}
		if len(ids) > 0 {
			ap.restore(ids)
		}
		return Result{Status: StatusApplied}

	case OpSetTitle:
		if op.Title == nil {
			return rejected(op, "no_title")
		}
		if len(*op.Title) > 1000 {
			return rejected(op, "too_long")
		}
		if *op.Title == d.Title {
			return Result{Status: StatusApplied, Version: d.TitleVersion}
		}
		if op.BaseVersion != d.TitleVersion {
			return ap.titleConflict(op, *op.Title)
		}
		ap.emit(Effect{Kind: OpSetTitle, Title: *op.Title, TitleVersion: d.TitleVersion + 1})
		return Result{Status: StatusApplied, Version: d.TitleVersion}
	}
	return rejected(op, "unknown_kind")
}

// restore brings back deleted blocks; blocks whose parent stays deleted move to the nearest live ancestor.
func (ap *applier) restore(ids []string) {
	d := ap.d
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	sorted := append([]string(nil), ids...)
	sort.Strings(sorted)
	ap.emit(Effect{Kind: OpRestore, IDs: sorted})
	for _, id := range sorted {
		b := d.Blocks[id]
		if b.ParentID == "" || set[b.ParentID] {
			continue
		}
		if p, ok := d.Blocks[b.ParentID]; ok && !p.Deleted {
			continue
		}
		ap.emit(Effect{Kind: OpMove, BlockID: b.ID, ParentID: d.liveAncestor(b.ParentID), OrderKey: b.OrderKey})
	}
}

// reviveAsNewBlock handles text for a block that no longer exists (its tombstone was purged after the
// retention period, e.g. a device was offline for weeks): the text becomes a new block at the end.
func (ap *applier) reviveAsNewBlock(op Op) Result {
	if op.Content == nil || *op.Content == "" || op.BlockID == "" || len(op.BlockID) > 64 {
		return rejected(op, "missing")
	}
	if ap.env.IDTaken != nil && ap.env.IDTaken(op.BlockID) {
		return rejected(op, "missing")
	}
	if len(*op.Content) > maxContentLength {
		return rejected(op, "too_long")
	}
	last := ""
	if roots := ap.d.Children(""); len(roots) > 0 {
		last = roots[len(roots)-1].OrderKey
	}
	key, err := KeyBetween(last, "")
	if err != nil {
		return rejected(op, "missing")
	}
	ap.emit(Effect{Kind: OpInsert, BlockID: op.BlockID, OrderKey: key, Type: "bullet", Content: *op.Content, Props: &Props{}, Version: 1})
	return Result{Status: StatusApplied, Version: 1, Reason: "revived"}
}

// Purge removes tombstones for good. Only blocks whose whole deleted subtree is purged too may go, so no
// remaining block refers to a missing parent. Returns the effect (nil if nothing to purge).
func Purge(d *Doc, candidates []string) *Effect {
	set := make(map[string]bool, len(candidates))
	for _, id := range candidates {
		if b, ok := d.Blocks[id]; ok && b.Deleted {
			set[id] = true
		}
	}
	for changed := true; changed; {
		changed = false
		for _, b := range d.Blocks {
			if !set[b.ID] && set[b.ParentID] {
				delete(set, b.ParentID) // a remaining block still points to it
				changed = true
			}
		}
	}
	if len(set) == 0 {
		return nil
	}
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	e := Effect{Kind: OpPurge, IDs: ids}
	d.ApplyEffect(e)
	return &e
}

// conflictCopy keeps the losing text as a new block directly below the contested one.
func (ap *applier) conflictCopy(op Op, b *Block, content string) Result {
	id := ConflictBlockID(op.OpID)
	if _, exists := ap.d.Blocks[id]; !exists {
		props := Props{ConflictOf: b.ID, ConflictAuthor: ap.a.Name}
		ap.emit(Effect{Kind: OpInsert, BlockID: id, ParentID: b.ParentID, OrderKey: ap.d.keyAfter(b), Type: b.Type, Content: content, Props: &props, Version: 1})
	}
	return Result{Status: StatusConflict, Version: b.Version, ConflictBlockID: id}
}

// titleConflict keeps a losing title as a conflict block at the very top of the note.
func (ap *applier) titleConflict(op Op, title string) Result {
	id := ConflictBlockID(op.OpID)
	if _, exists := ap.d.Blocks[id]; !exists {
		first := ""
		if roots := ap.d.Children(""); len(roots) > 0 {
			first = roots[0].OrderKey
		}
		key, err := KeyBetween("", first)
		if err != nil {
			key, _ = KeyBetween("", "")
		}
		props := Props{ConflictOf: "title", ConflictAuthor: ap.a.Name}
		ap.emit(Effect{Kind: OpInsert, BlockID: id, OrderKey: key, Type: "text", Content: title, Props: &props, Version: 1})
	}
	return Result{Status: StatusConflict, Version: ap.d.TitleVersion, ConflictBlockID: id}
}
