package storage

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// WriteMarkdownVault streams the user's workspace as an Obsidian-compatible ZIP straight into w:
// notes as .md files in their folders (as this user sees them, shared ones included), task lists
// under Aufgaben/, shopping and other lists under Listen/. Nothing is buffered on disk.
func (s *Store) WriteMarkdownVault(userID string, w io.Writer) error {
	zw := zip.NewWriter(w)
	names := newVaultNames()
	names.lang = s.MessageLanguage(userID)
	now := time.Now()

	// Folders first, so empty ones survive the round trip
	if folders, err := s.GetFolders(userID); err == nil {
		for _, f := range folders {
			if dir := names.dir(f); dir != "" {
				if _, err := zw.CreateHeader(&zip.FileHeader{Name: dir + "/", Modified: now}); err != nil {
					return err
				}
			}
		}
	}

	// Images and recordings go to attachments/, notes link them relative to their folder
	attachments := map[string]string{} // media ID -> path in the archive
	if media, err := s.MediaOfUser(userID); err == nil {
		for _, m := range media {
			attachments[m.ID] = vaultAttachmentDir + "/" + m.ID + MediaExt(m.Mime)
		}
	}
	if err := s.writeMediaFiles(zw, userID, func(m Media) string { return attachments[m.ID] }); err != nil {
		return err
	}

	docs, err := s.GetDocuments(userID)
	if err != nil {
		return err
	}
	for _, d := range docs {
		// Drawings as SVG files next to the images
		for _, b := range d.Blocks {
			if b.Type != drawing.BlockType {
				continue
			}
			if svg, ok := drawing.SVG(b.Content); ok {
				p := vaultAttachmentDir + "/" + b.ID + ".svg"
				if err := writeZipFile(zw, p, string(svg), parseISO(d.UpdatedAt, now)); err != nil {
					return err
				}
				attachments[DrawingAttachmentKey(b.ID)] = p
			}
		}
		dir := names.dir(d.FolderPath)
		name := names.file(dir, d.Title, i18n.T(names.lang, "Unbenannte Notiz"))
		up := ""
		if dir != "" {
			up = strings.Repeat("../", strings.Count(dir, "/")+1)
		}
		body := markdownFrontmatter(map[string]any{
			"title": d.Title, "icon": d.Icon, "tags": d.Tags, "created_at": d.CreatedAt, "updated_at": d.UpdatedAt,
		}) + blocksToVaultMarkdown(d.Blocks, func(id string) string {
			if p, ok := attachments[id]; ok {
				return up + p
			}
			return ""
		})
		if err := writeZipFile(zw, name, body, parseISO(d.UpdatedAt, now)); err != nil {
			return err
		}
	}

	if err := s.writeVaultTasks(zw, userID, names, now); err != nil {
		return err
	}
	if err := s.writeVaultLists(zw, userID, names, now); err != nil {
		return err
	}
	return zw.Close()
}

func (s *Store) writeVaultTasks(zw *zip.Writer, userID string, names *vaultNames, now time.Time) error {
	tasks, err := s.GetTasks(userID, "")
	if err != nil {
		return err
	}
	lists, _ := s.GetTaskLists(userID)
	byList := make(map[string][]domain.Thought)
	for _, t := range tasks {
		byList[t.TaskListID] = append(byList[t.TaskListID], t)
	}
	write := func(title string, tl *domain.TaskList, items []domain.Thought) error {
		sort.SliceStable(items, func(i, j int) bool { return items[i].SortOrder < items[j].SortOrder })
		meta := map[string]any{"title": title}
		if tl != nil {
			meta["icon"], meta["created_at"], meta["updated_at"] = tl.Icon, tl.CreatedAt, tl.UpdatedAt
		}
		var sb strings.Builder
		sb.WriteString(markdownFrontmatter(meta))
		for _, t := range items {
			sb.WriteString(taskMarkdownLine(t))
		}
		return writeZipFile(zw, names.file(i18n.T(names.lang, vaultTasks), title, i18n.T(names.lang, vaultTasks)), sb.String(), now)
	}
	for i := range lists {
		if err := write(lists[i].Title, &lists[i], byList[lists[i].ID]); err != nil {
			return err
		}
	}
	if items := byList[""]; len(items) > 0 {
		return write(i18n.T(names.lang, vaultNoList), nil, items)
	}
	return nil
}

func (s *Store) writeVaultLists(zw *zip.Writer, userID string, names *vaultNames, now time.Time) error {
	lists, err := s.GetAllListsForUser(userID)
	if err != nil {
		return err
	}
	for _, l := range lists {
		var sb strings.Builder
		sb.WriteString(markdownFrontmatter(map[string]any{"title": l.Title, "icon": l.Icon, "created_at": l.CreatedAt, "updated_at": l.UpdatedAt}))
		for _, it := range l.Items {
			mark := "[ ]"
			if it.IsCompleted {
				mark = "[x]"
			}
			line := "- " + mark + " " + oneLine(it.Content)
			if it.Quantity != "" {
				line += " (" + oneLine(it.Quantity) + ")"
			}
			if it.Category != "" && !strings.Contains(it.Content, "#") {
				line += " #" + strings.ReplaceAll(it.Category, " ", "_")
			}
			sb.WriteString(line + "\n")
		}
		if err := writeZipFile(zw, names.file(i18n.T(names.lang, vaultLists), l.Title, i18n.T(names.lang, "Liste")), sb.String(), parseISO(l.UpdatedAt, now)); err != nil {
			return err
		}
	}
	return nil
}

