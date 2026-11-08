package storage

import (
	"log/slog"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
)

// Wiki links, same rules as frontend/src/lib/wikiLink.ts. A link carries the id of the note; the title in
// it is only the fallback (export, no access, deleted note):
//
//	[[Titel#doc_id]]  [[Titel#doc_id|Text]]  [[Titel#doc_id^blk_id]]  [[Titel#doc_id^blk_id|Text]]
//
// Older forms stay readable: [[Titel]], [[Titel|Text]], [[Titel#Abschnitt]] and [[Titel#^blk_id|Text]].

type wikiLink struct {
	Title   string
	DocID   string
	BlockID string
	Label   string
}

var (
	wikiTokenRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	docIDRe     = regexp.MustCompile(`^doc_[\w-]+$`)
	// What a title in a link must not contain (the parts of the format)
	wikiTitleStrip = strings.NewReplacer("[", "", "]", "", "|", "", "#", "", "^", "")
)

func parseWikiLink(inner string) wikiLink {
	target, label, _ := strings.Cut(inner, "|")
	title, anchor, _ := strings.Cut(target, "#")
	anchor = strings.TrimSpace(anchor)
	head, block, hasBlock := strings.Cut(anchor, "^")
	l := wikiLink{Title: strings.TrimSpace(title), Label: strings.TrimSpace(label)}
	if hasBlock {
		l.BlockID = strings.TrimSpace(block)
	}
	if docIDRe.MatchString(head) {
		l.DocID = head
	}
	return l
}

// wikiLinks returns the links in a text with their position.
func wikiLinks(content string) ([]wikiLink, [][]int) {
	idx := wikiTokenRe.FindAllStringSubmatchIndex(content, -1)
	links := make([]wikiLink, len(idx))
	for i, m := range idx {
		links[i] = parseWikiLink(content[m[2]:m[3]])
	}
	return links, idx
}

func cleanLinkTitle(title string) string {
	return strings.Join(strings.Fields(wikiTitleStrip.Replace(title)), " ")
}

// noteLink builds [[Titel#doc_id]] (with |Text when label is set).
func noteLink(title, docID, label string) string {
	s := "[[" + cleanLinkTitle(title) + "#" + docID
	if label = cleanLinkTitle(label); label != "" {
		s += "|" + label
	}
	return s + "]]"
}

// blockLink builds [[Titel#doc_id^blk_id]] (with |Text when label is set).
func blockLink(title, docID, blockID, label string) string {
	s := "[[" + cleanLinkTitle(title) + "#" + docID + "^" + blockID
	if label = cleanLinkTitle(label); label != "" {
		s += "|" + label
	}
	return s + "]]"
}

// format writes the link back with the given title and id (keeps bullet and own text).
func (l wikiLink) format() string {
	if l.DocID == "" {
		s := "[[" + l.Title
		if l.BlockID != "" {
			s += "#^" + l.BlockID
		}
		if l.Label != "" {
			s += "|" + l.Label
		}
		return s + "]]"
	}
	if l.BlockID != "" {
		return blockLink(l.Title, l.DocID, l.BlockID, l.Label)
	}
	return noteLink(l.Title, l.DocID, l.Label)
}

// replaceWikiLinks rewrites every link in the text with fn; fn returns the new token or "" to keep it.
func replaceWikiLinks(content string, fn func(l wikiLink) string) string {
	return wikiTokenRe.ReplaceAllStringFunc(content, func(token string) string {
		if out := fn(parseWikiLink(token[2 : len(token)-2])); out != "" {
			return out
		}
		return token
	})
}

// noteLinkOnly: the bullet is only a link to a whole note (plus hashtags), as left behind by ExtractBranch.
func noteLinkOnly(content string) (wikiLink, bool) {
	m := noteLinkOnlyRe.FindStringSubmatch(content)
	if m == nil {
		return wikiLink{}, false
	}
	l := parseWikiLink(m[1])
	return l, l.BlockID == ""
}

