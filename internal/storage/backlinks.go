package storage

import (
	"errors"
	"regexp"
	"sort"
	"strings"
)

// Backlinks ("Linked to this note") lists the notes whose blocks contain a wiki link [[Title]]
// to a note. Matching ignores case and surrounding spaces like the link click in the editor;
// [[Title|Text]] and [[Title#Abschnitt]] count as well. Only notes the user can open are listed,
// never the note itself or notes in the trash.

// ErrNoAccess is returned when the user cannot open the note.
var ErrNoAccess = errors.New("Kein Zugriff auf diese Notiz")

var wikiLinkRe = regexp.MustCompile(`\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]`)

const maxBacklinkBlocks = 5

type BacklinkBlock struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

type Backlink struct {
	DocID      string          `json:"docId"`
	Title      string          `json:"title"`
	Icon       string          `json:"icon"`
	FolderPath string          `json:"folderPath"`
	Blocks     []BacklinkBlock `json:"blocks"`
	More       int             `json:"more,omitempty"` // further matching blocks not listed
}

func linksTo(content, title string) bool {
	for _, m := range wikiLinkRe.FindAllStringSubmatch(content, -1) {
		if strings.EqualFold(strings.TrimSpace(m[1]), title) {
			return true
		}
	}
	return false
}

func (s *Store) GetBacklinks(userID, docID string) ([]Backlink, error) {
	if s.DocRole(userID, docID) == "" {
		return nil, ErrNoAccess
	}
	var title string
	if err := s.db.QueryRow(`SELECT title FROM documents WHERE id = ?`, docID).Scan(&title); err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	out := []Backlink{}
	if title == "" {
		return out, nil
	}

	// The tree of the user: what they can open, with their own folder paths
	docs, err := s.GetDocuments(userID)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]int, len(docs))
	for i, d := range docs {
		byID[d.ID] = i
	}

	rows, err := s.db.Query(`SELECT id, document_id, content FROM blocks
		WHERE deleted = 0 AND document_id != ? AND content LIKE '%[[%'
		ORDER BY document_id, order_key`, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	index := map[string]int{}
	for rows.Next() {
		var blockID, sourceID, content string
		if rows.Scan(&blockID, &sourceID, &content) != nil {
			continue
		}
		di, visible := byID[sourceID]
		if !visible || !linksTo(content, title) {
			continue
		}
		pos, seen := index[sourceID]
		if !seen {
			d := docs[di]
			out = append(out, Backlink{DocID: d.ID, Title: d.Title, Icon: d.Icon, FolderPath: d.FolderPath})
			pos = len(out) - 1
			index[sourceID] = pos
		}
		if len(out[pos].Blocks) < maxBacklinkBlocks {
			out[pos].Blocks = append(out[pos].Blocks, BacklinkBlock{ID: blockID, Content: content})
		} else {
			out[pos].More++
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out, nil
}
