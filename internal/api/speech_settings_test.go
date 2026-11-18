package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// modelWhisper: a speaches-like server with a list of downloaded models; POST /v1/models/{id} downloads
// one (waits on release when given).
type modelWhisper struct {
	mu      sync.Mutex
	local   []string
	release chan struct{}
	auth    string
	posts   []string // models asked for
	deletes []string // models deleted
}

func (f *modelWhisper) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.auth = r.Header.Get("Authorization")
		f.mu.Unlock()
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
			f.mu.Lock()
			data := []map[string]string{}
			for _, id := range f.local {
				data = append(data, map[string]string{"id": id, "task": "automatic-speech-recognition"})
			}
			f.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/models/"):
			f.mu.Lock()
			f.posts = append(f.posts, strings.TrimPrefix(r.URL.Path, "/v1/models/"))
			f.mu.Unlock()
			if f.release != nil {
				<-f.release
			}
			f.mu.Lock()
			f.local = append(f.local, strings.TrimPrefix(r.URL.Path, "/v1/models/"))
			f.mu.Unlock()
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/v1/models/"):
			id := strings.TrimPrefix(r.URL.Path, "/v1/models/")
			f.mu.Lock()
			defer f.mu.Unlock()
			i := slices.Index(f.local, id)
			if i < 0 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			f.local = slices.Delete(f.local, i, i+1)
			f.deletes = append(f.deletes, id)
			_ = json.NewEncoder(w).Encode(map[string]string{"detail": "Model '" + id + "' deleted"})
		default:
			http.NotFound(w, r)
		}
	})
}