// resolveWikiLink finds the note a link points to among the notes the user can open (docs), never the
// note "except": by id, else (older links) by the bullet's id, else by title, where an own note wins
// over one shared with the user under the same title.
func (s *Store) resolveWikiLink(l wikiLink, docs []domain.Document, except string) *domain.Document {
	pick := func(match func(d *domain.Document) bool) *domain.Document {
		var found *domain.Document
		for i := range docs {
			d := &docs[i]
			if d.ID == except || d.IsArchived || !match(d) {
				continue
			}
			if found == nil || (d.IsOwner && !found.IsOwner) {
				found = d
			}
		}
		return found
	}
	if l.DocID != "" {
		return pick(func(d *domain.Document) bool { return d.ID == l.DocID })
	}
	if l.BlockID != "" {
		var owner string
		if s.db.QueryRow(`SELECT document_id FROM blocks WHERE id = ? AND deleted = 0`, l.BlockID).Scan(&owner) == nil {
			if d := pick(func(d *domain.Document) bool { return d.ID == owner }); d != nil {
				return d
			}
		}
	}
	title := strings.TrimSpace(l.Title)
	if title == "" {
		return nil
	}
	return pick(func(d *domain.Document) bool { return strings.EqualFold(strings.TrimSpace(d.Title), title) })
}

// DocTitles maps the id of every note the user can open to its title (for ReadableWikiLinks).
func (s *Store) DocTitles(userID string) map[string]string {
	docs, _ := s.GetDocuments(userID)
	out := make(map[string]string, len(docs))
	for _, d := range docs {
		out[d.ID] = d.Title
	}
	return out
}

// ReadableWikiLinks writes links for readers outside the app (Markdown export, AI agents, public links)
// without ids: [[current title]], [[current title|Text]], a bullet as [[current title#^blk_id]] (Obsidian's
// form). Notes missing from titles keep the title stored in the link.
func ReadableWikiLinks(content string, titles map[string]string) string {
	if !strings.Contains(content, "[[") {
		return content
	}
	return replaceWikiLinks(content, func(l wikiLink) string {
		if l.DocID == "" {
			return ""
		}
		if t, ok := titles[l.DocID]; ok && strings.TrimSpace(t) != "" {
			l.Title = cleanLinkTitle(t)
		}
		l.DocID = ""
		return l.format()
	})
}

// WikiLinker returns a function that gives links without id the id of their note, where the user can
// open exactly one note of that title (or the note holding the linked bullet); ambiguous and missing
// ones stay as they are. For text coming from outside: AI agents, imports.
func (s *Store) WikiLinker(userID string) func(content string) string {
	docs, _ := s.GetDocuments(userID)
	byTitle := map[string][]string{}
	titles := map[string]string{}
	for _, d := range docs {
		if d.IsArchived {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(d.Title))
		byTitle[key] = append(byTitle[key], d.ID)
		titles[d.ID] = d.Title
	}
	return func(content string) string {
		if !strings.Contains(content, "[[") {
			return content
		}
		return replaceWikiLinks(content, func(l wikiLink) string {
			if l.DocID != "" {
				return ""
			}
			if l.BlockID != "" {
				var owner string
				if s.db.QueryRow(`SELECT document_id FROM blocks WHERE id = ? AND deleted = 0`, l.BlockID).Scan(&owner) == nil {
					if t, ok := titles[owner]; ok {
						l.DocID, l.Title = owner, t
						return l.format()
					}
				}
			}
			ids := byTitle[strings.ToLower(l.Title)]
			if len(ids) != 1 {
				return ""
			}
			l.DocID, l.Title = ids[0], titles[ids[0]]
			return l.format()
		})
	}
}

