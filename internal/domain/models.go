package domain

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// NewID generates a readable prefixed ID (e.g. th_4f1c09e2b7a35d68c0e1f2a3). 96 random bits keep
// collisions out of reach; older IDs with 40 bits stay valid (FLAW-32).
func NewID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b))
}

// NowISO returns the current UTC timestamp in ISO-8601 format
func NowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// A hashtag starts the text or follows whitespace or "(". Fragments in links (example.com/blog#ueberschrift)
// and words like "C#" are not tags. The browser uses the same rule (lib/markdown.tsx, lib/api.ts).
var hashtagRegex = regexp.MustCompile(`(?:^|[\s(])#([\p{L}\p{N}_-]+)`)

// legacyHashtagRegex is the rule before anchors were excluded; only used to clean up stored tags.
var legacyHashtagRegex = regexp.MustCompile(`#([\p{L}\p{N}_-]+)`)

// StaleAnchorTags returns tags the old rule found in content that the current rule does not, i.e. tags that
// only came from URL fragments and similar.
func StaleAnchorTags(content string) []string {
	current := map[string]bool{}
	for _, t := range ExtractTags(content) {
		current[t] = true
	}
	var stale []string
	seen := map[string]bool{}
	for _, m := range legacyHashtagRegex.FindAllStringSubmatch(content, -1) {
		t := strings.ToLower(m[1])
		if !current[t] && !seen[t] {
			seen[t] = true
			stale = append(stale, t)
		}
	}
	return stale
}

// ExtractTags extracts #hashtags from content
func ExtractTags(content string) []string {
	matches := hashtagRegex.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool)
	tags := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) > 1 {
			tag := strings.ToLower(m[1])
			if !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

type User struct {
	ID                  string   `json:"id"`
	Email               string   `json:"email"`
	Username            string   `json:"username,omitempty"`
	PasswordHash        string   `json:"-"`
	DisplayName         string   `json:"displayName"`
	AvatarURL           string   `json:"avatarUrl,omitempty"`
	Role                string   `json:"role"` // admin | manager | member
	IsActive            bool     `json:"isActive"`
	TokenVersion        int      `json:"tokenVersion"`
	AlarmChannels       []string `json:"alarmChannels"` // email | discord | webhook
	AlarmEmail          string   `json:"alarmEmail"`
	DiscordWebhookURL   string   `json:"discordWebhookUrl"`
	CustomWebhookURL    string   `json:"customWebhookUrl"`
	NotifyBeforeMinutes int      `json:"notifyBeforeMinutes"`
	// OrganizationIDs: the organizations the user belongs to (admin user list only)
	OrganizationIDs []string `json:"organizationIds,omitempty"`
	// Organizations: the user's own organizations with names (own profile only, to pick one for a group)
	Organizations []OrganizationRef `json:"organizations,omitempty"`
	CreatedAt     string            `json:"createdAt"`
	// Registered while registration needs approval and not approved yet (admin user list only)
	PendingApproval bool `json:"pendingApproval,omitempty"`
	// Registered and the e-mail address is not confirmed yet (admin user list only)
	EmailUnverified bool `json:"emailUnverified,omitempty"`
	// Only filled for the user's own profile (GET /auth/me, PATCH /auth/settings)
	NotificationSettings *NotificationSettings `json:"notificationSettings,omitempty"`
	// DoneRetentionDays: completed tasks are deleted this many days after ticking them off (0 = never)
	DoneRetentionDays int `json:"doneRetentionDays"`
	// VoiceInput: "" uses the server's Whisper (when set up), "browser" the browser's recognition
	VoiceInput string `json:"voiceInput"`
	// VoiceLanguage: "" follows the app language, "auto" lets Whisper detect it, else a Whisper language code
	VoiceLanguage string `json:"voiceLanguage"`
	// Language of the app: a supported code, or "" to follow the browser and then the server's default
	Language string `json:"language"`
	// Retention: how long finished and deleted things are kept (storage/retention.go);
	// RetentionNeverAllowed: whether "nie" may be chosen on this server
	Retention             *Retention `json:"retention,omitempty"`
	RetentionNeverAllowed bool       `json:"retentionNeverAllowed"`
}

// Server roles: admins run everything, user managers ("Benutzerverwaltung") look after members,
// invites and organizations but not the server settings.
const (
	RoleAdmin   = "admin"
	RoleManager = "manager"
	RoleMember  = "member"
)

// ValidRole reports whether role is one of the server roles.
func ValidRole(role string) bool {
	return role == RoleAdmin || role == RoleManager || role == RoleMember
}

// PublicUser is the safe view of another person: only what others need to find and recognise them in
// the directory and when sharing. It never carries private settings (webhooks, alarm e-mail, role,
// notification settings, token version). An allowlist, so new User fields do not leak by default.
type PublicUser struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	// Findable: the viewer may share with this person; others in the directory are only there because
	// they work on something together with the viewer (their names show there, nothing more)
	Findable bool `json:"findable"`
}

