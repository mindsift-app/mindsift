// Package blockfmt holds the text formats inside a bullet that the store, the importer and the API share:
// references to media files and hidden values, Markdown tables, and the media formats a file may have.
// Pure functions, no database.
package blockfmt

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Accepted formats (detected from the content, not from the name): file extension and kind
var mediaTypes = map[string]struct{ ext, kind string }{
	"image/jpeg":      {".jpg", "image"},
	"image/png":       {".png", "image"},
	"image/gif":       {".gif", "image"},
	"image/webp":      {".webp", "image"},
	"audio/webm":      {".webm", "audio"},
	"video/webm":      {".webm", "audio"}, // Chrome's audio-only recordings are detected as video/webm
	"audio/ogg":       {".ogg", "audio"},
	"application/ogg": {".ogg", "audio"},
	"audio/mpeg":      {".mp3", "audio"},
	"audio/wave":      {".wav", "audio"},
	"audio/wav":       {".wav", "audio"},
	"audio/mp4":       {".m4a", "audio"},
	"video/mp4":       {".m4a", "audio"}, // Safari records MP4/AAC
	"audio/aac":       {".aac", "audio"},
}

// DetectMedia recognises the format from the first bytes. Browsers send audio as e.g.
// "audio/webm;codecs=opus"; that name is kept when the content looks like a container we accept.
func DetectMedia(data []byte, declared string) (mime, kind string, ok bool) {
	sniffed := http.DetectContentType(data)
	if i := strings.IndexByte(sniffed, ';'); i >= 0 {
		sniffed = sniffed[:i]
	}
	// Go does not know WebP and M4A by name; check their signatures directly
	switch {
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		sniffed = "image/webp"
	case len(data) >= 12 && string(data[4:8]) == "ftyp":
		sniffed = "video/mp4"
	}
	t, ok := mediaTypes[sniffed]
	if !ok {
		return "", "", false
	}
	if t.kind == "audio" {
		if d := strings.ToLower(strings.TrimSpace(strings.SplitN(declared, ";", 2)[0])); strings.HasPrefix(d, "audio/") {
			if dt, known := mediaTypes[d]; known && dt.kind == "audio" {
				sniffed = d
			}
		} else if sniffed == "video/webm" {
			sniffed = "audio/webm"
		} else if sniffed == "video/mp4" {
			sniffed = "audio/mp4"
		}
	}
	return sniffed, t.kind, true
}

// MediaExt is the file extension for a stored format.
func MediaExt(mime string) string {
	if t, ok := mediaTypes[mime]; ok {
		return t.ext
	}
	return ".bin"
}

// MediaRef is a block's pointer to a file: ![caption](media:id) for images, [caption](media:id) for audio.
// An image whose size was set by hand carries its displayed width in CSS pixels after an unescaped "|"
// at the end of the caption, as Obsidian does: ![caption|320](media:id). A "|" in the caption itself is
// escaped (`\|`). Width is 0 for the default size (and always for audio).
type MediaRef struct {
	ID, Caption string
	Width       int
}

var mediaRefRe = regexp.MustCompile(`^!?\[((?:[^\]\\]|\\.)*)\]\(media:(med_[0-9a-f]+)\)$`)
var mediaRefEsc = regexp.MustCompile(`\\(.)`)

// mediaWidthRe: the width at the end of the still escaped caption. Everything before it is plain
// characters or escaped pairs, so the "|" found is not an escaped one.
var mediaWidthRe = regexp.MustCompile(`^((?:[^\\]|\\.)*?)\|(\d{1,5})$`)

// MaxMediaWidth caps a stored width (the note column limits what the app shows anyway).
const MaxMediaWidth = 10000

func ParseMediaContent(content string) (MediaRef, bool) {
	content = strings.TrimSpace(content)
	m := mediaRefRe.FindStringSubmatch(content)
	if m == nil {
		return MediaRef{}, false
	}
	caption, width := m[1], 0
	if strings.HasPrefix(content, "!") {
		caption, width = splitMediaWidth(caption)
	}
	return MediaRef{ID: m[2], Caption: mediaRefEsc.ReplaceAllString(caption, "$1"), Width: width}, true
}

// splitMediaWidth separates the width from an image's (escaped) caption; 0 when there is none.
func splitMediaWidth(raw string) (string, int) {
	w := mediaWidthRe.FindStringSubmatch(raw)
	if w == nil {
		return raw, 0
	}
	n, err := strconv.Atoi(w[2])
	if err != nil || n <= 0 {
		return raw, 0
	}
	return w[1], min(n, MaxMediaWidth)
}

// LinkCaption is the caption of a link to a file as text: raw is the caption as it stands in the link
// ("[raw](media:…)", still escaped), image says the link starts with "!", so a width after "|" is no part
// of it.
func LinkCaption(raw string, image bool) string {
	if image {
		raw, _ = splitMediaWidth(raw)
	}
	return mediaRefEsc.ReplaceAllString(raw, "$1")
}

// MediaContent builds a block's content for a file (same format as the browser, lib/media.ts).
func MediaContent(kind, id, caption string) string {
	return MediaContentSized(kind, id, caption, 0)
}

// MediaContentSized is MediaContent with an image's width set by hand (0: default size).
func MediaContentSized(kind, id, caption string, width int) string {
	caption = strings.Join(strings.Fields(strings.ReplaceAll(caption, "\n", " ")), " ")
	caption = strings.NewReplacer(`\`, `\\`, `]`, `\]`, `|`, `\|`).Replace(caption)
	prefix := ""
	if kind == "image" {
		prefix = "!"
		if width > 0 {
			caption += "|" + strconv.Itoa(min(width, MaxMediaWidth))
		}
	}
	return prefix + "[" + caption + "](media:" + id + ")"
}

// MediaIDRe finds every file a block points to, wherever in the content (image and audio bullets, but
// also a reference pasted into text); the id is the media id format of domain.NewID.
var MediaIDRe = regexp.MustCompile(`media:(med_[0-9a-f]+)`)
