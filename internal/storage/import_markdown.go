package storage

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Import limits: they keep a crafted archive (zip bomb, millions of files) from exhausting the server.
const (
	MaxImportUploadBytes   = 100 << 20 // uploaded file
	maxImportFileBytes     = 10 << 20  // one unpacked note
	maxImportUnpackedBytes = 500 << 20 // all unpacked notes together
	maxImportFiles         = 20000
	maxImportMediaBytes    = 100 << 20 // one image or recording
)

// ImportPlan is everything an import would create. It is built completely (and validated) before
// anything is written, so the preview shows exactly what the import does.
type ImportPlan struct {
	Folders   []string           `json:"-"`
	Docs      []importDoc        `json:"-"`
	TaskLists []importTaskList   `json:"-"`
	Lists     []importList       `json:"-"`
	Inbox     []importTask       `json:"-"`
	Themes    []domain.UserTheme `json:"-"`
	Skipped   []ImportSkip       `json:"skipped"`
	// Images and recordings of the archive: "media:<id>" (own backup) or the path in the archive
	Media map[string][]byte `json:"-"`
}

// Only keeps the chosen sections of the plan (see NormalizeSections).
func (p *ImportPlan) Only(sections map[string]bool) *ImportPlan {
	out := &ImportPlan{Skipped: p.Skipped}
	if sections[SectionNotes] {
		out.Folders, out.Docs, out.Media = p.Folders, p.Docs, p.Media
	}
	if sections[SectionTasks] {
		out.TaskLists = p.TaskLists
	}
	if sections[SectionLists] {
		out.Lists = p.Lists
	}
	if sections[SectionInbox] {
		out.Inbox = p.Inbox
	}
	if sections[SectionThemes] {
		out.Themes = p.Themes
	}
	return out
}

type ImportSkip struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// ImportSummary is what the API returns for a preview and after the import.
type ImportSummary struct {
	Folders   int          `json:"folders"`
	Notes     int          `json:"notes"`
	TaskLists int          `json:"taskLists"`
	Tasks     int          `json:"tasks"`
	Lists     int          `json:"lists"`
	ListItems int          `json:"listItems"`
	Inbox     int          `json:"inbox"`
	Themes    int          `json:"themes"`
	Skipped   []ImportSkip `json:"skipped"`
	Applied   bool         `json:"applied"`
}

type importDoc struct {
	folder, title, icon string
	dir                 string // folder of the note inside the archive, for relative image links
	blocks              []domain.DocumentBlock
}

type importTask struct {
	content, priority, due, notes, recurrence string
	done                                      bool
	subtasks                                  []domain.SubTask
}

type importTaskList struct {
	title, icon string
	tasks       []importTask
}

type importList struct {
	title, icon string
	items       []importItem
}

type importItem struct {
	content, category, quantity string
	done                        bool
}

func (p *ImportPlan) skip(path, reason string) {
	p.Skipped = append(p.Skipped, ImportSkip{Path: path, Reason: reason})
}

func (p *ImportPlan) Summary(applied bool) ImportSummary {
	sum := ImportSummary{Folders: len(p.Folders), Notes: len(p.Docs), Lists: len(p.Lists), Inbox: len(p.Inbox), Themes: len(p.Themes), Skipped: p.Skipped, Applied: applied}
	for _, tl := range p.TaskLists {
		if tl.title != "" {
			sum.TaskLists++
		}
		sum.Tasks += len(tl.tasks)
	}
	for _, l := range p.Lists {
		sum.ListItems += len(l.items)
	}
	if sum.Skipped == nil {
		sum.Skipped = []ImportSkip{}
	}
	return sum
}

// --- Reading archives -------------------------------------------------------------------------------

type zipNote struct {
	path string // inside the archive, "/"-separated, without a leading vault folder
	text string
}

// readZipNotes returns the Markdown files of an archive (other files are reported as skipped). A
// single top-level folder, as Obsidian and most zip tools create, is stripped and returned as name.
func readZipNotes(r io.ReaderAt, size int64, plan *ImportPlan) ([]zipNote, []string, string, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, nil, "", errors.New("Die Datei ist kein gültiges ZIP-Archiv")
	}
	if len(zr.File) > maxImportFiles {
		return nil, nil, "", i18n.NewError("Zu viele Dateien im Archiv (max. {max})", "max", strconv.Itoa(maxImportFiles))
	}

	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		names = append(names, cleanArchivePath(f.Name))
	}
	prefix := commonTopFolder(names)

	var notes []zipNote
	var dirs []string
	var unpacked int64
	for i, f := range zr.File {
		name := strings.TrimPrefix(names[i], prefix)
		if name == "" || hiddenPath(name) {
			continue
		}
		if f.FileInfo().IsDir() {
			dirs = append(dirs, strings.TrimSuffix(name, "/"))
			continue
		}
		if !strings.EqualFold(path.Ext(name), ".md") {
			if !importMediaExt[strings.ToLower(path.Ext(name))] {
				plan.skip(name, "kein Markdown und kein Bild/Audio (z. B. PDFs werden nicht importiert)")
				continue
			}
			if f.UncompressedSize64 > maxImportMediaBytes {
				plan.skip(name, "zu groß (max. 100 MB pro Bild oder Aufnahme)")
				continue
			}
			data, err := readZipFile(f, maxImportMediaBytes)
			if err != nil {
				plan.skip(name, "nicht lesbar")
				continue
			}
			if unpacked += int64(len(data)); unpacked > maxImportUnpackedBytes {
				return nil, nil, "", errors.New("Archiv ist entpackt zu groß (max. 500 MB)")
			}
			plan.addMedia(name, data)
			continue
		}
		if f.UncompressedSize64 > maxImportFileBytes {
			plan.skip(name, "zu groß (max. 10 MB pro Notiz)")
			continue
		}
		rc, err := f.Open()
		if err != nil {
			plan.skip(name, "nicht lesbar")
			continue
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxImportFileBytes+1))
		rc.Close()
		if err != nil || len(data) > maxImportFileBytes {
			plan.skip(name, "nicht lesbar oder zu groß")
			continue
		}
		if unpacked += int64(len(data)); unpacked > maxImportUnpackedBytes {
			return nil, nil, "", errors.New("Archiv ist entpackt zu groß (max. 500 MB)")
		}
		if !utf8.Valid(data) {
			plan.skip(name, "keine UTF-8-Textdatei")
			continue
		}
		notes = append(notes, zipNote{path: name, text: strings.ReplaceAll(string(data), "\r\n", "\n")})
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].path < notes[j].path })
	return notes, dirs, strings.TrimSuffix(prefix, "/"), nil
}