// ToPublicUser reduces a user to the fields others may see.
func ToPublicUser(u User) PublicUser {
	return PublicUser{
		ID:          u.ID,
		Email:       u.Email,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
	}
}

// ToPublicUsers maps a list of users to their public view.
func ToPublicUsers(users []User) []PublicUser {
	out := make([]PublicUser, 0, len(users))
	for _, u := range users {
		out = append(out, ToPublicUser(u))
	}
	return out
}

// NotificationSettings: which events reach a user over which channel, the daily summary and a pause.
type NotificationSettings struct {
	Paused            bool               `json:"paused"`
	IncludeOwnWatched bool               `json:"includeOwnWatched"`
	Events            NotificationEvents `json:"events"`
	DailySummary      DailySummary       `json:"dailySummary"`
}

type NotificationEvents struct {
	Due      ChannelChoice `json:"due"`      // task alarms (sent at once)
	Shared   ChannelChoice `json:"shared"`   // something was shared with me
	TaskDone ChannelChoice `json:"taskDone"` // a shared task was completed
	Watched  ChannelChoice `json:"watched"`  // a watched task changed
}

type ChannelChoice struct {
	Email   bool `json:"email"`
	Discord bool `json:"discord"`
	Webhook bool `json:"webhook"` // own webhook (customWebhookUrl), JSON payload
	Push    bool `json:"push"`    // web push to the user's browsers and phones
}

// Any reports whether at least one channel is chosen.
func (c ChannelChoice) Any() bool { return c.Email || c.Discord || c.Webhook || c.Push }

type DailySummary struct {
	Enabled bool   `json:"enabled"`
	Time    string `json:"time"` // HH:MM, server time zone
	Email   bool   `json:"email"`
	Discord bool   `json:"discord"`
	Webhook bool   `json:"webhook"`
	Push    bool   `json:"push"`
}

// DefaultNotificationSettings for users who never saved any; task alarms follow the old alarm channels.
func DefaultNotificationSettings(alarmChannels []string) NotificationSettings {
	due := ChannelChoice{}
	for _, c := range alarmChannels {
		due.Email = due.Email || c == "email"
		due.Discord = due.Discord || c == "discord"
		due.Webhook = due.Webhook || c == "webhook"
	}
	return NotificationSettings{
		Events: NotificationEvents{
			Due:     due,
			Shared:  ChannelChoice{Email: true},
			Watched: ChannelChoice{Email: true, Discord: true},
		},
		DailySummary: DailySummary{Time: "07:00", Email: true},
	}
}

// Channels returns the choice for an event kind (due, shared, taskDone, watched).
func (n NotificationSettings) Channels(kind string) ChannelChoice {
	switch kind {
	case "due":
		return n.Events.Due
	case "shared":
		return n.Events.Shared
	case "taskDone":
		return n.Events.TaskDone
	case "watched":
		return n.Events.Watched
	}
	return ChannelChoice{}
}

type UserInvite struct {
	ID    string `json:"id"`
	Code  string `json:"code"`
	Email string `json:"email,omitempty"`
	Role  string `json:"role"` // always member: invites never make admins
	// Organizations the new account joins
	OrganizationIDs   []string `json:"organizationIds,omitempty"`
	OrganizationNames []string `json:"organizationNames,omitempty"`
	CreatedBy         string   `json:"createdBy"`
	ExpiresAt         string   `json:"expiresAt"`
	UsedBy            string   `json:"usedBy,omitempty"`
	// A link for several people: how often it may be used and how often it was
	MaxUses   int    `json:"maxUses"`
	UseCount  int    `json:"useCount"`
	CreatedAt string `json:"createdAt"`
	// Used up or expired: when the invite disappears from the list
	RemoveAt string `json:"removeAt,omitempty"`
}

