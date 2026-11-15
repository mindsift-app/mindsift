package storage

import "testing"

// BenchmarkTags: the hashtag overview and two hashtag pages of the person of BenchmarkDocumentList
// (136 notes they can see) on a server where 20 other people have 100 notes each, every bullet of
// those tagged #x. Run with
//
//	go test -run XXX -bench BenchmarkTags ./internal/storage/
func BenchmarkTags(b *testing.B) {
	store, me := seedListBench(b)
	b.ResetTimer()
	b.Run("overview", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.GetWorkspaceTags(me.ID); err != nil {
				b.Fatal(err)
			}
		}
	})
	// #x: 10,000 rows on the server, 80 of them in notes shared with the person
	b.Run("page_shared_tag", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.GetTagDetails(me.ID, "x"); err != nil {
				b.Fatal(err)
			}
		}
	})
	// A tag only in the person's own notes (about 300 bullets)
	b.Run("page_own_tag", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.GetTagDetails(me.ID, "projekt"); err != nil {
				b.Fatal(err)
			}
		}
	})
	// The same as before (every matching note loaded whole), for comparison
	b.Run("page_own_tag_whole_notes", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := tagDetailsReference(store, me.ID, "projekt"); err != nil {
				b.Fatal(err)
			}
		}
	})
}
