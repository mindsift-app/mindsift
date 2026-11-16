package storage

import (
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// TestTagsSeeEveryKindOfShare: the hashtag overview and the hashtag page show the hashtags of the notes
// the person can see, shared in every way the note list knows (directly, through a team, through a
// shared folder shared with them or with their team, in their own shared folder), and none of notes
// that are not shared with them or are in the trash.
func TestTagsSeeEveryKindOfShare(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "tags.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	openSharing(t, store)

	user := func(name string) *domain.User {
		u, err := store.CreateUser(name+"@example.com", "h", name, "member")
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	me, direct, viaTeam, folderOwner, teamFolderOwner, inMyFolder, stranger :=
		user("ich"), user("direkt"), user("team"), user("ordner"), user("teamordner"), user("gast"), user("fremd")

	team, _ := store.CreateTeam("", "Team", "")
	team2, _ := store.CreateTeam("", "Team 2", "")
	for _, m := range []struct{ team, user string }{
		{team.ID, me.ID}, {team.ID, viaTeam.ID}, {team2.ID, me.ID}, {team2.ID, viaTeam.ID}, {team.ID, teamFolderOwner.ID},
	} {
		if err := store.AddTeamMember(m.team, m.user, "member"); err != nil {
			t.Fatal(err)
		}
	}

	note := func(owner *domain.User, title, folder string, contents ...string) *domain.Document {
		blocks := make([]domain.DocumentBlock, len(contents))
		for i, c := range contents {
			blocks[i] = domain.DocumentBlock{ID: domain.NewID("blk"), Type: "bullet", Content: c}
		}
		d, err := store.CreateDocument(owner.ID, "", title, "", folder, blocks, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	must := func(_ any, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}

	// Own note: two tagged bullets, one with a second hashtag
	own := note(me, "Eigen", "", "Erster #gemeinsam", "Zweiter #gemeinsam #eigen")
	ownTrashed := note(me, "Eigen weg", "", "Im Papierkorb #gemeinsam #papierkorb")
	if err := store.DeleteDocument(me.ID, ownTrashed.ID); err != nil {
		t.Fatal(err)
	}

	// Directly with write access
	d1 := note(direct, "Direkt", "", "Direkt geteilt #gemeinsam #direkt")
	must(store.CreateDocShare(direct.ID, d1.ID, me.ID, "write"))
	// Directly, then in the trash of its owner
	d1Trashed := note(direct, "Direkt weg", "", "Weg #gemeinsam #papierkorb")
	must(store.CreateDocShare(direct.ID, d1Trashed.ID, me.ID, "write"))
	if err := store.DeleteDocument(direct.ID, d1Trashed.ID); err != nil {
		t.Fatal(err)
	}

	// Through a team, read only; a second note through two of the person's teams (counted once)
	d2 := note(viaTeam, "Team", "", "Über das Team #gemeinsam #team")
	must(store.CreateDocTeamShare(viaTeam.ID, d2.ID, team.ID, "read"))
	d2b := note(viaTeam, "Zwei Teams", "", "Über zwei Teams #gemeinsam #team")
	must(store.CreateDocTeamShare(viaTeam.ID, d2b.ID, team.ID, "read"))
	must(store.CreateDocTeamShare(viaTeam.ID, d2b.ID, team2.ID, "write")) // read through one team, write through the other: write wins

	// In a shared folder shared with the person, read only
	sf, err := store.CreateSharedFolder(folderOwner.ID, "Geteilt", "Geteilt")
	if err != nil {
		t.Fatal(err)
	}
	must(store.CreateFolderShare(folderOwner.ID, sf.ID, "user", me.ID, "read"))
	d3 := note(folderOwner, "Im Ordner", "Geteilt", "Im geteilten Ordner #gemeinsam #ordner")

	// In a shared folder shared with the person's team, with write access
	tf, err := store.CreateSharedFolder(teamFolderOwner.ID, "Teamordner", "Teamordner")
	if err != nil {
		t.Fatal(err)
	}
	must(store.CreateFolderShare(teamFolderOwner.ID, tf.ID, "team", team.ID, "write"))
	d4 := note(teamFolderOwner, "Im Teamordner", "Teamordner", "Im Teamordner #gemeinsam #teamordner")

	// In the person's own shared folder, a note of someone they shared it with
	mf, err := store.CreateSharedFolder(me.ID, "Meins", "Meins")
	if err != nil {
		t.Fatal(err)
	}
	must(store.CreateFolderShare(me.ID, mf.ID, "user", inMyFolder.ID, "write"))
	d5 := note(inMyFolder, "Im eigenen Ordner", "Meins", "Von einem Gast #gemeinsam #gast")
	if d5.SharedFolderID != mf.ID {
		t.Fatalf("guest's note is not in the shared folder: %+v", d5)
	}

	// Not shared at all
	note(stranger, "Fremd", "", "Nicht geteilt #gemeinsam #fremd")

	tags, err := store.GetWorkspaceTags(me.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, tg := range tags {
		got[tg.Tag] = tg.Count
	}
	want := map[string]int{"gemeinsam": 8, "team": 2, "eigen": 1, "direkt": 1, "ordner": 1, "teamordner": 1, "gast": 1}
	if len(got) != len(want) {
		t.Fatalf("tags = %v, want %v", got, want)
	}
	for tag, n := range want {
		if got[tag] != n {
			t.Fatalf("tags = %v, want %v", got, want)
		}
	}
	if tags[0].Tag != "gemeinsam" || tags[1].Tag != "team" {
		t.Fatalf("tags not by count: %v", tags)
	}

	// The notes per hashtag (for the sidebar's filter): the same notes as the counts, each once, sorted,
	// none in the trash and none not shared
	docsOf := map[string][]string{}
	for _, tg := range tags {
		docsOf[tg.Tag] = tg.DocIDs
	}
	sortedIDs := func(ids ...string) []string {
		sort.Strings(ids)
		return ids
	}
	wantDocs := map[string][]string{
		"gemeinsam":  sortedIDs(own.ID, d1.ID, d2.ID, d2b.ID, d3.ID, d4.ID, d5.ID),
		"team":       sortedIDs(d2.ID, d2b.ID),
		"eigen":      {own.ID},
		"direkt":     {d1.ID},
		"ordner":     {d3.ID},
		"teamordner": {d4.ID},
		"gast":       {d5.ID},
	}
	for tag, ids := range wantDocs {
		if strings.Join(docsOf[tag], ",") != strings.Join(ids, ",") {
			t.Fatalf("notes of #%s = %v, want %v", tag, docsOf[tag], ids)
		}
	}

	details, err := store.GetTagDetails(me.ID, "#gemeinsam")
	if err != nil {
		t.Fatal(err)
	}
	if details.TotalMatches != 8 {
		t.Fatalf("TotalMatches = %d, want 8", details.TotalMatches)
	}
	perm := map[string]string{}
	var ids []string
	for _, g := range details.Documents {
		perm[g.DocID] = g.Permission
		ids = append(ids, g.DocID)
		if g.DocID == own.ID && len(g.MatchedBlocks) != 2 {
			t.Fatalf("own note has %d matched bullets, want 2", len(g.MatchedBlocks))
		}
	}
	wantIDs := []string{own.ID, d1.ID, d2.ID, d2b.ID, d3.ID, d4.ID, d5.ID}
	sort.Strings(ids)
	sort.Strings(wantIDs)
	if len(ids) != len(wantIDs) {
		t.Fatalf("notes on the page = %v, want %v", ids, wantIDs)
	}
	for i := range ids {
		if ids[i] != wantIDs[i] {
			t.Fatalf("notes on the page = %v, want %v", ids, wantIDs)
		}
	}
	for id, p := range map[string]string{own.ID: "owner", d1.ID: "write", d2.ID: "read", d2b.ID: "write", d3.ID: "read", d4.ID: "write", d5.ID: "write"} {
		if perm[id] != p {
			t.Fatalf("permission of %s = %q, want %q (%v)", id, perm[id], p, perm)
		}
	}

	// Nothing of other people's notes for someone with no shares
	strangerTags, err := store.GetWorkspaceTags(stranger.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(strangerTags) != 2 {
		t.Fatalf("stranger's tags = %v, want only gemeinsam and fremd", strangerTags)
	}
	empty, err := store.GetTagDetails(stranger.ID, "team")
	if err != nil {
		t.Fatal(err)
	}
	if len(empty.Documents) != 0 || empty.TotalMatches != 0 {
		t.Fatalf("stranger sees %+v", empty)
	}
}

// TestTagPageNestedTaggedBullets: a tagged bullet below another tagged one is shown under it on the
// hashtag page, whatever order the index gives their ids in.
func TestTagPageNestedTaggedBullets(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "tags.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	me, _ := store.CreateUser("ich@example.com", "h", "Ich", "member")
	blocks := []domain.DocumentBlock{
		{ID: "blk_zz", Type: "bullet", Content: "Oben #thema"},
		{ID: "blk_aa", Type: "bullet", Content: "Darunter #thema", Level: 1},
		{ID: "blk_mm", Type: "bullet", Content: "Daneben #thema"},
	}
	if _, err := store.CreateDocument(me.ID, "", "Notiz", "", "", blocks, nil, false); err != nil {
		t.Fatal(err)
	}
	details, err := store.GetTagDetails(me.ID, "thema")
	if err != nil {
		t.Fatal(err)
	}
	if len(details.Documents) != 1 {
		t.Fatalf("documents = %+v", details.Documents)
	}
	mb := details.Documents[0].MatchedBlocks
	if len(mb) != 2 || mb[0].RootBlock.ID != "blk_zz" || len(mb[0].Children) != 1 || mb[0].Children[0].ID != "blk_aa" || mb[1].RootBlock.ID != "blk_mm" {
		t.Fatalf("matched bullets = %+v", mb)
	}
	if details.TotalMatches != 2 {
		t.Fatalf("TotalMatches = %d, want 2", details.TotalMatches)
	}
}