type ThoughtStatus string

const (
	StatusInbox     ThoughtStatus = "inbox"
	StatusKept      ThoughtStatus = "kept"
	StatusDiscarded ThoughtStatus = "discarded"
	StatusConverted ThoughtStatus = "converted"
)

type SubTask struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	IsCompleted bool   `json:"isCompleted"`
	CreatedAt   string `json:"createdAt,omitempty"`
	// BlockID: the note checkbox this subtask is tied to, when its task is linked to a note
	BlockID string `json:"blockId,omitempty"`
}

type Thought struct {
	// IsWatching: the requesting user gets notified about changes (task watchers)
	IsWatching     bool          `json:"isWatching,omitempty"`
	ID             string        `json:"id"`
	UserID         string        `json:"userId"`
	Content        string        `json:"content"`
	Tags           []string      `json:"tags"`
	Priority       string        `json:"priority"` // low | normal | high | urgent
	Source         string        `json:"source"`   // manual | voice | webhook | agent
	Status         ThoughtStatus `json:"status"`
	IsCompleted    bool          `json:"isCompleted"`
	ConvertedType  string        `json:"convertedType,omitempty"`  // task | document | list_item | document_block
	ConvertedRefID string        `json:"convertedRefId,omitempty"` // referenced entity ID
	DocID          string        `json:"docId,omitempty"`
	BlockID        string        `json:"blockId,omitempty"`
	DueDate        string        `json:"dueDate,omitempty"`
	TaskListID     string        `json:"taskListId,omitempty"`
	KanbanStatus   string        `json:"kanbanStatus,omitempty"` // todo | in_progress | done
	Notes          string        `json:"notes,omitempty"`
	Subtasks       []SubTask     `json:"subtasks"`
	Assignees      []string      `json:"assignees"`            // user IDs; only people with access to the task list
	Recurrence     string        `json:"recurrence,omitempty"` // "" | daily | weekly | monthly | yearly
	AlarmSent      bool          `json:"alarmSent,omitempty"`
	SortOrder      int           `json:"sortOrder"`
	CreatedAt      string        `json:"createdAt"`
	TriagedAt      string        `json:"triagedAt,omitempty"`
	Origin         *Origin       `json:"origin,omitempty"` // API key that created / last changed it
}

// Origin: which API key created an entry and which one changed it last, over which access ("api" for
// REST, "mcp"). Key names are resolved when reading; it stays when the user edits the entry.
type Origin struct {
	CreatedVia string `json:"createdVia,omitempty"`
	CreatedKey string `json:"createdKey,omitempty"`
	ChangedVia string `json:"changedVia,omitempty"`
	ChangedKey string `json:"changedKey,omitempty"`
	ChangedAt  string `json:"changedAt,omitempty"`
	// The key was deleted since (its name is gone)
	CreatedKeyDeleted bool `json:"createdKeyDeleted,omitempty"`
	ChangedKeyDeleted bool `json:"changedKeyDeleted,omitempty"`
}

type ThoughtReorderItem struct {
	ID           string  `json:"id"`
	SortOrder    int     `json:"sortOrder"`
	KanbanStatus *string `json:"kanbanStatus,omitempty"`
}

type ListItemReorderItem struct {
	ID        string  `json:"id"`
	SortOrder int     `json:"sortOrder"`
	Category  *string `json:"category,omitempty"`
	Content   *string `json:"content,omitempty"`
}

type TaskListShare struct {
	ID         string `json:"id"`
	TaskListID string `json:"taskListId"`
	TargetType string `json:"targetType"` // team | user
	TargetID   string `json:"targetId"`
	TargetName string `json:"targetName,omitempty"`
	Email      string `json:"email,omitempty"`
	AvatarURL  string `json:"avatarUrl,omitempty"`
	Permission string `json:"permission"` // editor | viewer
	CreatedAt  string `json:"createdAt"`
}

type TaskListMember struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	Role        string `json:"role"` // owner | member
}

type KanbanColumn struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Color  string `json:"color,omitempty"`
	IsDone bool   `json:"isDone,omitempty"`
}

