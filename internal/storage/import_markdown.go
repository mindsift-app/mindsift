package storage

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
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

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Import limits: they keep a crafted archive (zip bomb, millions of files) from exhausting the server.
// Besides, notes, files and the notes of a JSON backup are read one at a time when they are needed (once
// for the plan, again when it is applied), so an import never holds the whole archive unpacked.
const (
	MaxImportUploadBytes = 100 << 20 // uploaded file
	// One note (read one at a time, so this bounds the memory of a single note)
	maxImportNoteBytes     = 10 << 20
	maxImportUnpackedBytes = 500 << 20 // all notes and files together
	maxImportFiles         = 20000
	maxImportMediaBytes    = 100 << 20 // one image or recording
	maxImportDrawingBytes  = 10 << 20  // one drawing (an SVG with the drawing inside)
	// Notes of a JSON backup, tasks, lists and list items together; far more than a person has
	maxImportItems = 100_000
	// An entry that unpacks to more than maxImportRatio times its packed size is a zip bomb, not part of
	// a vault: Markdown packs 3 to 5 times, very repetitive notes up to about 50 (Obsidian's own help
	// vault, 6500 notes: 3 overall, 134 at most for a 64 KB note). Smaller entries are harmless at any ratio.
	maxImportRatio  = 100
	importRatioFrom = 1 << 20
	// One note, task or list of a JSON backup (the decoder holds one at a time)
	maxImportJSONValue = 32 << 20
)

// ImportPlan is everything an import would create. It is built completely (and validated) before
// anything is written, so the preview shows exactly what the import does. Notes of an archive or a JSON
// backup keep only their place and title here; their blocks are read again when the plan is applied.
type ImportPlan struct {
	Folders   []string           `json:"-"`
	Docs      []importDoc        `json:"-"`
	TaskLists []importTaskList   `json:"-"`
	Lists     []importList       `json:"-"`
	Inbox     []importTask       `json:"-"`
	Themes    []domain.UserTheme `json:"-"`
	Skipped   []ImportSkip       `json:"skipped"`
	// Images and recordings of the archive: "media:<id>" (own backup) or the path in the archive
	Media map[string]*zip.File `json:"-"`
	// jsonDocs opens the JSON backup again to read its notes one at a time (nil: Docs hold them)
	jsonDocs  func() (io.ReadCloser, error)
	items     int             // tasks and list items, against maxImportItems
	usedMedia map[string]bool // keys of Media a note shows, while the plan is built
	// Files the notes show that the archive does not bring along (other people's files cannot be shown,
	// see CheckImportMedia); outsideIDs counts them against maxImportOutsideMedia
	outside      []importMediaRefs
	outsideIDs   int
	mediaChecked bool
}

// importMediaRefs: the files of one note (by its path or title) that are not part of the import.
type importMediaRefs struct {
	note string
	ids  []string
}

// maxImportOutsideMedia bounds the file ids the preview checks; applying checks every reference anyway.
const maxImportOutsideMedia = 10_000

// Only keeps the chosen sections of the plan (see NormalizeSections).
func (p *ImportPlan) Only(sections map[string]bool) *ImportPlan {
	out := &ImportPlan{Skipped: p.Skipped}
	if sections[SectionNotes] {
		out.Folders, out.Docs, out.Media, out.jsonDocs, out.outside = p.Folders, p.Docs, p.Media, p.jsonDocs, p.outside
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
	// src: the note in the archive, converted again when the plan is applied (blocks stay nil)
	src *zip.File
	// hashtags: front matter tags missing in the text become a bullet of hashtags (Obsidian)
	hashtags bool
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
	file *zip.File
}

// readZipNotes lists the Markdown notes of an archive, sorted by path, and adds its images and
// recordings to the plan (other files are reported as skipped). Nothing is unpacked yet: entries too
// large or packed suspiciously well are skipped by their header, and the sizes they declare must stay
// within maxImportUnpackedBytes together (reading checks the real sizes again). A single top-level
// folder, as Obsidian and most zip tools create, is stripped and returned as name.
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
	var declared uint64
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
			if packedTooWell(f) {
				plan.skip(name, "ungewöhnlich stark gepackt, wird nicht entpackt")
				continue
			}
			declared += f.UncompressedSize64
			plan.addMedia(name, f)
			continue
		}
		if f.UncompressedSize64 > maxImportNoteBytes {
			plan.skip(name, "zu groß (max. 10 MB pro Notiz)")
			continue
		}
		if packedTooWell(f) {
			plan.skip(name, "ungewöhnlich stark gepackt, wird nicht entpackt")
			continue
		}
		declared += f.UncompressedSize64
		notes = append(notes, zipNote{path: name, file: f})
	}
	if declared > maxImportUnpackedBytes {
		return nil, nil, "", errors.New("Archiv ist entpackt zu groß (max. 500 MB)")
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].path < notes[j].path })
	return notes, dirs, strings.TrimSuffix(prefix, "/"), nil
}

