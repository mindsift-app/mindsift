package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4)), nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func imgB64(data []byte) string { return base64.StdEncoding.EncodeToString(data) }

// bulletByID returns the bullet with this id from a get_note-like result.
func bulletByID(t *testing.T, res map[string]any, id string) map[string]any {
	t.Helper()
	bullets, _ := res["bullets"].([]any)
	for _, b := range bullets {
		if m := b.(map[string]any); m["id"] == id {
			return m
		}
	}
	t.Fatalf("bullet %s not in %v", id, res["bullets"])
	return nil
}

// add_note_image stores the file like an upload and inserts an image bullet like the editor.
func TestMCPAddNoteImage(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxImageMB = 1
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	doc, err := store.CreateDocument(claims.UserID, "", "Bilder", "", "", []domain.DocumentBlock{
		{ID: "blk_im1", Type: "text", Content: "Eins", Level: 0},
		{ID: "blk_im2", Type: "text", Content: "Zwei", Level: 0},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}

	// PNG at the end, with a caption
	png := tinyPNG(t, 0)
	res, isErr, msg := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"`+imgB64(png)+`","caption":"Ein [Bild]"}`)
	if isErr {
		t.Fatalf("png: %s", msg)
	}
	pngBullet, _ := res["addedId"].(string)
	mediaID, _ := res["mediaId"].(string)
	b := bulletByID(t, res, pngBullet)
	if b["type"] != "image" || b["text"] != `![Ein [Bild\]](media:`+mediaID+`)` {
		t.Fatalf("image bullet: %v", b)
	}
	ref, ok := storage.ParseMediaContent(b["text"].(string))
	if !ok || ref.ID != mediaID || ref.Caption != "Ein [Bild]" {
		t.Fatalf("content must render as an image: %+v %v", ref, ok)
	}
	m, err := store.GetMedia(mediaID)
	if err != nil || m.DocID != doc.ID || m.OwnerID != claims.UserID || m.Mime != "image/png" || m.Kind != "image" {
		t.Fatalf("media row: %+v %v", m, err)
	}
	if onDisk, err := os.ReadFile(srv.mediaPath(m)); err != nil || !bytes.Equal(onDisk, png) {
		t.Fatalf("file on disk: %v", err)
	}
	// The owner reads it like any uploaded file
	if rec := sessionCall(srv.Router(), "GET", "/api/v1/media/"+mediaID, token, "", ""); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("read back: %d", rec.Code)
	}

	// JPEG as a data: URL, right after the first bullet; another one as a child of the second
	res, isErr, msg = call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"data:image/jpeg;base64,`+imgB64(tinyJPEG(t))+`","afterId":"blk_im1"}`)
	if isErr {
		t.Fatalf("jpeg: %s", msg)
	}
	jpegBullet := res["addedId"].(string)
	if jm, _ := store.GetMedia(res["mediaId"].(string)); jm == nil || jm.Mime != "image/jpeg" {
		t.Fatalf("jpeg media: %+v", jm)
	}
	res, isErr, msg = call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"`+imgB64(png)+`","parentId":"blk_im2"}`)
	if isErr {
		t.Fatalf("child: %s", msg)
	}
	childBullet := res["addedId"].(string)
	var order []string
	for _, x := range res["bullets"].([]any) {
		bm := x.(map[string]any)
		order = append(order, fmt.Sprintf("%v@%v", bm["id"], bm["level"]))
	}
	want := []string{"blk_im1@0", jpegBullet + "@0", "blk_im2@0", childBullet + "@1", pngBullet + "@0"}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Fatalf("placement:\n got %v\nwant %v", order, want)
	}
	// get_note shows the images as placeholders with their caption
	got, _, _ := call(key.RawKey, "get_note", `{"id":"`+doc.ID+`"}`)
	if c, _ := got["content"].(string); !strings.Contains(c, "Bild: Ein [Bild]") {
		t.Fatalf("get_note content: %q", c)
	}

	// Wrong types: SVG, a script, text, audio; broken base64; none or both of data and url
	for name, args := range map[string]string{
		"svg":    `"data":"` + imgB64([]byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`)) + `"`,
		"script": `"data":"` + imgB64([]byte("#!/bin/sh\nrm -rf /")) + `"`,
		"text":   `"data":"` + imgB64([]byte("Hallo Welt")) + `"`,
		"audio":  `"data":"` + imgB64(append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 40)...)) + `"`,
		"base64": `"data":"kein base64!"`,
		"none":   `"caption":"x"`,
		"both":   `"data":"` + imgB64(png) + `","url":"https://example.com/a.png"`,
	} {
		if _, isErr, msg := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`",`+args+`}`); !isErr || strings.Contains(msg, "Internal error") {
			t.Errorf("%s: want a clear tool error, got %v %s", name, isErr, msg)
		}
	}
	// Too large: a clear tool error naming the limit
	if _, isErr, msg := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"`+imgB64(tinyPNG(t, 1<<20+10))+`"}`); !isErr || !strings.Contains(msg, "at most 1 MB") {
		t.Fatalf("too large: %v %s", isErr, msg)
	}
	// A request beyond the MCP body limit gets a JSON-RPC error saying why
	big := strings.Repeat("A", int(srv.mcpBodyLimit())+10)
	_, out := rpc(t, srv.Router(), key.RawKey, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_note_image","arguments":{"noteId":"`+doc.ID+`","data":"`+big+`"}}}`)
	if e, _ := out["error"].(map[string]any); e == nil || !strings.Contains(e["message"].(string), "Request too large") {
		t.Fatalf("over the body limit: %v", out)
	}
	// Bad placement or unknown note: nothing stored
	before, _ := store.MediaUsage(claims.UserID)
	if _, isErr, _ := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"`+imgB64(png)+`","afterId":"blk_nope"}`); !isErr {
		t.Fatal("unknown afterId must fail")
	}
	if _, isErr, msg := call(key.RawKey, "add_note_image", `{"noteId":"doc_nope","data":"`+imgB64(png)+`"}`); !isErr || !strings.Contains(strings.ToLower(msg), "not found") {
		t.Fatalf("unknown note: %v %s", isErr, msg)
	}
	if after, _ := store.MediaUsage(claims.UserID); after != before {
		t.Fatalf("failed calls stored files: %d -> %d", before, after)
	}

	// Only with notes:write, and only on notes the user may edit
	reader, _ := store.CreateAPIKey(claims.UserID, "Leser", []string{"notes:read"})
	if _, isErr, _ := call(reader.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"`+imgB64(png)+`"}`); !isErr {
		t.Fatal("notes:read must not add images")
	}
	other, _ := newTestUser(t, store, "leserin@example.com")
	if _, err := store.CreateDocShare(claims.UserID, doc.ID, other.ID, "read"); err != nil {
		t.Fatal(err)
	}
	otherKey, _ := store.CreateAPIKey(other.ID, "Agent", []string{"notes:read", "notes:write"})
	if _, isErr, msg := call(otherKey.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","data":"`+imgB64(png)+`"}`); !isErr || !strings.Contains(msg, "write") {
		t.Fatalf("read-only share: %v %s", isErr, msg)
	}
	if used, _ := store.MediaUsage(other.ID); used != 0 {
		t.Fatalf("read-only share stored a file: %d", used)
	}
}

