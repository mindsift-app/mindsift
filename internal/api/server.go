package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"html"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

type Server struct {
	cfg      *config.Config
	store    *storage.Store
	wsHub    *ws.Hub
	staticFS fs.FS
	// licensesFile: THIRD_PARTY_LICENSES.txt, served at /third-party-licenses.txt (licenses.go); tests set it
	licensesFile string
	// setupMu: the first-boot setup runs once at a time
	setupMu sync.Mutex
	// setupCode: the one-time code the first-boot setup asks for (setup_code.go)
	setupCode setupCodeState

	leases   *collab.LeaseManager // block leases and open sessions of notes
	notifier *collab.Notifier     // wakes long-poll requests on note changes
	draw     *drawHub             // live drawing sessions (drawlive.go)

	demo          demoState     // periodic reset in demo mode (demo.go)
	streamTickets streamTickets // one-time tickets for WebSocket/SSE (streamticket.go)
	loginGuard    *loginGuard   // brute-force protection (loginguard.go)
	imports       importGate    // imports running at a time (importgate.go)
	mfaChallenges mfaChallenges // second step of a sign-in with a second factor (mfa.go)
	// passkeyChallenges: the challenges of passkey ceremonies, registration, confirmation, sign-in (passkeys.go)
	passkeyChallenges passkeyChallenges
	voice             *voiceService // self-hosted speech recognition (voice.go)
	metrics           *apiMetrics   // what /metrics reports (metrics.go)
	// oidc: sign-in through an OpenID Connect provider (oidc.go); nil while it is off
	oidc *oidcService
	// now: the time codes of authenticator apps and trusted devices are checked against (tests set it)
	now func() time.Time

	// Replace the delivery of bundled notifications in tests (notify.go)
	notifyEmailHook   func(to, subject, text, html string) error
	notifyDiscordHook func(webhookURL, heading string, items []notifyItem) error
	notifyWebhookHook func(webhookURL, heading string, items []notifyItem) error
	notifyPushHook    func(userID string, msg pushMessage) error
	pushHTTPClient    *http.Client // tests: reach a local push service
	push              pushKeys

	// Background jobs (tickers, compaction, backups); Close stops them
	stop     chan struct{}
	stopOnce sync.Once
	bg       sync.WaitGroup
}

func NewServer(cfg *config.Config, store *storage.Store, wsHub *ws.Hub, staticFS fs.FS) *Server {
	store.ConfiguredLanguage = cfg.DefaultLanguage
	srv := &Server{
		cfg:      cfg,
		store:    store,
		wsHub:    wsHub,
		staticFS: staticFS,
		// Next to the binary: /app/ in the image, the unpacked folder of a release archive
		licensesFile: defaultThirdPartyLicenses(),
		leases:       collab.NewLeaseManager(nil),
		notifier:     collab.NewNotifier(),
		stop:         make(chan struct{}),
		now:          time.Now,
	}
	srv.loginGuard = newLoginGuard(!cfg.DisableLoginProtection)
	srv.prepareSetupCode()
	srv.metrics = newAPIMetrics(srv)
	var oidcOff string
	srv.oidc, oidcOff = newOIDCService(cfg)
	srv.logOIDCSetup(oidcOff)
	srv.voice = newVoiceService(cfg.Speech.MaxParallel)
	if srv.voiceMode() == "server" {
		go srv.startVoiceCheck()
	}
	srv.draw = newDrawHub()
	wsHub.SetRoomAuthorizer(srv.canJoinRoom)
	wsHub.SetMessageHandler(drawMessageHandler{srv})
	wsHub.SetOriginCheck(srv.streamOriginAllowed)
	// Next occurrences of repeating tasks appear live on every connected client
	store.OnTaskCreated = func(th *domain.Thought) {
		srv.wsHub.BroadcastToUsers(srv.taskAudience(th), "TASK_CREATED", th)
	}
	srv.background(srv.startCompaction)
	srv.background(srv.startDrawTicker)
	if cfg.DemoMode && cfg.DemoResetMinutes > 0 {
		srv.background(srv.startDemoResetTicker)
	}
	// The demo sends nothing (FLAW-33); its alarm ticker only fills the notification center
	srv.background(srv.startAlarmTicker)
	if !cfg.DemoMode {
		srv.background(srv.startNotificationJobs)
		srv.background(srv.startBackupScheduler)
		srv.background(srv.startDoneCleanupTicker)
	}
	return srv
}

// background runs a job of the server until Close (each job returns once s.stop is closed).
func (s *Server) background(job func()) {
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		job()
	}()
}

// wait pauses a background job for d; false means the server is stopping and the job should return.
func (s *Server) wait(d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-s.stop:
		return false
	case <-t.C:
		return true
	}
}

// canJoinRoom allows realtime rooms only to users with read access: "doc:<id>" for notes, otherwise a shared list ID.
func (s *Server) canJoinRoom(userID, room string) bool {
	if docID, ok := strings.CutPrefix(room, "doc:"); ok {
		return s.store.DocRole(userID, docID) != ""
	}
	// Live drawings: "drawing:<docId>:<blockId>", everyone who can read the note may watch
	if rest, ok := strings.CutPrefix(room, "drawing:"); ok {
		docID, _, _ := strings.Cut(rest, ":")
		return s.store.DocRole(userID, docID) != ""
	}
	_, err := s.store.GetListByID(userID, room)
	return err == nil
}

// taskAudience returns everyone who can see a task: its owner plus all users of its task list.
func (s *Server) taskAudience(th *domain.Thought) []string {
	if th == nil {
		return nil
	}
	return append(s.store.GetTaskListUserIDs(th.TaskListID), th.UserID)
}

