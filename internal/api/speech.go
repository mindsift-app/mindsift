package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Voice input as it applies: each STT_* variable that is set (config.Speech) fixes its value, the rest
// comes from the administration (system settings "speech"), else the defaults. Read on every use, so a
// change in the administration counts at once.

func firstOf(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func firstInt(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}

// firstBool: the first value set, else true (both switches are on by default).
func firstBool(values ...*bool) *bool {
	on := true
	for _, v := range values {
		if v != nil {
			on = *v
			break
		}
	}
	return &on
}

// storedSpeech: what the administration saved for voice input (zero values when nothing).
func (s *Server) storedSpeech() domain.SpeechSettings {
	if sys, _ := s.store.GetSystemSettings(); sys != nil && sys.Speech != nil {
		return *sys.Speech
	}
	return domain.SpeechSettings{}
}

// speech: the voice input configuration the server works with. Mode() of the result is the mode.
func (s *Server) speech() config.SpeechConfig {
	env, st := s.cfg.Speech, s.storedSpeech()
	out := config.SpeechConfig{
		URL:            strings.TrimRight(firstOf(env.URL, st.URL), "/"),
		APIKey:         firstOf(env.APIKey, st.APIKey),
		Model:          firstOf(env.Model, st.Model, env.DefaultModel, config.DefaultSTTModel),
		MaxSeconds:     firstInt(env.MaxSeconds, st.MaxSeconds, config.DefaultSTTMaxSeconds),
		MaxUploadMB:    firstInt(env.MaxUploadMB, st.MaxUploadMB, config.DefaultSTTMaxUploadMB),
		MaxParallel:    firstInt(env.MaxParallel, st.MaxParallel, config.DefaultSTTMaxParallel),
		PerUserPerHour: firstInt(env.PerUserPerHour, st.PerUserPerHour, config.DefaultSTTPerUserPerHour),
		TimeoutSeconds: firstInt(env.TimeoutSeconds, st.TimeoutSeconds, config.DefaultSTTTimeoutSeconds),
		ChunkSeconds:   firstInt(env.ChunkSeconds, st.ChunkSeconds, config.DefaultSTTChunkSeconds),
		VADFilter:      firstBool(env.VADFilter, st.VADFilter),
		Chunked:        firstBool(env.Chunked, st.Chunked),
	}
	out.NoBrowser = !s.speechBrowserAllowed(st)
	// The mode: STT_DISABLED, else the administration's choice; without one the Whisper server when an
	// address is known (as before the setting existed), else the browser
	switch {
	case env.Disabled || st.Mode == "off":
		out.Disabled = true
	case st.Mode == "browser":
		out.URL = "" // the Whisper server stays configured, but is not used
	}
	return out
}

// speechBrowserAllowed: STT_ALLOW_BROWSER if set, else the administration's switch (default on).
func (s *Server) speechBrowserAllowed(st domain.SpeechSettings) bool {
	switch {
	case s.cfg.Speech.NoBrowser:
		return false
	case s.cfg.Speech.BrowserAllowed:
		return true
	case st.AllowBrowser != nil:
		return *st.AllowBrowser
	}
	return true
}

// whisperServer: address and key of the Whisper server, whatever the mode (the administration manages
// its models also while the browser's recognition is in use).
func (s *Server) whisperServer() (url, apiKey string) {
	st := s.storedSpeech()
	return strings.TrimRight(firstOf(s.cfg.Speech.URL, st.URL), "/"), firstOf(s.cfg.Speech.APIKey, st.APIKey)
}

// speechEnvFields: the fields of domain.SpeechSettings the STT_* variables fix.
func (s *Server) speechEnvFields() []string {
	env := s.cfg.Speech
	var out []string
	add := func(on bool, name string) {
		if on {
			out = append(out, name)
		}
	}
	add(env.Disabled, "mode")
	add(env.NoBrowser || env.BrowserAllowed, "allowBrowser")
	add(env.URL != "", "url")
	add(env.APIKey != "", "apiKey")
	add(env.Model != "", "model")
	add(env.MaxSeconds > 0, "maxSeconds")
	add(env.MaxUploadMB > 0, "maxUploadMb")
	add(env.MaxParallel > 0, "maxParallel")
	add(env.PerUserPerHour > 0, "perUserPerHour")
	add(env.TimeoutSeconds > 0, "timeoutSeconds")
	add(env.VADFilter != nil, "vadFilter")
	add(env.Chunked != nil, "chunked")
	add(env.ChunkSeconds > 0, "chunkSeconds")
	return out
}

// speechForAdmin: the voice input settings as the administration shows them: what applies (the
// environment's values where it fixes them), the mode as chosen ("" while the admin never chose one: the
// form shows the automatic mode and sends "" back, so an address entered later makes it server mode),
// the key only as "set".
func (s *Server) speechForAdmin() *domain.SpeechSettings {
	st, eff := s.storedSpeech(), s.speech()
	url, key := s.whisperServer()
	out := &domain.SpeechSettings{
		Mode: st.Mode, URL: url, APIKeySet: key != "" || st.APIKeyUnreadable,
		APIKeyUnreadable: st.APIKeyUnreadable && s.cfg.Speech.APIKey == "",
		Model:            eff.Model, MaxSeconds: eff.MaxSeconds, MaxUploadMB: eff.MaxUploadMB, MaxParallel: eff.MaxParallel,
		PerUserPerHour: eff.PerUserPerHour, TimeoutSeconds: eff.TimeoutSeconds, VADFilter: eff.VADFilter,
		Chunked: eff.Chunked, ChunkSeconds: eff.ChunkSeconds,
		ConfiguredViaEnv: s.speechEnvFields(),
	}
	allow := !eff.NoBrowser
	out.AllowBrowser = &allow
	if s.cfg.Speech.Disabled {
		out.Mode = "off"
	}
	return out
}

// keepSpeechEnvLocked puts the stored value back for every field STT_* fixes; the key is never part of
// what the browser has, so only a new one (or clearApiKey) changes it.
func (s *Server) keepSpeechEnvLocked(update, stored *domain.SpeechSettings) {
	if update == nil {
		return
	}
	if stored == nil {
		stored = &domain.SpeechSettings{}
	}
	for _, f := range s.speechEnvFields() {
		switch f {
		case "mode":
			update.Mode = stored.Mode
		case "allowBrowser":
			update.AllowBrowser = stored.AllowBrowser
		case "url":
			update.URL = stored.URL
		case "apiKey":
			update.APIKey, update.ClearAPIKey = "", false
		case "model":
			update.Model = stored.Model
		case "maxSeconds":
			update.MaxSeconds = stored.MaxSeconds
		case "maxUploadMb":
			update.MaxUploadMB = stored.MaxUploadMB
		case "maxParallel":
			update.MaxParallel = stored.MaxParallel
		case "perUserPerHour":
			update.PerUserPerHour = stored.PerUserPerHour
		case "timeoutSeconds":
			update.TimeoutSeconds = stored.TimeoutSeconds
		case "vadFilter":
			update.VADFilter = stored.VADFilter
		case "chunked":
			update.Chunked = stored.Chunked
		case "chunkSeconds":
			update.ChunkSeconds = stored.ChunkSeconds
		}
	}
	update.ConfiguredViaEnv, update.APIKeySet, update.APIKeyUnreadable = nil, false, false
}

// --- Models of the Whisper server ---

// knownSpeechModels: offered in the administration whether downloaded or not, with their rough size.
var knownSpeechModels = []struct {
	ID     string `json:"id"`
	SizeMB int    `json:"sizeMb"`
}{
	{config.DefaultSTTModel, 1600},
	{"Systran/faster-whisper-large-v3", 3100},
	{"Systran/faster-distil-whisper-large-v3", 1500},
	{"Systran/faster-whisper-medium", 1500},
	{"Systran/faster-whisper-small", 480},
}

// modelDownload: one download the server asked the Whisper server for. speaches answers only when it is
// done, so there is no progress: started, running, done or the error.
type modelDownload struct {
	Model      string       `json:"model"`
	StartedAt  string       `json:"startedAt"`
	FinishedAt string       `json:"finishedAt,omitempty"`
	Running    bool         `json:"running"`
	Error      string       `json:"error,omitempty"`
	selectBy   *domain.User // asked for it with select: becomes the model in use once downloaded
}

type modelDownloads struct {
	mu   sync.Mutex
	list map[string]*modelDownload
}

// running: a download of the model is under way.
func (d *modelDownloads) running(model string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.list[model] != nil && d.list[model].Running
}

func (d *modelDownloads) snapshot() []modelDownload {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]modelDownload, 0, len(d.list))
	for _, m := range d.list {
		out = append(out, *m)
	}
	slices.SortFunc(out, func(a, b modelDownload) int { return strings.Compare(a.Model, b.Model) })
	return out
}