// Voice input from the administration: mode, Whisper server and key (never shown, recorded without
// value), model and limits, each fixed by its STT_* variable; and the models: which are downloaded, a
// download with its state, the model in use once it is there.
func TestSpeechSettingsAndModels(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Speech = config.SpeechConfig{}
	router := srv.Router()
	fake := &modelWhisper{local: []string{"Systran/faster-whisper-small"}, release: make(chan struct{})}
	whisper := httptest.NewServer(fake.handler())
	defer whisper.Close()
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	put := func(speech string) *httptest.ResponseRecorder {
		return sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","speech":`+speech+`}`, "")
	}

	if !strings.Contains(status(), `"mode":"browser"`) {
		t.Fatalf("without a Whisper server the browser: %s", status())
	}
	rec := put(`{"mode":"server","url":"` + whisper.URL + `","apiKey":"geheim-123","model":"Systran/faster-whisper-small","maxSeconds":120,"maxParallel":2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(status(), `"voice":{"browserAllowed":true,"chunkSeconds":8,"chunked":true,"maxSeconds":120,"mode":"server"}`) {
		t.Fatalf("server mode from the administration: %s", status())
	}
	body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String()
	if strings.Contains(body, "geheim-123") || !strings.Contains(body, `"apiKeySet":true`) {
		t.Fatalf("the key is never shown: %s", body)
	}
	if e := lastAudit(t, store, storage.AuditSettingsChanged); strings.Contains(string(e.Details), "geheim") || !strings.Contains(string(e.Details), `"key":"speech.model"`) {
		t.Fatalf("audit without the key: %s", e.Details)
	}
	if sys, _ := store.GetSystemSettings(); sys.Speech.APIKey != "geheim-123" {
		t.Fatalf("stored key: %q", sys.Speech.APIKey)
	}
	// Saving without a key keeps it; the server sends it to Whisper
	put(`{"mode":"server","url":"` + whisper.URL + `","model":"Systran/faster-whisper-small"}`)
	sessionCall(router, "GET", "/api/v1/admin/voice/models", token, "", "")
	if fake.auth != "Bearer geheim-123" {
		t.Fatalf("key sent to Whisper: %q", fake.auth)
	}
	for _, bad := range []string{`{"mode":"radio"}`, `{"url":"ftp://x"}`, `{"model":"../etc"}`, `{"maxSeconds":2}`, `{"chunkSeconds":1}`, `{"chunkSeconds":31}`} {
		if rec := put(bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", bad, rec.Code)
		}
	}

	// The models: the known ones and the downloaded one, which is marked
	var models struct {
		Model  string `json:"model"`
		Models []struct {
			ID         string `json:"id"`
			Downloaded bool   `json:"downloaded"`
		} `json:"models"`
		Downloads []modelDownload `json:"downloads"`
	}
	getModels := func() {
		t.Helper()
		rec := sessionCall(router, "GET", "/api/v1/admin/voice/models", token, "", "")
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &models) != nil {
			t.Fatalf("models: %d %s", rec.Code, rec.Body.String())
		}
	}
	getModels()
	downloaded := map[string]bool{}
	for _, m := range models.Models {
		downloaded[m.ID] = m.Downloaded
	}
	if !downloaded["Systran/faster-whisper-small"] || downloaded["Systran/faster-whisper-medium"] || len(models.Models) < 5 {
		t.Fatalf("models list: %+v", models)
	}
	// A download: running until the Whisper server answers, then the model in use
	rec = sessionCall(router, "POST", "/api/v1/admin/voice/models/Systran/faster-whisper-medium", token, `{"select":true}`, "")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("download: %d %s", rec.Code, rec.Body.String())
	}
	if e := lastAudit(t, store, storage.AuditSpeechModelDownload); e.TargetKind != storage.AuditTargetSpeechModel || e.TargetName != "Systran/faster-whisper-medium" || string(e.Details) != `{"select":true}` {
		t.Fatalf("download in the audit log: %+v %s", e, e.Details)
	}
	getModels()
	if len(models.Downloads) != 1 || !models.Downloads[0].Running || models.Model != "Systran/faster-whisper-small" {
		t.Fatalf("while downloading: %+v", models)
	}
	close(fake.release)
	deadline := time.Now().Add(5 * time.Second)
	for {
		getModels()
		if len(models.Downloads) == 1 && !models.Downloads[0].Running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("download did not finish: %+v", models)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if models.Model != "Systran/faster-whisper-medium" || models.Downloads[0].Error != "" {
		t.Fatalf("after the download the model is in use: %+v", models)
	}
	// The switch after the download counts as a change by the admin who asked for it
	admin, _ := store.GetFirstUser()
	if e := lastAudit(t, store, storage.AuditSettingsChanged); e.ActorID != admin.ID || string(e.Details) != `{"changes":[{"key":"speech.model","from":"Systran/faster-whisper-small","to":"Systran/faster-whisper-medium"}]}` {
		t.Fatalf("model in use after the download in the audit log: %+v %s", e, e.Details)
	}
	// An already downloaded one is chosen at once
	if rec := sessionCall(router, "POST", "/api/v1/admin/voice/models/Systran/faster-whisper-small", token, `{"select":true}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("choose a downloaded model: %d", rec.Code)
	}
	if srv.speech().Model != "Systran/faster-whisper-small" {
		t.Fatalf("chosen: %q", srv.speech().Model)
	}
	if e := lastAudit(t, store, storage.AuditSettingsChanged); string(e.Details) != `{"changes":[{"key":"speech.model","from":"Systran/faster-whisper-medium","to":"Systran/faster-whisper-small"}]}` {
		t.Fatalf("choosing a downloaded model in the audit log: %s", e.Details)
	}

	// STT_* fixes its field: shown, locked, what the administration sends is not stored
	off := false
	srv.cfg.Speech = config.SpeechConfig{Model: "Systran/faster-whisper-large-v3", MaxSeconds: 30, NoBrowser: true, VADFilter: &off}
	put(`{"mode":"server","url":"` + whisper.URL + `","model":"andere/modell","maxSeconds":99,"allowBrowser":true,"vadFilter":true}`)
	body = sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String()
	for _, want := range []string{`"model":"Systran/faster-whisper-large-v3"`, `"maxSeconds":30`, `"allowBrowser":false`, `"vadFilter":false`, `"configuredViaEnv":["allowBrowser","model","maxSeconds","vadFilter"]`} {
		if !strings.Contains(body, want) {
			t.Fatalf("env lock, want %s: %s", want, body)
		}
	}
	if sys, _ := store.GetSystemSettings(); sys.Speech.Model != "Systran/faster-whisper-small" || sys.Speech.MaxSeconds == 99 {
		t.Fatalf("stored values stay: %+v", sys.Speech)
	}
	if rec := sessionCall(router, "POST", "/api/v1/admin/voice/models/Systran/faster-whisper-small", token, `{"select":true}`, ""); rec.Code != http.StatusConflict {
		t.Fatalf("STT_MODEL fixes the model: %d", rec.Code)
	}
	// STT_DISABLED switches voice input off whatever the administration chose
	srv.cfg.Speech = config.SpeechConfig{Disabled: true}
	if !strings.Contains(status(), `"mode":"off"`) {
		t.Fatalf("STT_DISABLED: %s", status())
	}
	// The browser chosen in the administration, the Whisper server stays entered
	srv.cfg.Speech = config.SpeechConfig{}
	put(`{"mode":"browser","url":"` + whisper.URL + `"}`)
	if !strings.Contains(status(), `"mode":"browser"`) {
		t.Fatalf("browser chosen: %s", status())
	}
}

