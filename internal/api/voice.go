package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// Self-hosted speech recognition: the browser records audio and sends it here, MindSift passes it on
// to an OpenAI-compatible Whisper server (STT_URL, e.g. speaches) and returns the text. Nothing is
// stored. A limited number of transcriptions run at the same time (STT_MAX_PARALLEL), the others
// wait in line; each user has an hourly budget (STT_PER_USER_PER_HOUR). Problems are logged, the
// browser only gets a short message.

type voiceService struct {
	mu       sync.Mutex
	slots    chan struct{} // as many places as STT_MAX_PARALLEL / the administration allow (slotsFor)
	parallel int
	usage    map[string][]time.Time // userID -> transcriptions within the last hour
	status   voiceStatus
	checked  time.Time

	downloads modelDownloads // models the administration had downloaded (speech.go)
	checking  atomic.Bool    // startVoiceCheck runs
}

// voiceStatus is what the admin page shows about the Whisper server.
type voiceStatus struct {
	Reachable  bool   `json:"reachable"`
	ModelReady bool   `json:"modelReady"`
	Error      string `json:"error,omitempty"`
	CheckedAt  string `json:"checkedAt,omitempty"`
}

func newVoiceService(parallel int) *voiceService {
	v := &voiceService{usage: map[string][]time.Time{}}
	v.slotsFor(parallel)
	return v
}

// slotsFor: the places for transcriptions at the same time. A new number gets a new set of places; the
// transcriptions under way give theirs back to the set they took it from.
func (v *voiceService) slotsFor(parallel int) chan struct{} {
	if parallel < 1 {
		parallel = 1
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.slots == nil || v.parallel != parallel {
		v.slots, v.parallel = make(chan struct{}, parallel), parallel
	}
	return v.slots
}

func (s *Server) voiceMode() string {
	return s.speech().Mode(s.cfg.DemoMode)
}

// allowVoice counts one transcription for the user; false when the hourly budget is used up.
func (v *voiceService) allowVoice(userID string, perHour int, now time.Time) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	recent := v.usage[userID][:0]
	for _, t := range v.usage[userID] {
		if now.Sub(t) < time.Hour {
			recent = append(recent, t)
		}
	}
	if len(recent) >= perHour {
		v.usage[userID] = recent
		return false
	}
	v.usage[userID] = append(recent, now)
	return true
}

// sttEndpoint joins the base URL with an API path; a base URL ending in /v1 works as well.
func (s *Server) sttEndpoint(p string) string {
	url, _ := s.whisperServer()
	return strings.TrimSuffix(url, "/v1") + p
}

func (s *Server) sttRequest(ctx context.Context, method, p string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, s.sttEndpoint(p), body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if _, key := s.whisperServer(); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	return http.DefaultClient.Do(req)
}

func (s *Server) handleVoiceTranscribe(w http.ResponseWriter, r *http.Request) {
	if s.voiceMode() != "server" {
		writeError(w, http.StatusNotFound, "Serverseitige Spracherkennung ist nicht eingerichtet")
		return
	}
	cfg := s.speech()
	userID := auth.GetUserID(r.Context())
	if !s.voice.allowVoice(userID, cfg.PerUserPerHour, time.Now()) {
		writeError(w, http.StatusTooManyRequests, "Stundenlimit für die Spracherkennung erreicht. Bitte später erneut versuchen.")
		return
	}
	allowLongTransfer(w)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, tr(w, "Aufnahme zu groß (höchstens {mb} MB)", "mb", strconv.Itoa(cfg.MaxUploadMB)))
			return
		}
		writeError(w, http.StatusBadRequest, "Keine Aufnahme im Feld \"file\"")
		return
	}
	defer file.Close()
	audio, err := io.ReadAll(file)
	if err != nil || len(audio) == 0 {
		writeError(w, http.StatusBadRequest, "Aufnahme konnte nicht gelesen werden")
		return
	}

	// Wait for a free slot; the request may be cancelled meanwhile (user stopped waiting)
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(cfg.TimeoutSeconds)*time.Second)
	defer cancel()
	slots := s.voice.slotsFor(cfg.MaxParallel)
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-ctx.Done():
		slog.Warn("Speech recognition: no free capacity within the time limit", "user_id", userID, "parallel", cfg.MaxParallel)
		writeError(w, http.StatusServiceUnavailable, "Die Spracherkennung ist gerade ausgelastet. Bitte gleich noch einmal versuchen.")
		return
	}

	started := time.Now()
	text, err := s.transcribe(ctx, audio, header.Filename, header.Header.Get("Content-Type"), s.sttLanguage(userID))
	if err != nil {
		slog.Warn("Speech recognition failed", "url", s.sttEndpoint("/v1/audio/transcriptions"), "model", cfg.Model,
			"bytes", len(audio), "duration_ms", time.Since(started).Milliseconds(), "error", err)
		msg := "Spracherkennung fehlgeschlagen"
		if errors.Is(err, context.DeadlineExceeded) {
			msg = "Spracherkennung hat zu lange gedauert"
		}
		writeError(w, http.StatusBadGateway, msg)
		return
	}
	slog.Debug("Speech recognition", "user_id", userID, "bytes", len(audio), "duration_ms", time.Since(started).Milliseconds())
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}