// startModelDownload asks the Whisper server for a model in the background (once at a time per model);
// selectBy (the admin who asked for it with select) makes it the model in use when done (unless STT_MODEL
// fixes the model), recorded in the audit log as that admin's change; nil only downloads.
func (s *Server) startModelDownload(model string, selectBy *domain.User) {
	d := &s.voice.downloads
	d.mu.Lock()
	if d.list == nil {
		d.list = map[string]*modelDownload{}
	}
	if cur := d.list[model]; cur != nil && cur.Running {
		if cur.selectBy == nil {
			cur.selectBy = selectBy
		}
		d.mu.Unlock()
		return
	}
	job := &modelDownload{Model: model, StartedAt: time.Now().UTC().Format(time.RFC3339), Running: true, selectBy: selectBy}
	d.list[model] = job
	d.mu.Unlock()
	slog.Info("Speech recognition: downloading a model (can take a few minutes)", "model", model)
	s.background(func() {
		err := s.downloadModel(model)
		d.mu.Lock()
		selectBy := job.selectBy
		d.mu.Unlock()
		if err != nil {
			slog.Warn("Speech recognition: model download failed", "model", model, "error", err)
		} else {
			slog.Info("Speech recognition: model downloaded", "model", model)
			// In use before the download shows as done, so the page never sees "done" with the old model
			if before := s.speech().Model; selectBy != nil && s.cfg.Speech.Model == "" && before != model {
				s.selectSpeechModel(model)
				s.auditAs(selectBy, storage.AuditSettingsChanged, storage.AuditEntry{TargetKind: storage.AuditTargetSettings},
					auditChanges{Changes: []auditChange{{Key: "speech.model", From: before, To: model}}})
			}
		}
		d.mu.Lock()
		job.Running, job.FinishedAt = false, time.Now().UTC().Format(time.RFC3339)
		if err != nil {
			job.Error = err.Error()
		}
		d.mu.Unlock()
	})
}

