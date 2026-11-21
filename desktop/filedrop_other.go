//go:build !linux || !cgo

package main

// Files dragged in from other programs: WebView2 on Windows hands them to the page itself, as a browser
// does (the drop target of filedrop_linux.go is only needed for WebKitGTK).
