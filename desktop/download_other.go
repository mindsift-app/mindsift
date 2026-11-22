//go:build !(linux && cgo)

package main

// Windows: WebView2 handles downloads itself (its download bar, saved into the Downloads folder or where it
// asks), so the app leaves them alone. See download_linux.go for WebKitGTK.
func setupDownloads(string, func(name, dir string) (string, error)) {}
