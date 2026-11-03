// Package collab contains the database-independent core of collaborative note editing: the block tree,
// operations with their conflict rules, block leases and change notification. The same rules run on the
// server for every incoming operation; clients replay the resulting effects to stay in sync.
package collab

import (
	"fmt"
	"sort"
)

// Props are per-block settings that change independently of the text.
type Props struct {
	Checked        bool   `json:"checked,omitempty"`
	Collapsed      bool   `json:"collapsed,omitempty"`
	Lang           string `json:"lang,omitempty"`
	ConflictOf     string `json:"conflictOf,omitempty"`     // ID of the block (or "title") this conflict copy belongs to
	ConflictAuthor string `json:"conflictAuthor,omitempty"` // display name of the author whose text lost
}

type Block struct {
	ID        string `json:"id"`
	ParentID  string `json:"parentId"` // "" = top level
	OrderKey  string `json:"orderKey"`
	Type      string `json:"type"`
	Content   string `json:"content"`
	Props     Props  `json:"props"`
	Version   int    `json:"version"` // content version; props changes do not bump it
	Deleted   bool   `json:"deleted,omitempty"`
	UpdatedBy string `json:"updatedBy,omitempty"`
}

// Doc is the complete state of one note including deleted blocks (tombstones).
type Doc struct {
	Title        string
	TitleVersion int
	Blocks       map[string]*Block
}

func NewDoc() *Doc {
	return &Doc{Blocks: make(map[string]*Block)}
}

func (d *Doc) Clone() *Doc {
	c := &Doc{Title: d.Title, TitleVersion: d.TitleVersion, Blocks: make(map[string]*Block, len(d.Blocks))}
	for id, b := range d.Blocks {
		cp := *b
		c.Blocks[id] = &cp
	}
	return c
}

func siblingLess(a, b *Block) bool {
	if a.OrderKey != b.OrderKey {
		return a.OrderKey < b.OrderKey
	}
	return a.ID < b.ID
}

// Children returns the live children of parentID in display order.
func (d *Doc) Children(parentID string) []*Block {
	out := make([]*Block, 0)
	for _, b := range d.Blocks {
		if !b.Deleted && b.ParentID == parentID {
			out = append(out, b)
		}
	}
	sort.Slice(out, func(i, j int) bool { return siblingLess(out[i], out[j]) })
	return out
}

// FlatBlock is a live block with its depth, in document (depth-first) order.
type FlatBlock struct {
	*Block
	Level int
}

// Flatten returns all live blocks in display order with their nesting level.
func (d *Doc) Flatten() []FlatBlock {
	children := make(map[string][]*Block)
	for _, b := range d.Blocks {
		if !b.Deleted {
			children[b.ParentID] = append(children[b.ParentID], b)
		}
	}
	for _, list := range children {
		sort.Slice(list, func(i, j int) bool { return siblingLess(list[i], list[j]) })
	}
	out := make([]FlatBlock, 0, len(d.Blocks))
	var walk func(parent string, level int)
	walk = func(parent string, level int) {
		for _, b := range children[parent] {
			out = append(out, FlatBlock{Block: b, Level: level})
			walk(b.ID, level+1)
		}
	}
	walk("", 0)
	return out
}

// subtree returns id and all descendants; with liveOnly, deleted blocks are skipped.
func (d *Doc) subtree(id string, liveOnly bool) []string {
	children := make(map[string][]string)
	for _, b := range d.Blocks {
		if liveOnly && b.Deleted {
			continue
		}
		children[b.ParentID] = append(children[b.ParentID], b.ID)
	}
	out := []string{id}
	for i := 0; i < len(out); i++ {
		out = append(out, children[out[i]]...)
	}
	sort.Strings(out[1:])
	return out
}

// liveAncestor walks up from id until it finds a live block; "" means top level.
func (d *Doc) liveAncestor(id string) string {
	seen := map[string]bool{}
	for id != "" && !seen[id] {
		seen[id] = true
		b, ok := d.Blocks[id]
		if !ok {
			return ""
		}
		if !b.Deleted {
			return id
		}
		id = b.ParentID
	}
	return ""
}

// isAncestor reports whether ancestorID is ancestorID itself or above id in the tree.
func (d *Doc) isAncestor(ancestorID, id string) bool {
	seen := map[string]bool{}
	for id != "" && !seen[id] {
		if id == ancestorID {
			return true
		}
		seen[id] = true
		b, ok := d.Blocks[id]
		if !ok {
			return false
		}
		id = b.ParentID
	}
	return false
}

// keyAfter returns a key directly after block b among its live siblings.
func (d *Doc) keyAfter(b *Block) string {
	next := ""
	for _, s := range d.Children(b.ParentID) {
		if siblingLess(b, s) {
			next = s.OrderKey
			break
		}
	}
	if next == b.OrderKey {
		// Equal keys are only ordered by ID; append after the whole run instead
		next = ""
		for _, s := range d.Children(b.ParentID) {
			if s.OrderKey > b.OrderKey {
				next = s.OrderKey
				break
			}
		}
	}
	k, err := KeyBetween(b.OrderKey, next)
	if err != nil {
		k, _ = KeyBetween(b.OrderKey, "")
	}
	return k
}

// Validate checks the tree invariants: parents exist, live blocks have live parents, no cycles, valid keys.
func (d *Doc) Validate() error {
	for id, b := range d.Blocks {
		if b.ID != id {
			return fmt.Errorf("block %s stored under key %s", b.ID, id)
		}
		if !ValidOrderKey(b.OrderKey) {
			return fmt.Errorf("block %s has invalid order key %q", id, b.OrderKey)
		}
		if b.ParentID == "" {
			continue
		}
		p, ok := d.Blocks[b.ParentID]
		if !ok {
			return fmt.Errorf("block %s has missing parent %s", id, b.ParentID)
		}
		if !b.Deleted && p.Deleted {
			return fmt.Errorf("live block %s has deleted parent %s", id, p.ID)
		}
		if d.isAncestor(id, b.ParentID) {
			return fmt.Errorf("block %s is part of a cycle", id)
		}
	}
	return nil
}