// Close stops the background jobs and waits until running passes have finished, so the database can be
// closed safely afterwards (tests close it right away; a pass still writing would race with that, and a
// ticker left running would keep logging failed queries on the closed database).
func (s *Server) Close() {
	s.stopOnce.Do(func() { close(s.stop) })
	s.bg.Wait()
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()

	r.Use(s.clientIPMiddleware)
	r.Use(s.languageMiddleware)
	r.Use(s.securityHeaders)
	r.Use(s.bodyLimit)
	r.Use(s.demoResetGate)
	r.Use(middleware.Recoverer)
	r.Use(s.apiLoggingMiddleware)
	// Browsers of other sites may only call the API when no BASE_URL is set (auth runs over the
	// Authorization header, never cookies, so credentials are not allowed either way)
	allowedOrigins := []string{"*"}
	if s.cfg.BaseURLSet {
		allowedOrigins = []string{strings.TrimRight(s.cfg.BaseURL, "/")}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-API-Key", "Mcp-Session-Id", "MCP-Protocol-Version"},
		ExposedHeaders:   []string{"Link", "X-Session-Token"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	// HEAD answers like GET without a body (curl -I, uptime monitors); the server drops what a handler
	// writes. There are no HEAD routes of our own, so this covers every GET route.
	r.Use(middleware.GetHead)

	// Public Health, Setup & Auth Routes
	r.Get("/api/v1/health", s.handleHealth)
	// Prometheus, only with METRICS_TOKEN (metrics.go); otherwise /metrics stays an unknown path (404)
	if s.cfg.MetricsToken != "" {
		r.Get("/metrics", s.handleMetrics)
	}
	r.Get("/api/v1/auth/status", s.handleAuthStatus)
	r.Get("/api/v1/legal/{type}", s.handleLegalText)
	r.Post("/api/v1/auth/setup", s.handleFirstBootSetup)
	r.Post("/api/v1/auth/verify-email", s.handleVerifyEmail)
	r.Post("/api/v1/auth/confirm-email", s.handleConfirmEmailChange)
	r.Post("/api/v1/auth/resend-verification", s.handleResendVerification)
	r.Post("/api/v1/auth/register", s.handleRegister)
	r.Post("/api/v1/auth/login", s.handleLogin)
	r.Post("/api/v1/auth/login/mfa", s.handleLoginMFA)
	r.Post("/api/v1/auth/login/mfa/passkey/options", s.passkeysOnly(s.handleMFAPasskeyOptions))
	r.Post("/api/v1/auth/login/mfa/passkey", s.passkeysOnly(s.handleLoginMFAPasskey))
	r.Post("/api/v1/auth/login/passkey/options", s.passkeysOnly(s.handlePasskeyLoginOptions))
	r.Post("/api/v1/auth/login/passkey", s.passkeysOnly(s.handlePasskeyLogin))
	r.Post("/api/v1/auth/forgot-password", s.handleForgotPassword)
	// Sign-in through an OpenID Connect provider (oidc.go)
	r.Post("/api/v1/auth/oidc/start", s.oidcOnly(s.handleOIDCStart))
	r.Get("/api/v1/auth/oidc/callback", s.oidcOnly(s.handleOIDCCallback))
	r.Post("/api/v1/auth/oidc/exchange", s.oidcOnly(s.handleOIDCExchange))
	r.Post("/api/v1/auth/reset-password", s.handleResetPassword)
	r.Post("/api/v1/webhooks/ingest", s.handleWebhookIngest)
	// Public links to notes (no login; the token is the access, publiclinks.go)
	r.Get("/api/v1/public/{token}", s.handlePublicNote)
	r.Post("/api/v1/public/{token}/unlock", s.handlePublicUnlock)
	r.Get("/api/v1/public/{token}/media/{mediaId}", s.handlePublicMedia)
	r.Get("/api/v1/ws", s.handleWebSocket)
	r.Get("/api/v1/ws/lists/{listId}", s.handleWebSocket)
	r.Get("/api/v1/events", s.handleSSE)

	// OAuth for the MCP endpoint (oauth.go); the consent page /oauth/authorize is part of the app
	r.Get("/.well-known/oauth-protected-resource", s.oauthOnly(s.handleOAuthProtectedResource))
	r.Get("/.well-known/oauth-protected-resource/*", s.oauthOnly(s.handleOAuthProtectedResource))
	r.Get("/.well-known/oauth-authorization-server", s.oauthOnly(s.handleOAuthServerMetadata))
	r.Post("/oauth/register", s.oauthOnly(s.handleOAuthRegister))
	r.Post("/oauth/token", s.oauthOnly(s.handleOAuthToken))
	r.Post("/oauth/revoke", s.oauthOnly(s.handleOAuthRevoke))

	// Authenticated API Routes
	r.Group(func(r chi.Router) {
		r.Use(s.authMiddleware)

		r.Get("/api/v1/auth/me", s.handleMe)
		r.Post("/api/v1/events/rooms", s.handleSSERooms)
		r.Post("/api/v1/events/poll", s.handleOpenPoll)
		r.Get("/api/v1/events/poll/{id}", s.handlePoll)
		r.Post("/api/v1/auth/stream-ticket", s.handleStreamTicket)
		r.Post("/api/v1/voice/transcribe", s.handleVoiceTranscribe)
		r.Post("/api/v1/documents/{id}/media", s.handleUploadMedia)
		r.Post("/api/v1/documents/{id}/media/fetch", s.notInDemo(s.handleFetchMedia))
		r.Post("/api/v1/documents/{id}/secrets", s.handleCreateSecret)
		r.Get("/api/v1/documents/{id}/secrets/{secretId}", s.handleRevealSecret)
		r.Put("/api/v1/documents/{id}/secrets/{secretId}", s.handleUpdateSecret)
		r.Get("/api/v1/media/{id}", s.handleGetMedia)
		r.Post("/api/v1/documents/{id}/extract", s.handleExtractBranch)
		r.Post("/api/v1/tasks/{id}/watch", s.handleWatchTask)
		r.Delete("/api/v1/tasks/{id}/watch", s.handleWatchTask)
		r.Post("/api/v1/documents/{id}/extract/undo", s.handleUndoExtract)
		r.Post("/api/v1/documents/{id}/branches/move", s.handleMoveBranch)
		r.Post("/api/v1/documents/{id}/branches/move/undo", s.handleUndoMove)
		// Earlier address of moving a branch; PUT on it moves the note into a folder. Kept for apps that
		// are still open or installed with older code
		r.Post("/api/v1/documents/{id}/move", s.handleMoveBranch)
		r.Post("/api/v1/documents/{id}/move/undo", s.handleUndoMove)
		r.Post("/api/v1/documents/{id}/inline", s.handleInlineNote)
		r.Post("/api/v1/documents/{id}/merge", s.handleMergeDocuments)
		r.Post("/api/v1/documents/{id}/merge/undo", s.handleUndoMerge)
		r.Get("/api/v1/link-preview", s.notInDemo(s.handleLinkPreview))
		r.Get("/api/v1/link-preview/{key}/{kind}", s.handleLinkPreviewPicture)
		r.Get("/api/v1/auth/sessions", s.handleListSessions)
		r.Delete("/api/v1/auth/sessions/{id}", s.notInDemo(s.handleEndSession))
		r.Post("/api/v1/auth/logout", s.handleLogout)
		r.Post("/api/v1/auth/revoke-all", s.notInDemo(s.handleRevokeAllSessions))
		// Two-factor sign-in of the own account (mfa.go)
		r.Get("/api/v1/auth/mfa", s.handleMFAStatus)
		r.Post("/api/v1/auth/oidc/confirm", s.oidcOnly(s.handleOIDCConfirm))
		r.Post("/api/v1/auth/mfa/totp/setup", s.notInDemo(s.handleTOTPSetup))
		r.Post("/api/v1/auth/mfa/totp/confirm", s.notInDemo(s.handleTOTPConfirm))
		r.Post("/api/v1/auth/mfa/totp/disable", s.notInDemo(s.handleTOTPDisable))
		r.Post("/api/v1/auth/mfa/recovery-codes", s.notInDemo(s.handleNewRecoveryCodes))
		r.Delete("/api/v1/auth/mfa/trusted-devices", s.notInDemo(s.handleRemoveTrustedDevices))
		r.Delete("/api/v1/auth/mfa/trusted-devices/{id}", s.notInDemo(s.handleRemoveTrustedDevice))
		// Passkeys of the own account (passkeys.go)
		r.Post("/api/v1/auth/mfa/passkeys/challenge", s.passkeysOnly(s.handlePasskeyChallenge))
		r.Post("/api/v1/auth/mfa/passkeys/register/options", s.passkeysOnly(s.handlePasskeyRegisterOptions))
		r.Post("/api/v1/auth/mfa/passkeys", s.passkeysOnly(s.handlePasskeyRegister))
		r.Patch("/api/v1/auth/mfa/passkeys/{id}", s.notInDemo(s.handleRenamePasskey))
		r.Delete("/api/v1/auth/mfa/passkeys/{id}", s.notInDemo(s.handleRemovePasskey))
		r.Patch("/api/v1/auth/settings", s.handleUpdateUserSettings)
		r.Post("/api/v1/auth/alarms/test", s.notInDemo(s.handleTestUserAlarm))
		r.Get("/api/v1/users/directory", s.handleGetUsersDirectory)
		r.Post("/api/v1/users/lookup", s.handleLookupUser)
		r.Get("/api/v1/collaborators", s.handleGetCollaborators)
		r.Get("/api/v1/mentions/candidates", s.handleMentionCandidates)
		r.Get("/api/v1/notifications", s.handleGetCenter)
		r.Post("/api/v1/notifications/read", s.handleCenterRead)
		r.Delete("/api/v1/notifications", s.handleClearCenter)
		r.Get("/api/v1/stats", s.handleStats)
		r.Get("/api/v1/search", s.handleSearch)
		r.Get("/api/v1/export", s.handleExport)
		r.Get("/api/v1/backups", s.handleListMyBackups)
		r.Get("/api/v1/backups/{name}", s.handleDownloadMyBackup)
		r.Post("/api/v1/backups/{name}/restore", s.handleRestoreMyBackup)
		r.Get("/api/v1/export/markdown", s.handleExportMarkdown)
		r.Post("/api/v1/import/mindsift", s.handleImportMindSift)
		r.Delete("/api/v1/user/data", s.notInDemo(s.handlePurgeOwnData))
		r.Delete("/api/v1/user/account", s.notInDemo(s.handleDeleteOwnAccount))
		r.Delete("/api/v1/user/email-change/{kind}", s.handleCancelEmailChange)
		r.Post("/api/v1/user/email-change/{kind}/resend", s.notInDemo(s.handleResendEmailChange))
		r.Post("/api/v1/import/obsidian", s.handleImportObsidian)
		r.Get("/api/v1/themes", s.handleGetThemes)
		r.Post("/api/v1/themes", s.handleSaveTheme)
		r.Delete("/api/v1/themes/{id}", s.handleDeleteTheme)

		// Instant Capture & Thoughts
		r.Post("/api/v1/inbox", s.handleCaptureInbox)
		r.Get("/api/v1/thoughts", s.handleGetThoughts)
		r.Get("/api/v1/thoughts/{id}", s.handleGetThought)
		r.Patch("/api/v1/thoughts/{id}", s.handleUpdateThought)
		r.Delete("/api/v1/thoughts/{id}", s.handleDeleteThought)
		r.Delete("/api/v1/thoughts/discarded/purge", s.handlePurgeDiscarded)

		// Triage (swipe-style cards) & Tasks
		r.Get("/api/v1/triage/deck", s.handleGetTriageDeck)
		r.Patch("/api/v1/triage/{id}", s.handleTriageAction)
		r.Get("/api/v1/tasks", s.handleGetTasks)
		r.Post("/api/v1/tasks/{id}/unlink", s.handleUnlinkEnhancedTask)
		r.Post("/api/v1/tasks/reorder", s.handleReorderTasks)
		r.Post("/api/v1/tasks/clear-done", s.handleClearDoneTasks)
		r.Get("/api/v1/tasks/trash", s.handleGetTaskTrash)
		r.Post("/api/v1/tasks/trash/empty", s.handleEmptyTaskTrash)
		r.Post("/api/v1/tasks/trash/{id}/restore", s.handleRestoreTrashedTask)
		r.Delete("/api/v1/tasks/trash/{id}", s.handlePurgeTrashedTask)
		r.Post("/api/v1/task-lists/{id}/tasks/reorder", s.handleReorderTasks)

		// Task Lists & Shares
		r.Get("/api/v1/task-lists", s.handleGetTaskLists)
		r.Put("/api/v1/task-lists/order", s.handleListOrder(storage.ListOrderTaskLists))
		r.Post("/api/v1/task-lists", s.handleCreateTaskList)
		r.Put("/api/v1/task-lists/{id}", s.handleUpdateTaskList)
		r.Delete("/api/v1/task-lists/{id}", s.handleDeleteTaskList)
		r.Put("/api/v1/task-lists/{id}/mute", s.handleMuteTaskList)
		r.Delete("/api/v1/task-lists/{id}/mute", s.handleMuteTaskList)
		r.Get("/api/v1/task-lists/{id}/shares", s.handleGetTaskListShares)
		r.Post("/api/v1/task-lists/{id}/shares", s.handleCreateTaskListShare)
		r.Delete("/api/v1/task-lists/{id}/shares/{shareId}", s.handleDeleteTaskListShare)

		// Workspace Documents & Folders
		r.Get("/api/v1/folders", s.handleGetFolders)
		r.Post("/api/v1/folders", s.handleCreateFolder)
		r.Post("/api/v1/folders/move", s.handleMoveFolder)
		r.Delete("/api/v1/folders", s.handleDeleteFolder)
		r.Post("/api/v1/folders/trash/{id}/restore", s.handleRestoreFolder)
		r.Delete("/api/v1/folders/trash/{id}", s.handlePurgeFolder)

		r.Get("/api/v1/workspace/folders/shared", s.handleGetSharedFolders)
		r.Post("/api/v1/workspace/folders/shared", s.handleCreateSharedFolder)
		r.Get("/api/v1/workspace/folders/shared/{id}", s.handleGetSharedFolderByID)
		r.Delete("/api/v1/workspace/folders/shared/{id}", s.handleDeleteSharedFolder)
		r.Put("/api/v1/workspace/folders/shared/{id}/mount", s.handleUpdateFolderMount)
		r.Get("/api/v1/workspace/folders/shared/{id}/shares", s.handleGetFolderShares)
		r.Post("/api/v1/workspace/folders/shared/{id}/shares", s.handleCreateFolderShare)
		r.Delete("/api/v1/workspace/folders/shared/{id}/shares/{shareId}", s.handleDeleteFolderShare)

		// Workspace Tags & Pages
		r.Get("/api/v1/workspace/tags", s.handleGetWorkspaceTags)
		r.Get("/api/v1/workspace/tags/{tag}", s.handleGetTagDetails)
		r.Put("/api/v1/workspace/tags/{tag}/note", s.handleUpdateTagPageNote)

		r.Get("/api/v1/journal", s.handleGetJournal)
		r.Get("/api/v1/push/key", s.handlePushKey)
		r.Get("/api/v1/push/devices", s.handlePushDevices)
		r.Post("/api/v1/push/subscribe", s.handlePushSubscribe)
		r.Post("/api/v1/push/unsubscribe", s.handlePushUnsubscribe)
		r.Post("/api/v1/push/test", s.handlePushTest)
		r.Post("/api/v1/journal/{date}", s.handleOpenJournalDay)
		r.Get("/api/v1/documents", s.handleGetDocuments)
		r.Post("/api/v1/documents", s.handleCreateDocument)
		r.Get("/api/v1/documents/{id}", s.handleGetDocument)
		r.Put("/api/v1/documents/{id}", s.handleUpdateDocument)
		r.Put("/api/v1/documents/{id}/move", s.handleMoveDocument)
		r.Delete("/api/v1/documents/{id}", s.handleDeleteDocument)
		r.Get("/api/v1/documents/trash", s.handleGetTrash)
		r.Delete("/api/v1/documents/trash", s.handleEmptyTrash)
		r.Post("/api/v1/documents/{id}/restore", s.handleRestoreDocument)
		r.Get("/api/v1/documents/{id}/backlinks", s.handleGetBacklinks)
		r.Delete("/api/v1/documents/{id}/permanent", s.handlePurgeDocument)
		r.Post("/api/v1/documents/{id}/blocks/{blockId}/enhanced-task", s.handleCreateEnhancedTask)

		// Collaborative note editing (operation log)
		r.Get("/api/v1/docs/{id}/snapshot", s.handleDocSnapshot)
		r.Post("/api/v1/docs/{id}/sync", s.handleDocSync)
		r.Get("/api/v1/docs/{id}/changes", s.handleDocChanges)
		r.Post("/api/v1/docs/{id}/leave", s.handleDocLeave)
		r.Get("/api/v1/docs/{id}/drawings/{blockId}/live", s.handleDrawLive)
		r.Post("/api/v1/docs/{id}/drawings/{blockId}/watch", s.handleDrawWatch)

		// Document Sharing & Collaboration
		r.Get("/api/v1/documents/{id}/shares", s.handleGetDocShares)
		r.Get("/api/v1/documents/{id}/public-link", s.handleGetPublicLink)
		r.Put("/api/v1/documents/{id}/public-link", s.handleSetPublicLink)
		r.Delete("/api/v1/documents/{id}/public-link", s.handleDeletePublicLink)
		r.Post("/api/v1/documents/{id}/shares", s.handleCreateDocShare)
		r.Delete("/api/v1/documents/{id}/shares/{userId}", s.handleDeleteDocShare)

		// Shared Lists & Realtime Collaboration
		r.Get("/api/v1/lists", s.handleGetAllLists)
		r.Put("/api/v1/lists/order", s.handleListOrder(storage.ListOrderLists))
		r.Post("/api/v1/lists", s.handleCreateList)
		r.Get("/api/v1/lists/{id}", s.handleGetListByID)
		r.Patch("/api/v1/lists/{id}", s.handleUpdateList)
		r.Delete("/api/v1/lists/{id}", s.handleDeleteList)
		r.Get("/api/v1/lists/{id}/shares", s.handleGetListShares)
		r.Post("/api/v1/lists/{id}/shares", s.handleCreateListShare)
		r.Delete("/api/v1/lists/{id}/shares/{shareId}", s.handleDeleteListShare)
		r.Post("/api/v1/lists/{id}/items", s.handleCreateListItem)
		r.Patch("/api/v1/lists/{id}/items/{itemId}", s.handleToggleListItem)
		r.Put("/api/v1/lists/{id}/items/{itemId}", s.handleUpdateListItem)
		r.Delete("/api/v1/lists/{id}/items/{itemId}", s.handleDeleteListItem)
		r.Post("/api/v1/lists/{id}/items/{itemId}/move", s.handleMoveListItem)
		r.Post("/api/v1/lists/{id}/items/reorder", s.handleReorderListItems)
		r.Put("/api/v1/lists/{id}/items/reorder", s.handleReorderListItems) // same as POST, kept for older clients
		r.Post("/api/v1/lists/{id}/clear-completed", s.handleClearCompletedItems)

		// Groups (user-managed; stored as teams)
		r.Get("/api/v1/teams", s.handleGetUserTeams)
		r.Post("/api/v1/teams", s.handleCreateTeamDirect)
		r.Put("/api/v1/teams/{id}", s.handleUpdateTeam)
		r.Delete("/api/v1/teams/{id}", s.handleDeleteTeam)
		r.Post("/api/v1/teams/{id}/members", s.handleAddTeamMember)
		r.Put("/api/v1/teams/{id}/members/{userId}", s.handleUpdateTeamMemberRole)
		r.Delete("/api/v1/teams/{id}/members/{userId}", s.handleRemoveTeamMember)

		// MCP endpoint for AI agents (API key with agent scopes or a session); no server stream, so
		// GET and DELETE answer 405 instead of the SPA fallback
		r.Post(mcpPath, s.handleMCP)
		r.Get(mcpPath, handleMCPNoStream)
		r.Delete(mcpPath, handleMCPNoStream)
		r.Get("/api/v1/oauth/authorize", s.oauthOnly(s.handleOAuthAuthorizeInfo))
		r.Post("/api/v1/oauth/authorize", s.oauthOnly(s.handleOAuthAuthorize))

		// API Keys Management
		r.Get("/api/v1/keys", s.handleGetAPIKeys)
		r.Post("/api/v1/keys", s.handleCreateAPIKey)
		r.Patch("/api/v1/keys/{id}", s.handleUpdateAPIKey)
		r.Delete("/api/v1/keys/{id}", s.handleDeleteAPIKey)

		// Staff routes: server admins and user managers (members, invites, organizations)
		r.Group(func(r chi.Router) {
			r.Use(s.staffMiddleware)
			r.Get("/api/v1/admin/users", s.handleAdminGetUsers)
			r.Post("/api/v1/admin/users", s.notInDemo(s.handleAdminCreateUser))
			r.Patch("/api/v1/admin/users/{id}", s.notInDemo(s.handleAdminUpdateUser))
			r.Delete("/api/v1/admin/users/{id}", s.notInDemo(s.handleAdminDeleteUser))
			r.Post("/api/v1/admin/users/{id}/approve", s.notInDemo(s.handleAdminApproveUser))

			r.Get("/api/v1/admin/invites", s.handleAdminGetInvites)
			r.Post("/api/v1/admin/invites", s.handleAdminCreateInvite)
			r.Delete("/api/v1/admin/invites/{id}", s.handleAdminDeleteInvite)
			r.Post("/api/v1/admin/invites/{id}/send", s.notInDemo(s.handleAdminSendInvite))

			// Organizations decide who may share with whom
			r.Get("/api/v1/admin/organizations", s.handleAdminGetOrganizations)
			r.Post("/api/v1/admin/organizations", s.handleAdminCreateOrganization)
			r.Put("/api/v1/admin/organizations/{id}", s.handleAdminRenameOrganization)
			r.Delete("/api/v1/admin/organizations/{id}", s.handleAdminDeleteOrganization)
			r.Post("/api/v1/admin/organizations/{id}/members", s.handleAdminAddOrganizationMember)
			r.Delete("/api/v1/admin/organizations/{id}/members/{userId}", s.handleAdminRemoveOrganizationMember)
		})

		// Server admins only: settings, backups, voice, mail, passwords
		r.Group(func(r chi.Router) {
			r.Use(s.adminMiddleware)
			r.Put("/api/v1/admin/users/{id}/password", s.notInDemo(s.handleAdminResetPassword))
			r.Post("/api/v1/admin/users/{id}/mfa/reset", s.notInDemo(s.handleAdminResetMFA))
			r.Get("/api/v1/admin/settings", s.handleAdminGetSettings)
			// The wizard's instance settings after an admin from ADMIN_USER (initial_admin.go)
			r.Post("/api/v1/admin/setup", s.notInDemo(s.handleFinishSetup))
			r.Get("/api/v1/admin/setup/status", s.handleSetupStatus)
			r.Get("/api/v1/admin/backups", s.handleAdminListBackups)
			r.Post("/api/v1/admin/backups", s.notInDemo(s.handleAdminRunBackup))
			r.Get("/api/v1/admin/backups/{name}", s.handleAdminDownloadBackup)
			r.Delete("/api/v1/admin/backups/{name}", s.notInDemo(s.handleAdminDeleteBackup))
			r.Get("/api/v1/admin/backups/deleted", s.handleAdminDeletedBackups)
			r.Get("/api/v1/admin/backups/deleted/{userId}/{name}", s.handleAdminDownloadDeletedBackup)
			r.Put("/api/v1/admin/settings", s.notInDemo(s.handleAdminUpdateSettings))
			r.Get("/api/v1/admin/settings/sharing-impact", s.handleAdminSharingImpact)
			r.Get("/api/v1/admin/voice", s.handleAdminVoiceStatus)
			r.Post("/api/v1/admin/smtp/test", s.notInDemo(s.handleAdminTestSMTP))
		})
	})

	// Web Share Target fallback when service worker is not active yet: redirect to /
	r.Post("/share-target", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
	})

	// Licenses of the third-party software in this build (licenses.go), linked in the app's About part
	r.Get("/third-party-licenses.txt", s.handleThirdPartyLicenses)

	// Embedded Frontend SPA Handler
	if s.staticFS != nil {
		fileServer := http.FileServer(http.FS(s.staticFS))
		r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
			// Public note pages (/p/<token>): never indexed, the token never leaves as referrer
			publicPage := strings.HasPrefix(req.URL.Path, "/p/")
			if publicPage {
				publicHeaders(w)
			}
			// An API path that does not exist is an error for API clients and agents, not the app's page
			if strings.HasPrefix(req.URL.Path, "/api/") {
				writeError(w, http.StatusNotFound, "Nicht gefunden")
				return
			}
			path := strings.TrimPrefix(req.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}
			if info, err := fs.Stat(s.staticFS, path); err != nil {
				if notAppPage(path) {
					http.NotFound(w, req)
					return
				}
				req.URL.Path = "/"
				path = "index.html"
			} else if info.IsDir() {
				// No listing of the build's folders (/assets/)
				http.NotFound(w, req)
				return
			}
			if path == "index.html" || path == "sw.js" || path == "manifest.json" || path == "version.json" {
				w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
				w.Header().Set("Pragma", "no-cache")
				w.Header().Set("Expires", "0")
			}
			if path == "manifest.json" {
				if data, err := fs.ReadFile(s.staticFS, path); err == nil {
					lang := s.requestLanguage(req)
					w.Header().Set("Content-Type", "application/manifest+json")
					w.Header().Set("Content-Language", lang)
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(localizeStatic(data, lang))
					return
				}
			}
			if path == "index.html" {
				if data, err := fs.ReadFile(s.staticFS, "index.html"); err == nil {
					// The page keeps the default language (German when none is set), unlike API answers
					lang := s.requestLanguage(req)
					w.Header().Set("Content-Language", lang)
					data = localizeStatic(data, lang)
					origin := requestOrigin(req)
					if s.cfg.BaseURLSet {
						origin = strings.TrimRight(s.cfg.BaseURL, "/")
					}
					if origin != "" {
						origin = html.EscapeString(origin)
						htmlStr := string(data)
						htmlStr = strings.ReplaceAll(htmlStr, `content="/og-image.png"`, `content="`+origin+`/og-image.png"`)
						htmlStr = strings.ReplaceAll(htmlStr, `property="og:url" content="/"`, `property="og:url" content="`+origin+`/"`)
						data = []byte(htmlStr)
					}
					if publicPage {
						data = []byte(strings.Replace(string(data), "<head>", `<head><meta name="robots" content="noindex, nofollow, noarchive">`, 1))
					}
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(data)
					return
				}
			}
			fileServer.ServeHTTP(w, req)
		})
	}

	return r
}

