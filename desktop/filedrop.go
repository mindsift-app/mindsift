package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Dropped files the shell hands to the page (filedrop_linux.go): at most this much in all; larger files are
// left out (the page then sees fewer files), the server's own limits apply to the rest.
const maxDroppedBytes = 64 << 20

// droppedFile: one dropped file as the page gets it; Data (base64) only in the drop itself.
type droppedFile struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
}

// describeFiles: names and types of dragged files, for the drag events while the pointer moves.
func describeFiles(paths []string) []droppedFile {
	out := make([]droppedFile, 0, len(paths))
	for _, p := range paths {
		out = append(out, droppedFile{Name: filepath.Base(p), Type: mime.TypeByExtension(strings.ToLower(filepath.Ext(p)))})
	}
	return out
}

// readDroppedFiles: the dropped regular files with their content (folders and unreadable files are left
// out); the type by the file name, else by the content.
func readDroppedFiles(paths []string) []droppedFile {
	var out []droppedFile
	total := 0
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if total+int(info.Size()) > maxDroppedBytes {
			slog.Warn("Desktop: dropped file left out, too large", "size", info.Size())
			continue
		}
		data, err := os.ReadFile(p)
		if err != nil {
			slog.Warn("Desktop: dropped file not readable", "error", err)
			continue
		}
		total += len(data)
		f := describeFiles([]string{p})[0]
		if f.Type == "" {
			f.Type, _, _ = strings.Cut(http.DetectContentType(data), ";")
		}
		f.Data = base64.StdEncoding.EncodeToString(data)
		out = append(out, f)
	}
	return out
}

// fileDragScript: the call of fileDropScript for one step of a file drag ("over", "leave", "drop") at x, y
// (CSS pixels in the window).
func fileDragScript(kind string, x, y float64, files []droppedFile) string {
	if files == nil {
		files = []droppedFile{}
	}
	data, _ := json.Marshal(files)
	return fmt.Sprintf("window.__msFileDrag&&window.__msFileDrag(%q,%g,%g,%s)", kind, x, y, data)
}

// dropScripts run after every page load (the window's JS option), after Wails' runtime.
//
// The runtime listens for file drags on the document element and, with Wails' own file drop off, sets every
// one to "none" after the page has handled it: a note's "copy" was overwritten and the drop never came
// (WebView2 on Windows; on Linux files come through fileDropScript). The page's effect goes back after it.
//
// __msFileDrag fires the drag events a browser fires for files dragged in from another program
// (filedrop_linux.go): dragenter, dragover and dragleave as the pointer moves, dragover and drop with the
// files' content at the end. Only the page's own handlers act on them, as in a browser. WebKit's own events
// for the same drag (a link with a hidden address) do not reach the page meanwhile.
const dropScripts = `(function(){if(window.__msFileDrag)return;
var kept=null;
function hasFiles(e){return e.dataTransfer&&Array.from(e.dataTransfer.types||[]).indexOf('Files')>=0}
['dragenter','dragover'].forEach(function(t){
document.body&&document.body.addEventListener(t,function(e){kept=hasFiles(e)&&e.defaultPrevented?{e:e,effect:e.dataTransfer.dropEffect}:null});
document.addEventListener(t,function(e){if(kept&&kept.e===e)e.dataTransfer.dropEffect=kept.effect;kept=null})});
var last=null,active=false;
['dragenter','dragover','dragleave','drop'].forEach(function(t){window.addEventListener(t,function(e){
if(!active||!e.isTrusted)return;e.stopImmediatePropagation();if(t!=='dragleave'){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy'}},true)});
function transfer(files){var d=new DataTransfer();files.forEach(function(f){var parts=[];if(f.data){var s=atob(f.data),a=new Uint8Array(s.length);for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);parts=[a]}d.items.add(new File(parts,f.name,{type:f.type||''}))});try{d.effectAllowed='copy'}catch(x){}return d}
function fire(type,el,x,y,d,rel){var e=new DragEvent(type,{bubbles:true,cancelable:type!=='dragleave',composed:true,clientX:x,clientY:y,dataTransfer:d,relatedTarget:rel||null});el.dispatchEvent(e);return e}
window.__msFileDrag=function(kind,x,y,files){
if(kind==='leave'){active=false;if(last&&last.isConnected)fire('dragleave',last,x,y,transfer([]),null);last=null;return}
active=kind==='over';
var el=document.elementFromPoint(x,y)||document.documentElement,d=transfer(files);
if(el!==last){if(last&&last.isConnected)fire('dragleave',last,x,y,d,el);fire('dragenter',el,x,y,d,last);last=el}
fire('dragover',el,x,y,d);
if(kind==='drop'){fire('drop',el,x,y,d);last=null}};})();`