// Obsidian Tasks writes repeat rules as "🔁 every week"
var recurrenceEvery = map[string]string{"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}

// taskMarkdownLine writes a task in the format of the Obsidian Tasks plugin (📅 due date, ⏫/🔺 priority)
// with its subtasks and notes indented below.
func taskMarkdownLine(t domain.Thought) string {
	mark := "[ ]"
	if t.IsCompleted {
		mark = "[x]"
	}
	line := "- " + mark + " " + oneLine(t.Content)
	switch t.Priority {
	case "urgent":
		line += " 🔺"
	case "high":
		line += " ⏫"
	case "low":
		line += " 🔽"
	}
	if every, ok := recurrenceEvery[t.Recurrence]; ok {
		line += " 🔁 every " + every
	}
	if t.DueDate != "" {
		// Obsidian Tasks only knows the date; the time follows separated by a space
		line += " 📅 " + strings.Replace(t.DueDate, "T", " ", 1)
	}
	var sb strings.Builder
	sb.WriteString(line + "\n")
	for _, st := range t.Subtasks {
		sub := "[ ]"
		if st.IsCompleted {
			sub = "[x]"
		}
		sb.WriteString("\t- " + sub + " " + oneLine(st.Title) + "\n")
	}
	if notes := strings.TrimSpace(t.Notes); notes != "" {
		for _, l := range strings.Split(notes, "\n") {
			sb.WriteString("\t> " + strings.TrimRight(l, "\r") + "\n")
		}
	}
	return sb.String()
}

// BlocksToVaultMarkdown turns outliner blocks into Markdown that Obsidian renders natively:
// top-level headings, dividers and callouts as real block elements, everything else as a nested
// list (one tab per level), code as fenced blocks inside the list.
// vaultAttachmentDir holds images and recordings in the Markdown archive.
const vaultAttachmentDir = "attachments"

// vaultCalloutKind: the Obsidian callout for each callout-like block type
var vaultCalloutKind = map[string]string{"callout": "note", "warning": "warning", "error": "failure"}

// DrawingAttachmentKey: how a drawing's SVG file is looked up among the attachments of an export
func DrawingAttachmentKey(blockID string) string { return "drawing:" + blockID }

func BlocksToVaultMarkdown(blocks []domain.DocumentBlock) string {
	return blocksToVaultMarkdown(blocks, nil)
}

// blocksToVaultMarkdown renders blocks as Markdown; attachment maps a media ID to its relative path
// (image and audio blocks become embeds Obsidian shows inline).
func blocksToVaultMarkdown(blocks []domain.DocumentBlock, attachment func(id string) string) string {
	var sb strings.Builder
	// Children of a top-level heading/callout/code/divider become a list one level up; otherwise their
	// tab indent would turn them into an indented code block in Markdown
	lift := 0
	for _, b := range blocks {
		lvl := b.Level
		if lvl <= 0 {
			lvl, lift = 0, 0
		} else if lvl -= lift; lvl < 0 {
			lvl = 0
		}
		indent := strings.Repeat("\t", lvl)
		content := MaskSecretRefs(strings.ReplaceAll(b.Content, "\r\n", "\n"))
		if b.Type == drawing.BlockType {
			// In an archive the picture file (with the model inside), otherwise a fenced block that pasting
			// or importing turns back into a drawing
			p := ""
			if attachment != nil {
				p = attachment(DrawingAttachmentKey(b.ID))
			}
			if p != "" {
				b.Type, content = "image", "!["+oneLine(strings.Join(drawing.Texts(b.Content), " · "))+"]("+strings.ReplaceAll(p, " ", "%20")+")"
			} else {
				b.Type, b.Lang, content = "code", drawing.Fence, strings.TrimSpace(b.Content)
			}
		}
		if (b.Type == "image" || b.Type == "audio") && attachment != nil {
			if ref, ok := ParseMediaContent(content); ok {
				if p := attachment(ref.ID); p != "" {
					content = "![" + ref.Caption + "](" + strings.ReplaceAll(p, " ", "%20") + ")"
				}
			}
		}
		// Soft line breaks continue the list item, aligned under its text
		cont := func(text, prefix string) string {
			return strings.ReplaceAll(text, "\n", "\n"+indent+prefix)
		}

		if b.Level <= 0 {
			switch b.Type {
			case "h1", "h2", "h3":
				hashes := map[string]string{"h1": "#", "h2": "##", "h3": "###"}[b.Type]
				sb.WriteString("\n" + hashes + " " + oneLine(content) + "\n\n")
				lift = 1
				continue
			case "divider":
				sb.WriteString("\n---\n\n")
				lift = 1
				continue
			case "callout", "warning", "error":
				sb.WriteString("\n> [!" + vaultCalloutKind[b.Type] + "]\n> " + strings.ReplaceAll(content, "\n", "\n> ") + "\n\n")
				lift = 1
				continue
			case "code":
				sb.WriteString("\n```" + b.Lang + "\n" + content + "\n```\n\n")
				lift = 1
				continue
			}
		}
		switch b.Type {
		case "code":
			// Fenced block nested under the previous list item
			sb.WriteString(indent + "```" + b.Lang + "\n" + indent + strings.ReplaceAll(content, "\n", "\n"+indent) + "\n" + indent + "```\n")
		case "todo":
			mark := "[ ]"
			if b.Checked {
				mark = "[x]"
			}
			sb.WriteString(indent + "- " + mark + " " + cont(content, "  ") + "\n")
		case "h1", "h2", "h3":
			hashes := map[string]string{"h1": "#", "h2": "##", "h3": "###"}[b.Type]
			sb.WriteString(indent + "- " + hashes + " " + oneLine(content) + "\n")
		case "divider":
			sb.WriteString(indent + "- ---\n")
		case "callout":
			sb.WriteString(indent + "- > " + cont(content, "  > ") + "\n")
		case "warning", "error":
			sb.WriteString(indent + "- > [!" + vaultCalloutKind[b.Type] + "] " + cont(content, "  > ") + "\n")
		case "numbered":
			// Markdown renumbers the items itself
			sb.WriteString(indent + "1. " + cont(content, "   ") + "\n")
		default:
			if strings.TrimSpace(content) == "" {
				sb.WriteString(indent + "-\n")
			} else {
				sb.WriteString(indent + "- " + cont(content, "  ") + "\n")
			}
		}
	}
	return strings.TrimLeft(sb.String(), "\n")
}

// markdownFrontmatter writes YAML front matter; JSON-encoded strings are valid YAML scalars.
func markdownFrontmatter(meta map[string]any) string {
	keys := make([]string, 0, len(meta))
	for k := range meta {
		keys = append(keys, k)
	}
	order := map[string]int{"title": 0, "icon": 1, "tags": 2, "created_at": 3, "updated_at": 4}
	sort.Slice(keys, func(i, j int) bool { return order[keys[i]] < order[keys[j]] })
	var sb strings.Builder
	sb.WriteString("---\n")
	for _, k := range keys {
		switch v := meta[k].(type) {
		case string:
			if v != "" {
				q, _ := json.Marshal(v)
				sb.WriteString(k + ": " + string(q) + "\n")
			}
		case []string:
			if len(v) > 0 {
				sb.WriteString(k + ":\n")
				for _, t := range v {
					q, _ := json.Marshal(t)
					sb.WriteString("  - " + string(q) + "\n")
				}
			}
		}
	}
	sb.WriteString("---\n\n")
	return sb.String()
}

func writeZipFile(zw *zip.Writer, name, body string, modified time.Time) error {
	f, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: modified})
	if err != nil {
		return err
	}
	_, err = io.WriteString(f, body)
	return err
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(s, "\n", " ")), " ")
}

