package api

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func seededSecretsKey(seed byte) []byte {
	return bytes.Repeat([]byte{seed}, 32)
}

// serverWithHiddenValues builds a server's data folder whose values are sealed with serverKey: Anna's note
// "Annas Zugang" with a hidden value of her own, Ben's note with one of his, and a full backup carrying the key (withKey) or not. It returns the full backup's folder, Anna
// and the id of her value.
func serverWithHiddenValues(t *testing.T, serverKey []byte, withKey bool) (string, *domain.User, string) {
	t.Helper()
	dataDir := t.TempDir()
	opts := []storage.StoreOption{storage.WithSecretsKey(serverKey)}
	if withKey {
		opts = append(opts, storage.WithBackupSecretsKey(serverKey))
	}
	store, err := storage.NewStore(filepath.Join(dataDir, "mindsift.db"), opts...)
	if err != nil {
		t.Fatalf("server store: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna Server", domain.RoleAdmin)
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", domain.RoleMember)
	addValue := func(u *domain.User, title, value string) string {
		id := storage.NewSecretID()
		doc, err := store.CreateDocument(u.ID, "", title, "📄", "", []domain.DocumentBlock{{ID: "s_" + id, Type: "bullet", Content: "Zugang " + secretRef(id)}}, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := storage.SealValue(serverKey, id, value)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.CreateSecret(id, doc.ID, u.ID, sealed); err != nil {
			t.Fatal(err)
		}
		return id
	}
	annaID := addValue(anna, "Annas Zugang", "hunter2")
	addValue(ben, "Bens Zugang", "bens-geheimnis")
	name, err := store.WriteFullBackup(filepath.Join(dataDir, "backups", "system"), time.Now(), "")
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dataDir, "backups", "system", name), anna, annaID
}

func secretRef(id string) string { return "{{secret:" + id + "}}" }

type secretTakeOver struct {
	store   *storage.Store
	router  http.Handler
	token   string
	me      domain.User
	dbPath  string
	preview string
}

// takeOverAnnaWithKey takes Anna over from file into a fresh local instance whose own key is localKey.
func takeOverAnnaWithKey(t *testing.T, file string, anna *domain.User, localKey []byte) secretTakeOver {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "local.db")
	store, err := storage.NewStore(dbPath, storage.WithSecretsKey(localKey))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, func(c *config.Config) { c.SecretsKey = localKey })
	router := srv.Router()
	token := desktopToken(t, router)
	local, _ := store.GetAllUsers()

	rec := uploadSnapshot(t, router, token, file)
	var up snapshotUploadResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	base := "/api/v1/admin/backups/server-snapshot/" + up.Token + "?account=" + anna.ID
	prev := sessionCall(router, http.MethodPost, base+"&preview=1", token, "", "")
	if prev.Code != http.StatusOK {
		t.Fatalf("preview: %d %s", prev.Code, prev.Body.String())
	}
	if rec := sessionCall(router, http.MethodPost, base+"&mode=merge", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("take over: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(srv.snapshotRoot()); !os.IsNotExist(err) {
		t.Errorf("the staged backup is still there: %v", err)
	}
	return secretTakeOver{store: store, router: router, token: token, me: local[0], dbPath: dbPath, preview: prev.Body.String()}
}

