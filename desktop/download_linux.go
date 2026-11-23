//go:build linux && cgo

package main

// WebKitGTK's downloads (see downloads.go). The window's network session reports every download it starts
// (download-started), on any page; WebKit then asks for a destination (decide-destination). The handler
// keeps the download waiting (returns TRUE without a destination, WebKitGTK 2.40 and later), the save
// dialog runs (Wails' dialog, GTK's GtkFileDialog, under Flatpak the FileChooser portal), and the download
// goes on into a folder of the app's own (<base>/webview/downloads/); when it finished, the file is moved
// to the chosen path. WebKit's own way would write "<name>.wkdownload" next to the destination and rename
// it, which in a single file exported by the document portal depends on the portal's temporary files; a
// copy into the chosen file is plain writing (checked with xdg-document-portal: renaming into it fails
// with EXDEV, opening and writing it works). A cancelled dialog cancels the download; the page gets a
// notice when a file was saved or could not be.

/*
#cgo pkg-config: gtk4 webkitgtk-6.0
#include <gtk/gtk.h>
#include <webkit/webkit.h>
#include <stdlib.h>

extern void msDownloadDecide(void *download, char *suggested);
extern void msDownloadFailed(void *download, int cancelled, char *message);
extern void msDownloadFinished(void *download);

static gboolean ms_download_decide(WebKitDownload *download, gchar *suggested, gpointer data) {
	msDownloadDecide(download, suggested);
	return TRUE; // the destination follows the dialog (ms_download_set_destination)
}

static void ms_download_failed(WebKitDownload *download, GError *error, gpointer data) {
	int cancelled = error != NULL && g_error_matches(error, WEBKIT_DOWNLOAD_ERROR, WEBKIT_DOWNLOAD_ERROR_CANCELLED_BY_USER);
	msDownloadFailed(download, cancelled, error != NULL ? error->message : "");
}

// "finished" also follows "failed"; the reference taken at the start ends here
static void ms_download_finished(WebKitDownload *download, gpointer data) {
	msDownloadFinished(download);
	g_object_unref(download);
}

static void ms_download_started(WebKitNetworkSession *session, WebKitDownload *download, gpointer data) {
	g_object_ref(download);
	g_signal_connect(download, "decide-destination", G_CALLBACK(ms_download_decide), NULL);
	g_signal_connect(download, "failed", G_CALLBACK(ms_download_failed), NULL);
	g_signal_connect(download, "finished", G_CALLBACK(ms_download_finished), NULL);
}

static void ms_watch_downloads(void *view) {
	WebKitNetworkSession *session = webkit_web_view_get_network_session(WEBKIT_WEB_VIEW(view));
	if (session != NULL) g_signal_connect(session, "download-started", G_CALLBACK(ms_download_started), NULL);
}

static void ms_download_set_destination(void *download, const char *path) {
	webkit_download_set_allow_overwrite(WEBKIT_DOWNLOAD(download), TRUE);
	webkit_download_set_destination(WEBKIT_DOWNLOAD(download), path);
}

static void ms_download_cancel(void *download) {
	webkit_download_cancel(WEBKIT_DOWNLOAD(download));
}

// The person's Downloads folder (GLib owns the string); "" when there is none
static const char *ms_downloads_dir(void) {
	const char *dir = g_get_user_special_dir(G_USER_DIRECTORY_DOWNLOAD);
	return dir != NULL ? dir : "";
}
*/
import "C"

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
)

// pendingDownload: one download between WebKit's start and its end
type pendingDownload struct {
	name string // the file's name as suggested (for the notice until a path was chosen)
	dest string // the chosen path ("" until then)
	tmp  string // where WebKit writes it, in a folder of its own below downloadsTemp
	// quiet: the dialog was cancelled, no notice; err: why it failed (dialog, folder, WebKit)
	quiet  bool
	failed bool
	err    error
}

var (
	downloadsMu sync.Mutex
	downloads   = map[uintptr]*pendingDownload{}
	// downloadsTemp: <base>/webview/downloads; askSavePath: the save dialog (main.go); lastDownloadDir:
	// the folder of the last saved download, as the person knows it
	downloadsTemp   string
	askSavePath     func(name, dir string) (string, error)
	lastDownloadDir string
)

// errNoDownloadDialog: downloads before the save dialog is set up
var errNoDownloadDialog = errors.New("no save dialog")