// packedTooWell: an entry that would unpack to far more than it takes in the archive (zip bomb).
func packedTooWell(f *zip.File) bool {
	return f.UncompressedSize64 > importRatioFrom && f.UncompressedSize64 > maxImportRatio*f.CompressedSize64
}

// unpackBudget counts the bytes really unpacked while an archive is read, whatever its entries declare.
type unpackBudget struct{ left int64 }

func newUnpackBudget() *unpackBudget { return &unpackBudget{left: maxImportUnpackedBytes} }

var errUnpackedTooLarge = errors.New("Archiv ist entpackt zu groß (max. 500 MB)")

// readNote reads one note of the archive as text with LF line ends. reason says why the note cannot be
// imported (it is skipped); err ends the whole import.
func readNote(f *zip.File, budget *unpackBudget) (text, reason string, err error) {
	rc, err := f.Open()
	if err != nil {
		return "", "nicht lesbar", nil
	}
	defer rc.Close()
	var sb strings.Builder
	sb.Grow(int(min(f.UncompressedSize64, maxImportNoteBytes)))
	n, err := io.Copy(&sb, io.LimitReader(rc, min(maxImportNoteBytes, budget.left)+1))
	if budget.left -= n; budget.left < 0 {
		return "", "", errUnpackedTooLarge
	}
	if err != nil {
		return "", "nicht lesbar", nil
	}
	if n > maxImportNoteBytes {
		return "", "zu groß (max. 10 MB pro Notiz)", nil
	}
	text = sb.String()
	if !utf8.ValidString(text) {
		return "", "keine UTF-8-Textdatei", nil
	}
	if strings.Contains(text, "\r\n") {
		text = strings.ReplaceAll(text, "\r\n", "\n")
	}
	return text, "", nil
}

// noteBlocks converts the text of a note. ok is false when it holds more bullets than a note may.
func noteBlocks(body string, tags []string, hashtags bool) ([]domain.DocumentBlock, bool) {
	blocks, ok := markdownToBlocks(body, collab.MaxNoteBlocks)
	if !ok {
		return nil, false
	}
	// Front matter tags become hashtags, since MindSift reads tags from the text
	if extra := missingTags(tags, body); hashtags && extra != "" {
		blocks = append(blocks, newBlock("bullet", extra, 0))
	}
	return blocks, len(blocks) <= collab.MaxNoteBlocks
}

// load reads and converts a note of the archive again, when the plan is applied.
func (d importDoc) load(budget *unpackBudget) ([]domain.DocumentBlock, error) {
	if d.src == nil {
		return d.blocks, nil
	}
	text, reason, err := readNote(d.src, budget)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, fmt.Errorf("note %q: %s", d.title, reason)
	}
	fm, body := splitFrontmatter(text)
	blocks, ok := noteBlocks(body, fm.tags, d.hashtags)
	if !ok {
		return nil, ErrNoteTooLarge
	}
	return blocks, nil
}

// eachDoc hands the notes of the plan to fn one at a time, with their blocks read again from the
// archive or the JSON backup, so only one note is in memory at a time.
func (p *ImportPlan) eachDoc(budget *unpackBudget, fn func(importDoc, []domain.DocumentBlock) error) error {
	if p.jsonDocs != nil {
		rc, err := p.jsonDocs()
		if err != nil {
			return err
		}
		defer rc.Close()
		return decodeExport(rc, nil, func(d *exportDoc) error {
			if d.skipReason() != "" {
				return nil
			}
			doc := d.importDoc()
			return fn(doc, doc.blocks)
		})
	}
	for _, d := range p.Docs {
		blocks, err := d.load(budget)
		if errors.Is(err, ErrNoteTooLarge) {
			return i18n.NewError("Notiz „{title}“: {reason}", "title", d.title, "reason", err.Error())
		}
		if err != nil {
			return err
		}
		if err := fn(d, blocks); err != nil {
			return err
		}
	}
	return nil
}