// Entering the Whisper server in the administration only checks it: the model is chosen there, the
// default (large) model is not fetched on its own. A model still downloading does not count as there,
// although speaches lists it from the start of its download.
func TestSavingTheWhisperServerFetchesNothing(t *testing.T) {
	srv, _, token := setupTestServer(t)
	srv.cfg.Speech = config.SpeechConfig{}
	router := srv.Router()
	fake := &modelWhisper{}
	whisper := httptest.NewServer(fake.handler())
	defer whisper.Close()
	if rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","speech":{"mode":"server","url":"`+whisper.URL+`"}}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	time.Sleep(300 * time.Millisecond)
	fake.mu.Lock()
	posts := append([]string(nil), fake.posts...)
	fake.mu.Unlock()
	if len(posts) != 0 {
		t.Fatalf("nothing must be downloaded on its own: %v", posts)
	}
	// A download under way: listed by speaches, but not counted as downloaded
	fake.mu.Lock()
	fake.local = []string{config.DefaultSTTModel}
	fake.mu.Unlock()
	srv.voice.downloads.list = map[string]*modelDownload{config.DefaultSTTModel: {Model: config.DefaultSTTModel, Running: true}}
	body := sessionCall(router, "GET", "/api/v1/admin/voice/models", token, "", "").Body.String()
	if !strings.Contains(body, `"id":"`+config.DefaultSTTModel+`","sizeMb":1600,"downloaded":false`) {
		t.Fatalf("a model still downloading is not there yet: %s", body)
	}
	if st := srv.checkVoice(t.Context()); st.ModelReady {
		t.Fatal("not ready while the model is still downloading")
	}
}

// Pieces while speaking: on with 8 s by default, the administration switches them off or shortens them,
// STT_CHUNKED and STT_CHUNK_SECONDS fix them; /auth/status tells the app.
func TestSpeechChunkSettings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Speech = config.SpeechConfig{}
	router := srv.Router()
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	put := func(speech string) *httptest.ResponseRecorder {
		return sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","speech":`+speech+`}`, "")
	}
	if !strings.Contains(status(), `"chunkSeconds":8,"chunked":true`) {
		t.Fatalf("default: in pieces of 8 s: %s", status())
	}
	if rec := put(`{"mode":"browser","chunked":false,"chunkSeconds":4}`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(status(), `"chunkSeconds":4,"chunked":false`) {
		t.Fatalf("from the administration: %s", status())
	}
	if sys, _ := store.GetSystemSettings(); sys.Speech.Chunked == nil || *sys.Speech.Chunked || sys.Speech.ChunkSeconds != 4 {
		t.Fatalf("stored: %+v", sys.Speech)
	}
	on := true
	srv.cfg.Speech = config.SpeechConfig{Chunked: &on, ChunkSeconds: 3}
	put(`{"mode":"browser","chunked":false,"chunkSeconds":20}`)
	body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String()
	for _, want := range []string{`"chunked":true`, `"chunkSeconds":3`, `"configuredViaEnv":["chunked","chunkSeconds"]`} {
		if !strings.Contains(body, want) {
			t.Fatalf("env lock, want %s: %s", want, body)
		}
	}
	if sys, _ := store.GetSystemSettings(); *sys.Speech.Chunked || sys.Speech.ChunkSeconds != 4 {
		t.Fatalf("stored values stay: %+v", sys.Speech)
	}
	if !strings.Contains(status(), `"chunkSeconds":3,"chunked":true`) {
		t.Fatalf("STT_* applies: %s", status())
	}
}

