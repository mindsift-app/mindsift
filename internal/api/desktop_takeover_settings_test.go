package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Audit 2026-11-22 F2: the settings taken over from a server's snapshot pass the checks of PATCH
// /auth/settings. Alarm webhooks PATCH would refuse (Discord not on discord.com, plain http) are left
// out with their channels and named in the answer; valid ones and the other settings come along.
func TestSnapshotTakeOverValidatesSettings(t *testing.T) {
	for _, tc := range []struct {
		name            string
		discord, custom string
		wantSkipped     []string
	}{
		{"invalid", "https://attacker.example/not-discord", "http://attacker.example/hook", []string{"discordWebhookUrl", "customWebhookUrl"}},
		{"valid", "https://discord.com/api/webhooks/1/abc", "https://hooks.example.com/alarm", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			srvStore, err := storage.NewStore(filepath.Join(dir, "mindsift.db"))
			if err != nil {
				t.Fatal(err)
			}
			anna, _ := srvStore.CreateUser("anna@example.com", "hash", "Anna", domain.RoleAdmin)
			channels := []string{"email", "discord", "webhook"}
			if _, err := srvStore.UpdateUserFull(anna.ID, nil, nil, nil, nil, &channels, &tc.discord, &tc.custom, nil, nil); err != nil {
				t.Fatal(err)
			}
			if err := srvStore.SetLanguage(anna.ID, "fr"); err != nil {
				t.Fatal(err)
			}
			name, err := srvStore.WriteSystemSnapshot(filepath.Join(dir, "backups", "system"), time.Now())
			if err != nil {
				t.Fatal(err)
			}
			_ = srvStore.Close()

			store, dbPath := freshStore(t)
			srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
			router := srv.Router()
			token := desktopToken(t, router)

			// The same Discord URL through the normal API is refused
			if tc.wantSkipped != nil {
				b, _ := json.Marshal(map[string]any{"discordWebhookUrl": tc.discord})
				if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, string(b), "application/json"); rec.Code != http.StatusBadRequest {
					t.Fatalf("PATCH /auth/settings with %q: %d, want 400", tc.discord, rec.Code)
				}
			}

			rec := uploadSnapshot(t, router, token, filepath.Join(dir, "backups", "system", name))
			var up snapshotUploadResult
			if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil {
				t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
			}
			rec = sessionCall(router, http.MethodPost, "/api/v1/admin/backups/server-snapshot/"+up.Token+"?account="+anna.ID, token, "", "")
			var res struct {
				Settings        bool     `json:"settings"`
				SettingsSkipped []string `json:"settingsSkipped"`
			}
			if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &res) != nil {
				t.Fatalf("take over: %d %s", rec.Code, rec.Body.String())
			}
			if !res.Settings || !slices.Equal(res.SettingsSkipped, tc.wantSkipped) {
				t.Errorf("settings %v, left out %v, want %v", res.Settings, res.SettingsSkipped, tc.wantSkipped)
			}
			users, _ := store.GetAllUsers()
			me := users[0]
			if store.Language(me.ID) != "fr" || me.DisplayName != "Anna" {
				t.Errorf("valid settings not taken over: language %q, name %q", store.Language(me.ID), me.DisplayName)
			}
			if tc.wantSkipped != nil {
				if me.DiscordWebhookURL != "" || me.CustomWebhookURL != "" || !slices.Equal(me.AlarmChannels, []string{"email"}) {
					t.Errorf("invalid webhooks taken over: discord %q custom %q channels %v", me.DiscordWebhookURL, me.CustomWebhookURL, me.AlarmChannels)
				}
			} else if me.DiscordWebhookURL != tc.discord || me.CustomWebhookURL != tc.custom || len(me.AlarmChannels) != 3 {
				t.Errorf("valid webhooks not taken over: discord %q custom %q channels %v", me.DiscordWebhookURL, me.CustomWebhookURL, me.AlarmChannels)
			}
		})
	}
}
