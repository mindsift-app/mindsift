package storage

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestStoreLifecycle(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_mindsift.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	user, err := store.EnsureDefaultUser()
	if err != nil {
		t.Fatalf("EnsureDefaultUser failed: %v", err)
	}
	if user.ID == "" {
		t.Fatal("expected valid user ID")
	}

	// 1. Test Instant Capture
	thought, err := store.CreateThought(user.ID, "Milch und Brot kaufen #einkauf #dringend", "high", "manual", "")
	if err != nil {
		t.Fatalf("CreateThought failed: %v", err)
	}
	if thought.Status != domain.StatusInbox {
		t.Fatalf("expected status inbox, got %s", thought.Status)
	}
	if len(thought.Tags) != 2 {
		t.Fatalf("expected 2 extracted hashtags, got %d", len(thought.Tags))
	}

	// 2. Test Tinder-Style Triage -> Convert to Document
	triaged, err := store.UpdateThoughtTriage(user.ID, thought.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatalf("UpdateThoughtTriage failed: %v", err)
	}
	if triaged.Status != domain.StatusConverted || triaged.ConvertedType != "document" || triaged.ConvertedRefID == "" {
		t.Fatalf("expected converted document, got status=%s type=%s ref=%s", triaged.Status, triaged.ConvertedType, triaged.ConvertedRefID)
	}

	// 3. Test Standalone Shopping List & Sharing
	lst, err := store.CreateList(user.ID, "REWE Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatalf("CreateList failed: %v", err)
	}
	item, err := store.CreateListItem(lst.ID, "Hafermilch", "Kühlregal", "2L", 0, user.ID)
	if err != nil {
		t.Fatalf("CreateListItem failed: %v", err)
	}
	toggled, err := store.ToggleListItem(item.ID, true, user.ID, user.DisplayName)
	if err != nil || !toggled.IsCompleted {
		t.Fatalf("ToggleListItem failed: %v", err)
	}

	// Test AddListShare & RemoveListShare
	u2, err := store.CreateUser("collab_space@example.com", "hash", "Collab User", "member")
	if err != nil {
		t.Fatalf("CreateUser u2 failed: %v", err)
	}
	share, err := store.AddListShare(user.ID, lst.ID, "user", u2.ID, "editor")
	if err != nil || share.TargetID != u2.ID {
		t.Fatalf("AddListShare failed: %v", err)
	}
	shares, err := store.GetListShares(lst.ID)
	if err != nil || len(shares) != 1 {
		t.Fatalf("expected 1 share, got %d", len(shares))
	}
	err = store.RemoveListShare(user.ID, lst.ID, share.ID)
	if err != nil {
		t.Fatalf("RemoveListShare failed: %v", err)
	}
	sharesAfter, _ := store.GetListShares(lst.ID)
	if len(sharesAfter) != 0 {
		t.Fatalf("expected 0 shares after remove, got %d", len(sharesAfter))
	}

	// 4. Test Webhook API Key generation & validation
	apiKey, err := store.CreateAPIKey(user.ID, "Home Assistant", nil)
	if err != nil {
		t.Fatalf("CreateAPIKey failed: %v", err)
	}
	validatedUser, err := store.ValidateAPIKeyAndGetUser(apiKey.RawKey)
	if err != nil || validatedUser.ID != user.ID {
		t.Fatalf("ValidateAPIKeyAndGetUser failed: %v", err)
	}

	// 5. Test TaskLists CRUD
	taskList, err := store.CreateTaskList(user.ID, "", "", "Haus & Garten", "🏡", "#10b981")
	if err != nil || taskList.ID == "" {
		t.Fatalf("CreateTaskList failed: %v", err)
	}
	taskLists, err := store.GetTaskLists(user.ID)
	if err != nil || len(taskLists) == 0 {
		t.Fatalf("GetTaskLists failed: %v", err)
	}

	// 6. Test Organizations & Teams
	org, err := store.CreateOrganization("Mindsift Inc")
	if err != nil || org.ID == "" {
		t.Fatalf("CreateOrganization failed: %v", err)
	}
	team, err := store.CreateTeam(org.ID, "DevOps", "Infrastructure team")
	if err != nil || team.ID == "" {
		t.Fatalf("CreateTeam failed: %v", err)
	}
	err = store.AddTeamMember(team.ID, user.ID, "owner")
	if err != nil {
		t.Fatalf("AddTeamMember failed: %v", err)
	}

	// Test TaskList Sharing with Team
	shareTeam, err := store.AddTaskListShare(taskList.ID, "team", team.ID, "editor", user.ID)
	if err != nil || shareTeam.ID == "" {
		t.Fatalf("AddTaskListShare team failed: %v", err)
	}
	tlShares, err := store.GetTaskListShares(taskList.ID)
	if err != nil || len(tlShares) == 0 {
		t.Fatalf("GetTaskListShares failed: %v", err)
	}
	fetchedTL, err := store.GetTaskListByID(user.ID, taskList.ID)
	if err != nil || len(fetchedTL.Shares) == 0 {
		t.Fatalf("GetTaskListByID with shares failed: %v", err)
	}

	// 7. Test System Settings
	sysSettings, err := store.GetSystemSettings()
	if err != nil || sysSettings.InstanceName == "" {
		t.Fatalf("GetSystemSettings failed: %v", err)
	}
	sysSettings.SharingMode = SharingOpen
	err = store.UpdateSystemSettings(sysSettings)
	if err != nil {
		t.Fatalf("UpdateSystemSettings failed: %v", err)
	}

	// 8. Test Document Sharing & Permissions
	user2, err := store.CreateUser("collab@example.com", "hash", "Collab User", "member")
	if err != nil {
		t.Fatalf("CreateUser collab failed: %v", err)
	}

	// Test read-only TaskList share
	ownerTask, err := store.CreateThoughtWithDetails(user.ID, "Rasen mähen", "normal", "manual", "", taskList.ID, "todo", "")
	if err != nil {
		t.Fatalf("CreateThoughtWithDetails in own list failed: %v", err)
	}
	if _, err := store.UpdateThoughtTriage(user.ID, ownerTask.ID, "keep", "task", "", "", taskList.ID); err != nil {
		t.Fatalf("UpdateThoughtTriage in own list failed: %v", err)
	}
	if _, err := store.AddTaskListShare(taskList.ID, "user", user2.ID, "viewer", user.ID); err != nil {
		t.Fatalf("AddTaskListShare viewer failed: %v", err)
	}
	if perm := store.GetTaskListPermission(user2.ID, taskList.ID); perm != "viewer" {
		t.Fatalf("expected viewer permission, got %q", perm)
	}
	viewerTasks, err := store.GetTasks(user2.ID, taskList.ID)
	if err != nil || len(viewerTasks) == 0 {
		t.Fatalf("viewer should see tasks of shared list: %v", err)
	}
	done := true
	if _, err := store.UpdateThoughtDetails(user2.ID, ownerTask.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil); !errors.Is(err, ErrTaskListReadOnly) {
		t.Fatalf("viewer must not update tasks, got %v", err)
	}
	if _, err := store.CreateThoughtWithDetails(user2.ID, "Hack", "normal", "manual", "", taskList.ID, "todo", ""); !errors.Is(err, ErrTaskListReadOnly) {
		t.Fatalf("viewer must not create tasks, got %v", err)
	}
	if err := store.DeleteThought(user2.ID, ownerTask.ID); !errors.Is(err, ErrTaskListReadOnly) {
		t.Fatalf("viewer must not delete tasks, got %v", err)
	}
	newTitle := "Umbenannt"
	if _, err := store.UpdateTaskList(user2.ID, taskList.ID, &newTitle, nil, nil, nil, nil); !errors.Is(err, ErrTaskListReadOnly) {
		t.Fatalf("viewer must not update task list, got %v", err)
	}
	if _, err := store.AddTaskListShare(taskList.ID, "user", user2.ID, "editor", user.ID); err != nil {
		t.Fatalf("upgrading share to editor failed: %v", err)
	}
	if !store.CanEditTaskList(user2.ID, taskList.ID) {
		t.Fatalf("editor share should allow editing")
	}
	newDoc, err := store.CreateDocument(user.ID, "", "Test Note", "🗒️", "", []domain.DocumentBlock{
		{ID: "blk_1", Type: "bullet", Content: "Geheim", Level: 0},
	}, []string{"test"}, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	// Share with user2 as "read"
	docShare, err := store.CreateDocShare(user.ID, newDoc.ID, user2.ID, "read")
	if err != nil || docShare.Permission != "read" {
		t.Fatalf("CreateDocShare failed: %v", err)
	}

	// user2 can get document
	docForUser2, err := store.GetDocumentByID(user2.ID, newDoc.ID)
	if err != nil || docForUser2.Permission != "read" || docForUser2.IsOwner {
		t.Fatalf("GetDocumentByID for user2 failed or wrong permission: %v", err)
	}

	// user2 tries to edit read-only doc -> must fail
	updatedTitle := "Hacked Title"
	_, err = store.UpdateDocument(user2.ID, newDoc.ID, &updatedTitle, nil, nil, nil)
	if err == nil {
		t.Fatalf("expected UpdateDocument to fail for read-only user, but succeeded")
	}

	// user2 is a read-only collaborator -> editing must fail
	_, err = store.UpdateDocument(user2.ID, newDoc.ID, &updatedTitle, nil, nil, nil)
	if err == nil {
		t.Fatalf("expected UpdateDocument to fail for read-only collaborator, but succeeded")
	}

	// Remove share
	err = store.DeleteDocShare(user.ID, newDoc.ID, user2.ID)
	if err != nil {
		t.Fatalf("DeleteDocShare failed: %v", err)
	}
	_, err = store.GetDocumentByID(user2.ID, newDoc.ID)
	if err == nil {
		t.Fatalf("expected GetDocumentByID to fail after share removed, but succeeded")
	}
}

func TestPerUserDocPinning(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "pin_test.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	user1, _ := store.CreateUser("user1@example.com", "hash", "User 1", "admin")
	user2, _ := store.CreateUser("user2@example.com", "hash", "User 2", "member")

	// user1 creates document and pins it
	doc, err := store.CreateDocument(user1.ID, "", "Doc 1", "📝", "", []domain.DocumentBlock{
		{ID: "b1", Type: "text", Content: "Hello"},
	}, []string{"test"}, true)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}
	if !doc.IsPinned {
		t.Fatalf("expected doc to be pinned for user1")
	}

	// Share with user2 as read-only
	_, err = store.CreateDocShare(user1.ID, doc.ID, user2.ID, "read")
	if err != nil {
		t.Fatalf("CreateDocShare failed: %v", err)
	}

	// user2 reads document: should NOT be pinned for user2
	docForUser2, err := store.GetDocumentByID(user2.ID, doc.ID)
	if err != nil {
		t.Fatalf("GetDocumentByID user2 failed: %v", err)
	}
	if docForUser2.IsPinned {
		t.Fatalf("expected doc to NOT be pinned for user2 initially")
	}

	// user2 pins the shared document (even with read-only access)
	pinTrue := true
	updatedDoc2, err := store.UpdateDocument(user2.ID, doc.ID, nil, nil, nil, &pinTrue)
	if err != nil {
		t.Fatalf("user2 pinning read-only doc failed: %v", err)
	}
	if !updatedDoc2.IsPinned {
		t.Fatalf("expected doc to be pinned for user2")
	}

	// Verify user1's doc is still pinned
	docForUser1, err := store.GetDocumentByID(user1.ID, doc.ID)
	if err != nil {
		t.Fatalf("GetDocumentByID user1 failed: %v", err)
	}
	if !docForUser1.IsPinned {
		t.Fatalf("expected doc to still be pinned for user1")
	}

	// user1 unpins the doc
	pinFalse := false
	_, err = store.UpdateDocument(user1.ID, doc.ID, nil, nil, nil, &pinFalse)
	if err != nil {
		t.Fatalf("user1 unpinning doc failed: %v", err)
	}

	// user1 doc is now unpinned, but user2 doc must STILL be pinned!
	docForUser1, _ = store.GetDocumentByID(user1.ID, doc.ID)
	if docForUser1.IsPinned {
		t.Fatalf("expected doc to be unpinned for user1")
	}
	docForUser2, _ = store.GetDocumentByID(user2.ID, doc.ID)
	if !docForUser2.IsPinned {
		t.Fatalf("expected doc to remain pinned for user2")
	}
}

