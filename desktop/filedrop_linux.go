//go:build linux && cgo

package main

// Files dragged in from other programs (file manager) on Linux. WebKitGTK hands such a drop to the page only
// as a link whose address it hides (no "Files", empty dataTransfer.files, empty text/uri-list), so a note
// could never take a dropped image. A GTK drop target in front of WebKit's own takes drags of local files
// instead, reads the files when they are dropped and hands them to the page as the drag events a browser
// fires (__msFileDrag in dropScripts): the page handles them as in a browser. Everything else (text, links,
// the page's own drags) stays WebKit's. Only the user's own drop reaches this code, never a request of the
// page, and the page only ever gets the files dropped onto it.

/*
#cgo pkg-config: gtk4 webkitgtk-6.0
#include <gtk/gtk.h>
#include <webkit/webkit.h>
#include <stdlib.h>

extern int msFileDragMotion(char **paths, double x, double y);
extern void msFileDragLeave(void);
extern int msFileDrop(char **paths, double x, double y);

static WebKitWebView *ms_webview = NULL;

// The local paths of a file list (NULL-terminated, g_strfreev); NULL when it is empty or holds anything that
// is no local file (a link dragged out of a browser).
static char **ms_local_paths(const GValue *value) {
	if (value == NULL || !G_VALUE_HOLDS(value, GDK_TYPE_FILE_LIST)) return NULL;
	GSList *files = gdk_file_list_get_files(g_value_get_boxed(value));
	guint n = g_slist_length(files);
	if (n == 0) {
		g_slist_free(files);
		return NULL;
	}
	char **paths = g_new0(char *, n + 1);
	guint i = 0;
	for (GSList *l = files; l != NULL; l = l->next) {
		char *path = g_file_get_path(G_FILE(l->data));
		if (path == NULL) {
			g_slist_free(files);
			g_strfreev(paths);
			return NULL;
		}
		paths[i++] = path;
	}
	g_slist_free(files);
	return paths;
}

// Only drags that offer a list of addresses (file managers; sandboxed ones through the portal); their file
// list is read as soon as the drag enters (preload). Plain text never counts as a file name.
static gboolean ms_accept(GtkDropTarget *target, GdkDrop *drop, gpointer data) {
	GdkContentFormats *formats = gdk_drop_get_formats(drop);
	return gdk_content_formats_contain_mime_type(formats, "text/uri-list") ||
		gdk_content_formats_contain_mime_type(formats, "application/vnd.portal.filetransfer") ||
		gdk_content_formats_contain_mime_type(formats, "application/vnd.portal.files");
}

// Read: anything but local files (a link out of a browser) goes back to WebKit
static void ms_value_read(GtkDropTarget *target, GParamSpec *pspec, gpointer data) {
	const GValue *value = gtk_drop_target_get_value(target);
	if (value == NULL) return;
	char **paths = ms_local_paths(value);
	if (paths == NULL) gtk_drop_target_reject(target);
	g_strfreev(paths);
}

static GdkDragAction ms_motion(GtkDropTarget *target, double x, double y, gpointer data) {
	char **paths = ms_local_paths(gtk_drop_target_get_value(target));
	// Not read yet: nothing to drop here so far
	if (paths == NULL) return 0;
	int ok = msFileDragMotion(paths, x, y);
	g_strfreev(paths);
	return ok ? GDK_ACTION_COPY : 0;
}

static void ms_leave(GtkDropTarget *target, gpointer data) {
	msFileDragLeave();
}

static gboolean ms_drop(GtkDropTarget *target, const GValue *value, double x, double y, gpointer data) {
	char **paths = ms_local_paths(value);
	if (paths == NULL) return FALSE;
	int ok = msFileDrop(paths, x, y);
	g_strfreev(paths);
	return ok;
}

static GtkWidget *ms_find_webview(GtkWidget *widget) {
	if (widget == NULL) return NULL;
	if (WEBKIT_IS_WEB_VIEW(widget)) return widget;
	for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
		GtkWidget *found = ms_find_webview(child);
		if (found != NULL) return found;
	}
	return NULL;
}

// Puts the drop target in front of WebKit's own (capture phase) on the window's webview
static int ms_attach_file_drop(void *window) {
	GtkWidget *webview = ms_find_webview(GTK_WIDGET(window));
	if (webview == NULL) return 0;
	ms_webview = WEBKIT_WEB_VIEW(webview);
	GtkDropTarget *target = gtk_drop_target_new(GDK_TYPE_FILE_LIST, GDK_ACTION_COPY);
	gtk_drop_target_set_preload(target, TRUE);
	gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(target), GTK_PHASE_CAPTURE);
	g_signal_connect(target, "accept", G_CALLBACK(ms_accept), NULL);
	g_signal_connect(target, "notify::value", G_CALLBACK(ms_value_read), NULL);
	g_signal_connect(target, "motion", G_CALLBACK(ms_motion), NULL);
	g_signal_connect(target, "leave", G_CALLBACK(ms_leave), NULL);
	g_signal_connect(target, "drop", G_CALLBACK(ms_drop), NULL);
	gtk_widget_add_controller(webview, GTK_EVENT_CONTROLLER(target));
	return 1;
}

// Runs a script in the page directly: Wails' ExecJS waits for its runtime, which a page may not have
static void ms_eval(const char *js) {
	if (ms_webview != NULL) webkit_web_view_evaluate_javascript(ms_webview, js, -1, NULL, NULL, NULL, NULL, NULL);
}
*/
import "C"

import (
	"log/slog"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// setupFileDrop adds the drop target once the window's webview exists (its first page load).
func setupFileDrop(window *application.WebviewWindow) {
	var once sync.Once
	window.RegisterHook(events.Linux.WindowLoadFinished, func(*application.WindowEvent) {
		once.Do(func() {
			application.InvokeSync(func() {
				native := window.NativeWindow()
				if native == nil || C.ms_attach_file_drop(native) == 0 {
					slog.Warn("Desktop: no webview for dropped files")
				}
			})
		})
	})
}

// evalInPage runs js in the window's page; only on the main thread.
func evalInPage(js string) {
	cjs := C.CString(js)
	defer C.free(unsafe.Pointer(cjs))
	C.ms_eval(cjs)
}

func goPaths(paths **C.char) []string {
	var out []string
	for p := paths; *p != nil; p = (**C.char)(unsafe.Add(unsafe.Pointer(p), unsafe.Sizeof(*p))) {
		out = append(out, C.GoString(*p))
	}
	return out
}

//export msFileDragMotion
func msFileDragMotion(paths **C.char, x, y C.double) C.int {
	evalInPage(fileDragScript("over", float64(x), float64(y), describeFiles(goPaths(paths))))
	return 1
}

//export msFileDragLeave
func msFileDragLeave() {
	evalInPage(fileDragScript("leave", 0, 0, nil))
}

//export msFileDrop
func msFileDrop(paths **C.char, x, y C.double) C.int {
	files := goPaths(paths)
	// Reading the files may take a moment; the window goes on meanwhile
	go func() {
		js := fileDragScript("drop", float64(x), float64(y), readDroppedFiles(files))
		application.InvokeAsync(func() { evalInPage(js) })
	}()
	return 1
}
