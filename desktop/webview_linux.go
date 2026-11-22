//go:build linux && cgo

package main

// The window's WebKitGTK webview, reached directly: Wails has no navigation API (back, forward), its
// Reload loads wails:// instead of reloading the page, and its ExecJS waits for a message of its full
// runtime, which no page of this app sends. Also here: which pages get Wails' runtime (setupPages) and
// where WebKit keeps the window's storage (useWebviewDataDir).

/*
#cgo pkg-config: gtk4 webkitgtk-6.0
#include <gtk/gtk.h>
#include <webkit/webkit.h>
#include <stdlib.h>
#include <string.h>

static GtkWidget *ms_find_view(GtkWidget *widget) {
	if (widget == NULL) return NULL;
	if (WEBKIT_IS_WEB_VIEW(widget)) return widget;
	for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
		GtkWidget *found = ms_find_view(child);
		if (found != NULL) return found;
	}
	return NULL;
}

static void *ms_view_of_window(void *window) {
	return ms_find_view(GTK_WIDGET(window));
}

// The page's address; the caller frees it
static char *ms_view_uri(void *view) {
	const char *uri = webkit_web_view_get_uri(WEBKIT_WEB_VIEW(view));
	return g_strdup(uri != NULL ? uri : "");
}

static void ms_view_eval(void *view, const char *js) {
	webkit_web_view_evaluate_javascript(WEBKIT_WEB_VIEW(view), js, -1, NULL, NULL, NULL, NULL, NULL);
}

static void ms_view_back(void *view) { webkit_web_view_go_back(WEBKIT_WEB_VIEW(view)); }
static void ms_view_forward(void *view) { webkit_web_view_go_forward(WEBKIT_WEB_VIEW(view)); }
static void ms_view_reload(void *view) { webkit_web_view_reload(WEBKIT_WEB_VIEW(view)); }

// --- The webview's storage ---------------------------------------------------------------------------
//
// WebKit keeps a webview's local storage, IndexedDB, cookies, service workers and caches in its network
// session; Wails creates the webview with the default session, whose folders follow the program's name
// below ~/.local/share and ~/.cache. The webview's network-session property is construct-only and Wails
// sets nothing there, so the class's constructor is wrapped once GTK is up (the application's startup,
// before its windows): a webview created without a session (and without a related view, which brings its
// own) gets one with folders in the app's base folder.

static char *ms_data_dir = NULL;
static char *ms_cache_dir = NULL;
static char *ms_cookie_file = NULL;
static WebKitNetworkSession *ms_session = NULL;
static GObject *(*ms_parent_constructor)(GType, guint, GObjectConstructParam *) = NULL;

static WebKitNetworkSession *ms_own_session(void) {
	if (ms_session == NULL) {
		ms_session = webkit_network_session_new(ms_data_dir, ms_cache_dir);
		WebKitCookieManager *cookies = webkit_network_session_get_cookie_manager(ms_session);
		webkit_cookie_manager_set_persistent_storage(cookies, ms_cookie_file, WEBKIT_COOKIE_PERSISTENT_STORAGE_SQLITE);
	}
	return ms_session;
}

static GObject *ms_view_constructor(GType type, guint n, GObjectConstructParam *params) {
	int session = -1;
	gboolean related = FALSE;
	for (guint i = 0; i < n; i++) {
		const char *name = params[i].pspec->name;
		if (strcmp(name, "network-session") == 0 && g_value_get_object(params[i].value) == NULL) session = (int)i;
		if (strcmp(name, "related-view") == 0 && g_value_get_object(params[i].value) != NULL) related = TRUE;
	}
	if (session < 0 || related) return ms_parent_constructor(type, n, params);
	// The parameters as given, with the session replaced (their values belong to g_object_new)
	GObjectConstructParam *own = g_new(GObjectConstructParam, n);
	memcpy(own, params, sizeof(GObjectConstructParam) * n);
	GValue value = G_VALUE_INIT;
	g_value_init(&value, WEBKIT_TYPE_NETWORK_SESSION);
	g_value_set_object(&value, ms_own_session());
	own[session].value = &value;
	GObject *obj = ms_parent_constructor(type, n, own);
	g_value_unset(&value);
	g_free(own);
	return obj;
}

static gboolean ms_patch_view_class(GSignalInvocationHint *hint, guint n, const GValue *values, gpointer data) {
	GObjectClass *klass = G_OBJECT_CLASS(g_type_class_ref(WEBKIT_TYPE_WEB_VIEW));
	if (ms_parent_constructor == NULL) {
		ms_parent_constructor = klass->constructor;
		klass->constructor = ms_view_constructor;
	}
	return FALSE; // once
}

static void ms_use_data_dir(const char *data, const char *cache, const char *cookies) {
	ms_data_dir = g_strdup(data);
	ms_cache_dir = g_strdup(cache);
	ms_cookie_file = g_strdup(cookies);
	g_type_class_ref(G_TYPE_APPLICATION);
	guint startup = g_signal_lookup("startup", G_TYPE_APPLICATION);
	// Emission hooks run after GApplication's own startup handler (RUN_FIRST), which initialises GTK
	g_signal_add_emission_hook(startup, 0, ms_patch_view_class, NULL, NULL);
}
*/
import "C"

