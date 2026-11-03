package collab

import "sync"

// Notifier wakes up long-poll requests waiting for changes of a document.
type Notifier struct {
	mu   sync.Mutex
	wait map[string]chan struct{}
}

func NewNotifier() *Notifier {
	return &Notifier{wait: map[string]chan struct{}{}}
}

// Changed returns a channel that is closed on the next Notify for docID.
func (n *Notifier) Changed(docID string) <-chan struct{} {
	n.mu.Lock()
	defer n.mu.Unlock()
	ch, ok := n.wait[docID]
	if !ok {
		ch = make(chan struct{})
		n.wait[docID] = ch
	}
	return ch
}

func (n *Notifier) Notify(docID string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if ch, ok := n.wait[docID]; ok {
		close(ch)
		delete(n.wait, docID)
	}
}
