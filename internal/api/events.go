package api

// The realtime events (Doku/api/websocket.md), one name each. event…: the server sends it to the apps;
// msg…: an app sends it to the server (ws/events.go has the hub's own, such as USER_PRESENCE and PING).
// frontend/src/lib/realtimeEvents.json lists the same names for the app's side: events_test.go checks the
// two against each other, and that no handler names an event by a string of its own. The payloads stay as
// they are: older apps and the desktop app in server mode read them.
const (
	// Tasks: the task as stored (TASK_DELETED only {id}), to everyone who sees it (taskAudience)
	eventTaskCreated   = "TASK_CREATED"
	eventTaskUpdated   = "TASK_UPDATED"
	eventTaskDeleted   = "TASK_DELETED"
	eventTaskReordered = "TASK_REORDERED"
	// Task lists: only {id}, to everyone who saw the list before or sees it now (broadcastTaskListChange)
	eventTaskListCreated = "TASK_LIST_CREATED"
	eventTaskListUpdated = "TASK_LIST_UPDATED"
	eventTaskListDeleted = "TASK_LIST_DELETED"

	// Notes: the note as each person's note list has it (broadcastDocToAuthorizedUsers), DOC_DELETED only {id}
	eventDocCreated = "DOC_CREATED"
	eventDocUpdated = "DOC_UPDATED"
	eventDocDeleted = "DOC_DELETED"
	eventDocCounts  = "DOC_COUNTS"
	eventDocSeq     = "DOC_SEQ"
	// Folders: `type` says what changed (folderEvent… in handlers_folders.go)
	eventFoldersUpdated = "WORKSPACE_FOLDERS_UPDATED"

	// Lists: LIST_* about the list, ITEM_* about its entries (the list's room); LIST_COUNTS {listId, open}
	// to everyone who sees the list, at most every 3 s (list_counts.go)
	eventListCreated   = "LIST_CREATED"
	eventListUpdated   = "LIST_UPDATED"
	eventListDeleted   = "LIST_DELETED"
	eventListShared    = "LIST_SHARED"
	eventListUnshared  = "LIST_UNSHARED"
	eventListCleared   = "LIST_CLEARED"
	eventListCounts    = "LIST_COUNTS"
	eventItemCreated   = "ITEM_CREATED"
	eventItemUpdated   = "ITEM_UPDATED"
	eventItemToggled   = "ITEM_TOGGLED"
	eventItemDeleted   = "ITEM_DELETED"
	eventItemReordered = "ITEM_REORDERED"

	// Shares or group memberships removed in bulk by the administration ({}): the app loads its data again
	// (tellAccessChanged)
	eventAccessChanged = "ACCESS_CHANGED"
	// Groups: {id} to the members before and after a change (broadcastTeamUpdated); the app reloads its groups
	eventTeamUpdated = "TEAM_UPDATED"

	// Notification center, transcriptions in the background, the demo's reset
	eventNotification         = "NOTIFICATION"
	eventNotificationsRead    = "NOTIFICATIONS_READ"
	eventNotificationsCleared = "NOTIFICATIONS_CLEARED"
	eventTranscriptionUpdated = "TRANSCRIPTION_UPDATED"
	eventTranscriptionDone    = "TRANSCRIPTION_DONE"
	eventDemoReset            = "DEMO_RESET"

	// Live drawing (drawlive.go), server to app
	eventDrawState    = "DRAW_STATE"
	eventDrawOps      = "DRAW_OPS"
	eventDrawAck      = "DRAW_ACK"
	eventDrawPeople   = "DRAW_PEOPLE"
	eventDrawPointers = "DRAW_POINTERS"
	eventDrawEnd      = "DRAW_END"
	eventDrawError    = "DRAW_ERROR"
)

// Live drawing, app to server (drawMessageHandler)
const (
	msgDrawJoin     = "DRAW_JOIN"
	msgDrawWatch    = "DRAW_WATCH"
	msgDrawOps      = "DRAW_OPS"
	msgDrawPresence = "DRAW_PRESENCE"
	msgDrawSync     = "DRAW_SYNC"
	msgDrawLeave    = "DRAW_LEAVE"
	msgDrawDone     = "DRAW_DONE"
	msgDrawDiscard  = "DRAW_DISCARD"
)
