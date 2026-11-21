//go:build !linux || !cgo

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// setupFileDrop: on Windows WebView2 hands dropped files to the page itself (see dropScripts).
func setupFileDrop(*application.WebviewWindow) {}