func TestEnsureDemoAccountsAndLoginLookup(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "demo_test.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	if err := store.EnsureDemoAccounts(); err != nil {
		t.Fatalf("EnsureDemoAccounts failed: %v", err)
	}

	// 1. Lookup by username "admin"
	adminUser, err := store.GetUserByLogin("admin")
	if err != nil || adminUser == nil {
		t.Fatalf("expected to find admin user by username 'admin', got %v", err)
	}
	if adminUser.Role != "admin" {
		t.Fatalf("expected role 'admin', got %s", adminUser.Role)
	}
	if !auth.CheckPassword("admin", adminUser.PasswordHash) {
		t.Fatalf("admin password check failed")
	}

	// 2. Lookup by email "admin@mindsift.local"
	adminByEmail, err := store.GetUserByLogin("admin@mindsift.local")
	if err != nil || adminByEmail.ID != adminUser.ID {
		t.Fatalf("lookup by email failed: got %v", err)
	}

	// 3. Lookup with case insensitivity "ADMIN"
	adminCaps, err := store.GetUserByLogin("ADMIN")
	if err != nil || adminCaps.ID != adminUser.ID {
		t.Fatalf("lookup by uppercase failed: got %v", err)
	}

	// 4. Lookup by username "user"
	normalUser, err := store.GetUserByLogin("user")
	if err != nil || normalUser == nil {
		t.Fatalf("expected to find user by username 'user', got %v", err)
	}
	if normalUser.Role != "member" {
		t.Fatalf("expected role 'member', got %s", normalUser.Role)
	}
	if !auth.CheckPassword("user", normalUser.PasswordHash) {
		t.Fatalf("user password check failed")
	}

	// 5. Ensure re-running is idempotent and preserves/refreshes credentials
	if err := store.EnsureDemoAccounts(); err != nil {
		t.Fatalf("second EnsureDemoAccounts call failed: %v", err)
	}
}