// downloadModel: POST /v1/models/{id} at the Whisper server (speaches); it answers when the files are there.
func (s *Server) downloadModel(model string) error {
	stopCtx, stopCancel := s.stopContext()
	defer stopCancel()
	ctx, cancel := context.WithTimeout(stopCtx, 2*time.Hour)
	defer cancel()
	// Model IDs contain a slash (owner/name); speaches takes them as a path
	resp, err := s.sttRequest(ctx, http.MethodPost, "/v1/models/"+model, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 300 {
		return &whisperError{status: resp.StatusCode, body: strings.TrimSpace(string(raw))}
	}
	return nil
}

type whisperError struct {
	status int
	body   string
}

func (e *whisperError) Error() string {
	return "HTTP " + http.StatusText(e.status) + ": " + e.body
}

// selectSpeechModel stores the model as the one in use.
func (s *Server) selectSpeechModel(model string) {
	sys, err := s.store.GetSystemSettings()
	if err != nil || sys == nil {
		return
	}
	sp := s.storedSpeech()
	sp.Model, sp.APIKey, sp.ClearAPIKey = model, "", false // the key stays as stored
	sys.Speech = &sp
	logFailed("Storing the speech model", s.store.UpdateSystemSettings(sys), "model", model)
}

// localSpeechModels: the models the Whisper server has downloaded (GET /v1/models).
func (s *Server) localSpeechModels(ctx context.Context) ([]string, error) {
	resp, err := s.sttRequest(ctx, http.MethodGet, "/v1/models", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &whisperError{status: resp.StatusCode}
	}
	var list struct {
		Data []struct {
			ID   string `json:"id"`
			Task string `json:"task"`
		} `json:"data"`
	}
	if err := decodeJSONLimited(resp.Body, &list); err != nil {
		return nil, err
	}
	var out []string
	for _, m := range list.Data {
		if m.Task == "" || m.Task == "automatic-speech-recognition" {
			out = append(out, m.ID)
		}
	}
	return out, nil
}

// handleAdminSpeechModels: GET /admin/voice/models: the known models and the downloaded ones, each
// with whether it is downloaded, the one in use and the downloads under way.
func (s *Server) handleAdminSpeechModels(w http.ResponseWriter, r *http.Request) {
	url, _ := s.whisperServer()
	out := map[string]any{"model": s.speech().Model, "downloads": s.voice.downloads.snapshot(), "reachable": false}
	type entry struct {
		ID         string `json:"id"`
		SizeMB     int    `json:"sizeMb,omitempty"`
		Downloaded bool   `json:"downloaded"`
	}
	var local []string
	if url != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		var err error
		local, err = s.localSpeechModels(ctx)
		cancel()
		if err != nil {
			out["error"] = tr(w, "Whisper-Server nicht erreichbar")
		} else {
			out["reachable"] = true
		}
	}
	// speaches lists a model as soon as its download began: one still coming is not downloaded yet
	have := func(id string) bool { return slices.Contains(local, id) && !s.voice.downloads.running(id) }
	var models []entry
	seen := map[string]bool{}
	for _, k := range knownSpeechModels {
		models = append(models, entry{ID: k.ID, SizeMB: k.SizeMB, Downloaded: have(k.ID)})
		seen[k.ID] = true
	}
	for _, id := range append(local, s.speech().Model) {
		if !seen[id] {
			models = append(models, entry{ID: id, Downloaded: have(id)})
			seen[id] = true
		}
	}
	out["models"] = models
	writeJSON(w, http.StatusOK, out)
}

