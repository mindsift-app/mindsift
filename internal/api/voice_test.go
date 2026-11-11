package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
)

// fakeWhisper answers like speaches: model list and OpenAI-style transcriptions.
func fakeWhisper(t *testing.T, models []string, got *map[string]string, downloads *int32) *httptest.Server {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
			var data []map[string]string
			for _, m := range models {
				data = append(data, map[string]string{"id": m})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/models/"):
			atomic.AddInt32(downloads, 1)
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			if r.Header.Get("Authorization") != "Bearer geheim" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			_ = r.ParseMultipartForm(10 << 20)
			f, _, _ := r.FormFile("file")
			audio, _ := io.ReadAll(f)
			*got = map[string]string{"model": r.FormValue("model"), "language": r.FormValue("language"), "audio": string(audio)}
			_ = json.NewEncoder(w).Encode(map[string]string{"text": "  Hallo Welt, wie geht's?  "})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

func voiceUpload(t *testing.T, router http.Handler, token string, audio []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "aufnahme.webm")
	_, _ = fw.Write(audio)
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/voice/transcribe", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func voiceServer(t *testing.T, speech config.SpeechConfig) (*Server, string) {
	t.Helper()
	srv, _, token := setupTestServer(t)
	srv.cfg.Speech = speech
	srv.voice = newVoiceService(speech.MaxParallel)
	return srv, token
}

func TestVoiceTranscribeForwardsToWhisper(t *testing.T) {
	var got map[string]string
	var downloads int32
	whisper := fakeWhisper(t, []string{"Systran/faster-whisper-small"}, &got, &downloads)
	srv, token := voiceServer(t, config.SpeechConfig{URL: whisper.URL + "/v1", Model: "Systran/faster-whisper-small",
		APIKey: "geheim", MaxSeconds: 600, MaxUploadMB: 1, MaxParallel: 1, PerUserPerHour: 2, TimeoutSeconds: 10})
	router := srv.Router()

	rec := voiceUpload(t, router, token, []byte("RIFF-audio"))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"text":"Hallo Welt, wie geht's?"`) {
		t.Fatalf("transcribe: %d %s", rec.Code, rec.Body.String())
	}
	// No language chosen: Whisper detects it
	if got["model"] != "Systran/faster-whisper-small" || got["language"] != "" || got["audio"] != "RIFF-audio" {
		t.Fatalf("forwarded wrong data: %+v", got)
	}
	// Hourly budget per user
	_ = voiceUpload(t, router, token, []byte("x"))
	if rec := voiceUpload(t, router, token, []byte("x")); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("over the hourly budget: want 429, got %d", rec.Code)
	}
	// Model already there: the startup check reports ready and requests no download
	st := srv.checkVoice(context.Background())
	if !st.Reachable || !st.ModelReady || downloads != 0 {
		t.Fatalf("status %+v, downloads %d", st, downloads)
	}
	// Status for the login screen and the admin card, without the API key
	if body := sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String(); !strings.Contains(body, `"mode":"server"`) {
		t.Fatalf("auth status: %s", body)
	}
	body := sessionCall(router, "GET", "/api/v1/admin/voice", token, "", "").Body.String()
	if !strings.Contains(body, `"modelReady":true`) || strings.Contains(body, "geheim") {
		t.Fatalf("admin voice status: %s", body)
	}
}

// Whisper gets the person's own voice language or, with "app", their app language; without a choice
// and with "auto" it gets none and detects the language itself.
func TestVoiceLanguagePerPerson(t *testing.T) {
	var got map[string]string
	var downloads int32
	whisper := fakeWhisper(t, []string{"Systran/faster-whisper-small"}, &got, &downloads)
	for _, tc := range []struct{ app, voice, want string }{
		{"en", "", ""},
		{"en", "app", "en"},
		{"fr", "app", "fr"},
		{"en", "ru", "ru"},
		{"de", "auto", ""},
		{"de", "it", "it"},
	} {
		srv, token := voiceServer(t, config.SpeechConfig{URL: whisper.URL + "/v1", Model: "Systran/faster-whisper-small",
			APIKey: "geheim", MaxSeconds: 600, MaxUploadMB: 1, MaxParallel: 1, PerUserPerHour: 5, TimeoutSeconds: 10})
		user, err := srv.store.EnsureDefaultUser()
		if err != nil {
			t.Fatal(err)
		}
		if err := srv.store.SetLanguage(user.ID, tc.app); err != nil {
			t.Fatal(err)
		}
		if err := srv.store.SetVoiceLanguage(user.ID, tc.voice); err != nil {
			t.Fatal(err)
		}
		if rec := voiceUpload(t, srv.Router(), token, []byte("RIFF-audio")); rec.Code != http.StatusOK {
			t.Fatalf("app %q, voice %q: %d %s", tc.app, tc.voice, rec.Code, rec.Body.String())
		}
		if got["language"] != tc.want {
			t.Fatalf("app %q, voice %q: Whisper got language %q, want %q", tc.app, tc.voice, got["language"], tc.want)
		}
	}
}

func TestVoiceUploadLimitAndModes(t *testing.T) {
	var got map[string]string
	var downloads int32
	whisper := fakeWhisper(t, nil, &got, &downloads)
	srv, token := voiceServer(t, config.SpeechConfig{URL: whisper.URL, Model: "m", MaxUploadMB: 1, MaxParallel: 1, PerUserPerHour: 10, TimeoutSeconds: 10})
	if rec := voiceUpload(t, srv.Router(), token, bytes.Repeat([]byte("x"), 3<<20)); rec.Code != http.StatusRequestEntityTooLarge && rec.Code != http.StatusBadRequest {
		t.Fatalf("too large: want 413/400, got %d", rec.Code)
	}
	if st := srv.checkVoice(context.Background()); st.ModelReady || !st.Reachable {
		t.Fatalf("missing model must be reported: %+v", st)
	}

	if m := (config.SpeechConfig{URL: "http://whisper:8000"}).Mode(true); m != "browser" {
		t.Fatalf("demo must use the browser, got %s", m)
	}
	if m := (config.SpeechConfig{}).Mode(false); m != "browser" {
		t.Fatalf("without URL: browser, got %s", m)
	}
	if m := (config.SpeechConfig{URL: "x", Disabled: true}).Mode(false); m != "off" {
		t.Fatalf("disabled: off, got %s", m)
	}
	browserSrv, browserToken := voiceServer(t, config.SpeechConfig{MaxParallel: 1, PerUserPerHour: 10})
	if rec := voiceUpload(t, browserSrv.Router(), browserToken, []byte("x")); rec.Code != http.StatusNotFound {
		t.Fatalf("browser mode: want 404, got %d", rec.Code)
	}
}

func TestVoiceLanguageSetting(t *testing.T) {
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	for _, tc := range []struct {
		value string
		code  int
	}{{"ru", http.StatusOK}, {"auto", http.StatusOK}, {"app", http.StatusOK}, {"", http.StatusOK}, {"xx", http.StatusBadRequest}, {"de-DE", http.StatusBadRequest}} {
		rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", token, `{"voiceLanguage":"`+tc.value+`"}`, "")
		if rec.Code != tc.code {
			t.Fatalf("voiceLanguage %q: want %d, got %d %s", tc.value, tc.code, rec.Code, rec.Body.String())
		}
		if tc.code == http.StatusOK && !strings.Contains(rec.Body.String(), `"voiceLanguage":"`+tc.value+`"`) {
			t.Fatalf("voiceLanguage %q not in the answer: %s", tc.value, rec.Body.String())
		}
	}
}
