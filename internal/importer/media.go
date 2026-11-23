package importer

import (
	"archive/zip"
	"errors"
	"io"
	"maps"
	"net/url"
	"os"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
)

// --- Images and recordings ----------------------------------------------------------------------------

var importMediaExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".webm": true, ".ogg": true, ".oga": true, ".mp3": true, ".wav": true, ".m4a": true, ".aac": true,
	// Only drawings exported by MindSift (the model is inside); other SVG files stay out
	".svg": true}

// reportUnusedMedia lists files no note shows (or that are no valid image/recording) as skipped in the
// preview and drops them from the plan.
func (p *Plan) reportUnusedMedia() {
	for _, k := range slices.Sorted(maps.Keys(p.media)) {
		if p.usedMedia[k] {
			continue
		}
		if head, err := readZipHead(p.media[k]); err != nil {
			p.Skip(k, "nicht lesbar")
		} else if _, _, ok := blockfmt.DetectMedia(head, ""); !ok {
			p.Skip(k, "kein gültiges Bild bzw. keine gültige Aufnahme")
		} else {
			p.Skip(k, "wird in keiner Notiz angezeigt")
		}
		delete(p.media, k)
	}
	p.usedMedia = nil
}

// markUsedMedia notes the files of the archive that blocks of a note show.
func (p *Plan) markUsedMedia(dir string, blocks []domain.DocumentBlock) {
	if len(p.media) == 0 {
		return
	}
	if p.usedMedia == nil {
		p.usedMedia = map[string]bool{}
	}
	for _, b := range blocks {
		if key, _, _ := mediaKey(b.Content, dir, p.media); key != "" {
			p.usedMedia[key] = true
		}
	}
}

// noteOutsideMedia notes the files a note shows that the import does not bring along: references by id
// (media:<id>) other than a bullet showing a file of the archive, which gets a new id.
func (p *Plan) noteOutsideMedia(note, dir string, blocks []domain.DocumentBlock) {
	var ids []string
	seen := map[string]bool{}
	for _, b := range blocks {
		if !strings.Contains(b.Content, "media:") {
			continue
		}
		key, _, _ := mediaKey(b.Content, dir, p.media)
		for _, m := range blockfmt.MediaIDRe.FindAllStringSubmatch(b.Content, -1) {
			if key == "media:"+m[1] || seen[m[1]] || p.outsideIDs >= maxImportOutsideMedia {
				continue
			}
			seen[m[1]] = true
			ids = append(ids, m[1])
			p.outsideIDs++
		}
	}
	if len(ids) > 0 {
		p.outside = append(p.outside, Refs{Note: note, IDs: ids})
	}
}

// noteSecretRefs notes the hidden values a note refers to. An import brings no values along, so every
// reference points to a value of a note on this server, or to nothing.
func (p *Plan) noteSecretRefs(note string, blocks []domain.DocumentBlock) {
	var ids []string
	seen := map[string]bool{}
	for _, b := range blocks {
		if !strings.Contains(b.Content, "{{secret:") {
			continue
		}
		for _, m := range blockfmt.SecretRefRe.FindAllStringSubmatch(b.Content, -1) {
			if seen[m[1]] || p.secretIDs >= maxImportOutsideMedia {
				continue
			}
			seen[m[1]] = true
			ids = append(ids, m[1])
			p.secretIDs++
		}
	}
	if len(ids) > 0 {
		p.secretRefs = append(p.secretRefs, Refs{Note: note, IDs: ids})
	}
}

// SkipHiddenValues lists every note of the plan that refers to hidden values as skipped with reason; for a
// plan whose values cannot come along at all (a server's database snapshot, sealed with its key).
func (p *Plan) SkipHiddenValues(reason string) {
	p.secretsSkipped = true
	for _, r := range p.secretRefs {
		p.Skip(r.Note, reason)
	}
}

// HiddenValueIDs: the hidden values the notes of the plan refer to (up to maxImportOutsideMedia).
func (p *Plan) HiddenValueIDs() []string {
	var ids []string
	for _, r := range p.secretRefs {
		ids = append(ids, r.IDs...)
	}
	return ids
}

// CarryHiddenValues makes the plan bring the hidden values along (reference id → plain text: a server's
// values, opened with its key from the backup); applying it gives each note a value of its own under a new
// id, sealed with this instance's key. Notes that refer to a value not in values are listed as skipped
// with reason, as SkipHiddenValues does; with no values at all it is SkipHiddenValues.
func (p *Plan) CarryHiddenValues(values map[string]string, reason string) {
	p.secretsSkipped = true
	if len(values) > 0 {
		p.carried = values
	}
	for _, r := range p.secretRefs {
		for _, id := range r.IDs {
			if _, ok := values[id]; !ok {
				p.Skip(r.Note, reason)
				break
			}
		}
	}
}