// notAppPage: a path missing from the build that is not one of the app's pages either, so it answers
// 404 instead of index.html (scanners read a 200 for /.env or /data/mindsift.db as a hit). The app's
// pages are "/", "/p/<token>" and "/oauth/authorize", with views in the query (?note=…); none has a file
// extension or a segment starting with a dot. /metrics and /debug/ (pprof) are what scanners look for on
// a Go server; MindSift has neither.
func notAppPage(path string) bool {
	if strings.HasPrefix(path, "assets/") {
		return true
	}
	segs := strings.Split(path, "/")
	for _, seg := range segs {
		if strings.HasPrefix(seg, ".") {
			return true
		}
	}
	return strings.Contains(segs[len(segs)-1], ".") || segs[0] == "metrics" || segs[0] == "debug"
}

// --- HELPERS & MIDDLEWARE ---

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// writeError answers with the message in the language of the request (languageMiddleware); the code
// lets the app react to one specific error regardless of the language
// staticTexts: the German texts of index.html (description, link preview) and manifest.json (app
// description, shortcuts), served in the browser's language
var staticTexts = []string{
	"MindSift — Notizen, Aufgaben und ein freier Kopf, selbst gehostet. Verschachtelte Notizen, Aufgaben mit Kanban und Kalender, gemeinsame Listen und eine Triage für alles Unsortierte.",
	"MindSift — Notizen, Aufgaben und ein freier Kopf, selbst gehostet",
	"Verschachtelte Notizen, Aufgaben mit Kanban und Kalender, gemeinsame Listen und eine Triage für alles Unsortierte.",
	"MindSift App Logo & Vorschau",
	"Gedanken schnell in die Triage werfen",
	"Neue Aufgabe",
	"Aufgabe",
	"Direkt eine neue Aufgabe anlegen",
	"Einkaufsliste",
	"Einen Eintrag zur Einkaufsliste hinzufügen",
}

