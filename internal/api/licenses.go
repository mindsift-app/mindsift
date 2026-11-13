package api

import (
	"net/http"
	"os"
	"path/filepath"
)

// thirdPartyLicensesName: the licenses of the third-party software built into the server (npm packages of
// the app, Go modules, Go's standard library). The image build writes it next to the binary (/app/), the
// release archives carry it beside the binary too; a binary built by hand has none.
const thirdPartyLicensesName = "THIRD_PARTY_LICENSES.txt"

// defaultThirdPartyLicenses: the file next to the running binary, "" when the binary's path is unknown.
func defaultThirdPartyLicenses() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Join(filepath.Dir(exe), thirdPartyLicensesName)
}

// handleThirdPartyLicenses serves the license file as plain text, public like the app itself (the About
// part of the settings links it). 404 where there is none (development, a binary built by hand).
func (s *Server) handleThirdPartyLicenses(w http.ResponseWriter, r *http.Request) {
	if s.licensesFile == "" {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(s.licensesFile)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	// Changes only with a new version: the browser may keep it for a day and asks again after that
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeContent(w, r, thirdPartyLicensesName, info.ModTime(), f)
}