func TestFolderManagementAndDeletion(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "folder_test.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	user, err := store.CreateUser("folderuser@example.com", "hash", "Folder User", "member")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// 1. Create folders
	f1, err := store.CreateFolder(user.ID, "Projekte/MindSift")
	if err != nil || f1 != "Projekte/MindSift" {
		t.Fatalf("CreateFolder failed: %v, f1=%s", err, f1)
	}
	f2, err := store.CreateFolder(user.ID, "Archiv")
	if err != nil || f2 != "Archiv" {
		t.Fatalf("CreateFolder Archiv failed: %v", err)
	}

	// 2. Create document in subfolder
	doc1, err := store.CreateDocument(user.ID, "", "Doc in MindSift", "🗒️", "Projekte/MindSift", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}
	doc2, err := store.CreateDocument(user.ID, "", "SubDoc", "📝", "Projekte/MindSift/Sub", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument 2 failed: %v", err)
	}

	// 3. GetFolders
	folders, err := store.GetFolders(user.ID)
	if err != nil {
		t.Fatalf("GetFolders failed: %v", err)
	}
	expected := map[string]bool{
		"Archiv":                true,
		"Projekte":              true,
		"Projekte/MindSift":     true,
		"Projekte/MindSift/Sub": true,
	}
	for _, f := range folders {
		delete(expected, f)
	}
	if len(expected) > 0 {
		t.Fatalf("GetFolders missing expected folders: %v (got %v)", expected, folders)
	}

	// 4. DeleteFolder "Projekte/MindSift" -> should remove doc1 & doc2
	deletedDocs, err := store.DeleteFolder(user.ID, "Projekte/MindSift")
	if err != nil {
		t.Fatalf("DeleteFolder failed: %v", err)
	}
	if len(deletedDocs) != 2 {
		t.Fatalf("expected 2 deleted docs, got %d (%v)", len(deletedDocs), deletedDocs)
	}

	// The folder is in the trash with both notes, which are no longer in the tree
	trash, _ := store.GetTrash(user.ID)
	if len(trash) != 1 || trash[0].Kind != "folder" || trash[0].NoteCount != 2 {
		t.Fatalf("expected the folder with doc1 and doc2 in the trash, got %v", trash)
	}
	docs, _ := store.GetDocuments(user.ID)
	for _, d := range docs {
		if d.ID == doc1.ID || d.ID == doc2.ID {
			t.Fatalf("trashed note %s still in the tree", d.ID)
		}
	}
}