type TaskList struct {
	ID         string           `json:"id"`
	UserID     string           `json:"userId"`
	SpaceID    string           `json:"spaceId,omitempty"`
	SpaceName  string           `json:"spaceName,omitempty"`
	OwnerName  string           `json:"ownerName,omitempty"`
	IsOwner    bool             `json:"isOwner"`
	Permission string           `json:"permission,omitempty"` // owner | editor | viewer
	Members    []TaskListMember `json:"members,omitempty"`
	Shares     []TaskListShare  `json:"shares,omitempty"`
	Columns    []KanbanColumn   `json:"columns,omitempty"`
	Title      string           `json:"title"`
	Icon       string           `json:"icon"`
	Color      string           `json:"color"`
	TasksCount int              `json:"tasksCount,omitempty"`
	CreatedAt  string           `json:"createdAt"`
	UpdatedAt  string           `json:"updatedAt"`
}

// Organization is defined by server admins; each user belongs to at most one.
// OrganizationRef names an organization (what members may know about their own ones).
type OrganizationRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Organization struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MemberCount int    `json:"memberCount"`
	CreatedAt   string `json:"createdAt"`
}

type Team struct {
	ID          string       `json:"id"`
	OrgID       string       `json:"orgId,omitempty"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Members     []TeamMember `json:"members"`
	CreatedAt   string       `json:"createdAt"`
}

type TeamMember struct {
	TeamID      string `json:"teamId"`
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	Role        string `json:"role"` // admin | member
	JoinedAt    string `json:"joinedAt"`
}

type SystemSettings struct {
	SharingMode string `json:"sharingMode"` // private | organizations | open
	// AllowRegistration mirrors RegistrationMode == "open" (older clients and the setup wizard)
	AllowRegistration bool `json:"allowRegistration"`
	// Who may register without an invite: closed | approval | domain | domain+approval | open
	RegistrationMode string `json:"registrationMode"`
	// E-mail domains for the domain modes, comma separated ("firma.de, familie.de")
	RegistrationDomains string `json:"registrationDomains"`
	// Set by REGISTRATION_MODE / REGISTRATION_DOMAINS (or ALLOW_REGISTRATION=true): not editable here
	RegistrationConfiguredViaEnv bool `json:"registrationConfiguredViaEnv,omitempty"`
	// Self-registrations confirm their e-mail address by link first (needs SMTP and BASE_URL)
	RegistrationVerifyEmail bool `json:"registrationVerifyEmail"`
	// Set by REGISTRATION_VERIFY_EMAIL: not editable here
	RegistrationVerifyViaEnv bool `json:"registrationVerifyConfiguredViaEnv,omitempty"`
	// Mails with links to unknown people can be sent (SMTP and BASE_URL configured)
	EmailLinksAvailable bool   `json:"emailLinksAvailable,omitempty"`
	InstanceName        string `json:"instanceName"`
	SMTPHost            string `json:"smtpHost"`
	SMTPPort            string `json:"smtpPort"`
	SMTPUser            string `json:"smtpUser"`
	// SMTPPass is never sent to the browser (FLAW-34): reads leave it empty and set SMTPPassSet;
	// writing it empty keeps the stored password
	SMTPPass    string `json:"smtpPass"`
	SMTPPassSet bool   `json:"smtpPassSet,omitempty"`
	SMTPFrom    string `json:"smtpFrom"`
	// SMTPFromName is shown as sender when SMTPFrom is a bare address (empty = "MindSift")
	SMTPFromName   string `json:"smtpFromName"`
	SMTPTLS        bool   `json:"smtpTls"`
	SMTPSkipVerify bool   `json:"smtpSkipVerify"` // accept self-signed certificates
	// AllowPrivateWebhooks lets alarm webhooks reach LAN addresses (and plain http); localhost and cloud
	// metadata stay blocked
	AllowPrivateWebhooks bool `json:"allowPrivateWebhooks"`
	SMTPConfiguredViaEnv bool `json:"smtpConfiguredViaEnv,omitempty"`
	// Automatic backups: on/off, daily time (HH:MM, server time zone) and how many days to keep them
	BackupEnabled       bool   `json:"backupEnabled"`
	BackupTime          string `json:"backupTime"`
	BackupRetentionDays int    `json:"backupRetentionDays"`
	// RetentionAllowNever: people may keep finished and deleted things for good ("nie"); nil in an
	// update leaves it unchanged. RetentionNeverViaEnv: fixed by RETENTION_ALLOW_NEVER, not editable.
	RetentionAllowNever  *bool `json:"retentionAllowNever,omitempty"`
	RetentionNeverViaEnv bool  `json:"retentionNeverViaEnv,omitempty"`
	// MCPEnabled: AI agents may connect over MCP (and claude.ai / ChatGPT over OAuth); nil in an update
	// leaves it unchanged. MCPViaEnv: fixed by MCP_ENABLED, not editable.
	MCPEnabled *bool `json:"mcpEnabled,omitempty"`
	MCPViaEnv  bool  `json:"mcpConfiguredViaEnv,omitempty"`
	// PeopleSearch: names are suggested while typing when sharing; off, people are added by their exact
	// e-mail address or username. nil in an update leaves it unchanged; ViaEnv: fixed by PEOPLE_SEARCH.
	PeopleSearch       *bool `json:"peopleSearch,omitempty"`
	PeopleSearchViaEnv bool  `json:"peopleSearchConfiguredViaEnv,omitempty"`
	// PublicLinks: owners may share a note by a public link (read only, always expiring); nil in an
	// update leaves it unchanged; ViaEnv: fixed by PUBLIC_LINKS. Always off in demo mode.
	PublicLinks       *bool `json:"publicLinks,omitempty"`
	PublicLinksViaEnv bool  `json:"publicLinksConfiguredViaEnv,omitempty"`
	// PublicLinkMaxDays: the longest a public link may live (1–14 days); 0 in an update leaves it
	// unchanged; ViaEnv: fixed by PUBLIC_LINKS_MAX_DAYS.
	PublicLinkMaxDays       int  `json:"publicLinkMaxDays,omitempty"`
	PublicLinkMaxDaysViaEnv bool `json:"publicLinkMaxDaysConfiguredViaEnv,omitempty"`
	// DefaultLanguage: language for people without their own choice whose browser language MindSift does
	// not speak, and for the demo; empty in an update leaves it unchanged
	DefaultLanguage string `json:"defaultLanguage,omitempty"`
}

// UnmarshalJSON accepts smtpPort as text or number: older clients sent a number, which made the whole
// settings request fail with "Invalid JSON".
func (s *SystemSettings) UnmarshalJSON(data []byte) error {
	type plain SystemSettings
	aux := struct {
		*plain
		SMTPPort json.RawMessage `json:"smtpPort"`
	}{plain: (*plain)(s)}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	port := strings.TrimSpace(string(aux.SMTPPort))
	switch {
	case port == "" || port == "null":
	case strings.HasPrefix(port, `"`):
		var str string
		if err := json.Unmarshal(aux.SMTPPort, &str); err != nil {
			return err
		}
		s.SMTPPort = strings.TrimSpace(str)
	default:
		var n json.Number
		if err := json.Unmarshal(aux.SMTPPort, &n); err != nil {
			return err
		}
		s.SMTPPort = n.String()
	}
	return nil
}

