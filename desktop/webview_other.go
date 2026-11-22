//go:build !windows && !(linux && cgo)

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// Neither Linux with WebKitGTK nor Windows: Wails' own ways (the spike builds only for those two).

func useWebviewDataDir(string) {}

func setupPages(*application.WebviewWindow, string, string, string, func(string)) {}

func goBack(w application.Window)               { w.ExecJS("history.back()") }
func goForward(w application.Window)            { w.ExecJS("history.forward()") }
func reload(w application.Window)               { w.Reload() }
func runInPage(w application.Window, js string) { w.ExecJS(js) }