// cleanArchivePath normalises an entry name and removes anything that could escape (.., absolute paths).
func cleanArchivePath(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	parts := make([]string, 0)
	for _, p := range strings.Split(name, "/") {
		if p == "" || p == "." || p == ".." {
			continue
		}
		parts = append(parts, p)
	}
	out := strings.Join(parts, "/")
	if strings.HasSuffix(name, "/") && out != "" {
		out += "/"
	}
	return out
}

func commonTopFolder(names []string) string {
	top := ""
	for _, n := range names {
		if n == "" || hiddenPath(n) {
			continue
		}
		i := strings.Index(n, "/")
		if i < 0 {
			return "" // a file at the root: no common folder
		}
		if top == "" {
			top = n[:i+1]
		} else if top != n[:i+1] {
			return ""
		}
	}
	return top
}

// hiddenPath skips Obsidian's settings, trash and OS junk.
func hiddenPath(p string) bool {
	for _, part := range strings.Split(p, "/") {
		if strings.HasPrefix(part, ".") || part == "__MACOSX" {
			return true
		}
	}
	return false
}

// --- Planning ---------------------------------------------------------------------------------------

// PlanObsidianImport reads a vault ZIP. Everything lands in a top folder named after the vault, so an
// import never mixes into existing notes. Checkboxes stay checkboxes in their note.
func PlanObsidianImport(r io.ReaderAt, size int64, fileName string) (*ImportPlan, error) {
	plan := &ImportPlan{}
	notes, dirs, vault, err := readZipNotes(r, size, plan)
	if err != nil {
		return nil, err
	}
	if vault == "" {
		vault = strings.TrimSuffix(path.Base(fileName), path.Ext(fileName))
	}
	root := segment(vault)
	if root == "" {
		root = "Obsidian-Import"
	}
	folders := map[string]bool{root: true}
	for _, d := range dirs {
		folders[path.Join(root, folderPathOf(d+"/x"))] = true
	}
	for _, n := range notes {
		fm, body := splitFrontmatter(n.text)
		folder := path.Join(root, folderPathOf(n.path))
		folders[folder] = true
		title := fm.title
		if title == "" {
			title = strings.TrimSuffix(path.Base(n.path), path.Ext(n.path))
		}
		blocks := MarkdownToBlocks(body)
		// Front matter tags become hashtags, since MindSift reads tags from the text
		if extra := missingTags(fm.tags, body); extra != "" {
			blocks = append(blocks, newBlock("bullet", extra, 0))
		}
		plan.Docs = append(plan.Docs, importDoc{folder: folder, title: title, icon: fm.icon, dir: path.Dir(n.path), blocks: blocks})
	}
	plan.reportUnusedMedia()
	plan.Folders = sortedKeys(folders)
	if len(plan.Docs) == 0 {
		return nil, errors.New("Im Archiv wurden keine Markdown-Notizen gefunden")
	}
	return plan, nil
}

// PlanMindSiftArchiveImport reads a ZIP created by "Markdown-Archiv herunterladen": notes go back to
// their folders, Aufgaben/ back into task lists, Listen/ back into lists.
func PlanMindSiftArchiveImport(r io.ReaderAt, size int64) (*ImportPlan, error) {
	plan := &ImportPlan{}
	notes, dirs, _, err := readZipNotes(r, size, plan)
	if err != nil {
		return nil, err
	}
	folders := map[string]bool{}
	for _, d := range dirs {
		if top := strings.SplitN(d, "/", 2)[0]; !isVaultDir(top, vaultTasks) && !isVaultDir(top, vaultLists) {
			folders[folderPathOf(d+"/x")] = true
		}
	}
	for _, n := range notes {
		fm, body := splitFrontmatter(n.text)
		title := fm.title
		if title == "" {
			title = strings.TrimSuffix(path.Base(n.path), path.Ext(n.path))
		}
		switch dir := folderPathOf(n.path); {
		case isVaultDir(dir, vaultTasks):
			tl := importTaskList{title: title, icon: fm.icon, tasks: parseTaskFile(body)}
			if isVaultDir(title, vaultNoList) {
				tl.title = ""
			}
			plan.TaskLists = append(plan.TaskLists, tl)
		case isVaultDir(dir, vaultLists):
			plan.Lists = append(plan.Lists, importList{title: title, icon: fm.icon, items: parseListFile(body)})
		default:
			folder := folderPathOf(n.path)
			if folder != "" {
				folders[folder] = true
			}
			plan.Docs = append(plan.Docs, importDoc{folder: folder, title: title, icon: fm.icon, dir: path.Dir(n.path), blocks: MarkdownToBlocks(body)})
		}
	}
	plan.reportUnusedMedia()
	plan.Folders = sortedKeys(folders)
	if len(plan.Docs)+len(plan.TaskLists)+len(plan.Lists) == 0 {
		return nil, errors.New("Das Archiv enthält keine MindSift-Daten (Notizen, Aufgaben oder Listen)")
	}
	return plan, nil
}