type DocumentBlock struct {
	ID         string  `json:"id"`
	DocumentID string  `json:"documentId,omitempty"`
	Type       string  `json:"type"` // h1 | h2 | h3 | paragraph | todo | bullet | code | callout | warning | error | divider | table | progress
	Content    string  `json:"content"`
	Checked    bool    `json:"checked,omitempty"`
	Lang       string  `json:"lang,omitempty"`
	Level      int     `json:"level"`
	Position   float64 `json:"position"`
	Collapsed  bool    `json:"collapsed,omitempty"`
	TaskID     string  `json:"taskId,omitempty"`
	SubtaskOf  string  `json:"subtaskOf,omitempty"` // checkbox tied to a subtask of this task
}

func CompileBlocksToMarkdown(blocks []DocumentBlock) string {
	var sb strings.Builder
	for _, b := range blocks {
		lvl := b.Level
		if lvl < 0 {
			lvl = 0
		}
		indent := strings.Repeat("  ", lvl)
		switch b.Type {
		case "h1":
			sb.WriteString(indent + "- # " + b.Content + "\n")
		case "h2":
			sb.WriteString(indent + "- ## " + b.Content + "\n")
		case "h3":
			sb.WriteString(indent + "- ### " + b.Content + "\n")
		case "todo":
			mark := "[ ]"
			if b.Checked {
				mark = "[x]"
			}
			sb.WriteString(indent + "- " + mark + " " + b.Content + "\n")
		case "code":
			sb.WriteString(indent + "- ```" + b.Lang + "\n" + b.Content + "\n" + indent + "  ```\n")
		case "divider":
			sb.WriteString(indent + "- ---\n")
		case "numbered":
			sb.WriteString(indent + "1. " + b.Content + "\n")
		default:
			sb.WriteString(indent + "- " + b.Content + "\n")
		}
	}
	return sb.String()
}

