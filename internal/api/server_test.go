package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// testSecretsKey: SECRETS_KEY of the test servers, given to their store as well (as cmd/server does)
var testSecretsKey = []byte("test-secrets-key-32-bytes-long!!")

func setupTestServer(t *testing.T) (*Server, *storage.Store, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test_mindsift.db")
	store, err := storage.NewStore(dbPath, storage.WithSecretsKey(testSecretsKey))
	openSharing(t, store)
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	user, err := store.EnsureDefaultUser()
	if err != nil {
		t.Fatalf("failed to ensure test user: %v", err)
	}
	_ = store.SeedStarterContent(user)

	cfg := &config.Config{
		Port:              "8080",
		DatabasePath:      dbPath,
		JWTSecret:         "test-jwt-secret-key",
		SecretsKey:        testSecretsKey,
		AllowRegistration: false,
	}
	hub := ws.NewHub()
	srv := NewServer(cfg, store, hub, nil)
	t.Cleanup(srv.Close)

	token, err := auth.GenerateToken(cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, testSession(t, store, user.ID))
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	return srv, store, token
}

func TestFirstBootSetupAndInviteRegistrationAndNonNullSlices(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "fresh_mindsift.db")
	store, err := storage.NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("failed to create fresh store: %v", err)
	}
	defer store.Close()

	cfg := &config.Config{
		Port:              "8080",
		DatabasePath:      dbPath,
		JWTSecret:         "test-jwt-secret-key",
		AllowRegistration: false,
	}
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()

	// 1. Fresh DB must report needsSetup = true
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from /api/v1/auth/status, got %d", rec.Code)
	}
	var statusResp struct {
		NeedsSetup        bool   `json:"needsSetup"`
		AllowRegistration bool   `json:"allowRegistration"`
		InstanceName      string `json:"instanceName"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &statusResp)
	if !statusResp.NeedsSetup {
		t.Fatalf("expected needsSetup=true on fresh database, got false")
	}

	// 2. Complete First-Boot Setup (without sample data)
	setupBody := []byte(`{
		"email": "owner@example.com",
		"password": "secretpassword",
		"displayName": "Server Owner",
		"instanceName": "My MindSift",
		"allowRegistration": false,
		"sharingMode": "organizations",
		"createSampleData": false
	}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(withSetupCode(srv, string(setupBody))))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from /api/v1/auth/setup, got %d: %s", rec.Code, rec.Body.String())
	}
	var setupRes struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &setupRes)
	if setupRes.User.Role != "admin" || setupRes.Token == "" {
		t.Fatalf("expected admin user and token, got %+v", setupRes)
	}

	// 3. Verify empty endpoints return [] and never null (preventing React crashes)
	arrayEndpoints := []string{
		"/api/v1/task-lists",
		"/api/v1/tasks",
		"/api/v1/admin/organizations",
		"/api/v1/teams",
		"/api/v1/lists",
	}
	for _, ep := range arrayEndpoints {
		req = httptest.NewRequest(http.MethodGet, ep, nil)
		req.Header.Set("Authorization", "Bearer "+setupRes.Token)
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s returned %d", ep, rec.Code)
		}
		trimmed := strings.TrimSpace(rec.Body.String())
		if trimmed == "null" || !strings.HasPrefix(trimmed, "[") {
			t.Fatalf("GET %s returned %q instead of JSON array []", ep, trimmed)
		}
	}

	// 4. Public registration without invite must be rejected (403)
	regBody := []byte(`{"email":"member@example.com","password":"password123","displayName":"Member"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(regBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when registration is disabled, got %d", rec.Code)
	}

	// 5. Create an Invite as Admin and register with that Invite Code (asking for the admin role does
	// nothing: invites always create members)
	invBody := []byte(`{"role":"admin","validDays":7}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/invites", bytes.NewReader(invBody))
	req.Header.Set("Authorization", "Bearer "+setupRes.Token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for invite, got %d: %s", rec.Code, rec.Body.String())
	}
	var createdInvite domain.UserInvite
	_ = json.Unmarshal(rec.Body.Bytes(), &createdInvite)
	if createdInvite.Code == "" {
		t.Fatalf("expected invite code, got empty")
	}

	regWithInviteBody, _ := json.Marshal(map[string]string{
		"email":       "invited@example.com",
		"password":    "password123",
		"displayName": "Invited Admin",
		"inviteCode":  createdInvite.Code,
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(regWithInviteBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created when registering with valid invite code, got %d: %s", rec.Code, rec.Body.String())
	}
	var invitedRes struct {
		User domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &invitedRes)
	if invitedRes.User.Role != "member" {
		t.Fatalf("an invite must never make an admin, got role %q", invitedRes.User.Role)
	}
}

func TestConcurrentInitialLoadAndListsNoDeadlock(t *testing.T) {
	srv, _, token := setupTestServer(t)
	router := srv.Router()

	endpoints := []string{
		"/api/v1/auth/me",
		"/api/v1/triage/deck",
		"/api/v1/lists",
		"/api/v1/tasks",
		"/api/v1/documents",
	}

	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		for _, ep := range endpoints {
			wg.Add(1)
			go func(path string) {
				defer wg.Done()
				req := httptest.NewRequest(http.MethodGet, path, nil)
				req.Header.Set("Authorization", "Bearer "+token)
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				if rec.Code != http.StatusOK {
					t.Errorf("GET %s returned %d: %s", path, rec.Code, rec.Body.String())
				}
			}(ep)
		}
	}
	wg.Wait()
}

func TestQuickDumpToTriageAndDirectTargets(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()

	// Verify stale token from non-existent user is rejected (401)
	staleToken, _ := auth.GenerateToken("test-jwt-secret-key", "usr_non_existent", "old@mindsift.local", "Old", 1, "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+staleToken)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for stale token, got %d", rec.Code)
	}

	// 1. Capture Quick Dump (default target: inbox)
	dumpPayload := map[string]string{
		"content":  "Schneller Quick Dump Testgedanke #test",
		"priority": "high",
		"target":   "inbox",
	}
	body, _ := json.Marshal(dumpPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/inbox", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for Quick Dump, got %d: %s", rec.Code, rec.Body.String())
	}

	var createdDump domain.Thought
	if err := json.Unmarshal(rec.Body.Bytes(), &createdDump); err != nil {
		t.Fatalf("failed to decode created dump: %v", err)
	}
	if createdDump.Status != domain.StatusInbox {
		t.Fatalf("expected status 'inbox', got %q", createdDump.Status)
	}

	// 2. Capture Direct Task (target: task)
	taskPayload := map[string]string{
		"content":  "Direkte Aufgabe ohne Triage",
		"priority": "urgent",
		"target":   "task",
		"dueDate":  "2026-11-01",
	}
	body, _ = json.Marshal(taskPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/inbox", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for Direct Task, got %d: %s", rec.Code, rec.Body.String())
	}
	var createdTask domain.Thought
	_ = json.Unmarshal(rec.Body.Bytes(), &createdTask)
	if createdTask.Status != domain.StatusConverted || createdTask.ConvertedType != "task" {
		t.Fatalf("expected converted task, got status=%q type=%q", createdTask.Status, createdTask.ConvertedType)
	}

	// 3. Capture Direct List Item (target: list_item)
	defUser, _ := store.EnsureDefaultUser()
	lists, err := store.GetAllListsForUser(defUser.ID)
	if err != nil || len(lists) == 0 {
		t.Fatalf("expected starter lists, got len=%d err=%v", len(lists), err)
	}
	targetListID := lists[0].ID

	listPayload := map[string]string{
		"content":      "Frische Haferflocken",
		"target":       "list_item",
		"targetListId": targetListID,
	}
	body, _ = json.Marshal(listPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/inbox", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for Direct List Item, got %d: %s", rec.Code, rec.Body.String())
	}
	var createdListItemThought domain.Thought
	_ = json.Unmarshal(rec.Body.Bytes(), &createdListItemThought)
	if createdListItemThought.ConvertedType != "list_item" || createdListItemThought.ConvertedRefID == "" {
		t.Fatalf("expected converted list_item, got %+v", createdListItemThought)
	}

	// 4. Swipe Triage card to Task
	triagePayload := map[string]string{
		"action":    "keep",
		"convertTo": "task",
	}
	body, _ = json.Marshal(triagePayload)
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/triage/"+createdDump.ID, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for triage action, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestNewFullFeatures(t *testing.T) {
	srv, _, token := setupTestServer(t)
	router := srv.Router()

	// 1. Test TaskLists: Create & Get
	taskListPayload := map[string]string{
		"title": "Homelab & Docker",
		"icon":  "🐳",
		"color": "#3b82f6",
	}
	body, _ := json.Marshal(taskListPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/task-lists", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for TaskList, got %d: %s", rec.Code, rec.Body.String())
	}
	var createdTaskList domain.TaskList
	_ = json.Unmarshal(rec.Body.Bytes(), &createdTaskList)
	if createdTaskList.Title != "Homelab & Docker" {
		t.Fatalf("expected task list title 'Homelab & Docker', got %q", createdTaskList.Title)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/task-lists", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET /api/v1/task-lists, got %d", rec.Code)
	}

	// 2. Test User Settings: Update Multi-Channel Alarms & Profile
	settingsPayload := map[string]any{
		"displayName":         "Admin User",
		"alarmChannels":       []string{"email", "discord", "webhook"},
		"alarmEmail":          "alarms@example.com", // no longer an own address: ignored
		"discordWebhookUrl":   "https://discord.com/api/webhooks/test/123",
		"customWebhookUrl":    "https://ntfy.sh/my-topic",
		"notifyBeforeMinutes": 15,
	}
	body, _ = json.Marshal(settingsPayload)
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/auth/settings", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for PATCH /api/v1/auth/settings, got %d: %s", rec.Code, rec.Body.String())
	}
	var updatedUser domain.User
	_ = json.Unmarshal(rec.Body.Bytes(), &updatedUser)
	// Mail alarms go to the login address; an alarm address sent along is ignored
	if len(updatedUser.AlarmChannels) != 3 || strings.Contains(rec.Body.String(), "alarms@example.com") {
		t.Fatalf("expected 3 alarm channels and no alarm address, got %s", rec.Body.String())
	}

	// 3. Test Admin routes (default user is admin)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET /api/v1/admin/users, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/admin/settings", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET /api/v1/admin/settings, got %d: %s", rec.Code, rec.Body.String())
	}

	// 4. Test Kanban & Task details update
	taskUpdatePayload := map[string]any{
		"kanbanStatus": "in_progress",
		"notes":        "Detailnotizen für die Aufgabe",
		"taskListId":   createdTaskList.ID,
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/inbox", bytes.NewReader([]byte(`{"content":"Kanban Task Test","target":"task"}`)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var taskThought domain.Thought
	_ = json.Unmarshal(rec.Body.Bytes(), &taskThought)

	body, _ = json.Marshal(taskUpdatePayload)
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/thoughts/"+taskThought.ID, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for PATCH /api/v1/thoughts/{id}, got %d: %s", rec.Code, rec.Body.String())
	}
	var updatedThought domain.Thought
	_ = json.Unmarshal(rec.Body.Bytes(), &updatedThought)
	if updatedThought.KanbanStatus != "in_progress" || updatedThought.Notes != "Detailnotizen für die Aufgabe" {
		t.Fatalf("expected updated kanbanStatus and notes, got %+v", updatedThought)
	}
}