// readPlanNote reads a note for the plan; one that cannot be imported is reported as skipped (ok false).
func (p *ImportPlan) readPlanNote(n zipNote, budget *unpackBudget) (fm frontmatter, body, title string, ok bool, err error) {
	text, reason, err := readNote(n.file, budget)
	if err != nil {
		return fm, "", "", false, err
	}
	if reason != "" {
		p.skip(n.path, reason)
		return fm, "", "", false, nil
	}
	fm, body = splitFrontmatter(text)
	title = fm.title
	if title == "" {
		title = strings.TrimSuffix(path.Base(n.path), path.Ext(n.path))
	}
	return fm, body, title, true, nil
}

// addZipDoc converts a note once to check it and to mark the files it shows; the plan keeps only its
// title and place, the blocks are read again when it is applied.
func (p *ImportPlan) addZipDoc(n zipNote, doc importDoc, tags []string, body string) {
	blocks, ok := noteBlocks(body, tags, doc.hashtags)
	if !ok {
		p.skip(n.path, "zu viele Punkte (max. 20.000 pro Notiz)")
		return
	}
	doc.dir, doc.src = path.Dir(n.path), n.file
	p.markUsedMedia(doc.dir, blocks)
	p.noteOutsideMedia(n.path, doc.dir, blocks)
	p.Docs = append(p.Docs, doc)
}