// localizeStatic translates the quoted staticTexts of a static file and sets <html lang>.
func localizeStatic(data []byte, lang string) []byte {
	out := strings.Replace(string(data), `<html lang="de"`, `<html lang="`+lang+`"`, 1)
	for _, de := range staticTexts {
		out = strings.ReplaceAll(out, `"`+de+`"`, `"`+i18n.T(lang, de)+`"`)
	}
	return []byte(out)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": tr(w, message)})
}

// writeUsernameError answers a refused username: taken is 409 (code username_taken), the rest 400
func writeUsernameError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrUsernameTaken):
		writeErrorCode(w, http.StatusConflict, "username_taken", storage.ErrUsernameTaken.Msg)
	case errors.Is(err, storage.ErrInvalidUsername):
		writeErrorCode(w, http.StatusBadRequest, "username_invalid", storage.ErrInvalidUsername.Msg)
	default:
		writeErrorFrom(w, http.StatusBadRequest, err)
	}
}

func writeErrorCode(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": tr(w, message), "code": code})
}

// errInternal is what clients see of an unexpected failure; the details (SQL, paths, driver messages)
// only go to the server log, not to browsers or AI agents.
const errInternal = "Interner Fehler – Details stehen im Server-Log"

// clientMessage: err as clients may see it. Texts written for people (from the catalog, or errors that
// say themselves in every language) pass; anything else is logged and replaced by errInternal.
func clientMessage(err error) string {
	if clientSafe(err) {
		return err.Error()
	}
	slog.Error("Request failed", "error", err)
	return errInternal
}