func TestLoginWithUsernameAndDemoMode(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "demo_api_test.db")
	store, err := storage.NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	if err := store.EnsureDemoAccounts(); err != nil {
		t.Fatalf("failed to seed demo accounts: %v", err)
	}

	cfg := &config.Config{
		Port:         "8080",
		DatabasePath: dbPath,
		JWTSecret:    "demo-jwt-secret",
		DemoMode:     true,
	}
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()

	// 1. Check auth status reports demoMode: true
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from /api/v1/auth/status, got %d", rec.Code)
	}
	var statusResp struct {
		NeedsSetup bool `json:"needsSetup"`
		DemoMode   bool `json:"demoMode"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &statusResp)
	if !statusResp.DemoMode {
		t.Fatalf("expected demoMode=true, got %v", statusResp.DemoMode)
	}
	if statusResp.NeedsSetup {
		t.Fatalf("expected needsSetup=false when demo accounts exist, got %v", statusResp.NeedsSetup)
	}

	// 2. Login with username "admin" / "admin"
	loginBody := []byte(`{"email":"admin","password":"admin"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d: %s", rec.Code, rec.Body.String())
	}
	var loginRes struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &loginRes)
	if loginRes.Token == "" || loginRes.User.Role != "admin" {
		t.Fatalf("invalid admin login response: %+v", loginRes)
	}

	// 3. Login with username "user" / "user"
	userLoginBody := []byte(`{"username":"user","password":"user"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(userLoginBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for user login, got %d: %s", rec.Code, rec.Body.String())
	}
	var userLoginRes struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &userLoginRes)
	if userLoginRes.Token == "" || userLoginRes.User.Role != "member" {
		t.Fatalf("invalid user login response: %+v", userLoginRes)
	}

	// 4. Invalid credentials must return 401
	wrongLoginBody := []byte(`{"login":"admin","password":"wrongpassword"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(wrongLoginBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong password, got %d", rec.Code)
	}
}

func TestSpaceMembersDirectInvitationAPI(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "space_members_test.db")
	store, err := storage.NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	if err := store.EnsureDemoAccounts(); err != nil {
		t.Fatalf("failed to seed demo accounts: %v", err)
	}

	cfg := &config.Config{
		Port:         "8080",
		DatabasePath: dbPath,
		JWTSecret:    "test-secret",
	}
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()

	adminUser, err := store.GetUserByLogin("admin")
	if err != nil {
		t.Fatalf("failed to get admin user: %v", err)
	}
	normalUser, err := store.GetUserByLogin("user")
	if err != nil {
		t.Fatalf("failed to get normal user: %v", err)
	}

	adminToken, err := auth.GenerateToken(cfg.JWTSecret, adminUser.ID, adminUser.Email, adminUser.DisplayName, adminUser.TokenVersion, testSession(t, store, adminUser.ID))
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}
	userToken, err := auth.GenerateToken(cfg.JWTSecret, normalUser.ID, normalUser.Email, normalUser.DisplayName, normalUser.TokenVersion, testSession(t, store, normalUser.ID))
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	// 1. Admin creates a list
	createListBody := []byte(`{"title":"Einkauf WG","icon":"🛒","listType":"shopping"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/lists", bytes.NewReader(createListBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from /api/v1/lists, got %d: %s", rec.Code, rec.Body.String())
	}
	var createdList domain.SharedList
	_ = json.Unmarshal(rec.Body.Bytes(), &createdList)
	if createdList.ID == "" {
		t.Fatalf("expected created list with ID, got %+v", createdList)
	}

	// 2. Admin shares list with normalUser by username "user"
	addShareBody := []byte(`{"targetType":"user","targetId":"user","role":"editor"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/lists/"+createdList.ID+"/shares", bytes.NewReader(addShareBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from add list share, got %d: %s", rec.Code, rec.Body.String())
	}
	var newShare domain.ListShare
	_ = json.Unmarshal(rec.Body.Bytes(), &newShare)
	if newShare.TargetID != normalUser.ID {
		t.Fatalf("expected share targetId %s, got %s", normalUser.ID, newShare.TargetID)
	}

	// 3. User checks their lists; the shared list must be listed
	req = httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for user lists, got %d", rec.Code)
	}
	var userLists []domain.SharedList
	_ = json.Unmarshal(rec.Body.Bytes(), &userLists)
	found := false
	for _, l := range userLists {
		if l.ID == createdList.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected list %s to be visible to user, got %+v", createdList.ID, userLists)
	}

	// 4. Admin removes user share from list
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/lists/"+createdList.ID+"/shares/"+newShare.ID, nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for remove share, got %d: %s", rec.Code, rec.Body.String())
	}

	// 5. Test sharing list with a team
	team, err := store.CreateTeam("", "WG Team", "Haushalt")
	if err != nil {
		t.Fatalf("failed to create team: %v", err)
	}
	_ = store.AddTeamMember(team.ID, normalUser.ID, "member")
	// Sharing with a group requires being in it
	_ = store.AddTeamMember(team.ID, adminUser.ID, "admin")

	addTeamBody := []byte(`{"targetType":"team","targetId":"` + team.ID + `","role":"editor"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/lists/"+createdList.ID+"/shares", bytes.NewReader(addTeamBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("expected 201 or 200 for add list team share, got %d: %s", rec.Code, rec.Body.String())
	}

	// User should see the list again because their team was added
	req = httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for user lists after team share add, got %d", rec.Code)
	}
	userLists = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &userLists)
	found = false
	for _, l := range userLists {
		if l.ID == createdList.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected list %s to be visible to user via team share, got %+v", createdList.ID, userLists)
	}
}

func TestWorkspaceTagsAPI(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()

	user, _ := store.CreateUser("api_tag_user@example.com", "hash", "API Tag User", "member")
	token, _ := auth.GenerateToken(srv.cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, testSession(t, store, user.ID))

	// Create document with hashtags
	blocks := []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Planung #Sprint12", Level: 0},
		{ID: "b2", Type: "bullet", Content: "Subtask 1", Level: 1},
	}
	_, err := store.CreateDocument(user.ID, "", "Sprint Plan", "🚀", "", blocks, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	// 1. GET /api/v1/workspace/tags
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspace/tags", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}
	var tagList []domain.TagSummary
	_ = json.Unmarshal(rec.Body.Bytes(), &tagList)
	if len(tagList) != 1 || tagList[0].Tag != "sprint12" {
		t.Fatalf("expected tag 'sprint12', got %+v", tagList)
	}

	// 2. GET /api/v1/workspace/tags/Sprint12
	req = httptest.NewRequest(http.MethodGet, "/api/v1/workspace/tags/Sprint12", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}
	var details domain.TagDetails
	_ = json.Unmarshal(rec.Body.Bytes(), &details)
	if details.Tag != "sprint12" || details.TotalMatches != 1 || len(details.Documents) != 1 {
		t.Fatalf("unexpected tag details: %+v", details)
	}
	matched := details.Documents[0].MatchedBlocks[0]
	if matched.RootBlock.ID != "b1" || len(matched.Children) != 1 || matched.Children[0].ID != "b2" {
		t.Fatalf("unexpected matched blocks or children: %+v", matched)
	}

	// 3. Folder endpoints test
	// Create folder
	createFolderBody := []byte(`{"path":"TestOrdner"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/folders", bytes.NewReader(createFolderBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from /api/v1/folders, got %d: %s", rec.Code, rec.Body.String())
	}

	// Get folders
	req = httptest.NewRequest(http.MethodGet, "/api/v1/folders", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from /api/v1/folders, got %d", rec.Code)
	}
	var folders []string
	_ = json.Unmarshal(rec.Body.Bytes(), &folders)
	foundFolder := false
	for _, f := range folders {
		if f == "TestOrdner" {
			foundFolder = true
			break
		}
	}
	if !foundFolder {
		t.Fatalf("expected TestOrdner in folders list, got %v", folders)
	}

	// Delete folder
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/folders?path=TestOrdner", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from DELETE /api/v1/folders, got %d", rec.Code)
	}
}