// BackupFileName is the JSON inside the backup ZIP.
const BackupFileName = "mindsift-backup.json"

// BackupVaultDir holds the Markdown vault inside the backup ZIP: Obsidian (or any editor) opens it as it is,
// without MindSift. Its attachments/ are also the media of the backup.
const BackupVaultDir = "Obsidian"

// WriteBackupZip streams the JSON backup compressed into a ZIP, next to it the workspace as a Markdown
// vault (BackupVaultDir) with the images and recordings of the user's notes as attachments/<id><ext>
// (blocks point to them as media:<id>).
func (s *Store) WriteBackupZip(userID string, exp *domain.FullExport, w io.Writer) error {
	zw := zip.NewWriter(w)
	modified := parseISO(exp.ExportedAt, time.Now())
	f, err := zw.CreateHeader(&zip.FileHeader{Name: BackupFileName, Method: zip.Deflate, Modified: modified})
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(exp); err != nil {
		return err
	}
	if err := s.writeVault(prefixedZip{zw: zw, prefix: BackupVaultDir + "/"}, userID); err != nil {
		return err
	}
	return zw.Close()
}

// writeMediaFiles adds the user's media files to an archive (already compressed formats: stored as is).
// Files missing on disk are left out.
func (s *Store) writeMediaFiles(zw zipEntries, userID string, name func(Media) string) error {
	media, err := s.MediaOfUser(userID)
	if err != nil {
		return err
	}
	for _, m := range media {
		src, err := os.Open(s.MediaFilePath(&m))
		if err != nil {
			continue
		}
		dst, err := zw.CreateHeader(&zip.FileHeader{Name: name(m), Method: zip.Store, Modified: parseISO(m.CreatedAt, time.Now())})
		if err == nil {
			_, err = io.Copy(dst, src)
		}
		src.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// PlanMindSiftImport picks the format of MindSift's own data: plain JSON backup, the backup ZIP
// (one JSON inside, next to it the Markdown vault) or the Markdown archive.
func PlanMindSiftImport(data []byte, fileName string) (*ImportPlan, error) {
	if strings.HasSuffix(strings.ToLower(fileName), ".json") || (len(data) > 0 && data[0] == '{') {
		return PlanMindSiftJSONImport(data)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("Die Datei ist weder ein MindSift-Backup (.json/.zip) noch ein MindSift-Markdown-Archiv")
	}
	var backup *zip.File
	for _, f := range zr.File {
		if cleanArchivePath(f.Name) == BackupFileName {
			backup = f
			break
		}
	}
	for _, f := range zr.File {
		if backup != nil {
			break
		}
		name := cleanArchivePath(f.Name)
		if strings.EqualFold(path.Ext(name), ".md") {
			backup = nil
			break
		}
		if strings.EqualFold(path.Ext(name), ".json") && !hiddenPath(name) {
			backup = f
		}
	}
	if backup == nil {
		return PlanMindSiftArchiveImport(bytes.NewReader(data), int64(len(data)))
	}
	// Images and recordings: attachments/<id><ext> of the vault next to the JSON, media/<id><ext> in older backups
	// (the vault's attachments/ also holds drawings as SVG, those are no media)
	media := map[string][]byte{}
	var mediaBytes int64
	vaultMedia := BackupVaultDir + "/" + vaultAttachmentDir + "/med_"
	for _, f := range zr.File {
		name := cleanArchivePath(f.Name)
		if !(strings.HasPrefix(name, "media/") || strings.HasPrefix(name, vaultMedia)) || f.FileInfo().IsDir() || f.UncompressedSize64 > maxImportMediaBytes {
			continue
		}
		if mediaBytes += int64(f.UncompressedSize64); mediaBytes > maxImportUnpackedBytes {
			return nil, errors.New("Backup ist entpackt zu groß (max. 500 MB)")
		}
		if b, err := readZipFile(f, maxImportMediaBytes); err == nil {
			base := path.Base(name)
			media["media:"+strings.TrimSuffix(base, path.Ext(base))] = b
		}
	}
	if backup.UncompressedSize64 > maxImportUnpackedBytes {
		return nil, errors.New("Backup ist entpackt zu groß (max. 500 MB)")
	}
	rc, err := backup.Open()
	if err != nil {
		return nil, errors.New("Backup im Archiv ist nicht lesbar")
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, maxImportUnpackedBytes+1))
	if err != nil || len(raw) > maxImportUnpackedBytes {
		return nil, errors.New("Backup im Archiv ist nicht lesbar oder zu groß")
	}
	plan, err := PlanMindSiftJSONImport(raw)
	if err != nil {
		return nil, err
	}
	if len(media) > 0 {
		plan.Media = media
	}
	return plan, nil
}

// PlanMindSiftJSONImport reads the JSON backup ("Backup herunterladen"). Notes shared with the
// exporting user belong to someone else and are skipped; discarded thoughts are not restored.
func PlanMindSiftJSONImport(data []byte) (*ImportPlan, error) {
	var exp domain.FullExport
	if err := json.Unmarshal(data, &exp); err != nil || (exp.Version == "" && exp.ExportedAt == "") {
		return nil, errors.New("Die Datei ist kein MindSift-JSON-Backup")
	}
	plan := &ImportPlan{}
	folders := map[string]bool{}
	for _, d := range exp.Documents {
		if !d.IsOwner && d.Permission != "" && d.Permission != "owner" {
			plan.skip(d.Title, "geteilte Notiz eines anderen Benutzers")
			continue
		}
		if d.FolderPath != "" {
			folders[d.FolderPath] = true
		}
		blocks := make([]domain.DocumentBlock, len(d.Blocks))
		for i, b := range d.Blocks {
			b.ID, b.DocumentID, b.TaskID = domain.NewID("blk"), "", ""
			blocks[i] = b
		}
		plan.Docs = append(plan.Docs, importDoc{folder: d.FolderPath, title: d.Title, icon: d.Icon, blocks: blocks})
	}
	listIndex := map[string]int{}
	for _, tl := range exp.TaskLists {
		if !tl.IsOwner {
			plan.skip(tl.Title, "geteilte Aufgabenliste eines anderen Benutzers")
			continue
		}
		listIndex[tl.ID] = len(plan.TaskLists)
		plan.TaskLists = append(plan.TaskLists, importTaskList{title: tl.Title, icon: tl.Icon})
	}
	for _, t := range exp.Thoughts {
		task := importTask{content: t.Content, priority: t.Priority, due: t.DueDate, notes: t.Notes, done: t.IsCompleted, subtasks: t.Subtasks, recurrence: t.Recurrence}
		switch {
		case t.Status == domain.StatusInbox:
			plan.Inbox = append(plan.Inbox, task)
		case t.Status == domain.StatusKept || (t.Status == domain.StatusConverted && t.ConvertedType == "task"):
			if i, ok := listIndex[t.TaskListID]; ok {
				plan.TaskLists[i].tasks = append(plan.TaskLists[i].tasks, task)
			} else {
				plan.TaskLists = append(plan.TaskLists, importTaskList{tasks: []importTask{task}})
			}
		}
	}
	for _, l := range exp.Lists {
		if !l.IsOwner {
			plan.skip(l.Title, "geteilte Liste eines anderen Benutzers")
			continue
		}
		il := importList{title: l.Title, icon: l.Icon}
		for _, it := range l.Items {
			il.items = append(il.items, importItem{content: it.Content, category: it.Category, quantity: it.Quantity, done: it.IsCompleted})
		}
		plan.Lists = append(plan.Lists, il)
	}
	plan.Themes = exp.Themes
	plan.Folders = sortedKeys(folders)
	return plan, nil
}

// --- Applying ---------------------------------------------------------------------------------------

// ApplyImport creates everything of the plan for the user. Existing data is never changed; imported
// items are added next to it. Task lists of the same name get merged into one new list per import.
func (s *Store) ApplyImport(userID string, plan *ImportPlan) (ImportSummary, error) {
	for _, f := range plan.Folders {
		_, _ = s.CreateFolder(userID, f) // already existing folders are fine
	}
	for _, d := range plan.Docs {
		title := strings.TrimSpace(d.title)
		if title == "" {
			title = i18n.T(s.MessageLanguage(userID), "Unbenannte Notiz")
		}
		icon := d.icon
		if icon == "" {
			icon = "🗒️"
		}
		blocks, files := linkImportMedia(d, plan.Media, nil)
		doc, err := s.CreateDocument(userID, "", title, icon, d.folder, blocks, nil, false)
		if errors.Is(err, ErrNoteTooLarge) {
			// Said with the note's name, so the person knows which file to split
			return plan.Summary(false), i18n.NewError("Notiz „{title}“: {reason}", "title", title, "reason", err.Error())
		}
		if err != nil {
			return plan.Summary(false), fmt.Errorf("Notiz %q: %w", title, err)
		}
		if err := s.storeImportMedia(userID, doc.ID, files); err != nil {
			return plan.Summary(false), fmt.Errorf("Notiz %q: %w", title, err)
		}
	}
	// [[Titel]] in the imported notes point at their notes by id, now that all of them exist
	if len(plan.Docs) > 0 {
		s.LinkWikiTitles(userID)
	}
	for _, tl := range plan.TaskLists {
		listID := "" // tasks without a list
		if tl.title != "" {
			icon := tl.icon
			if icon == "" {
				icon = "📋"
			}
			created, err := s.CreateTaskList(userID, "", "", tl.title, icon, "")
			if err != nil {
				return plan.Summary(false), fmt.Errorf("Aufgabenliste %q: %w", tl.title, err)
			}
			listID = created.ID
		}
		for _, t := range tl.tasks {
			if err := s.importTaskInto(userID, listID, t, true); err != nil {
				return plan.Summary(false), err
			}
		}
	}
	for _, t := range plan.Inbox {
		if err := s.importTaskInto(userID, "", t, false); err != nil {
			return plan.Summary(false), err
		}
	}
	for _, l := range plan.Lists {
		icon := l.icon
		if icon == "" {
			icon = "🛒"
		}
		created, err := s.CreateList(userID, l.title, icon, "shopping")
		if err != nil {
			return plan.Summary(false), fmt.Errorf("Liste %q: %w", l.title, err)
		}
		for i, it := range l.items {
			item, err := s.CreateListItem(created.ID, it.content, it.category, it.quantity, i, userID)
			if err != nil {
				continue // empty lines and the like
			}
			if it.done {
				_, err = s.ToggleListItem(item.ID, true, userID, "")
				logDBErr(err)
			}
		}
	}
	for _, th := range plan.Themes {
		if _, err := s.SaveUserTheme(userID, "", th.Name, th.CSS); err != nil {
			plan.skip(th.Name, "Theme: "+err.Error())
		}
	}
	return plan.Summary(true), nil
}

func (s *Store) importTaskInto(userID, listID string, t importTask, asTask bool) error {
	content := strings.TrimSpace(t.content)
	if content == "" {
		return nil
	}
	priority := t.priority
	if priority != "low" && priority != "high" && priority != "urgent" {
		priority = "normal"
	}
	th, err := s.CreateThoughtWithDetails(userID, content, priority, "import", t.due, listID, "todo", t.notes)
	if err != nil {
		return fmt.Errorf("Aufgabe %q: %w", content, err)
	}
	if !asTask {
		return nil
	}
	if _, err := s.UpdateThoughtTriage(userID, th.ID, "keep", "task", "", t.due, listID); err != nil {
		return fmt.Errorf("Aufgabe %q: %w", content, err)
	}
	if validRecurrence(t.recurrence) && t.recurrence != "" {
		// Imported as already handled: completing a restored task must not create a second successor
		s.execLogged(`UPDATE thoughts SET recurrence = ?, recurrence_spawned = ? WHERE id = ?`, t.recurrence, boolInt(t.done), th.ID)
	}
	if t.done || len(t.subtasks) > 0 {
		var done *bool
		if t.done {
			done = &t.done
		}
		var subs *[]domain.SubTask
		if len(t.subtasks) > 0 {
			subs = &t.subtasks
		}
		_, err = s.UpdateThoughtDetails(userID, th.ID, nil, done, nil, nil, nil, nil, nil, subs, nil)
		logDBErr(err)
	}
	return nil
}

// --- Markdown parsing -------------------------------------------------------------------------------

type frontmatter struct {
	title, icon string
	tags        []string
}

// splitFrontmatter reads the few keys MindSift uses (title, icon, tags/tag) from YAML front matter.
// It is deliberately tolerant: unknown keys and nested structures are ignored.
func splitFrontmatter(text string) (frontmatter, string) {
	var fm frontmatter
	if !strings.HasPrefix(text, "---\n") {
		return fm, text
	}
	end := strings.Index(text[4:], "\n---")
	if end < 0 {
		return fm, text
	}
	head := text[4 : 4+end]
	body := strings.TrimLeft(text[4+end+4:], "\n")
	key := ""
	for _, line := range strings.Split(head, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- ") && (key == "tags" || key == "tag") {
			fm.tags = append(fm.tags, yamlScalar(trimmed[2:]))
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(line, " ") {
			continue
		}
		key = strings.TrimSpace(strings.ToLower(k))
		v = strings.TrimSpace(v)
		switch key {
		case "title":
			fm.title = yamlScalar(v)
		case "icon":
			fm.icon = yamlScalar(v)
		case "tags", "tag":
			v = strings.Trim(v, "[]")
			for _, t := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' }) {
				if t = yamlScalar(t); t != "" {
					fm.tags = append(fm.tags, t)
				}
			}
		}
	}
	return fm, body
}