// rewriteDocLinks changes the links in the bullets of a note with fn, through the note's operation log
// (open editors follow, the change can be undone like any other); returns how many bullets changed.
// fn may query the database: it runs before the change's transaction (one connection in tests and builds).
func (s *Store) rewriteDocLinks(docID, userID string, fn func(content string) string) (int, error) {
	state, err := s.readCollabDoc(docID)
	if err != nil {
		return 0, err
	}
	next := map[string][2]string{} // block id -> old, new content
	for _, b := range state.Blocks {
		if b.Deleted || b.Type == drawing.BlockType || !strings.Contains(b.Content, "[[") {
			continue
		}
		if out := fn(b.Content); out != b.Content {
			next[b.ID] = [2]string{b.Content, out}
		}
	}
	if len(next) == 0 {
		return 0, nil
	}
	changed := 0
	_, _, err = s.applyDocChange(docID, collab.Actor{UserID: userID, ClientID: "server-links"}, nil, func(d *collab.Doc) []collab.Op {
		var ops []collab.Op
		for id, c := range next {
			// Only where nobody typed in the meantime
			if b := d.Blocks[id]; b != nil && !b.Deleted && b.Content == c[0] {
				text := c[1]
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: id, BaseVersion: b.Version, Content: &text})
			}
		}
		changed = len(ops)
		return ops
	})
	return changed, err
}

// migrateWikiLinksToIDs gives the existing links without id the id of their note, seen by the note's
// owner: where exactly one note has the title (or holds the linked bullet). Others stay as they are.
func (s *Store) migrateWikiLinksToIDs() error {
	rows, err := s.db.Query(`SELECT DISTINCT d.user_id, d.id FROM documents d JOIN blocks b ON b.document_id = d.id
		WHERE b.deleted = 0 AND b.content LIKE '%[[%' ORDER BY d.user_id`)
	if err != nil {
		return err
	}
	type pair struct{ user, doc string }
	var todo []pair
	for rows.Next() {
		var p pair
		if rows.Scan(&p.user, &p.doc) == nil {
			todo = append(todo, p)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var linker func(string) string
	user, total := "", 0
	for _, p := range todo {
		if p.user != user {
			user, linker = p.user, s.WikiLinker(p.user)
		}
		n, err := s.rewriteDocLinks(p.doc, p.user, linker)
		if err != nil {
			return err
		}
		total += n
	}
	if total > 0 {
		slog.Info("Links to notes now carry the note's id", "bullets", total)
	}
	return nil
}

// LinkWikiTitles gives the links without id in the user's own notes the id of their note (see WikiLinker);
// for notes made from text: sample data, imports. Returns the ids of the notes that changed.
func (s *Store) LinkWikiTitles(userID string) []string {
	rows, err := s.db.Query(`SELECT DISTINCT d.id FROM documents d JOIN blocks b ON b.document_id = d.id
		WHERE d.user_id = ? AND b.deleted = 0 AND b.content LIKE '%[[%'`, userID)
	if err != nil {
		return nil
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	_ = rows.Close()
	linker := s.WikiLinker(userID)
	var changed []string
	for _, id := range ids {
		if n, err := s.rewriteDocLinks(id, userID, linker); err == nil && n > 0 {
			changed = append(changed, id)
		}
	}
	return changed
}

// KeepWikiLinkIDs: an agent edits a bullet it read with readable links (ReadableWikiLinks). Links it left
// as they were get their id back, even where the title alone would be ambiguous.
func KeepWikiLinkIDs(old, edited string, titles map[string]string) string {
	if !strings.Contains(old, "[[") || !strings.Contains(edited, "[[") {
		return edited
	}
	original := map[string]string{}
	oldLinks, idx := wikiLinks(old)
	for i, l := range oldLinks {
		if l.DocID != "" {
			// Back with its id and the current title as the fallback
			if t, ok := titles[l.DocID]; ok {
				l.Title = t
			}
			original[ReadableWikiLinks(old[idx[i][0]:idx[i][1]], titles)] = l.format()
		}
	}
	return wikiTokenRe.ReplaceAllStringFunc(edited, func(token string) string {
		if o, ok := original[token]; ok {
			return o
		}
		return token
	})
}
