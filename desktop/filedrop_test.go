package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Audit 2026-11-22 F4: the page's drop function has a name of this start (a page cannot define it first),
// is defined read-only, and the drag events before the drop carry no file names.
func TestFileDropScripts(t *testing.T) {
	if !regexp.MustCompile(`^__msFileDrag_[0-9a-f]{24}$`).MatchString(fileDragName) {
		t.Fatalf("drop function name %q", fileDragName)
	}
	js := dropScripts()
	if strings.Contains(strings.ReplaceAll(js, fileDragName, ""), "__msFileDrag") {
		t.Error("the fixed name is left in the script")
	}
	if !strings.Contains(js, "Object.defineProperty(window,'"+fileDragName+"',{writable:false,configurable:false") {
		t.Error("the drop function is not defined read-only")
	}
	if !strings.HasPrefix(fileDragScript("over", 1, 2, nil), "window."+fileDragName+"&&window."+fileDragName+"(") {
		t.Errorf("call: %s", fileDragScript("over", 1, 2, nil))
	}

	dir := t.TempDir()
	secret := filepath.Join(dir, "Gehaltsabrechnung 2026.pdf")
	if err := os.WriteFile(secret, []byte("%PDF-1.7"), 0o600); err != nil {
		t.Fatal(err)
	}
	over := fileDragScript("over", 10, 20, describeFiles([]string{secret}))
	if strings.Contains(over, "Gehalt") || !strings.Contains(over, `"type":"application/pdf"`) {
		t.Errorf("drag over: %s", over)
	}
	drop := fileDragScript("drop", 10, 20, readDroppedFiles([]string{secret}))
	if !strings.Contains(drop, "Gehaltsabrechnung 2026.pdf") {
		t.Errorf("drop without the name: %s", drop)
	}
}
