package storage

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/importer"
)

// Writing an import: the importer reads and plans it (internal/importer), the store writes the plan and
// checks what only the database knows.

// ApplyImport creates everything of the plan for the user. Existing data is never changed; imported
// items are added next to it. Task lists of the same name get merged into one new list per import.
//
// Imports are applied one at a time (importMu); a second one waits for its turn. Two at once competed
// note by note for the write lock with each other and with everybody else, and one of them gave up with
// "database is locked" (re-test 2026-11-14, A2). An import that fails half way takes out what it
// created, so the person never keeps half of an archive without being told; the error says which part
// failed. Each note is still written in transactions of its own: one transaction for a whole archive
// would keep everybody else from writing for as long as the import runs.
func (s *Store) ApplyImport(userID string, plan *importer.Plan) (importer.Summary, error) {
	return s.RestoreImport(userID, plan, nil)
}

// RestoreImport is ApplyImport that replaces the chosen sections of the person's data with the plan
// (restoring a backup); with replace empty it only adds, as ApplyImport.
//
// The previous data is deleted only once the plan is in completely, in one transaction that leaves what
// the import created alone (purgeUserSections with keep). An import that fails before that is taken out
// as usual and the previous data was never touched; a delete that fails is rolled back and the import
// taken out as well. Emptying the sections first, as before, lost the previous data whenever the import
// failed after it; one transaction around everything is no option (see ApplyImport). For the time of
// the import the previous and the new data are there side by side, and what someone adds to these
// sections meanwhile goes with the previous data.
func (s *Store) RestoreImport(userID string, plan *importer.Plan, replace map[string]bool) (importer.Summary, error) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	undo := &importUndo{}
	err := s.applyImport(userID, plan, undo)
	if err == nil && len(replace) > 0 {
		if err = s.purgeUserSections(userID, replace, undo.created()); err == nil {
			// The delete took all folder entries along, also those the import uses
			for _, f := range plan.Folders {
				_, _ = s.CreateFolder(userID, f)
			}
		}
	}
	if err != nil {
		s.undoImport(userID, undo)
		return plan.Summary(false), err
	}
	// After the delete, which would take them along; one that cannot be saved is listed as skipped
	for _, th := range plan.Themes {
		if _, err := s.SaveUserTheme(userID, "", th.Name, th.CSS); err != nil {
			plan.Skip(th.Name, "Theme: "+err.Error())
		}
	}
	// [[Titel]] links point at their notes by id, now that all of them exist and the previous ones of a
	// restore are gone. Only once nothing can fail any more: it rewrites links in the person's existing
	// notes too, and undoImport does not put those back, so they would point at notes it deleted.
	if len(plan.Docs) > 0 {
		s.LinkWikiTitles(userID)
	}
	return plan.Summary(true), nil
}

// importUndo lists what an import created so far.
type importUndo struct {
	folders, docs, taskLists, tasks, lists []string
}