// carryHiddenValues rewrites the references of blocks to carried values to new ids (one per value and
// note) and returns new id → plain text; the store seals and stores them once the note exists.
func (p *Plan) carryHiddenValues(blocks []domain.DocumentBlock) ([]domain.DocumentBlock, map[string]string) {
	if len(p.carried) == 0 {
		return blocks, nil
	}
	fresh := map[string]string{} // reference id → new id
	values := map[string]string{}
	var out []domain.DocumentBlock
	for i, b := range blocks {
		if !strings.Contains(b.Content, "{{secret:") {
			continue
		}
		content := blockfmt.SecretRefRe.ReplaceAllStringFunc(b.Content, func(ref string) string {
			id := ref[len("{{secret:") : len(ref)-len("}}")]
			plain, ok := p.carried[id]
			if !ok {
				return ref
			}
			to, seen := fresh[id]
			if !seen {
				to = blockfmt.NewSecretID()
				fresh[id], values[to] = to, plain
			}
			return blockfmt.SecretRef(to)
		})
		if content == b.Content {
			continue
		}
		if out == nil {
			out = slices.Clone(blocks)
		}
		out[i].Content = content
	}
	if out == nil {
		return blocks, nil
	}
	return out, values
}

func (p *Plan) addMedia(name string, f *zip.File) {
	if p.media == nil {
		p.media = map[string]*zip.File{}
	}
	p.media[name] = f
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

// readZipHead reads the start of a file, enough to recognise its format (blockfmt.DetectMedia).
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

// MediaFile is an image or recording of the archive a note shows, under the id its blocks point to. The
// store records it and copies it to the media folder once the note exists (CopyTo).
type MediaFile struct {
	ID, Kind, Mime string
	src            *zip.File
}

// Size is the size the archive declares for the file (CopyTo never unpacks more than maxImportMediaBytes).
func (f MediaFile) Size() int64 { return int64(f.src.UncompressedSize64) }

var (
	mdEmbedRe   = regexp.MustCompile(`^!\[([^\]]*)\]\(<?([^)>]+?)>?(?:\s+"[^"]*")?\)$`)
	wikiEmbedRe = regexp.MustCompile(`^!\[\[([^|\]]+)(?:\|([^\]]*))?\]\]$`)
	sizeOnlyRe  = regexp.MustCompile(`^\d+(x\d+)?$`)
	// Obsidian's size after the caption of a Markdown image: ![caption|320](…) or ![caption|320x200](…)
	embedSizeRe = regexp.MustCompile(`^(.*)\|(\d{1,5}(?:x\d{1,5})?)$`)
)

// embedWidth reads the width of an Obsidian size ("320" or "320x200"); 0 for anything else.
func embedWidth(size string) int {
	if !sizeOnlyRe.MatchString(size) {
		return 0
	}
	n, _ := strconv.Atoi(strings.SplitN(size, "x", 2)[0])
	return min(n, blockfmt.MaxMediaWidth)
}

// mediaKey finds the file of the archive a block shows on its own: media:<id> of an own backup, a
// Markdown image relative to the note (dir), an Obsidian ![[file]] embed (found by name anywhere in the
// archive). "" when the block shows none of them. width: the size an image was given (MindSift's
// ![caption|320](media:…), Obsidian's |320 or |320x200), 0 for the default size.
func mediaKey(content, dir string, media map[string]*zip.File) (key, caption string, width int) {
	content = strings.TrimSpace(content)
	if ref, ok := blockfmt.ParseMediaContent(content); ok {
		key, caption, width = "media:"+ref.ID, ref.Caption, ref.Width
	} else if m := mdEmbedRe.FindStringSubmatch(content); m != nil {
		target := m[2]
		if u, err := url.PathUnescape(target); err == nil {
			target = u
		}
		key, caption = path.Clean(path.Join(dir, target)), m[1]
		if s := embedSizeRe.FindStringSubmatch(caption); s != nil {
			caption, width = s[1], embedWidth(s[2])
		}
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
		} else {
			width = embedWidth(m[2])
		}
	}
	if _, ok := media[key]; key == "" || !ok {
		return "", "", 0
	}
	return key, caption, width
}

// linkImportMedia turns blocks that only show a file of the archive into image/audio blocks with new
// file IDs (drawings exported as SVG back into drawings). Files without such a block are not imported.
// The files are copied once the note exists (MediaFile.CopyTo).
func linkImportMedia(dir string, blocks []domain.DocumentBlock, media map[string]*zip.File) ([]domain.DocumentBlock, []MediaFile) {
	if len(media) == 0 {
		return blocks, nil
	}
	byKey := map[string]MediaFile{} // one copy per note, even when shown twice
	var files []MediaFile
	for i, b := range blocks {
		key, caption, width := mediaKey(b.Content, dir, media)
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
			mime, kind, ok := blockfmt.DetectMedia(head, "")
			if !ok {
				continue
			}
			f = MediaFile{ID: domain.NewID("med"), Kind: kind, Mime: mime, src: src}
			byKey[key] = f
			files = append(files, f)
		}
		blocks[i].Type = f.Kind
		blocks[i].Content = blockfmt.MediaContentSized(f.Kind, f.ID, caption, width)
	}
	return blocks, files
}

// CopyTo unpacks the file of the archive straight to dst (max. maxImportMediaBytes); a file that fails is
// removed again.
func (f MediaFile) CopyTo(dst string, budget *Budget) error {
	rc, err := f.src.Open()
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