// addItems counts tasks and list items of an archive against maxImportItems.
func (p *ImportPlan) addItems(n int) error {
	if p.items += n; p.items > maxImportItems {
		return errTooManyItems
	}
	return nil
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
	budget := newUnpackBudget()
	for _, n := range notes {
		fm, body, title, ok, err := plan.readPlanNote(n, budget)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		folder := path.Join(root, folderPathOf(n.path))
		folders[folder] = true
		plan.addZipDoc(n, importDoc{folder: folder, title: title, icon: fm.icon, hashtags: true}, fm.tags, body)
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
	budget := newUnpackBudget()
	for _, n := range notes {
		fm, body, title, ok, err := plan.readPlanNote(n, budget)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		switch dir := folderPathOf(n.path); {
		case isVaultDir(dir, vaultTasks):
			tl := importTaskList{title: title, icon: fm.icon, tasks: parseTaskFile(body)}
			if isVaultDir(title, vaultNoList) {
				tl.title = ""
			}
			if err := plan.addItems(len(tl.tasks)); err != nil {
				return nil, err
			}
			plan.TaskLists = append(plan.TaskLists, tl)
		case isVaultDir(dir, vaultLists):
			l := importList{title: title, icon: fm.icon, items: parseListFile(body)}
			if err := plan.addItems(len(l.items)); err != nil {
				return nil, err
			}
			plan.Lists = append(plan.Lists, l)
		default:
			if dir != "" {
				folders[dir] = true
			}
			plan.addZipDoc(n, importDoc{folder: dir, title: title, icon: fm.icon}, nil, body)
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
// (one JSON inside, next to it the Markdown vault) or the Markdown archive. r must stay readable until
// the plan is applied: notes and files are read from it again then.
func PlanMindSiftImport(r io.ReaderAt, size int64, fileName string) (*ImportPlan, error) {
	first := make([]byte, 1)
	if _, err := r.ReadAt(first, 0); strings.HasSuffix(strings.ToLower(fileName), ".json") || (err == nil && first[0] == '{') {
		return planJSONBackup(func() (io.ReadCloser, error) { return io.NopCloser(io.NewSectionReader(r, 0, size)), nil }, nil)
	}
	zr, err := zip.NewReader(r, size)
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
		return PlanMindSiftArchiveImport(r, size)
	}
	// Images and recordings: attachments/<id><ext> of the vault next to the JSON, media/<id><ext> in older backups
	// (the vault's attachments/ also holds drawings as SVG, those are no media)
	media := map[string]*zip.File{}
	declared := backup.UncompressedSize64
	vaultMedia := BackupVaultDir + "/" + vaultAttachmentDir + "/med_"
	for _, f := range zr.File {
		name := cleanArchivePath(f.Name)
		if (!strings.HasPrefix(name, "media/") && !strings.HasPrefix(name, vaultMedia)) || f.FileInfo().IsDir() || f.UncompressedSize64 > maxImportMediaBytes || packedTooWell(f) {
			continue
		}
		declared += f.UncompressedSize64
		base := path.Base(name)
		media["media:"+strings.TrimSuffix(base, path.Ext(base))] = f
	}
	if declared > maxImportUnpackedBytes {
		return nil, errors.New("Backup ist entpackt zu groß (max. 500 MB)")
	}
	if packedTooWell(backup) {
		return nil, errors.New("Das Backup im Archiv ist ungewöhnlich stark gepackt und wird nicht entpackt")
	}
	return planJSONBackup(func() (io.ReadCloser, error) {
		rc, err := backup.Open()
		if err != nil {
			return nil, errors.New("Backup im Archiv ist nicht lesbar")
		}
		return readCloser{io.LimitReader(rc, maxImportUnpackedBytes), rc}, nil
	}, media)
}

type readCloser struct {
	io.Reader
	io.Closer
}

// PlanMindSiftJSONImport reads the JSON backup ("Backup herunterladen"). Notes shared with the
// exporting user belong to someone else and are skipped; discarded thoughts are not restored.
func PlanMindSiftJSONImport(data []byte) (*ImportPlan, error) {
	return planJSONBackup(func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }, nil)
}

// planJSONBackup reads the backup that open returns, with the files of its archive (media, nil for a
// bare JSON). Its notes are read one at a time and only counted here; the plan opens the backup again
// when it is applied (eachDoc).
func planJSONBackup(open func() (io.ReadCloser, error), media map[string]*zip.File) (*ImportPlan, error) {
	rc, err := open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	plan := &ImportPlan{jsonDocs: open}
	if len(media) > 0 {
		plan.Media = media
	}
	folders := map[string]bool{}
	var exp domain.FullExport
	err = decodeExport(rc, &exp, func(d *exportDoc) error {
		if reason := d.skipReason(); reason != "" {
			plan.skip(d.Title, reason)
			return nil
		}
		if d.FolderPath != "" {
			folders[d.FolderPath] = true
		}
		plan.noteOutsideMedia(d.Title, "", d.Blocks)
		plan.Docs = append(plan.Docs, importDoc{folder: d.FolderPath, title: d.Title, icon: d.Icon})
		return nil
	})
	if errors.Is(err, errJSONValueTooLarge) || errors.Is(err, errTooManyItems) {
		return nil, err
	}
	if err != nil || (exp.Version == "" && exp.ExportedAt == "") {
		return nil, errors.New("Die Datei ist kein MindSift-JSON-Backup")
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

// exportDoc is the part of a note in a JSON backup the import uses (the content caches stay out).
type exportDoc struct {
	Title      string                 `json:"title"`
	Icon       string                 `json:"icon"`
	FolderPath string                 `json:"folderPath"`
	Permission string                 `json:"permission"`
	IsOwner    bool                   `json:"isOwner"`
	Blocks     []domain.DocumentBlock `json:"blocks"`
}

// skipReason says why a note of the backup is not imported ("" = it is).
func (d *exportDoc) skipReason() string {
	switch {
	case !d.IsOwner && d.Permission != "" && d.Permission != "owner":
		return "geteilte Notiz eines anderen Benutzers"
	case len(d.Blocks) > collab.MaxNoteBlocks:
		return "zu viele Punkte (max. 20.000 pro Notiz)"
	}
	return ""
}

// importDoc gives the note's blocks new IDs and no task links: a backup cannot reach anything existing.
func (d *exportDoc) importDoc() importDoc {
	for i := range d.Blocks {
		d.Blocks[i].ID, d.Blocks[i].DocumentID, d.Blocks[i].TaskID = domain.NewID("blk"), "", ""
	}
	return importDoc{folder: d.FolderPath, title: d.Title, icon: d.Icon, blocks: d.Blocks}
}

var (
	errJSONValueTooLarge = i18n.NewError("Ein Eintrag im Backup ist zu groß (max. {mb} MB)", "mb", strconv.Itoa(maxImportJSONValue>>20))
	errTooManyItems      = i18n.NewError("Zu viele Einträge im Archiv (max. {max})", "max", strconv.Itoa(maxImportItems))
)

// valueLimit fails a read once the JSON value being decoded has grown beyond maxImportJSONValue: the
// decoder holds a whole value in memory before it decodes it.
type valueLimit struct {
	r        io.Reader
	n, start int64
}

func (v *valueLimit) Read(p []byte) (int, error) {
	if v.n-v.start > maxImportJSONValue {
		return 0, errJSONValueTooLarge
	}
	n, err := v.r.Read(p)
	v.n += int64(n)
	return n, err
}

// decodeExport reads a JSON backup one value at a time: onDoc gets each note as it is decoded, the
// other parts are collected in rest (nil: passed over). It never holds more than one note.
func decodeExport(r io.Reader, rest *domain.FullExport, onDoc func(*exportDoc) error) error {
	lim := &valueLimit{r: r}
	dec := json.NewDecoder(lim)
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return errors.New("not a JSON object")
	}
	items := 0
	countItems := func(n int) error {
		if items += n; items > maxImportItems {
			return errTooManyItems
		}
		return nil
	}
	for dec.More() {
		lim.start = lim.n
		t, err := dec.Token()
		if err != nil {
			return err
		}
		lim.start = lim.n
		key, _ := t.(string)
		switch {
		case key == "documents":
			err = jsonArray(dec, lim, func() error {
				var d exportDoc
				if err := dec.Decode(&d); err != nil {
					return err
				}
				if err := countItems(1); err != nil {
					return err
				}
				return onDoc(&d)
			})
		case rest == nil:
			var skip json.RawMessage
			if key == "thoughts" || key == "lists" || key == "taskLists" || key == "themes" {
				err = jsonArray(dec, lim, func() error { return dec.Decode(&skip) })
			} else {
				err = dec.Decode(&skip)
			}
		case key == "thoughts":
			err = jsonArray(dec, lim, func() error {
				var th domain.Thought
				if err := dec.Decode(&th); err != nil {
					return err
				}
				rest.Thoughts = append(rest.Thoughts, th)
				return countItems(1)
			})
		case key == "lists":
			err = jsonArray(dec, lim, func() error {
				var l domain.SharedList
				if err := dec.Decode(&l); err != nil {
					return err
				}
				rest.Lists = append(rest.Lists, l)
				return countItems(1 + len(l.Items))
			})
		case key == "taskLists":
			err = jsonArray(dec, lim, func() error {
				var tl domain.TaskList
				if err := dec.Decode(&tl); err != nil {
					return err
				}
				rest.TaskLists = append(rest.TaskLists, tl)
				return countItems(1)
			})
		case key == "themes":
			err = jsonArray(dec, lim, func() error {
				var th domain.UserTheme
				if err := dec.Decode(&th); err != nil {
					return err
				}
				rest.Themes = append(rest.Themes, th)
				return countItems(1)
			})
		case key == "exportedAt":
			err = dec.Decode(&rest.ExportedAt)
		case key == "version":
			err = dec.Decode(&rest.Version)
		default: // the profile and anything unknown: not imported
			var skip json.RawMessage
			err = dec.Decode(&skip)
		}
		if err != nil {
			return err
		}
	}
	lim.start = lim.n
	_, err := dec.Token()
	return err
}

// jsonArray calls each for every element of the array that comes next (null counts as empty).
func jsonArray(dec *json.Decoder, lim *valueLimit, each func() error) error {
	t, err := dec.Token()
	if err != nil || t == nil {
		return err
	}
	if t != json.Delim('[') {
		return errors.New("not a JSON array")
	}
	for dec.More() {
		lim.start = lim.n
		if err := each(); err != nil {
			return err
		}
	}
	lim.start = lim.n
	_, err = dec.Token()
	return err
}

// --- Applying ---------------------------------------------------------------------------------------

// ApplyImport creates everything of the plan for the user. Existing data is never changed; imported
// items are added next to it. Task lists of the same name get merged into one new list per import.
//
// Imports are applied one at a time (importMu); a second one waits for its turn. Two at once competed
// note by note for the write lock with each other and with everybody else, and one of them gave up with
// "database is locked" (re-test 2026-11-14, A2). An import that fails half way takes out what it
// created, so the person never keeps half of an archive without being told; the error says which part
// failed. Each note is still written in transactions of its own: one transaction for a whole archive
// would keep everybody else from writing for as long as the import runs.
func (s *Store) ApplyImport(userID string, plan *ImportPlan) (ImportSummary, error) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	undo := &importUndo{}
	sum, err := s.applyImport(userID, plan, undo)
	if err != nil {
		s.undoImport(userID, undo)
		return sum, err
	}
	// [[Titel]] links point at their notes by id, now that all of them exist. Only once nothing can
	// fail any more: it rewrites links in the person's existing notes too, and undoImport does not put
	// those back, so they would point at notes it deleted.
	if len(plan.Docs) > 0 {
		s.LinkWikiTitles(userID)
	}
	return sum, nil
}

// importUndo lists what an import created so far.
type importUndo struct {
	folders, docs, taskLists, tasks, lists []string
}

// undoImport deletes what a failed import created. A step that fails is logged and the rest go on.
func (s *Store) undoImport(userID string, u *importUndo) {
	for _, id := range u.tasks {
		s.execLogged(`DELETE FROM thoughts WHERE id = ? AND user_id = ?`, id, userID)
	}
	for _, id := range u.taskLists {
		logDBErr(s.DeleteTaskList(userID, id))
	}
	for _, id := range u.lists {
		s.execLogged(`DELETE FROM lists WHERE id = ? AND user_id = ?`, id, userID) // items cascade
	}
	for _, id := range u.docs {
		logDBErr(s.hardDeleteDocument(id))
	}
	for _, id := range u.folders {
		s.execLogged(`DELETE FROM workspace_folders WHERE id = ? AND user_id = ?`, id, userID)
	}
	slog.Info("Failed import taken out again", "user_id", userID, "notes", len(u.docs), "tasks", len(u.tasks),
		"task_lists", len(u.taskLists), "lists", len(u.lists), "folders", len(u.folders))
}

// userFolderIDs: the ids of the folder entries the user has (workspace_folders).
func (s *Store) userFolderIDs(userID string) (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT id FROM workspace_folders WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

func (s *Store) applyImport(userID string, plan *ImportPlan, undo *importUndo) (ImportSummary, error) {
	s.CheckImportMedia(userID, plan)
	before, err := s.userFolderIDs(userID)
	if err != nil {
		return plan.Summary(false), err
	}
	for _, f := range plan.Folders {
		_, _ = s.CreateFolder(userID, f) // already existing folders are fine
	}
	after, err := s.userFolderIDs(userID)
	if err != nil {
		return plan.Summary(false), err
	}
	for id := range after {
		if !before[id] {
			undo.folders = append(undo.folders, id)
		}
	}
	budget := newUnpackBudget()
	err = plan.eachDoc(budget, func(d importDoc, blocks []domain.DocumentBlock) error {
		title := strings.TrimSpace(d.title)
		if title == "" {
			title = i18n.T(s.MessageLanguage(userID), "Unbenannte Notiz")
		}
		icon := d.icon
		if icon == "" {
			icon = "🗒️"
		}
		blocks, files := linkImportMedia(d.dir, blocks, plan.Media)
		// The import's own files are stored once the note exists; any other file stays out unless the
		// person may read it already (mediaGate)
		keep := make(map[string]bool, len(files))
		for _, f := range files {
			keep[f.id] = true
		}
		doc, err := s.createDocument(userID, "", title, icon, d.folder, blocks, nil, false, keep)
		if errors.Is(err, ErrNoteTooLarge) {
			// Said with the note's name, so the person knows which file to split
			return i18n.NewError("Notiz „{title}“: {reason}", "title", title, "reason", err.Error())
		}
		if err != nil {
			return fmt.Errorf("note %q: %w", title, err)
		}
		undo.docs = append(undo.docs, doc.ID)
		if err := s.storeImportMedia(userID, doc.ID, files, budget); err != nil {
			return fmt.Errorf("note %q: %w", title, err)
		}
		return nil
	})
	if err != nil {
		return plan.Summary(false), err
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
				return plan.Summary(false), fmt.Errorf("task list %q: %w", tl.title, err)
			}
			listID = created.ID
			undo.taskLists = append(undo.taskLists, listID)
		}
		for _, t := range tl.tasks {
			if err := s.importTaskInto(userID, listID, t, true, undo); err != nil {
				return plan.Summary(false), err
			}
		}
	}
	for _, t := range plan.Inbox {
		if err := s.importTaskInto(userID, "", t, false, undo); err != nil {
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
			return plan.Summary(false), fmt.Errorf("list %q: %w", l.title, err)
		}
		undo.lists = append(undo.lists, created.ID)
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

func (s *Store) importTaskInto(userID, listID string, t importTask, asTask bool, undo *importUndo) error {
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
		return fmt.Errorf("task %q: %w", content, err)
	}
	undo.tasks = append(undo.tasks, th.ID)
	if !asTask {
		return nil
	}
	if _, err := s.UpdateThoughtTriage(userID, th.ID, "keep", "task", "", t.due, listID); err != nil {
		return fmt.Errorf("task %q: %w", content, err)
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
	blocks, _ := markdownToBlocks(md, 0)
	return blocks
}

// markdownToBlocks stops (ok false) as soon as there are more than limit blocks (0: no limit), so a
// note of countless short lines never turns into countless blocks in memory.
func markdownToBlocks(md string, limit int) (_ []domain.DocumentBlock, ok bool) {
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
		if limit > 0 && len(blocks) > limit {
			return nil, false
		}
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
	return blocks, limit <= 0 || len(blocks) <= limit
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
	for _, k := range sortedKeys(keySet(p.Media)) {
		if p.usedMedia[k] {
			continue
		}
		if head, err := readZipHead(p.Media[k]); err != nil {
			p.skip(k, "nicht lesbar")
		} else if _, _, ok := DetectMedia(head, ""); !ok {
			p.skip(k, "kein gültiges Bild bzw. keine gültige Aufnahme")
		} else {
			p.skip(k, "wird in keiner Notiz angezeigt")
		}
		delete(p.Media, k)
	}
	p.usedMedia = nil
}

// markUsedMedia notes the files of the archive that blocks of a note show.
func (p *ImportPlan) markUsedMedia(dir string, blocks []domain.DocumentBlock) {
	if len(p.Media) == 0 {
		return
	}
	if p.usedMedia == nil {
		p.usedMedia = map[string]bool{}
	}
	for _, b := range blocks {
		if key, _ := mediaKey(b.Content, dir, p.Media); key != "" {
			p.usedMedia[key] = true
		}
	}
}

// noteOutsideMedia notes the files a note shows that the import does not bring along: references by id
// (media:<id>) other than a bullet showing a file of the archive, which gets a new id.
func (p *ImportPlan) noteOutsideMedia(note, dir string, blocks []domain.DocumentBlock) {
	var ids []string
	seen := map[string]bool{}
	for _, b := range blocks {
		if !strings.Contains(b.Content, "media:") {
			continue
		}
		key, _ := mediaKey(b.Content, dir, p.Media)
		for _, m := range mediaIDRe.FindAllStringSubmatch(b.Content, -1) {
			if key == "media:"+m[1] || seen[m[1]] || p.outsideIDs >= maxImportOutsideMedia {
				continue
			}
			seen[m[1]] = true
			ids = append(ids, m[1])
			p.outsideIDs++
		}
	}
	if len(ids) > 0 {
		p.outside = append(p.outside, importMediaRefs{note: note, ids: ids})
	}
}

// CheckImportMedia lists the notes of the plan as skipped that show a file the import does not bring
// along and the person may not read (someone else's file, or one that no longer exists). Applying the
// plan drops these references: a bullet showing a file would make it readable (mediaGate).
func (s *Store) CheckImportMedia(userID string, plan *ImportPlan) {
	if plan.mediaChecked {
		return
	}
	plan.mediaChecked = true
	gate := s.newMediaGate(userID, nil)
	for _, r := range plan.outside {
		for _, id := range r.ids {
			if !gate.allowed(id) {
				plan.skip(r.note, "Bild oder Aufnahme ohne Zugriff, nur die Beschriftung wird übernommen")
				break
			}
		}
	}
}

func keySet(m map[string]*zip.File) map[string]bool {
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}

func (p *ImportPlan) addMedia(name string, f *zip.File) {
	if p.Media == nil {
		p.Media = map[string]*zip.File{}
	}
	p.Media[name] = f
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

// readZipHead reads the start of a file, enough to recognise its format (DetectMedia).
func readZipHead(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	head := make([]byte, 512)
	n, err := io.ReadFull(rc, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return head[:n], nil
}

type importMediaFile struct {
	id, kind, mime string
	src            *zip.File // copied to the media folder when the note exists
}

var (
	mdEmbedRe   = regexp.MustCompile(`^!\[([^\]]*)\]\(<?([^)>]+?)>?(?:\s+"[^"]*")?\)$`)
	wikiEmbedRe = regexp.MustCompile(`^!\[\[([^|\]]+)(?:\|([^\]]*))?\]\]$`)
	sizeOnlyRe  = regexp.MustCompile(`^\d+(x\d+)?$`)
)

// mediaKey finds the file of the archive a block shows on its own: media:<id> of an own backup, a
// Markdown image relative to the note (dir), an Obsidian ![[file]] embed (found by name anywhere in the
// archive). "" when the block shows none of them.
func mediaKey(content, dir string, media map[string]*zip.File) (key, caption string) {
	content = strings.TrimSpace(content)
	if ref, ok := ParseMediaContent(content); ok {
		key, caption = "media:"+ref.ID, ref.Caption
	} else if m := mdEmbedRe.FindStringSubmatch(content); m != nil {
		target := m[2]
		if u, err := url.PathUnescape(target); err == nil {
			target = u
		}
		key, caption = path.Clean(path.Join(dir, target)), m[1]
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
	if _, ok := media[key]; key == "" || !ok {
		return "", ""
	}
	return key, caption
}

// linkImportMedia turns blocks that only show a file of the archive into image/audio blocks with new
// file IDs (drawings exported as SVG back into drawings). Files without such a block are not imported.
// The files are copied once the note exists (storeImportMedia).
func linkImportMedia(dir string, blocks []domain.DocumentBlock, media map[string]*zip.File) ([]domain.DocumentBlock, []importMediaFile) {
	if len(media) == 0 {
		return blocks, nil
	}
	byKey := map[string]importMediaFile{} // one copy per note, even when shown twice
	var files []importMediaFile
	for i, b := range blocks {
		key, caption := mediaKey(b.Content, dir, media)
		if key == "" {
			continue
		}
		src := media[key]
		if strings.EqualFold(path.Ext(src.Name), ".svg") {
			if svg, err := readZipFile(src, maxImportDrawingBytes); err == nil {
				if content, ok := drawing.FromSVG(svg); ok {
					blocks[i].Type, blocks[i].Content = drawing.BlockType, content
					continue
				}
			}
		}
		f, seen := byKey[key]
		if !seen {
			head, err := readZipHead(src)
			if err != nil {
				continue
			}
			mime, kind, ok := DetectMedia(head, "")
			if !ok {
				continue
			}
			f = importMediaFile{id: domain.NewID("med"), kind: kind, mime: mime, src: src}
			byKey[key] = f
			files = append(files, f)
		}
		blocks[i].Type = f.kind
		blocks[i].Content = MediaContent(f.kind, f.id, caption)
	}
	return blocks, files
}

func (s *Store) storeImportMedia(userID, docID string, files []importMediaFile, budget *unpackBudget) error {
	if len(files) == 0 || s.mediaRoot == "" {
		return nil
	}
	for _, f := range files {
		m, err := s.createMediaWithID(f.id, docID, userID, f.kind, f.mime, int64(f.src.UncompressedSize64), "")
		if err != nil {
			return err
		}
		dst := s.MediaFilePath(m)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := copyZipFile(f.src, dst, budget); err != nil {
			return err
		}
	}
	return nil
}

// copyZipFile unpacks a file of the archive straight to dst (max. maxImportMediaBytes).
func copyZipFile(f *zip.File, dst string, budget *unpackBudget) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	n, err := io.Copy(out, io.LimitReader(rc, min(maxImportMediaBytes, budget.left)+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if budget.left -= n; budget.left < 0 {
		err = errUnpackedTooLarge
	} else if err == nil && n > maxImportMediaBytes {
		err = errors.New("media file too large")
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
}