func parseISO(v string, fallback time.Time) time.Time {
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t
	}
	return fallback
}

// vaultNames builds safe, unique file and folder names inside the archive.
type vaultNames struct {
	used map[string]bool
	lang string // language of folder names and fallbacks
}

// Folders of the archive for tasks and lists and the file of tasks without a list, in the language of
// the one exporting; the import knows them in every language.
const (
	vaultTasks  = "Aufgaben"
	vaultLists  = "Listen"
	vaultNoList = "Ohne Liste"
)

func isVaultDir(name, german string) bool {
	for _, lang := range i18n.Supported {
		if name == i18n.T(lang, german) {
			return true
		}
	}
	return false
}

func newVaultNames() *vaultNames { return &vaultNames{used: make(map[string]bool)} }

// segment makes one path part safe on Windows, macOS and Linux and never "." or "..".
func segment(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(s))
	s = strings.Trim(s, ". ")
	if len([]rune(s)) > 100 {
		s = string([]rune(s)[:100])
	}
	return s
}

func (n *vaultNames) dir(folderPath string) string {
	parts := make([]string, 0)
	for _, p := range strings.Split(folderPath, "/") {
		if seg := segment(p); seg != "" {
			parts = append(parts, seg)
		}
	}
	return path.Join(parts...)
}

// file returns "dir/title.md", adding " (2)", " (3)" … when the name is already taken.
func (n *vaultNames) file(dir, title, fallback string) string {
	base := segment(title)
	if base == "" {
		base = fallback
	}
	name := path.Join(dir, base+".md")
	for i := 2; n.used[strings.ToLower(name)]; i++ {
		name = path.Join(dir, fmt.Sprintf("%s (%d).md", base, i))
	}
	n.used[strings.ToLower(name)] = true
	return name
}