func TestWebhookTriageBadgeAndIngestion(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_webhook.db")
	store, err := storage.NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}
	defer store.Close()

	cfg := &config.Config{
		JWTSecret:         "test-jwt-secret-key",
		AllowRegistration: false,
	}
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()

	// 1. Setup user
	setupBody := []byte(`{
		"email": "smarthome_owner@example.com",
		"password": "secretpassword",
		"displayName": "Home User",
		"instanceName": "MindSift Home",
		"allowRegistration": false,
		"createSampleData": false
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(withSetupCode(srv, string(setupBody))))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup failed: %s", rec.Body.String())
	}
	var authResp struct {
		Token string       `json:"token"`
		User  *domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &authResp)

	// 2. Create API key for user
	apiKey, err := store.CreateAPIKey(authResp.User.ID, "Home Assistant Webhook", nil)
	if err != nil || apiKey == nil || apiKey.RawKey == "" {
		t.Fatalf("failed to create API key: %v", err)
	}
	plainKey := apiKey.RawKey

	// 3. Post to /api/v1/inbox using X-API-Key without passing "source"
	inboxBody := []byte(`{
		"content": "Kellerfeuchtigkeit über 68% gestiegen – Entfeuchter prüfen #smarthome #alarm",
		"priority": "urgent"
	}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/inbox", bytes.NewReader(inboxBody))
	req.Header.Set("X-API-Key", plainKey)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from /api/v1/inbox with API key, got %d: %s", rec.Code, rec.Body.String())
	}
	var createdThought domain.Thought
	_ = json.Unmarshal(rec.Body.Bytes(), &createdThought)
	if createdThought.Source != "webhook" {
		t.Fatalf("expected created thought to have source='webhook' when called with API key, got '%s'", createdThought.Source)
	}

	// 4. Post to /api/v1/webhooks/ingest using ?token=... with message alias
	webhookBody := []byte(`{
		"message": "Waschmaschine im Keller fertig",
		"priority": "high",
		"tags": ["automation"]
	}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/ingest?token="+plainKey, bytes.NewReader(webhookBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from /api/v1/webhooks/ingest, got %d: %s", rec.Code, rec.Body.String())
	}
	var ingestResp struct {
		Status  string         `json:"status"`
		Thought domain.Thought `json:"thought"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ingestResp)
	if ingestResp.Thought.Source != "webhook" {
		t.Fatalf("expected ingested webhook thought to have source='webhook', got '%s'", ingestResp.Thought.Source)
	}
	if !strings.Contains(ingestResp.Thought.Content, "Waschmaschine") {
		t.Fatalf("expected thought content to contain 'Waschmaschine', got '%s'", ingestResp.Thought.Content)
	}
}