import (
	"log/slog"
	"path/filepath"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
)

// webView: the window's WebKitWebView, found at the first page load; only used on the main thread
var webView unsafe.Pointer

// useWebviewDataDir keeps the webview's storage (local storage, IndexedDB, cookies, service workers) in
// dir and its caches in dir/cache, whatever the program's file is called. Before app.Run.
func useWebviewDataDir(dir string) {
	data, cache, cookies := C.CString(dir), C.CString(filepath.Join(dir, "cache")), C.CString(filepath.Join(dir, "cookies.sqlite"))
	defer C.free(unsafe.Pointer(data))
	defer C.free(unsafe.Pointer(cache))
	defer C.free(unsafe.Pointer(cookies))
	C.ms_use_data_dir(data, cache, cookies)
}

// setupPages runs after every page load, before Wails: the window's own pages get Wails' runtime and the
// window's scripts as Wails gives them (the JS option); any other page (a server's) gets only the scripts
// and the marker (shellMarker, no way into the app).
// The hook comes first, so cancelling the event keeps Wails' runtime hook, the JS option and the event's
// listeners away from that page. The first load also finds the webview (and adds the drop target for files,
// filedrop_linux.go). navigated gets the address of every page shown (history included), for the title.
func setupPages(window *application.WebviewWindow, origin, scripts, marker string, navigated func(address string)) {
	var once sync.Once
	window.RegisterHook(events.Linux.WindowLoadFinished, func(e *application.WindowEvent) {
		address := ""
		own := application.InvokeSyncWithResult(func() bool {
			once.Do(func() {
				native := window.NativeWindow()
				if native != nil {
					webView = C.ms_view_of_window(native)
				}
				if webView == nil {
					slog.Warn("Desktop: the window's webview was not found")
					return
				}
				attachFileDrop(webView)
			})
			if webView == nil {
				return true // nothing to decide without the webview; Wails' own way
			}
			uri := C.ms_view_uri(webView)
			defer C.g_free(C.gpointer(uri))
			address = C.GoString(uri)
			own := shell.OwnPage(address, origin)
			if !own {
				evalInPage(marker + scripts)
			}
			return own
		})
		if address != "" && navigated != nil {
			navigated(address)
		}
		if !own {
			e.Cancel()
		}
	})
}

// rawMessages: Wails' RawMessageHandler; none on Linux, setupPages reads every page's address itself
var rawMessages func(application.Window, string, *application.OriginInfo)

// currentURI: the address of the window's page ("" without the webview); only on the main thread.
func currentURI() string {
	if webView == nil {
		return ""
	}
	uri := C.ms_view_uri(webView)
	defer C.g_free(C.gpointer(uri))
	return C.GoString(uri)
}

// evalInPage runs js in the window's page; only on the main thread.
func evalInPage(js string) {
	if webView == nil {
		return
	}
	cjs := C.CString(js)
	defer C.free(unsafe.Pointer(cjs))
	C.ms_view_eval(webView, cjs)
}

func onView(f func(unsafe.Pointer)) {
	application.InvokeAsync(func() {
		if webView != nil {
			f(webView)
		}
	})
}

// The window's history and reload, for the key bindings; on any page, the window's own or a server's
func goBack(application.Window)    { onView(func(v unsafe.Pointer) { C.ms_view_back(v) }) }
func goForward(application.Window) { onView(func(v unsafe.Pointer) { C.ms_view_forward(v) }) }
func reload(application.Window)    { onView(func(v unsafe.Pointer) { C.ms_view_reload(v) }) }