func TestWorkspaceBlockHashtagsAndDetails(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "tags_test.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	user, err := store.CreateUser("taguser@example.com", "hash", "Tag User", "member")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Create document with nested bullet points and hashtags
	blocks := []domain.DocumentBlock{
		{ID: "b0", Type: "bullet", Content: "Einleitung ohne Tag", Level: 0},
		{ID: "b1", Type: "bullet", Content: "Einkauf planen #Kühlregal #Wocheneinkauf", Level: 0},
		{ID: "b2", Type: "bullet", Content: "Milch 3.8%", Level: 1},
		{ID: "b3", Type: "bullet", Content: "Gouda alt", Level: 1},
		{ID: "b4", Type: "bullet", Content: "Zusatzinfo: Aus Weidemilch", Level: 2},
		{ID: "b5", Type: "bullet", Content: "Anderes Thema ohne Bezug", Level: 0},
	}

	doc, err := store.CreateDocument(user.ID, "", "Einkaufszettel", "🛒", "Haushalt", blocks, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	// 1. Check GetWorkspaceTags
	tags, err := store.GetWorkspaceTags(user.ID)
	if err != nil {
		t.Fatalf("GetWorkspaceTags failed: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d (%v)", len(tags), tags)
	}
	tagMap := make(map[string]int)
	for _, tg := range tags {
		tagMap[tg.Tag] = tg.Count
	}
	if tagMap["kühlregal"] != 1 || tagMap["wocheneinkauf"] != 1 {
		t.Fatalf("unexpected tag counts: %v", tagMap)
	}

	// 2. Check GetTagDetails for #Kühlregal
	details, err := store.GetTagDetails(user.ID, "#Kühlregal")
	if err != nil {
		t.Fatalf("GetTagDetails failed: %v", err)
	}
	if details.Tag != "kühlregal" {
		t.Fatalf("expected tag 'kühlregal', got %s", details.Tag)
	}
	if details.TotalMatches != 1 {
		t.Fatalf("expected 1 match, got %d", details.TotalMatches)
	}
	if len(details.Documents) != 1 {
		t.Fatalf("expected 1 document, got %d", len(details.Documents))
	}
	docGroup := details.Documents[0]
	if docGroup.DocID != doc.ID || docGroup.Title != "Einkaufszettel" {
		t.Fatalf("unexpected doc group: %+v", docGroup)
	}
	if len(docGroup.MatchedBlocks) != 1 {
		t.Fatalf("expected 1 matched block, got %d", len(docGroup.MatchedBlocks))
	}
	matched := docGroup.MatchedBlocks[0]
	if matched.RootBlock.ID != "b1" {
		t.Fatalf("expected root block b1, got %s", matched.RootBlock.ID)
	}
	// Children should be b2, b3, b4 (all subsequent blocks with Level > 0 until b5 where Level == 0)
	if len(matched.Children) != 3 {
		t.Fatalf("expected 3 children (b2, b3, b4), got %d (%v)", len(matched.Children), matched.Children)
	}
	if matched.Children[0].ID != "b2" || matched.Children[1].ID != "b3" || matched.Children[2].ID != "b4" {
		t.Fatalf("unexpected children IDs: %v", matched.Children)
	}

	// 3. Update document: remove #Wocheneinkauf, add #Vorrat
	updatedBlocks := []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Einkauf planen #Kühlregal #Vorrat", Level: 0},
	}
	store.replaceDocBlocksInDB(doc.ID, user.ID, updatedBlocks, "")

	tagsAfter, err := store.GetWorkspaceTags(user.ID)
	if err != nil {
		t.Fatalf("GetWorkspaceTags after update failed: %v", err)
	}
	tagMapAfter := make(map[string]int)
	for _, tg := range tagsAfter {
		tagMapAfter[tg.Tag] = tg.Count
	}
	if tagMapAfter["wocheneinkauf"] != 0 {
		t.Fatalf("expected wocheneinkauf to be removed, got %v", tagMapAfter)
	}
	if tagMapAfter["vorrat"] != 1 || tagMapAfter["kühlregal"] != 1 {
		t.Fatalf("expected vorrat and kühlregal, got %v", tagMapAfter)
	}
}