// created: the ids of the notes, task lists, tasks and lists the import created (folders are matched
// by path, not id).
func (u *importUndo) created() []string {
	return slices.Concat(u.docs, u.taskLists, u.tasks, u.lists)
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

func (s *Store) applyImport(userID string, plan *importer.Plan, undo *importUndo) error {
	s.CheckImportMedia(userID, plan)
	before, err := s.userFolderIDs(userID)
	if err != nil {
		return err
	}
	for _, f := range plan.Folders {
		_, _ = s.CreateFolder(userID, f) // already existing folders are fine
	}
	after, err := s.userFolderIDs(userID)
	if err != nil {
		return err
	}
	for id := range after {
		if !before[id] {
			undo.folders = append(undo.folders, id)
		}
	}
	budget := importer.NewBudget()
	err = plan.EachNote(budget, func(n importer.Note) error {
		title := strings.TrimSpace(n.Title)
		if title == "" {
			title = i18n.T(s.MessageLanguage(userID), "Unbenannte Notiz")
		}
		icon := n.Icon
		if icon == "" {
			icon = "🗒️"
		}
		// The import's own files are stored once the note exists; any other file stays out unless the
		// person may read it already (mediaGate)
		keep := make(map[string]bool, len(n.Files))
		for _, f := range n.Files {
			keep[f.ID] = true
		}
		doc, err := s.createDocument(userID, "", title, icon, n.Folder, n.Blocks, nil, false, keep)
		if errors.Is(err, collab.ErrNoteTooLarge) {
			// Said with the note's name, so the person knows which file to split
			return i18n.NewError("Notiz „{title}“: {reason}", "title", title, "reason", err.Error())
		}
		if err != nil {
			return fmt.Errorf("note %q: %w", title, err)
		}
		undo.docs = append(undo.docs, doc.ID)
		if err := s.storeImportMedia(userID, doc.ID, n.Files, budget); err != nil {
			return fmt.Errorf("note %q: %w", title, err)
		}
		if err := s.storeCarriedValues(userID, doc, n.Values); err != nil {
			return fmt.Errorf("note %q: %w", title, err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, tl := range plan.TaskLists {
		listID := "" // tasks without a list
		if tl.Title != "" {
			icon := tl.Icon
			if icon == "" {
				icon = "📋"
			}
			created, err := s.CreateTaskList(userID, "", "", tl.Title, icon, "")
			if err != nil {
				return fmt.Errorf("task list %q: %w", tl.Title, err)
			}
			listID = created.ID
			undo.taskLists = append(undo.taskLists, listID)
		}
		for _, t := range tl.Tasks {
			if err := s.importTaskInto(userID, listID, t, true, undo); err != nil {
				return err
			}
		}
	}
	for _, t := range plan.Inbox {
		if err := s.importTaskInto(userID, "", t, false, undo); err != nil {
			return err
		}
	}
	for _, l := range plan.Lists {
		icon := l.Icon
		if icon == "" {
			icon = "🛒"
		}
		created, err := s.CreateList(userID, l.Title, icon, "shopping")
		if err != nil {
			return fmt.Errorf("list %q: %w", l.Title, err)
		}
		undo.lists = append(undo.lists, created.ID)
		for i, it := range l.Items {
			item, err := s.CreateListItem(created.ID, it.Content, it.Category, it.Quantity, i, userID)
			if err != nil {
				continue // empty lines and the like
			}
			if it.Done {
				_, err = s.ToggleListItem(item.ID, true, userID, "")
				logDBErr(err)
			}
		}
	}
	return nil
}

func (s *Store) importTaskInto(userID, listID string, t importer.Task, asTask bool, undo *importUndo) error {
	content := strings.TrimSpace(t.Content)
	if content == "" {
		return nil
	}
	priority := t.Priority
	if priority != "low" && priority != "high" && priority != "urgent" {
		priority = "normal"
	}
	th, err := s.CreateThoughtWithDetails(userID, content, priority, "import", t.Due, listID, "todo", t.Notes)
	if err != nil {
		return fmt.Errorf("task %q: %w", content, err)
	}
	undo.tasks = append(undo.tasks, th.ID)
	if !asTask {
		return nil
	}
	if _, err := s.UpdateThoughtTriage(userID, th.ID, "keep", "task", "", t.Due, listID); err != nil {
		return fmt.Errorf("task %q: %w", content, err)
	}
	if validRecurrence(t.Recurrence) && t.Recurrence != "" {
		// Imported as already handled: completing a restored task must not create a second successor
		s.execLogged(`UPDATE thoughts SET recurrence = ?, recurrence_spawned = ? WHERE id = ?`, t.Recurrence, boolInt(t.Done), th.ID)
	}
	if t.Done || len(t.Subtasks) > 0 {
		var done *bool
		if t.Done {
			done = &t.Done
		}
		var subs *[]domain.SubTask
		if len(t.Subtasks) > 0 {
			subs = &t.Subtasks
		}
		_, err = s.UpdateThoughtDetails(userID, th.ID, nil, done, nil, nil, nil, nil, nil, subs, nil)
		logDBErr(err)
	}
	return nil
}

// storeCarriedValues seals the values the plan gave the note doc (importer.Note.Values) with this instance's key and
// stores them; a value no bullet of the stored note refers to (a code block keeps none) is left out.
func (s *Store) storeCarriedValues(userID string, doc *domain.Document, values map[string]string) error {
	if len(values) == 0 {
		return nil
	}
	var list []NoteSecret
	seen := map[string]bool{}
	for _, b := range doc.Blocks {
		for _, m := range blockfmt.SecretRefRe.FindAllStringSubmatch(b.Content, -1) {
			plain, ok := values[m[1]]
			if !ok || seen[m[1]] {
				continue
			}
			seen[m[1]] = true
			sealed, err := SealValue(s.secretsKey, m[1], plain)
			if err != nil {
				return err
			}
			list = append(list, NoteSecret{ID: m[1], DocumentID: doc.ID, CreatedBy: userID, Ciphertext: sealed})
		}
	}
	if len(list) == 0 {
		return nil
	}
	return s.insertSecrets(list)
}

// CheckImportMedia lists the notes of the plan as skipped that show a file the import does not bring
// along and the person may not read (someone else's file, or one that no longer exists), or that refer
// to a hidden value of a note the person may not read. Applying the plan drops these references: a
// bullet showing a file would make it readable (mediaGate), the hidden value becomes a placeholder
// (secretGate).
func (s *Store) CheckImportMedia(userID string, plan *importer.Plan) {
	if plan.MarkChecked() {
		return
	}
	gate := s.newMediaGate(userID, nil)
	for _, r := range plan.OutsideMedia() {
		for _, id := range r.IDs {
			if !gate.allowed(id) {
				plan.Skip(r.Note, "Bild oder Aufnahme ohne Zugriff, nur die Beschriftung wird übernommen")
				break
			}
		}
	}
	s.checkImportSecrets(userID, plan)
}

// checkImportSecrets is CheckImportMedia for hidden values, by the rule of secretGate.prepare: a value of
// a note the person may read becomes a copy in the new note, a value of a note the person may not read
// becomes a placeholder. A reference to no value on this server stays but shows nothing: a backup holds
// the references only, never the values (they are sealed with the key of the server it was made on), so
// the values of a backup from another server, or of notes deleted since, are lost. A backup of this
// server whose notes still exist keeps them.
func (s *Store) checkImportSecrets(userID string, plan *importer.Plan) {
	refs := plan.SecretRefs()
	if len(refs) == 0 || plan.HiddenValuesListed() {
		return
	}
	rows, err := s.secretsByID(plan.HiddenValueIDs())
	if err != nil {
		logDBErr(err)
		return
	}
	gate := s.newSecretGate(userID, "")
	for _, r := range refs {
		for _, id := range r.IDs {
			v, ok := rows[id]
			if !ok {
				plan.Skip(r.Note, "Versteckter Wert nicht im Backup enthalten und nicht mehr auf diesem Server, nur ein Platzhalter wird übernommen")
				break
			}
			if !gate.mayRead(v.DocumentID) {
				plan.Skip(r.Note, "Versteckter Wert ohne Zugriff, nur ein Platzhalter wird übernommen")
				break
			}
		}
	}
}

func (s *Store) storeImportMedia(userID, docID string, files []importer.MediaFile, budget *importer.Budget) error {
	if len(files) == 0 || s.mediaRoot == "" {
		return nil
	}
	for _, f := range files {
		m, err := s.createMediaWithID(f.ID, docID, userID, f.Kind, f.Mime, f.Size(), "")
		if err != nil {
			return err
		}
		dst := s.MediaFilePath(m)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := f.CopyTo(dst, budget); err != nil {
			return err
		}
	}
	return nil
}