// handleAdminSpeechModelDownload: POST /admin/voice/models/{model} {select} lets the Whisper server
// download a model; select makes it the model in use once it is there (already there: at once).
func (s *Server) handleAdminSpeechModelDownload(w http.ResponseWriter, r *http.Request) {
	model := strings.TrimSpace(chi.URLParam(r, "*"))
	if model == "" || !storage.ValidSpeechModel(model) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrSpeechModel)
		return
	}
	if url, _ := s.whisperServer(); url == "" {
		writeError(w, http.StatusBadRequest, "Kein Whisper-Server eingetragen")
		return
	}
	if s.cfg.DemoMode {
		writeErrorFrom(w, http.StatusForbidden, errDemoOutgoing)
		return
	}
	var req struct {
		Select bool `json:"select"`
	}
	_ = decodeJSONLimited(r.Body, &req)
	if req.Select && s.cfg.Speech.Model != "" {
		writeError(w, http.StatusConflict, "Das Modell ist per STT_MODEL festgelegt")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	local, _ := s.localSpeechModels(ctx)
	cancel()
	if slices.Contains(local, model) && !s.voice.downloads.running(model) {
		if before := s.speech().Model; req.Select && before != model {
			s.selectSpeechModel(model)
			s.audit(r, storage.AuditSettingsChanged, storage.AuditEntry{TargetKind: storage.AuditTargetSettings},
				auditChanges{Changes: []auditChange{{Key: "speech.model", From: before, To: model}}})
		}
		writeJSON(w, http.StatusOK, map[string]any{"downloaded": true})
		return
	}
	if !s.voice.downloads.running(model) {
		s.audit(r, storage.AuditSpeechModelDownload, auditSpeechModelTarget(model), map[string]bool{"select": req.Select})
	}
	var selectBy *domain.User
	if req.Select {
		selectBy = s.auditActor(r)
	}
	s.startModelDownload(model, selectBy)
	writeJSON(w, http.StatusAccepted, map[string]any{"downloaded": false, "downloads": s.voice.downloads.snapshot()})
}

// handleAdminSpeechModelDelete: DELETE /admin/voice/models/{model} removes a downloaded model from the
// Whisper server (DELETE /v1/models/{id} on speaches) to free its space. Not the model in use, not one
// still downloading, and not at all while STT_MODEL fixes the model.
func (s *Server) handleAdminSpeechModelDelete(w http.ResponseWriter, r *http.Request) {
	model := strings.TrimSpace(chi.URLParam(r, "*"))
	if model == "" || !storage.ValidSpeechModel(model) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrSpeechModel)
		return
	}
	if url, _ := s.whisperServer(); url == "" {
		writeError(w, http.StatusBadRequest, "Kein Whisper-Server eingetragen")
		return
	}
	switch {
	case s.cfg.Speech.Model != "":
		writeError(w, http.StatusConflict, "Das Modell ist per STT_MODEL festgelegt")
		return
	case model == s.speech().Model:
		writeError(w, http.StatusConflict, "Das Modell ist in Gebrauch und kann nicht gelöscht werden")
		return
	case s.voice.downloads.running(model):
		writeError(w, http.StatusConflict, "Das Modell wird gerade heruntergeladen")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	resp, err := s.sttRequest(ctx, http.MethodDelete, "/v1/models/"+model, nil, "")
	if err != nil {
		writeError(w, http.StatusBadGateway, "Whisper-Server nicht erreichbar")
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusNotFound:
		writeError(w, http.StatusNotFound, "Das Modell ist auf dem Whisper-Server nicht vorhanden")
		return
	case resp.StatusCode >= 300:
		slog.Warn("Speech recognition: deleting a model failed", "model", model, "status", resp.StatusCode, "body", strings.TrimSpace(string(raw)))
		writeError(w, http.StatusBadGateway, "Der Whisper-Server konnte das Modell nicht löschen")
		return
	}
	slog.Info("Speech recognition: model deleted", "model", model)
	s.audit(r, storage.AuditSpeechModelDeleted, auditSpeechModelTarget(model), nil)
	// A finished download of it would still show as done
	d := &s.voice.downloads
	d.mu.Lock()
	if cur := d.list[model]; cur != nil && !cur.Running {
		delete(d.list, model)
	}
	d.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// auditSpeechModelTarget: a model of the Whisper server as the target of a row of the audit log.
func auditSpeechModelTarget(model string) storage.AuditEntry {
	return storage.AuditEntry{TargetKind: storage.AuditTargetSpeechModel, TargetName: model}
}

// decodeJSONLimited reads at most 4 MB of JSON into v.
func decodeJSONLimited(r io.Reader, v any) error {
	return json.NewDecoder(io.LimitReader(r, 4<<20)).Decode(v)
}