func TestDatabaseFirstWorkspaceArchitecture(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_db_first.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	userA, err := store.EnsureDefaultUser()
	if err != nil {
		t.Fatalf("EnsureDefaultUser failed: %v", err)
	}
	userB, err := store.CreateUser("userb@example.com", "hash", "User B", "member")
	if err != nil {
		t.Fatalf("CreateUser userB failed: %v", err)
	}

	// 1. Create a document in User A's folder "Privat" and share with User B (write)
	initialBlocks := []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Zeile 1 Original", Level: 0},
		{ID: "b2", Type: "bullet", Content: "Zeile 2 Original", Level: 0},
	}
	doc, err := store.CreateDocument(userA.ID, "", "Gemeinsame Notiz", "📝", "Privat", initialBlocks, []string{"folder:Privat", "notiz"}, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}
	// Verify folder:* tag was stripped
	for _, tg := range doc.Tags {
		if tg == "folder:Privat" {
			t.Fatalf("expected folder:* tag to be stripped, got tags: %v", doc.Tags)
		}
	}

	_, err = store.CreateDocShare(userA.ID, doc.ID, userB.ID, "read")
	if err != nil {
		t.Fatalf("CreateDocShare failed: %v", err)
	}

	// User B moves the individually shared note into "Arbeit/Eingang"
	_, err = store.MoveDocument(userB.ID, doc.ID, "Arbeit/Eingang")
	if err != nil {
		t.Fatalf("MoveDocument by userB failed: %v", err)
	}

	// User A edits b1 and adds b4 through the operation log; blocks A did not touch stay
	editedB1, newB4, top := "Zeile 1 von A bearbeitet", "Zeile 4 neu von A", ""
	res, _, err := store.ApplyDocOps(doc.ID, collab.Actor{UserID: userA.ID, ClientID: "tab-a"}, []collab.Op{
		{OpID: "a-b1", Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: 1, Content: &editedB1},
		{OpID: "a-b4", Kind: collab.OpInsert, BlockID: "b4", ParentID: &top, OrderKey: "a9", Content: &newB4},
	}, nil)
	if err != nil || res[0].Status != collab.StatusApplied || res[1].Status != collab.StatusApplied {
		t.Fatalf("ApplyDocOps by userA failed: %+v %v", res, err)
	}
	patchedDocA, _ := store.GetDocumentByID(userA.ID, doc.ID)
	blockContent := make(map[string]string)
	for _, b := range patchedDocA.Blocks {
		blockContent[b.ID] = b.Content
	}
	if blockContent["b1"] != editedB1 || blockContent["b4"] != newB4 || blockContent["b2"] == "" {
		t.Fatalf("unexpected blocks after edit: %+v", blockContent)
	}

	// Verify folder independence: User A still sees "Privat", User B still sees "Arbeit/Eingang"
	docForA, err := store.GetDocumentByID(userA.ID, doc.ID)
	if err != nil || docForA.FolderPath != "Privat" {
		t.Fatalf("expected User A FolderPath 'Privat', got %q (err=%v)", docForA.FolderPath, err)
	}
	docForB, err := store.GetDocumentByID(userB.ID, doc.ID)
	if err != nil || docForB.FolderPath != "Arbeit/Eingang" {
		t.Fatalf("expected User B FolderPath 'Arbeit/Eingang', got %q (err=%v)", docForB.FolderPath, err)
	}

	foldersA, err := store.GetFolders(userA.ID)
	if err != nil {
		t.Fatalf("GetFolders for userA failed: %v", err)
	}
	for _, f := range foldersA {
		if f == "Arbeit" || f == "Arbeit/Eingang" {
			t.Fatalf("User B's private folder leaked into User A's folder list: %v", foldersA)
		}
	}

	// 2. Shared Folder & Empty Subfolder Sync
	_, err = store.CreateFolder(userA.ID, "TeamProjekt")
	if err != nil {
		t.Fatalf("CreateFolder TeamProjekt failed: %v", err)
	}
	sf, err := store.CreateSharedFolder(userA.ID, "TeamProjekt", "TeamProjekt")
	if err != nil {
		t.Fatalf("CreateSharedFolder failed: %v", err)
	}
	_, err = store.CreateFolderShare(userA.ID, sf.ID, "user", userB.ID, "write")
	if err != nil {
		t.Fatalf("CreateFolderShare failed: %v", err)
	}

	// User B moves their mount root of the shared folder to "ExterneProjekte/TeamProjekt"
	err = store.UpdateFolderMount(userB.ID, sf.ID, "ExterneProjekte/TeamProjekt")
	if err != nil {
		t.Fatalf("UpdateFolderMount failed: %v", err)
	}

	// User A creates an EMPTY subfolder inside "TeamProjekt/Konzepte"
	_, err = store.CreateFolder(userA.ID, "TeamProjekt/Konzepte")
	if err != nil {
		t.Fatalf("CreateFolder TeamProjekt/Konzepte failed: %v", err)
	}

	// User B must immediately see "ExterneProjekte/TeamProjekt/Konzepte" in GetFolders without any document inside!
	foldersB, err := store.GetFolders(userB.ID)
	if err != nil {
		t.Fatalf("GetFolders for userB failed: %v", err)
	}
	foundSubfolderForB := false
	for _, f := range foldersB {
		if f == "ExterneProjekte/TeamProjekt/Konzepte" {
			foundSubfolderForB = true
		}
	}
	if !foundSubfolderForB {
		t.Fatalf("expected User B to see empty shared subfolder 'ExterneProjekte/TeamProjekt/Konzepte', got folders: %v", foldersB)
	}

	// 3. MoveFolder inside a shared folder
	newPath, _, err := store.MoveFolder(userA.ID, "TeamProjekt/Konzepte", "TeamProjekt/Archiv")
	if err != nil {
		t.Fatalf("MoveFolder failed: %v", err)
	}
	if newPath != "TeamProjekt/Archiv/Konzepte" {
		t.Fatalf("expected newPath 'TeamProjekt/Archiv/Konzepte', got %q", newPath)
	}

	// User B must now see "ExterneProjekte/TeamProjekt/Archiv/Konzepte"
	foldersBAfterMove, err := store.GetFolders(userB.ID)
	if err != nil {
		t.Fatalf("GetFolders after MoveFolder failed: %v", err)
	}
	foundMovedForB := false
	for _, f := range foldersBAfterMove {
		if f == "ExterneProjekte/TeamProjekt/Archiv/Konzepte" {
			foundMovedForB = true
		}
	}
	if !foundMovedForB {
		t.Fatalf("expected User B to see moved shared subfolder 'ExterneProjekte/TeamProjekt/Archiv/Konzepte', got %v", foldersBAfterMove)
	}
}