// url copies the image the way the editor does: the guard refuses http and the server's own network.
func TestMCPAddNoteImageFromURL(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxImageMB = 1
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	doc, _ := store.CreateDocument(claims.UserID, "", "Kopie", "", "", nil, nil, false)

	for _, u := range []string{
		"http://example.com/bild.png",
		"https://127.0.0.1/bild.png",
		"https://10.0.0.1/bild.png",
		"https://[::1]/bild.png",
		"https://localhost:1/bild.png", // resolves to loopback: refused when connecting
		"ftp://example.com/bild.png",
	} {
		if _, isErr, msg := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","url":"`+u+`"}`); !isErr || strings.Contains(msg, "Internal error") {
			t.Errorf("%s: want a clear refusal, got %v %s", u, isErr, msg)
		}
	}
	if used, _ := store.MediaUsage(claims.UserID); used != 0 {
		t.Fatalf("refused addresses stored a file: %d", used)
	}

	// A public https server (here a local one the test client reaches as example.com)
	png := tinyPNG(t, 0)
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bild.png":
			_, _ = w.Write(png)
		default:
			_, _ = w.Write([]byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))
		}
	}))
	defer ts.Close()
	orig := mediaFetchClient
	defer func() { mediaFetchClient = orig }()
	mediaFetchClient = func() *http.Client {
		c := ts.Client()
		tr := c.Transport.(*http.Transport).Clone()
		tr.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, ts.Listener.Addr().String())
		}
		tr.TLSClientConfig.ServerName = "example.com"
		c.Transport = tr
		return c
	}
	res, isErr, msg := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","url":"https://example.com/bild.png","caption":"Kopiert"}`)
	if isErr {
		t.Fatalf("copy: %s", msg)
	}
	m, err := store.GetMedia(res["mediaId"].(string))
	if err != nil || m.Mime != "image/png" || m.SourceURL != "https://example.com/bild.png" {
		t.Fatalf("copied media: %+v %v", m, err)
	}
	if b := bulletByID(t, res, res["addedId"].(string)); b["type"] != "image" || b["text"] != "![Kopiert](media:"+m.ID+")" {
		t.Fatalf("copied bullet: %v", b)
	}
	if _, isErr, _ := call(key.RawKey, "add_note_image", `{"noteId":"`+doc.ID+`","url":"https://example.com/bild.svg"}`); !isErr {
		t.Fatal("an SVG behind a URL must be refused")
	}
}