func TestSSEGlobalEndpoint(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_sse.db")
	store, err := storage.NewStore(dbPath)
	openSharing(t, store)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}
	defer store.Close()

	hub := ws.NewHub()
	cfg := &config.Config{
		JWTSecret:         "test-jwt-secret-key",
		AllowRegistration: false,
	}
	srv := NewServer(cfg, store, hub, nil)
	t.Cleanup(srv.Close)
	router := srv.Router()

	setupBody := []byte(`{
		"email": "sse_user@example.com",
		"password": "secretpassword",
		"displayName": "SSE User",
		"instanceName": "MindSift SSE",
		"allowRegistration": false,
		"createSampleData": false
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(withSetupCode(srv, string(setupBody))))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup failed: %s", rec.Body.String())
	}
	var authResp struct {
		Token string       `json:"token"`
		User  *domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &authResp)
	token := authResp.Token

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req = httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(rec, req)

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("expected Content-Type text/event-stream, got %s", contentType)
	}
	bodyStr := rec.Body.String()
	if !strings.Contains(bodyStr, "SSE_CONNECTED") {
		t.Fatalf("expected SSE_CONNECTED event in body, got: %s", bodyStr)
	}
}

func TestDecoupledFolderSharingAPI(t *testing.T) {
	srv, store, tokenA := setupTestServer(t)
	router := srv.Router()

	userB, err := store.CreateUser("user_b@example.com", "hash", "User B", "member")
	if err != nil {
		t.Fatalf("failed to create user B: %v", err)
	}
	tokenB, err := auth.GenerateToken(srv.cfg.JWTSecret, userB.ID, userB.Email, userB.DisplayName, userB.TokenVersion, testSession(t, store, userB.ID))
	if err != nil {
		t.Fatalf("failed to generate token B: %v", err)
	}

	// 1. User A creates a shared folder "TeamProjekt"
	shPayload := map[string]string{"name": "TeamProjekt", "mountPath": "TeamProjekt"}
	b, _ := json.Marshal(shPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspace/folders/shared", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create shared folder failed: %s", rec.Body.String())
	}
	var shFolder domain.SharedFolder
	_ = json.Unmarshal(rec.Body.Bytes(), &shFolder)

	// 2. User A creates a document inside "TeamProjekt"
	docPayload := map[string]any{
		"title":      "Spezifikation",
		"folderPath": "TeamProjekt",
		"blocks": []domain.DocumentBlock{
			{ID: "blk_1", Type: "text", Content: "Projekt Details", Level: 0, Position: 1000},
		},
	}
	b, _ = json.Marshal(docPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create doc failed: %s", rec.Body.String())
	}
	var createdDoc domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &createdDoc)

	// 3. User A shares the folder with User B (write permission)
	sharePayload := map[string]any{
		"userId":     userB.ID,
		"targetType": "user",
		"permission": "write",
	}
	b, _ = json.Marshal(sharePayload)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/workspace/folders/shared/"+shFolder.ID+"/shares", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("share folder failed: %s", rec.Body.String())
	}

	// 4. User B gets their documents list -> must see the document in "TeamProjekt"
	req = httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil)
	req.Header.Set("Authorization", "Bearer "+tokenB)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get docs userB failed: %s", rec.Body.String())
	}
	var docsB []domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &docsB)
	var foundDocB *domain.Document
	for i := range docsB {
		if docsB[i].ID == createdDoc.ID {
			foundDocB = &docsB[i]
			break
		}
	}
	if foundDocB == nil {
		t.Fatalf("User B did not see shared document!")
	}
	if foundDocB.FolderPath != "TeamProjekt" {
		t.Fatalf("expected User B initial folderPath 'TeamProjekt', got %q", foundDocB.FolderPath)
	}

	// 5. User B moves their mount point to "MeineOrdner/TeamProjekt"
	movePayload := map[string]string{
		"sourcePath":       "TeamProjekt",
		"targetParentPath": "MeineOrdner",
	}
	b, _ = json.Marshal(movePayload)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/folders/move", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tokenB)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("User B move folder failed: %s", rec.Body.String())
	}

	// 6. DECOUPLED CHECK:
	// User B's document path must now be "MeineOrdner/TeamProjekt"
	req = httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+createdDoc.ID, nil)
	req.Header.Set("Authorization", "Bearer "+tokenB)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("User B get doc failed: %s", rec.Body.String())
	}
	var docBAfterMove domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &docBAfterMove)
	if docBAfterMove.FolderPath != "MeineOrdner/TeamProjekt" {
		t.Fatalf("expected User B folderPath 'MeineOrdner/TeamProjekt', got %q", docBAfterMove.FolderPath)
	}

	// User A's document path must STILL be "TeamProjekt" (completely decoupled!)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+createdDoc.ID, nil)
	req.Header.Set("Authorization", "Bearer "+tokenA)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("User A get doc failed: %s", rec.Body.String())
	}
	var docAAfterMove domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &docAAfterMove)
	if docAAfterMove.FolderPath != "TeamProjekt" {
		t.Fatalf("User A's folder hierarchy was altered! Expected 'TeamProjekt', got %q", docAAfterMove.FolderPath)
	}

	// 7. Synchronous contents check:
	// User B (read-only recipient) cannot move documents within the shared folder:
	moveDocPayload := map[string]string{
		"folderPath": "MeineOrdner/TeamProjekt/Archiv",
	}
	b, _ = json.Marshal(moveDocPayload)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+createdDoc.ID+"/move", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tokenB)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("Expected User B move doc in read-only shared folder to fail, got %d", rec.Code)
	}

	// User A (the owner) moves the document into a subfolder: "TeamProjekt/Archiv"
	moveDocPayload = map[string]string{
		"folderPath": "TeamProjekt/Archiv",
	}
	b, _ = json.Marshal(moveDocPayload)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+createdDoc.ID+"/move", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("User A move doc into subfolder failed: %s", rec.Body.String())
	}

	// User B must now see the document synchronized at "MeineOrdner/TeamProjekt/Archiv"!
	req = httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+createdDoc.ID, nil)
	req.Header.Set("Authorization", "Bearer "+tokenB)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("User B get doc failed: %s", rec.Body.String())
	}
	var docBSynced domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &docBSynced)
	if docBSynced.FolderPath != "MeineOrdner/TeamProjekt/Archiv" {
		t.Fatalf("expected User B to see subfolder sync at 'MeineOrdner/TeamProjekt/Archiv', got %q", docBSynced.FolderPath)
	}
}

func TestTokenBlacklistingAndTokenVersionRevocation(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()

	// 1. Create a fresh user with known password
	password := "initialPassword123"
	hash, _ := auth.HashPassword(password)
	user, err := store.CreateUser("revocation_test@example.com", hash, "Revocation Tester", "member")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// 2. Perform login to get initial JWT
	loginBody, _ := json.Marshal(map[string]string{
		"login":    user.Email,
		"password": password,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login failed: %s", rec.Body.String())
	}
	var loginResp struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &loginResp)
	token1 := loginResp.Token
	if token1 == "" {
		t.Fatalf("expected token in login response")
	}

	// 3. Verify token1 works
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token1)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("token1 should be valid, got %d", rec.Code)
	}

	// 4. Test explicit logout (blacklists token1)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token1)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout failed: %s", rec.Body.String())
	}

	// Token1 must now be blacklisted and rejected (401)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token1)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for blacklisted token1, got %d", rec.Code)
	}

	// Also check authenticateUserFromReq rejects token1
	req = httptest.NewRequest(http.MethodGet, "/api/v1/ws", nil)
	req.Header.Set("Authorization", "Bearer "+token1)
	if u, _ := srv.authenticateUserFromReq(req); u != nil {
		t.Fatalf("authenticateUserFromReq should reject blacklisted token1, got uid %q", u.ID)
	}

	// 5. Login again to get token2
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var loginResp2 struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &loginResp2)
	token2 := loginResp2.Token

	// Token2 works
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token2)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("token2 should be valid, got %d", rec.Code)
	}

	// 6. Change password via UpdateUserPassword -> increments token_version
	newPassword := "newSecretPassword456"
	newHash, _ := auth.HashPassword(newPassword)
	if err := store.UpdateUserPassword(user.ID, newHash); err != nil {
		t.Fatalf("failed to update password: %v", err)
	}

	// Token2 must now be REJECTED (401) because its token_version is outdated!
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token2)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for token2 after password change, got %d", rec.Code)
	}

	// 7. Login with new password to get token3
	loginNewBody, _ := json.Marshal(map[string]string{
		"login":    user.Email,
		"password": newPassword,
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginNewBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var loginResp3 struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &loginResp3)
	token3 := loginResp3.Token

	// Token3 works
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token3)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("token3 should be valid, got %d", rec.Code)
	}

	// 8. Test revoke-all endpoint -> increments token_version and invalidates all existing sessions
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/revoke-all", nil)
	req.Header.Set("Authorization", "Bearer "+token3)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke-all failed: %s", rec.Body.String())
	}

	// Token3 must now be REJECTED (401)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token3)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for token3 after revoke-all, got %d", rec.Code)
	}
}

func TestDocumentSharingStrictlyReadOnly(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()

	userA, _ := store.CreateUser("user_a_ro@example.com", "hash", "User A", "member")
	tokenA, _ := auth.GenerateToken(srv.cfg.JWTSecret, userA.ID, userA.Email, userA.DisplayName, userA.TokenVersion, testSession(t, store, userA.ID))

	userB, _ := store.CreateUser("user_b_ro@example.com", "hash", "User B", "member")
	tokenB, _ := auth.GenerateToken(srv.cfg.JWTSecret, userB.ID, userB.Email, userB.DisplayName, userB.TokenVersion, testSession(t, store, userB.ID))

	// Create document owned by User A
	blocks := []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Row 1", Level: 0},
		{ID: "b2", Type: "bullet", Content: "Row 2", Level: 0},
	}
	doc, err := store.CreateDocument(userA.ID, "", "Read Only Test Doc", "📝", "", blocks, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	// Share with User B (forced read-only)
	_, err = store.CreateDocShare(userA.ID, doc.ID, userB.ID, "read")
	if err != nil {
		t.Fatalf("CreateDocShare failed: %v", err)
	}

	// 1. User B can read document
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+doc.ID, nil)
	req.Header.Set("Authorization", "Bearer "+tokenB)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("User B should be able to read doc, got status: %d", rec.Code)
	}

	// 2. User B tries to update document via PUT -> must fail (not owner)
	newTitle := "Hacked Title"
	updateBody, _ := json.Marshal(map[string]any{"title": newTitle})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+doc.ID, bytes.NewReader(updateBody))
	req.Header.Set("Authorization", "Bearer "+tokenB)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected error for User B updating document, got 200 OK")
	}

	// 3. User B tries to change blocks through the sync API -> must fail (read-only)
	hacked := "Hacked by User B"
	syncBody, _ := json.Marshal(map[string]any{
		"clientId": "tab-b",
		"ops":      []collab.Op{{OpID: "b-hack", Kind: collab.OpSetContent, BlockID: "b2", BaseVersion: 1, Content: &hacked}},
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/docs/"+doc.ID+"/sync", bytes.NewReader(syncBody))
	req.Header.Set("Authorization", "Bearer "+tokenB)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for User B changing blocks, got %d", rec.Code)
	}

	// The old whole-document save no longer accepts blocks, not even from the owner
	blocksBody, _ := json.Marshal(map[string]any{"blocks": []domain.DocumentBlock{{ID: "b1", Content: "x"}}})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+doc.ID, bytes.NewReader(blocksBody))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blocks via PUT, got %d", rec.Code)
	}

	// 4. User A (owner) can successfully update document
	ownerTitle := "Owner Updated Title"
	ownerBody, _ := json.Marshal(map[string]any{"title": ownerTitle})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+doc.ID, bytes.NewReader(ownerBody))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner should be able to update document, got %d", rec.Code)
	}
}

// openSharing lets tests that are not about visibility share freely between their users.
func openSharing(t *testing.T, store *storage.Store) {
	t.Helper()
	if store == nil {
		return
	}
	sys, err := store.GetSystemSettings()
	if err != nil {
		t.Fatalf("GetSystemSettings: %v", err)
	}
	sys.SharingMode = storage.SharingOpen
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatalf("UpdateSystemSettings: %v", err)
	}
}

// The setup switch "Beispieldaten anlegen" fills the new admin's account, but creates no other users
// (shared demo accounts exist only in demo mode).
func TestFirstBootSetupWithSampleData(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sample.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	srv := NewServer(&config.Config{Port: "8080", DatabasePath: dbPath, JWTSecret: "test-jwt-secret-key"}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)

	// Too short passwords are refused (FLAW-09)
	short := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(withSetupCode(srv, `{"email":"me@example.com","password":"secret"}`)))
	short.Header.Set("Content-Type", "application/json")
	short.Header.Set("Accept-Language", "de")
	shortRec := httptest.NewRecorder()
	srv.Router().ServeHTTP(shortRec, short)
	if shortRec.Code != http.StatusBadRequest || !strings.Contains(shortRec.Body.String(), "mindestens 8 Zeichen") {
		t.Fatalf("setup with 6 characters: want 400, got %d %s", shortRec.Code, shortRec.Body.String())
	}

	body := []byte(`{"email":"me@example.com","password":"secret123","displayName":"Ich","createSampleData":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(withSetupCode(srv, string(body))))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		User domain.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)

	if n, _ := store.CountUsers(); n != 1 {
		t.Fatalf("sample data must not create users, found %d", n)
	}
	docs, _ := store.GetDocuments(res.User.ID)
	lists, _ := store.GetTaskLists(res.User.ID)
	if len(docs) == 0 || len(lists) == 0 {
		t.Fatalf("expected sample notes and task lists, got %d notes, %d task lists", len(docs), len(lists))
	}
}