type DocShare struct {
	ID          string `json:"id"`
	DocID       string `json:"docId"`
	TargetType  string `json:"targetType,omitempty"` // user | team
	TargetID    string `json:"targetId,omitempty"`
	TargetName  string `json:"targetName,omitempty"`
	UserID      string `json:"userId,omitempty"`
	UserEmail   string `json:"userEmail,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Permission  string `json:"permission"` // read | write
	CreatedBy   string `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
}

type Document struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	SpaceID       string          `json:"spaceId,omitempty"`
	Title         string          `json:"title"`
	Icon          string          `json:"icon"`
	Content       string          `json:"content"`
	MarkdownCache string          `json:"markdownCache,omitempty"`
	Blocks        []DocumentBlock `json:"blocks"`
	Tags          []string        `json:"tags"`
	FolderID      string          `json:"folderId,omitempty"`
	FolderPath    string          `json:"folderPath,omitempty"`
	IsPinned      bool            `json:"isPinned"`
	IsArchived    bool            `json:"isArchived"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`

	// Collaboration & Permissions
	Permission       string     `json:"permission"` // owner | write | read
	IsOwner          bool       `json:"isOwner"`
	OwnerName        string     `json:"ownerName,omitempty"`
	SharedWith       []DocShare `json:"sharedWith,omitempty"`
	SharedFolderID   string     `json:"sharedFolderId,omitempty"`
	SubFolderPath    string     `json:"subFolderPath,omitempty"`
	IsSharedFolder   bool       `json:"isSharedFolder,omitempty"`
	FolderPermission string     `json:"folderPermission,omitempty"`
}

type TagSummary struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

type MatchedTagBlock struct {
	RootBlock DocumentBlock   `json:"rootBlock"`
	Children  []DocumentBlock `json:"children"`
}

type TagDocumentGroup struct {
	DocID         string            `json:"docId"`
	Title         string            `json:"title"`
	Icon          string            `json:"icon"`
	FolderPath    string            `json:"folderPath"`
	UpdatedAt     string            `json:"updatedAt"`
	IsOwner       bool              `json:"isOwner"`
	Permission    string            `json:"permission"`
	OwnerName     string            `json:"ownerName,omitempty"`
	MatchedBlocks []MatchedTagBlock `json:"matchedBlocks"`
}

type TagDetails struct {
	Tag           string             `json:"tag"`
	NoteContent   string             `json:"noteContent"`
	NoteUpdatedAt string             `json:"noteUpdatedAt,omitempty"`
	Documents     []TagDocumentGroup `json:"documents"`
	TotalMatches  int                `json:"totalMatches"`
}

type ListShare struct {
	ID         string `json:"id"`
	ListID     string `json:"listId"`
	TargetType string `json:"targetType"` // team | user
	TargetID   string `json:"targetId"`
	TargetName string `json:"targetName,omitempty"`
	Email      string `json:"email,omitempty"`
	Role       string `json:"role"` // editor | viewer
	CreatedBy  string `json:"createdBy"`
	CreatedAt  string `json:"createdAt"`
}

type ListItem struct {
	ID              string  `json:"id"`
	ListID          string  `json:"listId"`
	Content         string  `json:"content"`
	Category        string  `json:"category,omitempty"`
	Quantity        string  `json:"quantity,omitempty"`
	IsCompleted     bool    `json:"isCompleted"`
	CompletedBy     string  `json:"completedBy,omitempty"`
	CompletedByName string  `json:"completedByName,omitempty"`
	CreatedBy       string  `json:"createdBy,omitempty"`
	CreatedByName   string  `json:"createdByName,omitempty"`
	SortOrder       int     `json:"sortOrder"`
	CreatedAt       string  `json:"createdAt"`
	CompletedAt     string  `json:"completedAt,omitempty"`
	Origin          *Origin `json:"origin,omitempty"` // API key that created / last changed it
}

