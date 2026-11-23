package ws

// The hub's own realtime events (Doku/api/websocket.md); the app's events are in api/events.go, and
// api/events_test.go checks both against frontend/src/lib/realtimeEvents.json.
const (
	// EventUserPresence: a connection of a room came or went (onlineCount), to the room
	EventUserPresence = "USER_PRESENCE"
	// EventSSEConnected: the first event of an event stream, with its sseId
	EventSSEConnected = "SSE_CONNECTED"
	// EventPong answers MsgPing
	EventPong = "PONG"
)

// What an app sends over its WebSocket besides the live drawing's DRAW_* messages (drawMessagePrefix)
const (
	MsgPing      = "PING"
	MsgJoinRoom  = "JOIN_ROOM"
	MsgLeaveRoom = "LEAVE_ROOM"
)

// drawMessagePrefix: messages starting with it go to the message handler (the live drawing, api/drawlive.go)
const drawMessagePrefix = "DRAW_"