// sttLanguage: the language Whisper is told for a recording ("" = none, Whisper detects it): the person's
// own choice for voice input; without one Whisper detects it (better for German with English terms).
func (s *Server) sttLanguage(userID string) string {
	switch lang := s.store.VoiceLanguage(userID); lang {
	case "", "auto":
		return ""
	case "app":
		return s.userLanguage(userID)
	default:
		return lang
	}
}

// transcribe sends the audio to the Whisper server (OpenAI API: POST /v1/audio/transcriptions); an empty
// language lets Whisper detect it.
func (s *Server) transcribe(ctx context.Context, audio []byte, filename, contentType, language string) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if filename == "" {
		filename = "aufnahme.webm"
	}
	part := textproto.MIMEHeader{}
	part.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, path.Base(strings.ReplaceAll(filename, `"`, ""))))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	part.Set("Content-Type", contentType)
	fw, err := mw.CreatePart(part)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(audio); err != nil {
		return "", err
	}
	cfg := s.speech()
	_ = mw.WriteField("model", cfg.Model)
	if language != "" {
		_ = mw.WriteField("language", language)
	}
	_ = mw.WriteField("response_format", "json")
	if cfg.VADFilter == nil || *cfg.VADFilter {
		_ = mw.WriteField("vad_filter", "true")
	}
	if err := mw.Close(); err != nil {
		return "", err
	}

	resp, err := s.sttRequest(ctx, http.MethodPost, "/v1/audio/transcriptions", &body, mw.FormDataContentType())
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("unexpected answer: %s", strings.TrimSpace(string(raw)))
	}
	return dropRepeatedTail(strings.TrimSpace(out.Text)), nil
}

var sentenceRe = regexp.MustCompile(`[^.!?…]+[.!?…]*`)

func normalizeSpeech(s string) string {
	return strings.Trim(strings.ToLower(strings.Join(strings.Fields(s), " ")), " .,!?…;:-–")
}

// dropRepeatedTail removes what Whisper sometimes makes up at the end of longer recordings: sentences
// it already wrote, repeated once more, or the last words echoed right after themselves.
func dropRepeatedTail(text string) string {
	for {
		trimmed := dropOnce(text)
		if trimmed == text {
			return text
		}
		text = trimmed
	}
}

func dropOnce(text string) string {
	// Sentence level: the last k sentences occur in the same order earlier on
	sentences := sentenceRe.FindAllStringIndex(text, -1)
	norm := make([]string, len(sentences))
	for i, loc := range sentences {
		norm[i] = normalizeSpeech(text[loc[0]:loc[1]])
	}
	for k := len(norm) / 2; k >= 1; k-- {
		tail := norm[len(norm)-k:]
		if len(strings.Join(tail, " ")) < 15 {
			continue
		}
		for start := 0; start+k <= len(norm)-k; start++ {
			same := true
			for j := 0; j < k; j++ {
				if norm[start+j] != tail[j] || tail[j] == "" {
					same = false
					break
				}
			}
			if same {
				return strings.TrimSpace(text[:sentences[len(norm)-k][0]])
			}
		}
	}
	// Word level: the last n words (at least 6) directly repeat the n words before them
	words := strings.Fields(text)
	for n := len(words) / 2; n >= 6; n-- {
		a := normalizeSpeech(strings.Join(words[len(words)-2*n:len(words)-n], " "))
		b := normalizeSpeech(strings.Join(words[len(words)-n:], " "))
		if a == b {
			return strings.Join(words[:len(words)-n], " ")
		}
	}
	return text
}

