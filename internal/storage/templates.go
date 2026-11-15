package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Note templates (Doku/modules/workspace.md, "Templates"). A template is an ordinary note that a person
// marked as one of theirs: the mark is personal like the pin (doc_templates, one row per person and
// note), so everyone picks their own templates from the notes they can read. Marking a note shared
// with you changes nothing for its owner or the others it is shared with, and needs no edit right:
// using a template only reads it (its bullets are copied into another note by the editor, or into a
// new note through POST /documents, where mediaGate and secretGate check the copy like any paste).

// migrateNoteTemplates is migration 61: the templates of each person.
func (s *Store) migrateNoteTemplates() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS doc_templates (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL,
			PRIMARY KEY(user_id, doc_id)
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_doc_templates_doc ON doc_templates(doc_id)`),
	)
}

// SetDocTemplate marks a note the person can read as one of their templates (on) or removes the mark.
// A note in the trash cannot become one (sql.ErrNoRows for a note the person cannot see, ErrDocInTrash
// for one in the trash); removing the mark always works.
func (s *Store) SetDocTemplate(userID, docID string, on bool) error {
	if !on {
		_, err := s.db.Exec(`DELETE FROM doc_templates WHERE user_id = ? AND doc_id = ?`, userID, docID)
		return err
	}
	role := s.DocRole(userID, docID)
	if role == "" {
		return sql.ErrNoRows
	}
	var archived bool
	if err := s.db.QueryRow(`SELECT is_archived FROM documents WHERE id = ?`, docID).Scan(&archived); err != nil {
		return err
	}
	if archived {
		return ErrDocInTrash
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO doc_templates (user_id, doc_id, created_at) VALUES (?, ?, ?)`,
		userID, docID, domain.NowISO())
	return err
}

// Errors of TemplateBlocksFor
var (
	ErrTemplateNotFound  = errors.New("Vorlage nicht gefunden")
	ErrTemplateAmbiguous = errors.New("Mehrere Vorlagen tragen diesen Titel, gib die id der Vorlage an")
)

// TemplateBlocksFor finds one of the person's templates by its id or else by its title (exact, then
// ignoring case) and returns copies of its bullets for a new note, as the app's "Neue Notiz" from a
// template does (frontend lib/noteTemplate.ts): see TemplateBlocks. Only templates the person can still
// read and that are not in the trash count. The copies are a paste: CreateDocument checks pictures and
// hidden values like any (mediaGate, secretGate).
func (s *Store) TemplateBlocksFor(userID, ref, title, date string) ([]domain.DocumentBlock, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, ErrTemplateNotFound
	}
	rows, err := s.db.Query(`SELECT d.id, d.title FROM doc_templates t JOIN documents d ON d.id = t.doc_id
		WHERE t.user_id = ? AND d.is_archived = 0`, userID)
	if err != nil {
		return nil, err
	}
	type tmpl struct{ id, title string }
	var all []tmpl
	for rows.Next() {
		var t tmpl
		if err := rows.Scan(&t.id, &t.title); err != nil {
			_ = rows.Close()
			return nil, err
		}
		all = append(all, t)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	readable := all[:0]
	for _, t := range all {
		if s.DocRole(userID, t.id) != "" {
			readable = append(readable, t)
		}
	}
	pick := func(match func(t tmpl) bool) (string, error) {
		found := ""
		for _, t := range readable {
			if match(t) {
				if found != "" {
					return "", ErrTemplateAmbiguous
				}
				found = t.id
			}
		}
		return found, nil
	}
	id, err := pick(func(t tmpl) bool { return t.id == ref })
	if err == nil && id == "" {
		id, err = pick(func(t tmpl) bool { return strings.TrimSpace(t.title) == ref })
	}
	if err == nil && id == "" {
		id, err = pick(func(t tmpl) bool { return strings.EqualFold(strings.TrimSpace(t.title), ref) })
	}
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, ErrTemplateNotFound
	}
	doc, _, err := loadCollabDoc(s.db, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTemplateNotFound
		}
		return nil, err
	}
	var src []domain.DocumentBlock
	for _, f := range doc.Flatten() {
		if f.Props.ConflictOf != "" {
			continue
		}
		src = append(src, domain.DocumentBlock{Type: f.Type, Content: f.Content, Lang: f.Props.Lang, Level: f.Level})
	}
	return TemplateBlocks(src, title, date), nil
}

// templatePlaceholder: {{datum}} and {{date}}, {{titel}} and {{title}}, in any case and with spaces inside
// the braces (lib/noteTemplate.ts). A hidden value's reference ({{secret:…}}) is no placeholder and stays.
var templatePlaceholder = regexp.MustCompile(`(?i)\{\{\s*(datum|date|titel|title)\s*\}\}`)

// FillTemplatePlaceholders fills in the placeholders of a template's bullet: date as given (the person's
// short date), title the new note's.
func FillTemplatePlaceholders(text, title, date string) string {
	if !strings.Contains(text, "{{") {
		return text
	}
	return templatePlaceholder.ReplaceAllStringFunc(text, func(m string) string {
		name := strings.ToLower(templatePlaceholder.FindStringSubmatch(m)[1])
		if name == "datum" || name == "date" {
			return date
		}
		return title
	})
}

// TemplateBlocks copies a template's bullets for a new note: new ids, the shallowest bullet at the top
// level, to-dos open and tied to no task, nothing collapsed, placeholders filled in except in code and
// drawings (in code {{date}} may belong to the code, a drawing's text is its model).
func TemplateBlocks(src []domain.DocumentBlock, title, date string) []domain.DocumentBlock {
	if len(src) == 0 {
		return nil
	}
	minLevel := -1
	for _, b := range src {
		if l := max(0, b.Level); minLevel < 0 || l < minLevel {
			minLevel = l
		}
	}
	out := make([]domain.DocumentBlock, len(src))
	for i, b := range src {
		content := b.Content
		if b.Type != "code" && b.Type != "drawing" {
			content = FillTemplatePlaceholders(content, title, date)
		}
		out[i] = domain.DocumentBlock{
			ID:       domain.NewID("blk"),
			Type:     b.Type,
			Content:  content,
			Lang:     b.Lang,
			Level:    max(0, b.Level) - minLevel,
			Position: float64((i + 1) * 1000),
		}
	}
	return out
}