func TestBlockListAndDerivedData(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "tabula_rasa_test.db")

	store, err := NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	user, err := store.CreateUser("outliner@example.com", "hash", "Outliner User", "member")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	doc, err := store.CreateDocument(user.ID, "", "Initial Note", "📝", "Projekte", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	blocks := []domain.DocumentBlock{
		{
			ID:      "blk_root_1",
			Type:    "text",
			Content: "Architektur Übersicht #backend #go",
			Level:   0,
		},
		{
			ID:      "blk_child_1",
			Type:    "todo",
			Content: "SQLite WAL Modus aktivieren #sqlite",
			Level:   1,
			Checked: true,
		},
	}

	store.replaceDocBlocksInDB(doc.ID, user.ID, blocks, "")
	store.applyLegacyTitle(doc.ID, user.ID, "Architektur Notiz")

	updatedDoc, err := store.GetDocumentByID(user.ID, doc.ID)
	if err != nil {
		t.Fatalf("GetDocumentByID failed: %v", err)
	}
	if updatedDoc.Title != "Architektur Notiz" {
		t.Fatalf("expected title 'Architektur Notiz', got '%s'", updatedDoc.Title)
	}
	if len(updatedDoc.Blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(updatedDoc.Blocks))
	}
	if updatedDoc.Blocks[1].Level != 1 || updatedDoc.Blocks[1].Position != 2000 {
		t.Fatalf("expected block[1] level=1 position=2000, got level=%d position=%v", updatedDoc.Blocks[1].Level, updatedDoc.Blocks[1].Position)
	}
	if updatedDoc.MarkdownCache == "" {
		t.Fatalf("expected markdown_cache to be populated")
	}

	tags, err := store.GetWorkspaceTags(user.ID)
	if err != nil {
		t.Fatalf("GetWorkspaceTags failed: %v", err)
	}
	if len(tags) != 3 {
		t.Fatalf("expected 3 extracted tags in block_tags (#backend, #go, #sqlite), got %d: %+v", len(tags), tags)
	}
}