// Deleting a downloaded model on the Whisper server: not the one in use, not one downloading, not while
// STT_MODEL fixes the model; one that is not there answers 404.
func TestSpeechModelDelete(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Speech = config.SpeechConfig{}
	router := srv.Router()
	fake := &modelWhisper{local: []string{"Systran/faster-whisper-small", "Systran/faster-whisper-medium"}}
	whisper := httptest.NewServer(fake.handler())
	defer whisper.Close()
	del := func(model string) *httptest.ResponseRecorder {
		return sessionCall(router, "DELETE", "/api/v1/admin/voice/models/"+model, token, "", "")
	}
	if rec := del("Systran/faster-whisper-medium"); rec.Code != http.StatusBadRequest {
		t.Fatalf("without a Whisper server: %d", rec.Code)
	}
	if rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","speech":{"mode":"server","url":"`+whisper.URL+`","model":"Systran/faster-whisper-small"}}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if rec := del("Systran/faster-whisper-small"); rec.Code != http.StatusConflict {
		t.Fatalf("the model in use stays: %d", rec.Code)
	}
	if rec := del("a..b"); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad name: %d", rec.Code)
	}
	srv.voice.downloads.list = map[string]*modelDownload{"Systran/faster-whisper-medium": {Model: "Systran/faster-whisper-medium", Running: true}}
	if rec := del("Systran/faster-whisper-medium"); rec.Code != http.StatusConflict {
		t.Fatalf("not while downloading: %d", rec.Code)
	}
	srv.voice.downloads.list["Systran/faster-whisper-medium"].Running = false
	if rec := del("Systran/faster-whisper-medium"); rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	fake.mu.Lock()
	deleted, local := append([]string(nil), fake.deletes...), append([]string(nil), fake.local...)
	fake.mu.Unlock()
	if !slices.Equal(deleted, []string{"Systran/faster-whisper-medium"}) || !slices.Equal(local, []string{"Systran/faster-whisper-small"}) {
		t.Fatalf("asked the Whisper server: deleted %v, left %v", deleted, local)
	}
	if len(srv.voice.downloads.snapshot()) != 0 {
		t.Fatal("the finished download of a deleted model is no longer shown")
	}
	if e := lastAudit(t, store, storage.AuditSpeechModelDeleted); e.TargetKind != storage.AuditTargetSpeechModel || e.TargetName != "Systran/faster-whisper-medium" {
		t.Fatalf("deletion in the audit log: %+v", e)
	}
	if rows, _ := store.AuditEntries(storage.AuditFilter{Action: storage.AuditSpeechModelDeleted}); len(rows) != 1 {
		t.Fatalf("refused deletions are not recorded: %d rows", len(rows))
	}
	if rec := del("Systran/faster-whisper-medium"); rec.Code != http.StatusNotFound {
		t.Fatalf("not there: %d", rec.Code)
	}
	srv.cfg.Speech = config.SpeechConfig{Model: "Systran/faster-whisper-large-v3"}
	if rec := del("Systran/faster-whisper-small"); rec.Code != http.StatusConflict {
		t.Fatalf("STT_MODEL fixes the model: %d", rec.Code)
	}
}

// A fresh server: the mode stays automatic ("") until the admin chooses one, so the address entered
// later makes it server mode; a mode chosen on purpose stays as chosen.
func TestSpeechModeAutomaticUntilChosen(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Speech = config.SpeechConfig{}
	router := srv.Router()
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	put := func(speech string) {
		t.Helper()
		if rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","speech":`+speech+`}`, ""); rec.Code != http.StatusOK {
			t.Fatalf("save %s: %d %s", speech, rec.Code, rec.Body.String())
		}
	}
	adminSpeech := func() domain.SpeechSettings {
		t.Helper()
		var out struct {
			Speech domain.SpeechSettings `json:"speech"`
		}
		rec := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "")
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("admin settings: %v %s", err, rec.Body.String())
		}
		return out.Speech
	}
	// The form sends back what it got, with the new address
	saveAddress := func(url string) {
		t.Helper()
		sp := adminSpeech()
		sp.URL = url
		raw, _ := json.Marshal(sp)
		put(string(raw))
	}
	if sp := adminSpeech(); sp.Mode != "" {
		t.Fatalf("no mode chosen yet: %q", sp.Mode)
	}
	if !strings.Contains(status(), `"mode":"browser"`) {
		t.Fatalf("without an address the browser: %s", status())
	}
	saveAddress("http://127.0.0.1:18612")
	if !strings.Contains(status(), `"mode":"server"`) {
		t.Fatalf("the address makes it server mode: %s", status())
	}
	if sys, _ := store.GetSystemSettings(); sys.Speech.Mode != "" {
		t.Fatalf("stored mode stays automatic: %q", sys.Speech.Mode)
	}
	// Chosen on purpose: browser and off stay as chosen when the address is saved again
	for _, mode := range []string{"browser", "off"} {
		put(`{"mode":"` + mode + `","url":"http://127.0.0.1:18612"}`)
		saveAddress("http://127.0.0.1:18613")
		if sp := adminSpeech(); sp.Mode != mode || !strings.Contains(status(), `"mode":"`+mode+`"`) {
			t.Fatalf("%s as chosen: %q %s", mode, sp.Mode, status())
		}
	}
}