// clientSafe: err's text was written for people, a message of the catalog (also "Kontext: Meldung") or one
// with placeholders (i18n.Localizer). Anything else (SQL, driver, I/O, addresses) stays in the server log.
func clientSafe(err error) bool {
	var l i18n.Localizer
	return errors.As(err, &l) || i18n.Known(err.Error())
}

// writeErrorFrom answers err with status when its text is meant for people, in the request's language;
// anything else is an internal failure: logged, 500 with the fixed text (writeInternal).
func writeErrorFrom(w http.ResponseWriter, status int, err error) {
	if !clientSafe(err) {
		writeInternal(w, err)
		return
	}
	writeJSON(w, status, map[string]string{"error": trErr(w, err)})
}

// writeInternal answers an unexpected failure with 500 (see clientMessage).
func writeInternal(w http.ResponseWriter, err error) {
	writeError(w, http.StatusInternalServerError, clientMessage(err))
}

// logFailed logs the failure of a step the answer does not depend on (cleaning up, something on the
// side), so it is not lost. what names the step: "Setting the language".
func logFailed(what string, err error, args ...any) {
	if err != nil {
		slog.Warn(what+" failed", append(args, "error", err)...)
	}
}

// writeStoreError maps read-only task list violations to 403, a missing row (no access or gone) to 404,
// and everything else to the given fallback status. A raw sql.ErrNoRows is never shown to the client.
func writeStoreError(w http.ResponseWriter, fallbackStatus int, err error) {
	if errors.Is(err, storage.ErrTaskListReadOnly) || errors.Is(err, storage.ErrAssigneeNoAccess) {
		writeErrorFrom(w, http.StatusForbidden, err)
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Nicht gefunden oder kein Zugriff")
		return
	}
	writeErrorFrom(w, fallbackStatus, err)
}

