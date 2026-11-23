// Package importer reads what an import brings (an Obsidian vault, MindSift's Markdown archive, its JSON
// backup or the backup ZIP) and plans it: which folders, notes, task lists, tasks, lists and themes it
// creates and what it leaves out, with the reason. It never touches the database; the store writes a
// plan (storage.Store.ApplyImport, RestoreImport) and checks what only the database can tell (whether
// the person may read the files and hidden values the notes point to).
//
// A plan is built completely, and checked, before anything is written, so the preview shows exactly what
// the import does and a broken file changes nothing. It keeps only the place and title of each note: the
// notes are read and converted again, one at a time, when the plan is applied (Plan.EachNote).
package importer

import (
	"archive/zip"
	"io"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Import limits: they keep a crafted archive (zip bomb, millions of files) from exhausting the server.
// Besides, notes, files and the notes of a JSON backup are read one at a time when they are needed (once
// for the plan, again when it is applied), so an import never holds the whole archive unpacked.
const (
	MaxUploadBytes = 100 << 20 // uploaded file
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

// Plan is everything an import would create. It is built completely (and validated) before
// anything is written, so the preview shows exactly what the import does. Notes of an archive or a JSON
// backup keep only their place and title here; their blocks are read again when the plan is applied.
type Plan struct {
	Folders   []string           `json:"-"`
	Docs      []Doc              `json:"-"`
	TaskLists []TaskList         `json:"-"`
	Lists     []List             `json:"-"`
	Inbox     []Task             `json:"-"`
	Themes    []domain.UserTheme `json:"-"`
	Skipped   []Skip             `json:"skipped"`
	// Images and recordings of the archive: "media:<id>" (own backup) or the path in the archive
	media map[string]*zip.File
	// jsonDocs opens the JSON backup again to read its notes one at a time (nil: Docs hold them)
	jsonDocs  func() (io.ReadCloser, error)
	itemCount int             // tasks and list items, against maxImportItems
	usedMedia map[string]bool // keys of media a note shows, while the plan is built
	// Files the notes show that the archive does not bring along (other people's files cannot be shown,
	// see storage.Store.CheckImportMedia); outsideIDs counts them against maxImportOutsideMedia
	outside    []Refs
	outsideIDs int
	checked    bool
	// Hidden values the notes refer to ({{secret:<id>}}); values of notes the person may not read become
	// a placeholder (the store's secretGate). secretIDs counts them against maxImportOutsideMedia as well.
	secretRefs []Refs
	secretIDs  int
	// secretsSkipped: SkipHiddenValues or CarryHiddenValues listed them already, the store's check adds nothing
	secretsSkipped bool
	// carried: hidden values the plan brings along (reference id → plain text, CarryHiddenValues); each
	// note gets values of its own, sealed with this instance's key
	carried map[string]string
}

// Refs: the files (or hidden values) of one note (by its path or title) that are not part of
// the import.
type Refs struct {
	Note string
	IDs  []string
}

// maxImportOutsideMedia bounds the file ids the preview checks; applying checks every reference anyway.
const maxImportOutsideMedia = 10_000

// Sections are the parts of a plan to keep (Only); the store's sections of a person's data
// (storage.NormalizeSections) name them.
type Sections struct {
	Notes, Tasks, Lists, Inbox, Themes bool
}

// Only keeps the chosen sections of the plan.
func (p *Plan) Only(sections Sections) *Plan {
	out := &Plan{Skipped: p.Skipped}
	if sections.Notes {
		out.Folders, out.Docs, out.media, out.jsonDocs, out.outside, out.secretRefs = p.Folders, p.Docs, p.media, p.jsonDocs, p.outside, p.secretRefs
	}
	if sections.Tasks {
		out.TaskLists = p.TaskLists
	}
	if sections.Lists {
		out.Lists = p.Lists
	}
	if sections.Inbox {
		out.Inbox = p.Inbox
	}
	if sections.Themes {
		out.Themes = p.Themes
	}
	return out
}

// Skip is a part of the import left out, with the reason.
type Skip struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// Summary is what the API returns for a preview and after the import.
type Summary struct {
	Folders   int    `json:"folders"`
	Notes     int    `json:"notes"`
	TaskLists int    `json:"taskLists"`
	Tasks     int    `json:"tasks"`
	Lists     int    `json:"lists"`
	ListItems int    `json:"listItems"`
	Inbox     int    `json:"inbox"`
	Themes    int    `json:"themes"`
	Skipped   []Skip `json:"skipped"`
	Applied   bool   `json:"applied"`
}

// Doc is a note of the plan: where it goes and its title. Its blocks are read again when the plan is
// applied (EachNote).
type Doc struct {
	Folder, Title, Icon string
	dir                 string // folder of the note inside the archive, for relative image links
	blocks              []domain.DocumentBlock
	// src: the note in the archive, converted again when the plan is applied (blocks stay nil)
	src *zip.File
	// hashtags: front matter tags missing in the text become a bullet of hashtags (Obsidian)
	hashtags bool
}

type Task struct {
	Content, Priority, Due, Notes, Recurrence string
	Done                                      bool
	Subtasks                                  []domain.SubTask
}

// TaskList holds the tasks of one task list; with no title they are tasks without a list.
type TaskList struct {
	Title, Icon string
	Tasks       []Task
}

type List struct {
	Title, Icon string
	Items       []Item
}

type Item struct {
	Content, Category, Quantity string
	Done                        bool
}

// Skip lists path as left out of the import, with reason.
func (p *Plan) Skip(path, reason string) {
	p.Skipped = append(p.Skipped, Skip{Path: path, Reason: reason})
}

func (p *Plan) Summary(applied bool) Summary {
	sum := Summary{Folders: len(p.Folders), Notes: len(p.Docs), Lists: len(p.Lists), Inbox: len(p.Inbox), Themes: len(p.Themes), Skipped: p.Skipped, Applied: applied}
	for _, tl := range p.TaskLists {
		if tl.Title != "" {
			sum.TaskLists++
		}
		sum.Tasks += len(tl.Tasks)
	}
	for _, l := range p.Lists {
		sum.ListItems += len(l.Items)
	}
	if sum.Skipped == nil {
		sum.Skipped = []Skip{}
	}
	return sum
}

// OutsideMedia: per note, the files it shows that the import does not bring along (up to
// maxImportOutsideMedia ids); the store checks whether the person may read them.
func (p *Plan) OutsideMedia() []Refs { return p.outside }

// SecretRefs: per note, the hidden values it refers to (up to maxImportOutsideMedia ids).
func (p *Plan) SecretRefs() []Refs { return p.secretRefs }

// MarkChecked records that the store checked the plan's references against the database, so a preview
// and the import that follows list them once; it reports whether that had happened already.
func (p *Plan) MarkChecked() (already bool) {
	already, p.checked = p.checked, true
	return already
}

// HiddenValuesListed: SkipHiddenValues or CarryHiddenValues listed the notes whose hidden values do not
// come along already, so the store's check of hidden values adds nothing.
func (p *Plan) HiddenValuesListed() bool { return p.secretsSkipped }