func yamlScalar(v string) string {
	v = strings.TrimSpace(v)
	if strings.HasPrefix(v, `"`) {
		var out string
		if json.Unmarshal([]byte(v), &out) == nil {
			return out
		}
	}
	return strings.Trim(v, `"'`)
}

func missingTags(tags []string, body string) string {
	lower := strings.ToLower(body)
	var out []string
	for _, t := range tags {
		t = strings.TrimPrefix(strings.TrimSpace(t), "#")
		if t == "" || strings.Contains(lower, "#"+strings.ToLower(t)) {
			continue
		}
		out = append(out, "#"+strings.ReplaceAll(t, " ", "_"))
	}
	return strings.Join(out, " ")
}

var (
	listItemRe = regexp.MustCompile(`^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]+(.*))?$`)
	checkboxRe = regexp.MustCompile(`^\[([ xX])\][ \t]*(.*)$`)
	headingRe  = regexp.MustCompile(`^(#{1,6})[ \t]+(.*)$`)
	fenceRe    = regexp.MustCompile("^([ \\t]*)(```|~~~)(.*)$")
	calloutRe  = regexp.MustCompile(`^\[!([\w-]+)\][+-]?[ \t]*(.*)$`)
)

// calloutType maps an Obsidian callout kind to a block type: warnings and failures keep their colour,
// every other kind (note, tip, quote …) becomes a plain callout.
func calloutType(kind string) string {
	switch strings.ToLower(kind) {
	case "warning", "caution", "attention":
		return "warning"
	case "failure", "fail", "missing", "danger", "error", "bug":
		return "error"
	}
	return "callout"
}