// logPath: the request path as logged. The token of a public link is the only key to it and lands in
// the log exactly when it fails (password missing, expired), so it is left out.
func logPath(path string) string {
	const public = "/api/v1/public/"
	if rest, ok := strings.CutPrefix(path, public); ok && rest != "" {
		if i := strings.Index(rest, "/"); i >= 0 {
			return public + "<token>" + rest[i:]
		}
		return public + "<token>"
	}
	return path
}

func (s *Server) apiLoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only log API requests (/api/...)
		if !strings.HasPrefix(r.URL.Path, "/api") {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		duration := time.Since(start)
		s.metrics.observeRequest(r, max(ww.Status(), http.StatusOK), duration)
		durationMs := float64(duration.Microseconds()) / 1000.0
		status := ww.Status()
		if status == 0 {
			status = http.StatusOK
		}

		method := r.Method
		path := logPath(r.URL.Path)

		if status >= 500 {
			slog.Error("HTTP request failed",
				"method", method,
				"path", path,
				"status", status,
				"duration_ms", durationMs,
			)
		} else if status >= 400 {
			slog.Warn("HTTP request warning",
				"method", method,
				"path", path,
				"status", status,
				"duration_ms", durationMs,
			)
		} else {
			slog.Debug("HTTP request completed",
				"method", method,
				"path", path,
				"status", status,
				"duration_ms", durationMs,
			)
		}
	})
}

