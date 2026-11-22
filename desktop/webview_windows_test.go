package main

import (
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The title follows every page on Windows, servers' too: the address comes from WebView2 (TopOrigin), the
// page only says that it was shown
func TestPageMessageTakesWebViewAddress(t *testing.T) {
	var got []string
	pageShown = func(a string) { got = append(got, a) }
	defer func() { pageShown = nil }()

	rawMessages(nil, pageMessage, &application.OriginInfo{Origin: "https://evil.example/", TopOrigin: "https://mind.example.com/notes/1"})
	rawMessages(nil, pageMessage, &application.OriginInfo{TopOrigin: "http://wails.localhost/__desktop/start"})
	// Other messages, a message without origin info or without an address change nothing
	rawMessages(nil, "mindsift:page:https://evil.example/", &application.OriginInfo{TopOrigin: "https://evil.example/"})
	rawMessages(nil, "something", &application.OriginInfo{TopOrigin: "https://evil.example/"})
	rawMessages(nil, pageMessage, nil)
	rawMessages(nil, pageMessage, &application.OriginInfo{})

	want := []string{"https://mind.example.com/notes/1", "http://wails.localhost/__desktop/start"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("addresses passed on: %q, want %q", got, want)
	}
	if !strings.Contains(pageScript, "chrome.webview.postMessage('"+pageMessage+"')") {
		t.Errorf("pageScript does not post the message: %s", pageScript)
	}
}
