package importer

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

type readCloser struct {
	io.Reader
	io.Closer
}

// PlanMindSiftJSONImport reads the JSON backup ("Backup herunterladen"). Notes shared with the
// exporting user belong to someone else and are skipped; discarded thoughts are not restored.
func PlanMindSiftJSONImport(data []byte) (*Plan, error) {
	return planJSONBackup(func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }, nil)
}

// planJSONBackup reads the backup that open returns, with the files of its archive (media, nil for a
// bare JSON). Its notes are read one at a time and only counted here; the plan opens the backup again
// when it is applied (eachDoc).
func planJSONBackup(open func() (io.ReadCloser, error), media map[string]*zip.File) (*Plan, error) {
	rc, err := open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	plan := &Plan{jsonDocs: open}
	if len(media) > 0 {
		plan.media = media
	}
	folders := map[string]bool{}
	var exp domain.FullExport
	err = decodeExport(rc, &exp, func(d *exportDoc) error {
		if reason := d.skipReason(); reason != "" {
			plan.Skip(d.Title, reason)
			return nil
		}
		if d.FolderPath != "" {
			folders[d.FolderPath] = true
		}
		plan.noteOutsideMedia(d.Title, "", d.Blocks)
		plan.noteSecretRefs(d.Title, d.Blocks)
		plan.Docs = append(plan.Docs, Doc{Folder: d.FolderPath, Title: d.Title, Icon: d.Icon})
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
			plan.Skip(tl.Title, "geteilte Aufgabenliste eines anderen Benutzers")
			continue
		}
		listIndex[tl.ID] = len(plan.TaskLists)
		plan.TaskLists = append(plan.TaskLists, TaskList{Title: tl.Title, Icon: tl.Icon})
	}
	for _, t := range exp.Thoughts {
		task := Task{Content: t.Content, Priority: t.Priority, Due: t.DueDate, Notes: t.Notes, Done: t.IsCompleted, Subtasks: t.Subtasks, Recurrence: t.Recurrence}
		switch {
		case t.Status == domain.StatusInbox:
			plan.Inbox = append(plan.Inbox, task)
		case t.Status == domain.StatusKept || (t.Status == domain.StatusConverted && t.ConvertedType == "task"):
			if i, ok := listIndex[t.TaskListID]; ok {
				plan.TaskLists[i].Tasks = append(plan.TaskLists[i].Tasks, task)
			} else {
				plan.TaskLists = append(plan.TaskLists, TaskList{Tasks: []Task{task}})
			}
		}
	}
	for _, l := range exp.Lists {
		if !l.IsOwner {
			plan.Skip(l.Title, "geteilte Liste eines anderen Benutzers")
			continue
		}
		il := List{Title: l.Title, Icon: l.Icon}
		for _, it := range l.Items {
			il.Items = append(il.Items, Item{Content: it.Content, Category: it.Category, Quantity: it.Quantity, Done: it.IsCompleted})
		}
		plan.Lists = append(plan.Lists, il)
	}
	plan.Themes = exp.Themes
	plan.Folders = folderList(folders)
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

// Doc gives the note's blocks new IDs and no task links: a backup cannot reach anything existing.
func (d *exportDoc) toDoc() Doc {
	for i := range d.Blocks {
		d.Blocks[i].ID, d.Blocks[i].DocumentID, d.Blocks[i].TaskID = domain.NewID("blk"), "", ""
	}
	return Doc{Folder: d.FolderPath, Title: d.Title, Icon: d.Icon, blocks: d.Blocks}
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