// checkVoice asks the Whisper server whether it is up and has the model.
func (s *Server) checkVoice(ctx context.Context) voiceStatus {
	st := voiceStatus{CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	resp, err := s.sttRequest(ctx, http.MethodGet, "/v1/models", nil, "")
	if err != nil {
		st.Error = err.Error()
		return st
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		st.Error = fmt.Sprintf("GET /v1/models: HTTP %d", resp.StatusCode)
		return st
	}
	st.Reachable = true
	var list struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&list)
	model := s.speech().Model
	// speaches lists a model as soon as its download began: one still coming does not count yet
	if s.voice.downloads.running(model) {
		return st
	}
	for _, m := range list.Data {
		if m.ID == model {
			st.ModelReady = true
		}
	}
	if !st.ModelReady {
		st.Error = "Modell ist noch nicht heruntergeladen"
	}
	return st
}

func (s *Server) setVoiceStatus(st voiceStatus) {
	s.voice.mu.Lock()
	s.voice.status = st
	s.voice.checked = time.Now()
	s.voice.mu.Unlock()
}

// startVoiceCheck waits for the Whisper server (after startup it may start later than MindSift, or the
// administration just entered it) and asks it to download the model if it does not have it yet, so the
// first recording works. A background job: it ends with Close, also while it waits or a check is under
// way; only one runs at a time (kickVoiceCheck). After the administration saved its settings it only
// checks: the model is then chosen there, and the default must not be fetched on its own.
func (s *Server) startVoiceCheck() { s.voiceCheck(true) }

func (s *Server) voiceCheck(fetchModel bool) {
	if !s.voice.checking.CompareAndSwap(false, true) {
		return
	}
	defer s.voice.checking.Store(false)
	cfg := s.speech()
	slog.Info("Speech recognition: server mode", "url", cfg.URL, "model", cfg.Model,
		"max_parallel", cfg.MaxParallel, "per_user_per_hour", cfg.PerUserPerHour, "max_upload_mb", cfg.MaxUploadMB)
	stopCtx, stopCancel := s.stopContext()
	defer stopCancel()
	downloadRequested := false
	for attempt := 0; ; attempt++ {
		if s.voiceMode() != "server" {
			return // switched to the browser or off meanwhile
		}
		ctx, cancel := context.WithTimeout(stopCtx, 10*time.Second)
		st := s.checkVoice(ctx)
		cancel()
		if stopCtx.Err() != nil {
			return
		}
		s.setVoiceStatus(st)
		cfg = s.speech()
		switch {
		case st.ModelReady:
			slog.Info("Speech recognition ready", "url", cfg.URL, "model", cfg.Model)
			return
		case st.Reachable && fetchModel && !downloadRequested:
			downloadRequested = true
			s.startModelDownload(cfg.Model, nil)
		case st.Reachable && !fetchModel:
			return // the administration chooses (and downloads) the model
		case !st.Reachable && attempt%6 == 0:
			slog.Warn("Speech recognition: Whisper server not reachable, will retry", "url", cfg.URL, "error", st.Error)
		}
		if !s.wait(voiceCheckInterval) {
			return
		}
	}
}

// kickVoiceCheck starts startVoiceCheck when the server mode applies (after saving the settings).
func (s *Server) kickVoiceCheck() {
	if s.voiceMode() == "server" && !s.voice.checking.Load() {
		s.background(func() { s.voiceCheck(false) })
	}
}

// voiceCheckInterval: how often startVoiceCheck asks the Whisper server until the model is ready
const voiceCheckInterval = 10 * time.Second

// handleAdminVoiceStatus shows the admin which speech recognition is active and checks the Whisper
// server right now.
func (s *Server) handleAdminVoiceStatus(w http.ResponseWriter, r *http.Request) {
	cfg := s.speech()
	out := map[string]any{
		"mode":           s.voiceMode(),
		"demo":           s.cfg.DemoMode,
		"maxSeconds":     cfg.MaxSeconds,
		"maxUploadMb":    cfg.MaxUploadMB,
		"maxParallel":    cfg.MaxParallel,
		"perUserPerHour": cfg.PerUserPerHour,
		"timeoutSeconds": cfg.TimeoutSeconds,
	}
	if cfg.URL != "" {
		out["url"] = cfg.URL
		out["model"] = cfg.Model
		out["apiKeySet"] = cfg.APIKey != ""
	}
	if s.voiceMode() == "server" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		st := s.checkVoice(ctx)
		cancel()
		s.setVoiceStatus(st)
		st.Error = tr(w, st.Error)
		out["status"] = st
	}
	writeJSON(w, http.StatusOK, out)
}