// authenticateToken checks a session token or an API key. key is nil for sessions and holds the key's
// id and scopes for API keys. JWTs are checked against the revocation list and token_version.
func (s *Server) authenticateToken(token string) (user *domain.User, key *apiKeyAuth) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, nil
	}
	if strings.HasPrefix(token, "mindsift_sec_") {
		u, scopes, keyID, err := s.store.ValidateAPIKey(token)
		if err != nil || u == nil || !u.IsActive {
			return nil, nil
		}
		return u, &apiKeyAuth{ID: keyID, Scopes: scopes}
	}
	if strings.HasPrefix(token, storage.OAuthAccessPrefix) {
		if !s.oauthEnabled() {
			return nil, nil
		}
		u, scopes, keyID, err := s.store.ValidateOAuthAccessToken(token, time.Now())
		if err != nil || u == nil || !u.IsActive {
			return nil, nil
		}
		return u, &apiKeyAuth{ID: keyID, Scopes: scopes, OAuth: true}
	}
	claims, err := auth.ValidateToken(s.cfg.JWTSecret, token)
	if err != nil || claims == nil {
		return nil, nil
	}
	u, err := s.store.GetUserByID(claims.UserID)
	if err != nil || u == nil || !u.IsActive {
		return nil, nil
	}
	// Tokens always carry a version (1 or more); one without is not ours
	if claims.TokenVersion != u.TokenVersion {
		return nil, nil
	}
	// Logged out, ended from the session list or idle for 30 days
	if !s.store.SessionActive(claims.ID, u.ID) {
		return nil, nil
	}
	return u, nil
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		} else {
			token = r.Header.Get("X-API-Key")
		}
		// MCP switched off: the endpoint answers as if it did not exist, with or without login
		if r.URL.Path == mcpPath && !s.mcpEnabled() {
			writeError(w, http.StatusNotFound, "MCP ist auf diesem Server ausgeschaltet")
			return
		}
		user, key := s.authenticateToken(token)
		if user == nil {
			// Tells MCP clients where to start the OAuth flow (RFC 9728)
			if r.URL.Path == mcpPath && s.oauthEnabled() {
				w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+s.oauthResourceMetadataURL()+`"`)
			}
			writeError(w, http.StatusUnauthorized, "Nicht autorisiert – bitte anmelden")
			return
		}
		// OAuth tokens were issued for the MCP endpoint only
		if key != nil && key.OAuth && r.URL.Path != mcpPath {
			writeError(w, http.StatusForbidden, "OAuth-Zugänge gelten nur für den MCP-Endpunkt")
			return
		}
		var sessionID string
		var claims *auth.Claims
		if key == nil {
			if c, err := auth.ValidateToken(s.cfg.JWTSecret, token); err == nil {
				claims, sessionID = c, c.ID
			}
		}
		// Two-factor sign-in required but not set up yet: only setting it up (and signing out) until then.
		// Not for sessions from an OIDC provider, which asks for its own second factor.
		if key == nil && !mfaSetupPath(r.URL.Path) && s.mfaSetupRefused(w, user, sessionID) {
			return
		}
		ctx := auth.WithUserID(r.Context(), user.ID)
		if claims != nil {
			ctx = withSession(ctx, claims.ID)
			s.renewSessionToken(w, user, claims, false)
		}
		if key != nil {
			if msg := apiKeyRouteDenied(r, key.Scopes); msg != "" {
				writeError(w, http.StatusForbidden, msg)
				return
			}
			via := storage.OriginAPI
			if r.URL.Path == mcpPath {
				via = storage.OriginMCP
			}
			ctx = withAPIKey(ctx, key, via)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) staffMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := auth.GetUserID(r.Context())
		if userID == "" {
			writeError(w, http.StatusUnauthorized, "Nicht autorisiert")
			return
		}
		user, err := s.store.GetUserByID(userID)
		if err != nil || user == nil || (user.Role != domain.RoleAdmin && user.Role != domain.RoleManager) {
			writeError(w, http.StatusForbidden, "Admin-Berechtigung erforderlich")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) adminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := auth.GetUserID(r.Context())
		if userID == "" {
			writeError(w, http.StatusUnauthorized, "Nicht autorisiert")
			return
		}
		user, err := s.store.GetUserByID(userID)
		if err != nil || user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Server-Administrator-Rechte erforderlich")
			return
		}
		next.ServeHTTP(w, r)
	})
}