func newBlock(typ, content string, level int) domain.DocumentBlock {
	return domain.DocumentBlock{ID: domain.NewID("blk"), Type: typ, Content: content, Level: level}
}

// indentWidth counts a tab as 4 columns.
func indentWidth(s string) int {
	w := 0
	for _, r := range s {
		if r == '\t' {
			w += 4
		} else {
			w++
		}
	}
	return w
}

// MarkdownToBlocks turns Markdown into outliner blocks. Lists keep their nesting, headings start a
// section whose following content is nested below them (the reverse of the export), callouts and
// quotes become callout blocks, fenced code becomes a code block, Markdown tables become table blocks,
// plain paragraphs become bullets.
func MarkdownToBlocks(md string) []domain.DocumentBlock {
	lines := strings.Split(md, "\n")
	var blocks []domain.DocumentBlock
	base := 0          // level of content in the current heading section
	var headings []int // ranks (1–3) of the open headings: H2 below H1 nests one level deeper
	var indents []int  // indent widths of the open list levels
	inList := false    // the previous line belonged to a list item (for continuation lines)
	// A list right after a paragraph ("Folgende Punkte:") nests under that paragraph
	afterParagraph, listBase := false, 0
	listLevel := func(width int) int {
		if len(indents) == 0 {
			listBase = base
			if afterParagraph {
				listBase = base + 1
			}
		}
		for len(indents) > 0 && indents[len(indents)-1] > width {
			indents = indents[:len(indents)-1]
		}
		if len(indents) == 0 || indents[len(indents)-1] < width {
			indents = append(indents, width)
		}
		return listBase + len(indents) - 1
	}

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			inList = false
			continue
		}

		// Fenced code (also inside lists)
		if m := fenceRe.FindStringSubmatch(line); m != nil {
			fence, lang, prefix := m[2], strings.TrimSpace(m[3]), m[1]
			var code []string
			for i++; i < len(lines); i++ {
				l := lines[i]
				if strings.HasPrefix(strings.TrimSpace(l), fence) {
					break
				}
				code = append(code, strings.TrimPrefix(l, prefix))
			}
			level := base
			if prefix != "" && len(indents) > 0 {
				level = listLevel(indentWidth(prefix))
			}
			b := newBlock("code", strings.Join(code, "\n"), level)
			b.Lang = lang
			// A drawing copied or exported without its file comes back as a drawing
			if lang == drawing.Fence {
				if _, ok := drawing.Parse(b.Content); ok {
					b.Type, b.Lang = drawing.BlockType, ""
				}
			}
			blocks = append(blocks, b)
			inList, afterParagraph = false, false
			continue
		}

		// A Markdown table (header, separator row, rows), also inside lists
		if IsTableStart(lines, i) {
			prefix := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			var rows []string
			for ; i < len(lines) && strings.TrimSpace(lines[i]) != "" && strings.Contains(lines[i], "|"); i++ {
				rows = append(rows, lines[i])
			}
			i--
			level := base
			if prefix != "" && len(indents) > 0 {
				level = listLevel(indentWidth(prefix))
			}
			blocks = append(blocks, newBlock("table", NormalizeTable(strings.Join(rows, "\n")), level))
			inList, afterParagraph = false, false
			continue
		}

		if m := headingRe.FindStringSubmatch(line); m != nil && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			typ := map[int]string{1: "h1", 2: "h2"}[len(m[1])]
			if typ == "" {
				typ = "h3"
			}
			rank := len(m[1])
			if rank > 3 {
				rank = 3
			}
			for len(headings) > 0 && headings[len(headings)-1] >= rank {
				headings = headings[:len(headings)-1]
			}
			blocks = append(blocks, newBlock(typ, strings.TrimSpace(m[2]), len(headings)))
			headings = append(headings, rank)
			base, indents, inList, afterParagraph = len(headings), nil, false, false
			continue
		}

		if trimmed == "---" || trimmed == "***" || trimmed == "___" {
			if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
				blocks = append(blocks, newBlock("divider", "", 0))
				base, headings, indents, inList, afterParagraph = 0, nil, nil, false, false
				continue
			}
		}

		// Quotes and Obsidian callouts (> [!note] …): one callout block; [!warning] and [!failure] keep
		// their kind as warning and error blocks
		if strings.HasPrefix(trimmed, ">") && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			var parts []string
			typ := "callout"
			for ; i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), ">"); i++ {
				q := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[i]), ">"))
				if m := calloutRe.FindStringSubmatch(q); m != nil {
					if len(parts) == 0 {
						typ = calloutType(m[1])
					}
					if q = strings.TrimSpace(m[2]); q == "" {
						continue
					}
				}
				parts = append(parts, q)
			}
			i--
			blocks = append(blocks, newBlock(typ, strings.Join(parts, "\n"), base))
			indents, inList, afterParagraph = nil, false, false
			continue
		}

		if m := listItemRe.FindStringSubmatch(line); m != nil {
			level := listLevel(indentWidth(m[1]))
			content := m[2]
			typ := "bullet"
			if t := strings.TrimLeft(line, " \t"); t != "" && t[0] >= '0' && t[0] <= '9' {
				typ = "numbered"
			}
			checked := false
			if c := checkboxRe.FindStringSubmatch(content); c != nil {
				typ, checked, content = "todo", c[1] != " ", c[2]
			} else if h := headingRe.FindStringSubmatch(content); h != nil {
				typ = map[int]string{1: "h1", 2: "h2"}[len(h[1])]
				if typ == "" {
					typ = "h3"
				}
				content = strings.TrimSpace(h[2])
			} else if strings.TrimSpace(content) == "---" {
				typ, content = "divider", ""
			} else if strings.HasPrefix(content, "> ") {
				typ, content = "callout", strings.TrimPrefix(content, "> ")
				if c := calloutRe.FindStringSubmatch(content); c != nil {
					typ, content = calloutType(c[1]), c[2]
				}
			}
			b := newBlock(typ, content, level)
			b.Checked = checked
			blocks = append(blocks, b)
			inList = true
			continue
		}

		// Indented text right below a list item continues it (soft line break)
		if inList && (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")) && len(blocks) > 0 {
			last := &blocks[len(blocks)-1]
			last.Content += "\n" + strings.TrimPrefix(trimmed, "> ")
			continue
		}

		// Plain paragraph (consecutive lines form one block). The first line always belongs to it: an
		// indented "> …" lands here and must not end the paragraph before it starts (endless loop)
		var para []string
		for start := i; i < len(lines); i++ {
			l := strings.TrimSpace(lines[i])
			if i > start && (l == "" || headingRe.MatchString(lines[i]) || listItemRe.MatchString(lines[i]) || fenceRe.MatchString(lines[i]) || strings.HasPrefix(l, ">") || IsTableStart(lines, i)) {
				break
			}
			para = append(para, l)
		}
		i--
		blocks = append(blocks, newBlock("bullet", strings.Join(para, "\n"), base))
		indents, inList, afterParagraph = nil, false, true
	}
	return blocks
}

