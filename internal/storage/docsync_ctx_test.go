package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
)

// Opening a note must not wait for the note's write lock (load test 2026-11-05: 24 s to open a note
// with 800 people typing in it).
func TestDocSnapshotDoesNotWaitForWriters(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "", "", flatBlocks([3]interface{}{"a", 0, "eins"}), nil, false)

	unlock := lockDoc(doc.ID) // a writer holds the note
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	snap, err := s.GetDocSnapshotCtx(ctx, doc.ID)
	if err != nil || len(snap.Blocks) == 0 {
		t.Fatalf("snapshot while the note is locked: %v, %+v", err, snap)
	}
	if _, _, err := s.GetDocOpsSinceCtx(ctx, doc.ID, 0, 10); err != nil {
		t.Fatalf("log while the note is locked: %v", err)
	}
}

// A request whose client has gone stops waiting for the note instead of being worked off later.
func TestApplyDocOpsGivesUpWhenTheRequestEnds(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "", "", flatBlocks([3]interface{}{"a", 0, "eins"}), nil, false)
	unlock := lockDoc(doc.ID)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	text := "zwei"
	op := collab.Op{OpID: "op-1", Kind: collab.OpSetContent, BlockID: "a", BaseVersion: 1, Content: &text}
	_, _, err := s.ApplyDocOpsCtx(ctx, doc.ID, collab.Actor{UserID: u.ID, ClientID: "c1"}, []collab.Op{op}, nil)
	unlock()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want the context's error, got %v", err)
	}
	// Nothing applied; resending later works and is applied once
	res, _, err := s.ApplyDocOps(doc.ID, collab.Actor{UserID: u.ID, ClientID: "c1"}, []collab.Op{op}, nil)
	if err != nil || len(res) != 1 || res[0].Status != collab.StatusApplied {
		t.Fatalf("resend after giving up: %v, %+v", err, res)
	}
}

// A note deleted while someone syncs: "not found" (404 in the API), not a server error.
func TestDocSyncOnMissingNoteIsNotFound(t *testing.T) {
	s, u := newSyncTestStore(t)
	text := "x"
	op := collab.Op{OpID: "op-1", Kind: collab.OpSetContent, BlockID: "a", BaseVersion: 1, Content: &text}
	if _, _, err := s.ApplyDocOpsCtx(context.Background(), "doc_gone", collab.Actor{UserID: u.ID, ClientID: "c1"}, []collab.Op{op}, nil); !errors.Is(err, ErrDocNotFound) {
		t.Errorf("apply: want ErrDocNotFound, got %v", err)
	}
	if _, _, err := s.GetDocOpsSinceCtx(context.Background(), "doc_gone", 0, 10); !errors.Is(err, ErrDocNotFound) {
		t.Errorf("log: want ErrDocNotFound, got %v", err)
	}
	if _, err := s.GetDocSnapshotCtx(context.Background(), "doc_gone"); !errors.Is(err, ErrDocNotFound) {
		t.Errorf("snapshot: want ErrDocNotFound, got %v", err)
	}
}
