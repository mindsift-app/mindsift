package storage

import (
	"fmt"
	"regexp"
	"strings"
)

// @-mentions: a bullet, a task's description or a subtask holds {{mention:<user id>}}; the app shows the
// person's current name. Readers outside the app (export, MCP, search snippets) get "@Name".

var mentionRefRE = regexp.MustCompile(`\{\{mention:([A-Za-z0-9_]+)\}\}`)

// In a search snippet the match may be marked inside the id
var mentionSnippetRE = regexp.MustCompile(`\{\{mention:((?:<mark>|</mark>|[A-Za-z0-9_])+)\}\}`)

// PublicMentionRef stands for a mention on a public page: nobody's name is shown there
const PublicMentionRef = "{{mention:hidden}}"

// MentionCounts: how often each person is mentioned in the texts.
func MentionCounts(texts ...string) map[string]int {
	out := map[string]int{}
	for _, t := range texts {
		if !strings.Contains(t, "{{mention:") {
			continue
		}
		for _, m := range mentionRefRE.FindAllStringSubmatch(t, -1) {
			out[m[1]]++
		}
	}
	return out
}

// NewlyMentioned: the people mentioned more often after than before (a mention that is merely kept does
// not count again, a second one does).
func NewlyMentioned(before, after map[string]int) []string {
	var out []string
	for id, n := range after {
		if n > before[id] {
			out = append(out, id)
		}
	}
	return out
}

// ReadableMentions writes mentions as "@Name" (a missing person as "@?").
func (s *Store) ReadableMentions(content string) string {
	if !strings.Contains(content, "{{mention:") {
		return content
	}
	return mentionSnippetRE.ReplaceAllStringFunc(content, func(tok string) string {
		raw := mentionSnippetRE.FindStringSubmatch(tok)[1]
		id := strings.NewReplacer("<mark>", "", "</mark>", "").Replace(raw)
		name := s.mentionName(id)
		if raw != id {
			return "<mark>@" + name + "</mark>"
		}
		return "@" + name
	})
}

func (s *Store) mentionName(userID string) string {
	var name, username string
	if err := s.db.QueryRow(`SELECT display_name, username FROM users WHERE id = ?`, userID).Scan(&name, &username); err != nil {
		return "?"
	}
	if strings.TrimSpace(name) == "" {
		return username
	}
	return name
}

// HideMentions: mentions on a public page, without names.
func HideMentions(content string) string {
	if !strings.Contains(content, "{{mention:") {
		return content
	}
	return mentionRefRE.ReplaceAllString(content, PublicMentionRef)
}

// mentionSearchTerms: for a search word, the index terms of the people whose name or username starts with
// it (the id part after "usr_", which the full-text index keeps as a word of its own).
func (s *Store) mentionSearchTerms(word string) []string {
	if len([]rune(word)) < 2 {
		return nil
	}
	ids := s.queryUserIDs(`SELECT id FROM users WHERE is_active = 1 AND (display_name LIKE ? OR username LIKE ?
		OR display_name LIKE ?) LIMIT 20`, word+"%", word+"%", "% "+word+"%")
	var out []string
	for _, id := range ids {
		if _, part, ok := strings.Cut(id, "_"); ok && part != "" {
			out = append(out, part)
		}
	}
	return out
}

// prepareSearchQuery is PrepareFTSQuery where a word that names a person also finds mentions of them.
func (s *Store) prepareSearchQuery(raw string) string {
	matches := wordTokenRegex.FindAllString(strings.TrimSpace(raw), -1)
	if len(matches) == 0 {
		return ""
	}
	tokens := make([]string, 0, len(matches))
	for _, m := range matches {
		clean := strings.ReplaceAll(m, `"`, `""`)
		term := fmt.Sprintf(`"%s"*`, clean)
		if parts := s.mentionSearchTerms(m); len(parts) > 0 {
			alts := []string{term}
			for _, p := range parts {
				alts = append(alts, fmt.Sprintf(`"%s"`, p))
			}
			term = "(" + strings.Join(alts, " OR ") + ")"
		}
		tokens = append(tokens, term)
	}
	return strings.Join(tokens, " ")
}

// --- Notes: what was mentioned last per bullet, so only new mentions notify ---

func (s *Store) migrateMentions() error {
	return s.execSchemaStatement(`CREATE TABLE IF NOT EXISTS block_mentions (
		document_id TEXT NOT NULL,
		block_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		count INTEGER NOT NULL,
		PRIMARY KEY (document_id, block_id, user_id)
	)`)
}

// SwapBlockMentions stores the mentions now in a bullet and returns those it had before.
func (s *Store) SwapBlockMentions(docID, blockID string, now map[string]int) (map[string]int, error) {
	before := map[string]int{}
	rows, err := s.db.Query(`SELECT user_id, count FROM block_mentions WHERE document_id = ? AND block_id = ?`, docID, blockID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var n int
		if rows.Scan(&id, &n) == nil {
			before[id] = n
		}
	}
	rows.Close()
	if len(before) == 0 && len(now) == 0 {
		return before, nil
	}
	stmts := []sqlStmt{stmt(`DELETE FROM block_mentions WHERE document_id = ? AND block_id = ?`, docID, blockID)}
	for id, n := range now {
		stmts = append(stmts, stmt(`INSERT INTO block_mentions (document_id, block_id, user_id, count) VALUES (?, ?, ?, ?)`, docID, blockID, id, n))
	}
	return before, s.execInTx(stmts...)
}

// MentionCandidate is a person the mention picker offers, with whether they can see the place.
type MentionCandidate struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Username    string `json:"username,omitempty"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	HasAccess   bool   `json:"hasAccess"`
}