var (
	recurRe    = regexp.MustCompile(`(?i)[ \t]*🔁[ \t]*every[ \t]+(day|week|month|year)\b`)
	dueRe      = regexp.MustCompile(`[ \t]*📅[ \t]*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?`)
	priorityRe = regexp.MustCompile(`[ \t]*(🔺|⏫|🔼|🔽|⏬)`)
)

// parseTaskFile reads a task list in Obsidian Tasks format as written by the export.
func parseTaskFile(body string) []importTask {
	var tasks []importTask
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indented := strings.HasPrefix(line, "\t") || strings.HasPrefix(line, "  ")
		trimmed := strings.TrimSpace(line)
		if indented && len(tasks) > 0 {
			last := &tasks[len(tasks)-1]
			if strings.HasPrefix(trimmed, ">") {
				note := strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))
				if last.notes != "" {
					last.notes += "\n"
				}
				last.notes += note
			} else if m := listItemRe.FindStringSubmatch(trimmed); m != nil {
				if c := checkboxRe.FindStringSubmatch(m[2]); c != nil {
					last.subtasks = append(last.subtasks, domain.SubTask{ID: domain.NewID("st"), Title: c[2], IsCompleted: c[1] != " ", CreatedAt: domain.NowISO()})
				}
			}
			continue
		}
		m := listItemRe.FindStringSubmatch(trimmed)
		if m == nil {
			continue
		}
		t := importTask{content: m[2], priority: "normal"}
		if c := checkboxRe.FindStringSubmatch(m[2]); c != nil {
			t.done, t.content = c[1] != " ", c[2]
		}
		if r := recurRe.FindStringSubmatch(t.content); r != nil {
			t.recurrence = map[string]string{"day": "daily", "week": "weekly", "month": "monthly", "year": "yearly"}[strings.ToLower(r[1])]
			t.content = recurRe.ReplaceAllString(t.content, "")
		}
		if d := dueRe.FindStringSubmatch(t.content); d != nil {
			t.due = d[1]
			if d[2] != "" {
				t.due += "T" + d[2]
			}
			t.content = dueRe.ReplaceAllString(t.content, "")
		}
		if p := priorityRe.FindStringSubmatch(t.content); p != nil {
			t.priority = map[string]string{"🔺": "urgent", "⏫": "high", "🔼": "high", "🔽": "low", "⏬": "low"}[p[1]]
			t.content = priorityRe.ReplaceAllString(t.content, "")
		}
		t.content = strings.TrimSpace(t.content)
		tasks = append(tasks, t)
	}
	return tasks
}