// setupDownloads: where downloads wait until they are moved, and the save dialog; before the window loads
// a page. Leftovers of a run that ended during a download are removed.
func setupDownloads(base string, ask func(name, dir string) (string, error)) {
	downloadsTemp = filepath.Join(base, "webview", "downloads")
	_ = os.RemoveAll(downloadsTemp)
	askSavePath = ask
}

// watchDownloads: WebKit's downloads of the window's network session; once, with the webview found at the
// first page load (webview_linux.go), on the main thread.
func watchDownloads(view unsafe.Pointer) {
	C.ms_watch_downloads(view)
}

func pending(key uintptr) *pendingDownload {
	downloadsMu.Lock()
	defer downloadsMu.Unlock()
	d := downloads[key]
	if d == nil {
		d = &pendingDownload{name: "download"}
		downloads[key] = d
	}
	return d
}

//export msDownloadDecide
func msDownloadDecide(download unsafe.Pointer, suggested *C.char) {
	key := uintptr(download)
	d := pending(key)
	name := safeDownloadName(C.GoString(suggested))
	downloadsMu.Lock()
	d.name = name
	downloadsDir := C.GoString(C.ms_downloads_dir())
	if home, err := os.UserHomeDir(); err == nil && downloadsDir == "" {
		downloadsDir = filepath.Join(home, "Downloads")
	}
	start := downloadStartDir(lastDownloadDir, downloadsDir, os.Getenv("FLATPAK_ID") != "")
	downloadsMu.Unlock()
	// The dialog waits for the person; WebKit waits for the destination meanwhile
	go func() {
		dest, err := "", errNoDownloadDialog
		if askSavePath != nil {
			dest, err = askSavePath(name, start)
		}
		tmp := ""
		if err == nil && dest != "" {
			tmp, err = downloadTempFile(name)
		}
		application.InvokeAsync(func() {
			downloadsMu.Lock()
			switch {
			case err != nil:
				d.err = err
			case dest == "":
				d.quiet = true
			default:
				d.dest, d.tmp = dest, tmp
			}
			downloadsMu.Unlock()
			if err != nil || dest == "" {
				C.ms_download_cancel(download)
				return
			}
			ctmp := C.CString(tmp)
			defer C.free(unsafe.Pointer(ctmp))
			C.ms_download_set_destination(download, ctmp)
		})
	}()
}

// downloadTempFile: a path for WebKit in a new folder below downloadsTemp
func downloadTempFile(name string) (string, error) {
	if err := os.MkdirAll(downloadsTemp, 0o700); err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp(downloadsTemp, "dl-")
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, name), nil
}

//export msDownloadFailed
func msDownloadFailed(download unsafe.Pointer, cancelled C.int, message *C.char) {
	d := pending(uintptr(download))
	downloadsMu.Lock()
	defer downloadsMu.Unlock()
	d.failed = true
	if d.err == nil && cancelled == 0 {
		d.err = errors.New(C.GoString(message))
	}
	if d.err == nil && !d.quiet {
		// Cancelled, but not by the dialog: the page or WebKit gave up
		d.err = errors.New("cancelled")
	}
}

//export msDownloadFinished
func msDownloadFinished(download unsafe.Pointer) {
	key := uintptr(download)
	downloadsMu.Lock()
	d := downloads[key]
	delete(downloads, key)
	downloadsMu.Unlock()
	if d == nil || d.quiet {
		if d != nil {
			removeDownloadTemp(d.tmp)
		}
		return
	}
	name := d.name
	if d.dest != "" {
		name = filepath.Base(shell.HostPath(d.dest))
	}
	if d.failed {
		slog.Warn("Desktop: download failed", "name", name, "error", d.err)
		removeDownloadTemp(d.tmp)
		evalInPage(downloadNotice(false, name))
		return
	}
	// Moving a large backup may take a moment; the window goes on meanwhile
	go func() {
		err := moveDownload(d.tmp, d.dest)
		removeDownloadTemp(d.tmp)
		if err != nil {
			slog.Warn("Desktop: saving a download failed", "name", name, "error", err)
		} else {
			downloadsMu.Lock()
			lastDownloadDir = filepath.Dir(shell.HostPath(d.dest))
			downloadsMu.Unlock()
		}
		application.InvokeAsync(func() { evalInPage(downloadNotice(err == nil, name)) })
	}()
}

// removeDownloadTemp: the folder of one download below downloadsTemp, whatever is left in it
func removeDownloadTemp(tmp string) {
	if tmp == "" {
		return
	}
	if dir := filepath.Dir(tmp); filepath.Dir(dir) == downloadsTemp {
		_ = os.RemoveAll(dir)
	}
}