type SharedList struct {
	ID        string           `json:"id"`
	UserID    string           `json:"userId"`
	OwnerName string           `json:"ownerName,omitempty"`
	IsOwner   bool             `json:"isOwner"`
	Role      string           `json:"role,omitempty"` // editor | viewer
	Title     string           `json:"title"`
	Icon      string           `json:"icon"`
	ListType  string           `json:"listType"` // shopping | checklist | vacation
	Items     []ListItem       `json:"items"`
	Shares    []ListShare      `json:"shares,omitempty"`
	Members   []TaskListMember `json:"members,omitempty"` // owner + everyone the list is shared with
	UpdatedAt string           `json:"updatedAt"`
	CreatedAt string           `json:"createdAt"`
}

// UserTheme is a custom CSS theme of one user.
type UserTheme struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CSS       string `json:"css"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type APIKey struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	Name       string `json:"name"`
	KeyPrefix  string `json:"keyPrefix"`
	KeyHash    string `json:"-"`
	RawKey     string `json:"rawKey,omitempty"` // Only returned once on creation
	Scopes     string `json:"scopes"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
	CreatedAt  string `json:"createdAt"`
	// Kind: "key" (secret shown once) or "oauth" (a connection agreed to on the consent page)
	Kind string `json:"kind"`
}

type WSMessage struct {
	Event     string      `json:"event"` // ITEM_CREATED | ITEM_UPDATED | ITEM_TOGGLED | ITEM_DELETED | LIST_CLEARED | USER_PRESENCE
	ListID    string      `json:"list_id"`
	Payload   interface{} `json:"payload"`
	Timestamp string      `json:"timestamp"`
}

type DashboardStats struct {
	InboxCount         int `json:"inboxCount"`
	TasksOpenCount     int `json:"tasksOpenCount"`
	TasksDoneCount     int `json:"tasksDoneCount"`
	DocsCount          int `json:"docsCount"`
	DocsTodosOpenCount int `json:"docsTodosOpenCount"`
	ListsCount         int `json:"listsCount"`
	ListItemsOpenCount int `json:"listItemsOpenCount"` // unchecked items in all lists the user sees
	DiscardedCount     int `json:"discardedCount"`
}

type FullExport struct {
	ExportedAt string       `json:"exportedAt"`
	Version    string       `json:"version"`
	User       User         `json:"user"`
	Thoughts   []Thought    `json:"thoughts"`
	Documents  []Document   `json:"documents"`
	Lists      []SharedList `json:"lists"`
	TaskLists  []TaskList   `json:"taskLists,omitempty"`
	Themes     []UserTheme  `json:"themes,omitempty"`
}

type SharedFolder struct {
	ID         string        `json:"id"`
	OwnerID    string        `json:"ownerId"`
	OwnerName  string        `json:"ownerName,omitempty"`
	Name       string        `json:"name"`
	MountPath  string        `json:"mountPath"`
	IsOwner    bool          `json:"isOwner"`
	Permission string        `json:"permission"` // owner | write | read
	Shares     []FolderShare `json:"shares,omitempty"`
	CreatedAt  string        `json:"createdAt"`
	UpdatedAt  string        `json:"updatedAt"`
}

type FolderShare struct {
	ID         string `json:"id"`
	FolderID   string `json:"folderId"`
	TargetType string `json:"targetType"` // team | user
	TargetID   string `json:"targetId"`
	TargetName string `json:"targetName,omitempty"`
	Email      string `json:"email,omitempty"`
	AvatarURL  string `json:"avatarUrl,omitempty"`
	Permission string `json:"permission"` // read | write
	CreatedBy  string `json:"createdBy"`
	CreatedAt  string `json:"createdAt"`
}

// Retention: delays in days for completed tasks, the task, triage and notes trash and ticked-off list
// items; 0 = keep for good.
type Retention struct {
	DoneTasks   int `json:"doneTasks"`
	TaskTrash   int `json:"taskTrash"`
	TriageTrash int `json:"triageTrash"`
	NoteTrash   int `json:"noteTrash"`
	ListDone    int `json:"listDone"`
}