var quantityRe = regexp.MustCompile(`[ \t]*\(([^()]+)\)[ \t]*$`)

// parseListFile reads list entries "- [ ] Milk (2L) #fridge".
func parseListFile(body string) []importItem {
	var items []importItem
	for _, line := range strings.Split(body, "\n") {
		m := listItemRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil || strings.TrimSpace(m[2]) == "" {
			continue
		}
		it := importItem{content: m[2]}
		if c := checkboxRe.FindStringSubmatch(m[2]); c != nil {
			it.done, it.content = c[1] != " ", c[2]
		}
		// A trailing #Category is turned into the category by CreateListItem itself
		if q := quantityRe.FindStringSubmatch(stripTrailingTag(it.content)); q != nil {
			it.quantity = q[1]
			it.content = strings.Replace(it.content, q[0], "", 1)
		}
		it.content = strings.TrimSpace(it.content)
		items = append(items, it)
	}
	return items
}

func stripTrailingTag(s string) string {
	if i := strings.LastIndex(s, " #"); i >= 0 && !strings.Contains(s[i+2:], " ") {
		return s[:i]
	}
	return s
}

// folderPathOf returns the folder of a "/"-separated archive path with every part made safe.
func folderPathOf(p string) string {
	dir := path.Dir(p)
	if dir == "." || dir == "/" {
		return ""
	}
	parts := make([]string, 0)
	for _, part := range strings.Split(dir, "/") {
		if seg := segment(part); seg != "" {
			parts = append(parts, seg)
		}
	}
	return strings.Join(parts, "/")
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if k != "" {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// --- Images and recordings ----------------------------------------------------------------------------

var importMediaExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".webm": true, ".ogg": true, ".oga": true, ".mp3": true, ".wav": true, ".m4a": true, ".aac": true,
	// Only drawings exported by MindSift (the model is inside); other SVG files stay out
	".svg": true}

// reportUnusedMedia lists files no note shows (or that are no valid image/recording) as skipped in the
// preview and drops them from the plan.
func (p *ImportPlan) reportUnusedMedia() {
	if len(p.Media) == 0 {
		return
	}
	used := map[string]bool{}
	for _, d := range p.Docs {
		linkImportMedia(d, p.Media, used)
	}
	for _, k := range sortedKeys(keySet(p.Media)) {
		if used[k] {
			continue
		}
		if _, _, ok := DetectMedia(p.Media[k], ""); !ok {
			p.skip(k, "kein gültiges Bild bzw. keine gültige Aufnahme")
		} else {
			p.skip(k, "wird in keiner Notiz angezeigt")
		}
		delete(p.Media, k)
	}
}

func keySet(m map[string][]byte) map[string]bool {
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}

func (p *ImportPlan) addMedia(name string, data []byte) {
	if p.Media == nil {
		p.Media = map[string][]byte{}
	}
	p.Media[name] = data
}

func readZipFile(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errors.New("nicht lesbar oder zu groß")
	}
	return data, nil
}