// Only a few large MCP requests at a time: the next one gets a busy error before its body is read, small
// ones go on. The image tool names the server's own limit.
func TestMCPLargeRequestGate(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxImageMB = 7
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	doc, _ := store.CreateDocument(claims.UserID, "", "Gate", "", "", nil, nil, false)

	_, list := rpc(t, srv.Router(), key.RawKey, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	found := false
	for _, tl := range list["result"].(map[string]any)["tools"].([]any) {
		if m := tl.(map[string]any); m["name"] == "add_note_image" {
			desc := m["description"].(string)
			found = strings.Contains(desc, "at most 7 MB per image") && !strings.Contains(desc, mcpImageLimitText)
		}
	}
	if !found {
		t.Fatal("add_note_image must name the server's image limit (7 MB)")
	}

	big := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_note_image","arguments":{"noteId":"` + doc.ID + `","data":"` + imgB64(tinyPNG(t, 3<<20)) + `"}}}`
	for range maxMCPLargeRunning {
		if !srv.mcpLarge.enter() {
			t.Fatal("gate refused a free place")
		}
	}
	_, out := rpc(t, srv.Router(), key.RawKey, big)
	if e, _ := out["error"].(map[string]any); e == nil || e["code"] != float64(rpcServerBusy) || !strings.Contains(e["message"].(string), "try again") {
		t.Fatalf("busy: want a JSON-RPC busy error, got %v", out)
	}
	// Small requests are not held back
	if _, isErr, msg := call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"klein"}`); isErr {
		t.Fatalf("small request while busy: %s", msg)
	}
	srv.mcpLarge.leave()
	_, out = rpc(t, srv.Router(), key.RawKey, big)
	if res, ok := out["result"].(map[string]any); !ok || res["isError"] == true {
		t.Fatalf("with a free place the image goes in: %v", out)
	}
	srv.mcpLarge.leave()
	if srv.mcpLarge.running != 0 {
		t.Fatalf("every request gives its place back: %d", srv.mcpLarge.running)
	}

	// The tools get the request's context: a client that went away changes nothing
	before, _, _ := call(key.RawKey, "get_note", `{"id":"`+doc.ID+`"}`)
	tool, _ := mcpToolByName("add_note_bullet")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := tool.run(ctx, srv, claims.UserID, &apiActor{}, json.RawMessage(`{"noteId":"`+doc.ID+`","text":"weg"}`)); err == nil {
		t.Fatal("a cancelled request must not change the note")
	}
	if after, _, _ := call(key.RawKey, "get_note", `{"id":"`+doc.ID+`"}`); len(bulletTexts(after)) != len(bulletTexts(before)) {
		t.Fatalf("bullets: %v -> %v", bulletTexts(before), bulletTexts(after))
	}
}
