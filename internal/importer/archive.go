package importer

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

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
func readZipNotes(r io.ReaderAt, size int64, plan *Plan) ([]zipNote, []string, string, error) {
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
				plan.Skip(name, "kein Markdown und kein Bild/Audio (z. B. PDFs werden nicht importiert)")
				continue
			}
			if f.UncompressedSize64 > maxImportMediaBytes {
				plan.Skip(name, "zu groß (max. 100 MB pro Bild oder Aufnahme)")
				continue
			}
			if packedTooWell(f) {
				plan.Skip(name, "ungewöhnlich stark gepackt, wird nicht entpackt")
				continue
			}
			declared += f.UncompressedSize64
			plan.addMedia(name, f)
			continue
		}
		if f.UncompressedSize64 > maxImportNoteBytes {
			plan.Skip(name, "zu groß (max. 10 MB pro Notiz)")
			continue
		}
		if packedTooWell(f) {
			plan.Skip(name, "ungewöhnlich stark gepackt, wird nicht entpackt")
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

// Budget counts the bytes really unpacked while an archive is read, whatever its entries declare.
type Budget struct{ left int64 }

func NewBudget() *Budget { return &Budget{left: maxImportUnpackedBytes} }

var errUnpackedTooLarge = errors.New("Archiv ist entpackt zu groß (max. 500 MB)")

// readNote reads one note of the archive as text with LF line ends. reason says why the note cannot be
// imported (it is skipped); err ends the whole import.
func readNote(f *zip.File, budget *Budget) (text, reason string, err error) {
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
func (d Doc) load(budget *Budget) ([]domain.DocumentBlock, error) {
	if d.src == nil {
		return d.blocks, nil
	}
	text, reason, err := readNote(d.src, budget)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, fmt.Errorf("note %q: %s", d.Title, reason)
	}
	fm, body := splitFrontmatter(text)
	blocks, ok := noteBlocks(body, fm.tags, d.hashtags)
	if !ok {
		return nil, collab.ErrNoteTooLarge
	}
	return blocks, nil
}

// eachDoc hands the notes of the plan to fn one at a time, with their blocks read again from the
// archive or the JSON backup, so only one note is in memory at a time.
func (p *Plan) eachDoc(budget *Budget, fn func(Doc, []domain.DocumentBlock) error) error {
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
			doc := d.toDoc()
			return fn(doc, doc.blocks)
		})
	}
	for _, d := range p.Docs {
		blocks, err := d.load(budget)
		if errors.Is(err, collab.ErrNoteTooLarge) {
			return i18n.NewError("Notiz „{title}“: {reason}", "title", d.Title, "reason", err.Error())
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

// Note is a note of the plan as it is written: its blocks read again and converted, the files of the
// archive it shows under new ids (copied once the note exists, MediaFile.CopyTo) and the hidden values it
// brings along (new id → plain text, sealed and stored once the note exists).
type Note struct {
	Doc
	Blocks []domain.DocumentBlock
	Files  []MediaFile
	Values map[string]string
}

// EachNote hands the notes of the plan to fn one at a time, read again from the archive or the JSON
// backup: blocks that only show a file of the archive become image, audio or drawing blocks with new
// file ids (the files are not imported otherwise), references to hidden values the plan carries get
// new ids. budget counts what is unpacked, also by MediaFile.CopyTo.
func (p *Plan) EachNote(budget *Budget, fn func(Note) error) error {
	return p.eachDoc(budget, func(d Doc, blocks []domain.DocumentBlock) error {
		blocks, files := linkImportMedia(d.dir, blocks, p.media)
		blocks, values := p.carryHiddenValues(blocks)
		return fn(Note{Doc: d, Blocks: blocks, Files: files, Values: values})
	})
}

// readPlanNote reads a note for the plan; one that cannot be imported is reported as skipped (ok false).
func (p *Plan) readPlanNote(n zipNote, budget *Budget) (fm frontmatter, body, title string, ok bool, err error) {
	text, reason, err := readNote(n.file, budget)
	if err != nil {
		return fm, "", "", false, err
	}
	if reason != "" {
		p.Skip(n.path, reason)
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
func (p *Plan) addZipDoc(n zipNote, doc Doc, tags []string, body string) {
	blocks, ok := noteBlocks(body, tags, doc.hashtags)
	if !ok {
		p.Skip(n.path, "zu viele Punkte (max. 20.000 pro Notiz)")
		return
	}
	doc.dir, doc.src = path.Dir(n.path), n.file
	p.markUsedMedia(doc.dir, blocks)
	p.noteOutsideMedia(n.path, doc.dir, blocks)
	p.noteSecretRefs(n.path, blocks)
	p.Docs = append(p.Docs, doc)
}

// addItems counts tasks and list items of an archive against maxImportItems.
func (p *Plan) addItems(n int) error {
	if p.itemCount += n; p.itemCount > maxImportItems {
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
func PlanObsidianImport(r io.ReaderAt, size int64, fileName string) (*Plan, error) {
	plan := &Plan{}
	notes, dirs, vault, err := readZipNotes(r, size, plan)
	if err != nil {
		return nil, err
	}
	if vault == "" {
		vault = strings.TrimSuffix(path.Base(fileName), path.Ext(fileName))
	}
	root := Segment(vault)
	if root == "" {
		root = "Obsidian-Import"
	}
	folders := map[string]bool{root: true}
	for _, d := range dirs {
		folders[path.Join(root, folderPathOf(d+"/x"))] = true
	}
	budget := NewBudget()
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
		plan.addZipDoc(n, Doc{Folder: folder, Title: title, Icon: fm.icon, hashtags: true}, fm.tags, body)
	}
	plan.reportUnusedMedia()
	plan.Folders = folderList(folders)
	if len(plan.Docs) == 0 {
		return nil, errors.New("Im Archiv wurden keine Markdown-Notizen gefunden")
	}
	return plan, nil
}

// PlanMindSiftArchiveImport reads a ZIP created by "Markdown-Archiv herunterladen": notes go back to
// their folders, Aufgaben/ back into task lists, Listen/ back into lists.
func PlanMindSiftArchiveImport(r io.ReaderAt, size int64) (*Plan, error) {
	plan := &Plan{}
	notes, dirs, _, err := readZipNotes(r, size, plan)
	if err != nil {
		return nil, err
	}
	folders := map[string]bool{}
	for _, d := range dirs {
		if top := strings.SplitN(d, "/", 2)[0]; !IsVaultDir(top, VaultTasks) && !IsVaultDir(top, VaultLists) {
			folders[folderPathOf(d+"/x")] = true
		}
	}
	budget := NewBudget()
	for _, n := range notes {
		fm, body, title, ok, err := plan.readPlanNote(n, budget)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		switch dir := folderPathOf(n.path); {
		case IsVaultDir(dir, VaultTasks):
			tl := TaskList{Title: title, Icon: fm.icon, Tasks: parseTaskFile(body)}
			if IsVaultDir(title, VaultNoList) {
				tl.Title = ""
			}
			if err := plan.addItems(len(tl.Tasks)); err != nil {
				return nil, err
			}
			plan.TaskLists = append(plan.TaskLists, tl)
		case IsVaultDir(dir, VaultLists):
			l := List{Title: title, Icon: fm.icon, Items: parseListFile(body)}
			if err := plan.addItems(len(l.Items)); err != nil {
				return nil, err
			}
			plan.Lists = append(plan.Lists, l)
		default:
			if dir != "" {
				folders[dir] = true
			}
			plan.addZipDoc(n, Doc{Folder: dir, Title: title, Icon: fm.icon}, nil, body)
		}
	}
	plan.reportUnusedMedia()
	plan.Folders = folderList(folders)
	if len(plan.Docs)+len(plan.TaskLists)+len(plan.Lists) == 0 {
		return nil, errors.New("Das Archiv enthält keine MindSift-Daten (Notizen, Aufgaben oder Listen)")
	}
	return plan, nil
}

// PlanMindSiftImport picks the format of MindSift's own data: plain JSON backup, the backup ZIP
// (one JSON inside, next to it the Markdown vault) or the Markdown archive. r must stay readable until
// the plan is applied: notes and files are read from it again then.
func PlanMindSiftImport(r io.ReaderAt, size int64, fileName string) (*Plan, error) {
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
	vaultMedia := BackupVaultDir + "/" + VaultAttachmentDir + "/med_"
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
