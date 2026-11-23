package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Downloads of the window's pages (a backup, an export, a theme, a note as Markdown: the frontend saves a
// blob through a link with the download attribute). WebKitGTK does not ask where to save: without the app
// it writes into the Downloads folder, which a Flatpak may not reach, so the download failed without a
// word. download_linux.go takes WebKit's downloads of every page (the window's own and a server's) and asks
// with the system's save dialog (under Flatpak the portal's, whose answer is a path the app may write);
// WebView2 on Windows has its own download bar and asks or saves there itself. The helpers here hold no
// webview.

// downloadNoticeEvent: the event a page gets when a download was saved or failed; the frontend shows a
// notice (components/DownloadNotice.tsx)
const downloadNoticeEvent = "mindsift:desktop-download"

// downloadNotice: the script that tells the page about a finished download
func downloadNotice(saved bool, name string) string {
	detail, _ := json.Marshal(map[string]any{"saved": saved, "name": name})
	ev, _ := json.Marshal(downloadNoticeEvent)
	return `window.dispatchEvent(new CustomEvent(` + string(ev) + `,{detail:` + string(detail) + `}));`
}

// safeDownloadName: the name a page suggests, as a file name (no folders, no characters a file system
// refuses); "download" when nothing is left
func safeDownloadName(name string) string {
	name = strings.ReplaceAll(name, `\`, "/")
	name = name[strings.LastIndex(name, "/")+1:]
	var b strings.Builder
	for _, r := range name {
		if r < 32 || r == 127 || strings.ContainsRune(`<>:"|?*`, r) {
			r = '_'
		}
		b.WriteRune(r)
	}
	out := strings.Trim(strings.TrimSpace(b.String()), ".")
	if out == "" {
		return "download"
	}
	return out
}

// moveDownload puts the finished download (src, in the app's own folder) where the person chose (dst):
// renamed when both lie on one file system, else copied, which also works for a path of the Flatpak
// document portal (its FUSE file system takes no rename from elsewhere). The file is written over, the
// save dialog asked about that. src is gone afterwards.
func moveDownload(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	return os.Remove(src)
}

// downloadStartDir: where the save dialog opens; the folder of the last download, else the Downloads
// folder (given), when the app can see it. Under Flatpak the dialog is the portal's on the host, which the
// sandbox cannot check, so the folder is handed over as it is.
func downloadStartDir(last, downloads string, sandboxed bool) string {
	for _, dir := range []string{last, downloads} {
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		if sandboxed {
			return dir
		}
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}