// Impressum and Datenschutz must be reachable without login; unset texts stay hidden.
func TestLegalTextsArePublic(t *testing.T) {
	// In memory: no files the cleanup could race with
	dbPath := ":memory:"
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	cfg := &config.Config{Port: "8080", DatabasePath: dbPath, JWTSecret: "test-jwt-secret-key",
		Legal: config.LegalTexts{
			ImprintContent:  "# Impressum\nMax Muster",
			PrivacyURL:      "https://example.org/datenschutz",
			CustomLinkLabel: "Support",
			CustomLinkURL:   "https://support.example.org",
		}}
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	defer srv.Close()
	router := srv.Router()

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/status", nil))
	var st struct {
		Legal struct {
			ImprintURL        string `json:"imprintUrl"`
			HasImprintContent bool   `json:"hasImprintContent"`
			PrivacyURL        string `json:"privacyUrl"`
			HasPrivacyContent bool   `json:"hasPrivacyContent"`
			CustomLinkLabel   string `json:"customLinkLabel"`
			CustomLinkURL     string `json:"customLinkUrl"`
		} `json:"legal"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if !st.Legal.HasImprintContent || st.Legal.HasPrivacyContent || st.Legal.PrivacyURL != "https://example.org/datenschutz" || st.Legal.CustomLinkLabel != "Support" || st.Legal.CustomLinkURL != "https://support.example.org" {
		t.Fatalf("unexpected legal status: %+v", st.Legal)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/legal/imprint", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Max Muster") {
		t.Fatalf("imprint without login: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/legal/privacy", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("privacy without text should be 404, got %d", rec.Code)
	}
}

// API keys only deliver data, and only what their scopes allow (FLAW-07). Revoked sessions are refused
// everywhere, the webhook ingest included.
func TestAPIKeysOnlyDeliverData(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, err := store.CreateAPIKey(claims.UserID, "Home Assistant", nil)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	do := func(method, path, auth, body string) int {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if strings.HasPrefix(auth, "mindsift_sec_") {
			req.Header.Set("X-API-Key", auth)
		} else {
			req.Header.Set("Authorization", "Bearer "+auth)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := do(http.MethodPost, "/api/v1/inbox", key.RawKey, `{"content":"Waschmaschine fertig"}`); code >= 300 {
		t.Fatalf("API key must be able to post into the inbox, got %d", code)
	}
	// Default key = triage only
	if code := do(http.MethodPost, "/api/v1/inbox", key.RawKey, `{"content":"Filter wechseln","target":"task"}`); code != http.StatusForbidden {
		t.Fatalf("triage-only key must not create tasks, got %d", code)
	}
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", key.RawKey, `{"content":"Milch","target":"list_item","listId":"x"}`); code != http.StatusForbidden {
		t.Fatalf("triage-only key must not add list items, got %d", code)
	}
	full, _ := store.CreateAPIKey(claims.UserID, "Alles", []string{"webhook:task", "webhook:list"})
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", full.RawKey, `{"title":"Filter wechseln","target":"task","priority":"high"}`); code != http.StatusCreated {
		t.Fatalf("task scope must create a task, got %d", code)
	}
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", full.RawKey, `{"content":"Rauchmelder"}`); code != http.StatusForbidden {
		t.Fatalf("key without triage scope must not fill the inbox, got %d", code)
	}
	list, _ := store.CreateList(claims.UserID, "Einkauf", "", "shopping")
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", full.RawKey, `{"content":"Milch","target":"list_item","listId":"`+list.ID+`","quantity":"2"}`); code != http.StatusCreated {
		t.Fatalf("list scope must add the item, got %d", code)
	}
	if items, _ := store.GetListItems(list.ID); len(items) != 1 || items[0].Quantity != "2" {
		t.Fatalf("list item not stored: %+v", items)
	}
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "member")
	foreign, _ := store.CreateList(other.ID, "Fremd", "", "shopping")
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", full.RawKey, `{"content":"Spam","target":"list_item","listId":"`+foreign.ID+`"}`); code != http.StatusNotFound {
		t.Fatalf("key must not write into lists its owner cannot see, got %d", code)
	}
	// Keys never open live streams (those carry the user's data)
	streamReq := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	streamReq.Header.Set("Authorization", "Bearer "+full.RawKey)
	if u, _ := srv.authenticateUserFromReq(streamReq); u != nil {
		t.Fatalf("API key must not authenticate a live stream")
	}
	if code := do(http.MethodGet, "/api/v1/documents", key.RawKey, ""); code != http.StatusForbidden {
		t.Fatalf("API key must not read notes, got %d", code)
	}
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", key.RawKey, `{"content":"Rauchmelder"}`); code >= 300 {
		t.Fatalf("API key must work on the webhook ingest, got %d", code)
	}
	// Logged-out session token: refused by the ingest as well (was FLAW-08)
	if code := do(http.MethodPost, "/api/v1/auth/logout", token, ""); code >= 300 {
		t.Fatalf("logout: %d", code)
	}
	if code := do(http.MethodPost, "/api/v1/webhooks/ingest", token, `{"content":"x"}`); code != http.StatusUnauthorized {
		t.Fatalf("revoked token must be refused by the ingest, got %d", code)
	}
}

func TestPasswordResetFlow(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	post := func(path, body string) (int, string) {
		req := httptest.NewRequest("POST", path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code, rec.Body.String()
	}

	// Without BASE_URL and SMTP the feature is off
	if code, _ := post("/api/v1/auth/forgot-password", `{"email":"x@example.com"}`); code != http.StatusServiceUnavailable {
		t.Errorf("forgot-password without setup: want 503, got %d", code)
	}

	// The link from the mail sets a new password once and ends the old sessions
	u, _ := store.CreateUser("reset@example.com", "hash", "Reset", "member")
	raw, err := store.CreatePasswordResetToken(u.ID)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	if code, _ := post("/api/v1/auth/reset-password", `{"token":"`+raw+`","password":"abc"}`); code != http.StatusBadRequest {
		t.Errorf("too short password must be refused, got %d", code)
	}
	if code, body := post("/api/v1/auth/reset-password", `{"token":"`+raw+`","password":"neues-passwort"}`); code != http.StatusOK {
		t.Fatalf("reset: %d %s", code, body)
	}
	if code, _ := post("/api/v1/auth/login", `{"login":"reset@example.com","password":"neues-passwort"}`); code != http.StatusOK {
		t.Errorf("login with the new password failed: %d", code)
	}
	if code, _ := post("/api/v1/auth/reset-password", `{"token":"`+raw+`","password":"nochmal1"}`); code != http.StatusBadRequest {
		t.Errorf("token must work only once, got %d", code)
	}
}

func TestShareTargetFallbackRedirects(t *testing.T) {
	store, err := storage.NewStore(":memory:")
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	srv := NewServer(&config.Config{Port: "8080", DatabasePath: ":memory:", JWTSecret: "test-jwt-secret-key"}, store, ws.NewHub(), nil)
	defer srv.Close()
	router := srv.Router()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/share-target", nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("expected 303 See Other, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/" {
		t.Fatalf("expected Location '/', got %q", loc)
	}
}

// testSession starts a server-side session, as a login would, for tokens made directly in tests.
func testSession(t *testing.T, store *storage.Store, userID string) string {
	t.Helper()
	sid, err := store.CreateSession(userID, "go-test", "192.0.2.1", storage.SessionViaPassword)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return sid
}

// List entries move between lists only if the user may edit both
func TestMoveListItemBetweenLists(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	move := func(listID, itemID, target string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/lists/"+listID+"/items/"+itemID+"/move", strings.NewReader(`{"targetListId":"`+target+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	from, _ := store.CreateList(claims.UserID, "Einkauf", "", "shopping")
	to, _ := store.CreateList(claims.UserID, "Baumarkt", "", "shopping")
	item, _ := store.CreateListItem(from.ID, "Schrauben", "werkzeug", "20", 3, claims.UserID)

	if code := move(from.ID, item.ID, to.ID); code != http.StatusOK {
		t.Fatalf("move: %d", code)
	}
	if items, _ := store.GetListItems(from.ID); len(items) != 0 {
		t.Fatalf("item still in the source list: %+v", items)
	}
	items, _ := store.GetListItems(to.ID)
	if len(items) != 1 || items[0].Content != "Schrauben" || items[0].Category != "werkzeug" || items[0].Quantity != "20" {
		t.Fatalf("item not moved intact: %+v", items)
	}

	// Read-only target and foreign lists are refused
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "member")
	readOnly, _ := store.CreateList(other.ID, "Nur lesen", "", "shopping")
	if _, err := store.AddListShare(other.ID, readOnly.ID, "user", claims.UserID, "viewer"); err != nil {
		t.Fatalf("share: %v", err)
	}
	if code := move(to.ID, item.ID, readOnly.ID); code != http.StatusForbidden {
		t.Fatalf("read-only target must be refused, got %d", code)
	}
	foreign, _ := store.CreateList(other.ID, "Fremd", "", "shopping")
	if code := move(to.ID, item.ID, foreign.ID); code != http.StatusNotFound {
		t.Fatalf("foreign target must be refused, got %d", code)
	}
	if code := move(from.ID, item.ID, to.ID); code != http.StatusNotFound {
		t.Fatalf("item addressed through the wrong list must be refused, got %d", code)
	}
}