// openSharing lets tests that are not about visibility share freely between their users.
func openSharing(t *testing.T, store *Store) {
	t.Helper()
	if store == nil {
		return
	}
	sys, err := store.GetSystemSettings()
	if err != nil {
		t.Fatalf("GetSystemSettings: %v", err)
	}
	sys.SharingMode = SharingOpen
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatalf("UpdateSystemSettings: %v", err)
	}
}

// The engine built into the binary: at least the SQLite go.mod pins (an accidental downgrade of
// modernc.org/sqlite would bring back older SQLite bugs), with FTS5 for the search, and the file opened in
// WAL mode as the DSN asks.
func TestSQLiteEngine(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "engine.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	v, err := store.SQLiteVersion()
	if err != nil {
		t.Fatalf("SQLiteVersion: %v", err)
	}
	var major, minor int
	if _, err := fmt.Sscanf(v, "%d.%d", &major, &minor); err != nil {
		t.Fatalf("unexpected version %q: %v", v, err)
	}
	if major != 3 || minor < 54 {
		t.Fatalf("SQLite %s is older than 3.54", v)
	}

	var fts5 int
	if err := store.db.QueryRow(`SELECT sqlite_compileoption_used('ENABLE_FTS5')`).Scan(&fts5); err != nil || fts5 != 1 {
		t.Fatalf("FTS5 not compiled in (%d, %v)", fts5, err)
	}
	var mode string
	if err := store.db.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("journal_mode = %q (%v), want wal", mode, err)
	}
}