type importMediaFile struct {
	id, kind, mime string
	data           []byte
}

var (
	mdEmbedRe   = regexp.MustCompile(`^!\[([^\]]*)\]\(<?([^)>]+?)>?(?:\s+"[^"]*")?\)$`)
	wikiEmbedRe = regexp.MustCompile(`^!\[\[([^|\]]+)(?:\|([^\]]*))?\]\]$`)
	sizeOnlyRe  = regexp.MustCompile(`^\d+(x\d+)?$`)
)

// linkImportMedia turns blocks that only show a file of the archive into image/audio blocks with new
// file IDs: media:<id> of an own backup, Markdown images relative to the note, Obsidian ![[file]]
// embeds (found by name anywhere in the archive). Files without such a block are not imported.
func linkImportMedia(d importDoc, media map[string][]byte, used map[string]bool) ([]domain.DocumentBlock, []importMediaFile) {
	if len(media) == 0 {
		return d.blocks, nil
	}
	blocks := make([]domain.DocumentBlock, len(d.blocks))
	copy(blocks, d.blocks)
	byKey := map[string]importMediaFile{} // one copy per note, even when shown twice
	var files []importMediaFile
	for i, b := range blocks {
		content := strings.TrimSpace(b.Content)
		key, caption := "", ""
		if ref, ok := ParseMediaContent(content); ok {
			key, caption = "media:"+ref.ID, ref.Caption
		} else if m := mdEmbedRe.FindStringSubmatch(content); m != nil {
			target := m[2]
			if u, err := url.PathUnescape(target); err == nil {
				target = u
			}
			key, caption = path.Clean(path.Join(d.dir, target)), m[1]
		} else if m := wikiEmbedRe.FindStringSubmatch(content); m != nil {
			name := strings.TrimSpace(m[1])
			for k := range media {
				if path.Base(k) == name || k == name {
					key = k
					break
				}
			}
			if !sizeOnlyRe.MatchString(m[2]) {
				caption = m[2]
			}
		}
		data, ok := media[key]
		if key == "" || !ok {
			continue
		}
		if content, ok := drawing.FromSVG(data); ok {
			if used != nil {
				used[key] = true
			}
			blocks[i].Type, blocks[i].Content = drawing.BlockType, content
			continue
		}
		f, seen := byKey[key]
		if !seen {
			if used != nil {
				used[key] = true
			}
			mime, kind, ok := DetectMedia(data, "")
			if !ok {
				continue
			}
			f = importMediaFile{id: domain.NewID("med"), kind: kind, mime: mime, data: data}
			byKey[key] = f
			files = append(files, f)
		}
		blocks[i].Type = f.kind
		blocks[i].Content = MediaContent(f.kind, f.id, caption)
	}
	return blocks, files
}

func (s *Store) storeImportMedia(userID, docID string, files []importMediaFile) error {
	if len(files) == 0 || s.mediaRoot == "" {
		return nil
	}
	for _, f := range files {
		m, err := s.createMediaWithID(f.id, docID, userID, f.kind, f.mime, int64(len(f.data)), "")
		if err != nil {
			return err
		}
		dst := s.MediaFilePath(m)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, f.data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