// noteRefs: the hidden values the local note title refers to, and the note's id.
func (r secretTakeOver) noteRefs(t *testing.T, title string) (string, []string) {
	t.Helper()
	docs, _ := r.store.GetDocuments(r.me.ID)
	for _, d := range docs {
		if d.Title != title {
			continue
		}
		doc, err := r.store.GetDocumentByID(r.me.ID, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, b := range doc.Blocks {
			for _, m := range storage.SecretRefRe.FindAllStringSubmatch(b.Content, -1) {
				ids = append(ids, m[1])
			}
		}
		return d.ID, ids
	}
	t.Fatalf("note %q not taken over: %v", title, titles(docs))
	return "", nil
}

// A complete backup carries the server's secrets.key: Anna's hidden value comes along, sealed again with
// the local key under a new id, and reads in the local app; the preview no longer lists her note. Ben's
// value stays behind, and the server's key never becomes the instance's.
func TestDesktopTakeOverBringsHiddenValuesWithTheServersKey(t *testing.T) {
	serverKey, localKey := seededSecretsKey(1), seededSecretsKey(2)
	folder, anna, oldID := serverWithHiddenValues(t, serverKey, true)
	if _, err := os.Stat(filepath.Join(folder, storage.FullBackupSecretsKey)); err != nil {
		t.Fatalf("the full backup carries no key: %v", err)
	}
	for _, kind := range []string{"tar download", "data folder"} {
		t.Run(kind, func(t *testing.T) {
			file := packDir(t, folder, "", uploadTar)
			if kind == "data folder" {
				// The server's data folder: its key lies beside mindsift.db, the backups folder below it
				dataDir := filepath.Dir(filepath.Dir(filepath.Dir(folder)))
				if err := os.WriteFile(filepath.Join(dataDir, storage.FullBackupSecretsKey), []byte(hex.EncodeToString(serverKey)+"\n"), 0o600); err != nil {
					t.Fatal(err)
				}
				file = packDir(t, dataDir, "data", uploadTarGz)
			}
			r := takeOverAnnaWithKey(t, file, anna, localKey)
			if strings.Contains(r.preview, "Annas Zugang") {
				t.Errorf("the preview still lists the note with the value: %s", r.preview)
			}
			if strings.Contains(r.preview, snapshotHiddenValues) {
				t.Errorf("the preview still says the values stay behind: %s", r.preview)
			}
			docID, refs := r.noteRefs(t, "Annas Zugang")
			if len(refs) != 1 || refs[0] == oldID {
				t.Fatalf("references in the taken-over note: %v (old %s)", refs, oldID)
			}
			sec, err := r.store.GetSecret(refs[0])
			if err != nil || sec.DocumentID != docID || sec.CreatedBy != r.me.ID {
				t.Fatalf("the value in the local store: %+v %v", sec, err)
			}
			if v, err := storage.OpenValue(localKey, sec.ID, sec.Ciphertext); err != nil || v != "hunter2" {
				t.Errorf("the value does not open with the local key: %q %v", v, err)
			}
			if _, err := storage.OpenValue(serverKey, sec.ID, sec.Ciphertext); err == nil {
				t.Error("the value is still sealed with the server's key")
			}
			rec := sessionCall(r.router, http.MethodGet, "/api/v1/documents/"+docID+"/secrets/"+sec.ID, r.token, "", "")
			if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "hunter2") {
				t.Errorf("revealing the value in the app: %d %s", rec.Code, rec.Body.String())
			}
			// Only Anna's value is in the local store, not Ben's
			if samples, _ := r.store.SealedSamples(10); len(samples) != 1 {
				t.Errorf("values in the local store: %+v", samples)
			}
			// The instance keeps its own key: no secrets.key of the server in its data folder
			if raw, err := os.ReadFile(filepath.Join(filepath.Dir(r.dbPath), storage.FullBackupSecretsKey)); err == nil && strings.Contains(string(raw), hex.EncodeToString(serverKey)) {
				t.Error("the server's key was written into the local instance")
			}
		})
	}
}

// Without the server's key (a backup that leaves it out) or with a key that does not open the values, the
// notes come without them and are listed as before; nothing breaks.
func TestDesktopTakeOverSkipsHiddenValuesWithoutAWorkingKey(t *testing.T) {
	serverKey, localKey := seededSecretsKey(1), seededSecretsKey(2)
	cases := map[string]func(folder string){
		"no key":    nil,
		"wrong key": func(folder string) { writeKeyFile(t, folder, hex.EncodeToString(seededSecretsKey(3))+"\n") },
		"not a key": func(folder string) { writeKeyFile(t, folder, "kein Schlüssel\n") },
		"too large": func(folder string) { writeKeyFile(t, folder, strings.Repeat("ab", 2048)) },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			folder, anna, oldID := serverWithHiddenValues(t, serverKey, change != nil)
			if change != nil {
				change(folder)
			}
			r := takeOverAnnaWithKey(t, packDir(t, folder, "", uploadTar), anna, localKey)
			if !strings.Contains(r.preview, "Annas Zugang") || !strings.Contains(r.preview, snapshotHiddenValues) {
				t.Errorf("the note with the value is not listed: %s", r.preview)
			}
			_, refs := r.noteRefs(t, "Annas Zugang")
			if len(refs) != 1 || refs[0] != oldID {
				t.Fatalf("references in the taken-over note: %v (old %s)", refs, oldID)
			}
			if _, err := r.store.GetSecret(oldID); err == nil {
				t.Error("a value came along without a working key")
			}
		})
	}
}

func writeKeyFile(t *testing.T, folder, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(folder, storage.FullBackupSecretsKey), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
