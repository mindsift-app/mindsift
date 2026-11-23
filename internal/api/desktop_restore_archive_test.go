package api

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/importer"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// testPNG: a small picture, different for each shade.
func testPNG(t *testing.T, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	img.Set(1, 1, color.RGBA{R: shade, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// serverWithMedia builds a server's data folder as the server leaves it: mindsift.db, media/ with a picture
// of Anna and one of Ben, and a backup run (backups/system/…db.gz, backups/users/<id>/…zip). It returns the
// folder, Anna and the bytes of both pictures.
func serverWithMedia(t *testing.T) (dataDir string, anna *domain.User, annaImg, benImg []byte) {
	t.Helper()
	dataDir = t.TempDir()
	store, err := storage.NewStore(filepath.Join(dataDir, "mindsift.db"))
	if err != nil {
		t.Fatalf("server store: %v", err)
	}
	anna, _ = store.CreateUser("anna@example.com", "hash", "Anna Server", domain.RoleAdmin)
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", domain.RoleMember)
	annaImg, benImg = testPNG(t, 10), testPNG(t, 200)
	for _, p := range []struct {
		u     *domain.User
		title string
		img   []byte
	}{{anna, "Annas Urlaub", annaImg}, {ben, "Bens Garten", benImg}} {
		doc, _ := store.CreateDocument(p.u.ID, "", p.title, "📄", "", nil, nil, false)
		mime, kind, ok := blockfmt.DetectMedia(p.img, "")
		if !ok {
			t.Fatal("test picture not recognised")
		}
		m, err := store.CreateMedia(doc.ID, p.u.ID, kind, mime, int64(len(p.img)), "")
		if err != nil {
			t.Fatal(err)
		}
		_ = os.MkdirAll(filepath.Dir(store.MediaFilePath(m)), 0o700)
		if err := os.WriteFile(store.MediaFilePath(m), p.img, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateDocument(p.u.ID, "", p.title+" (Bild)", "📄", "", []domain.DocumentBlock{
			{ID: "b_" + p.u.ID, Type: "image", Content: blockfmt.MediaContent("image", m.ID, "Foto")},
		}, nil, false); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	backups := filepath.Join(dataDir, "backups")
	if _, err := store.WriteSystemSnapshot(filepath.Join(backups, "system"), now); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	for _, u := range []*domain.User{anna, ben} {
		if _, err := store.WriteUserBackup(u.ID, storage.UserBackupDir(backups, u.ID), now); err != nil {
			t.Fatalf("user backup: %v", err)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	return dataDir, anna, annaImg, benImg
}

// packDir packs the folder src as an archive (zip, tar or tgz) below prefix and returns its file.
func packDir(t *testing.T, src, prefix string, kind uploadKind) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "server-backup."+string(kind))
	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var add func(name string, data []byte)
	var finish func()
	switch kind {
	case uploadZip:
		zw := zip.NewWriter(f)
		add = func(name string, data []byte) {
			w, _ := zw.Create(name)
			_, _ = w.Write(data)
		}
		finish = func() { _ = zw.Close() }
	default:
		var w io.Writer = f
		var gz *gzip.Writer
		if kind == uploadTarGz {
			gz = gzip.NewWriter(f)
			w = gz
		}
		tw := tar.NewWriter(w)
		add = func(name string, data []byte) {
			_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(data)), Typeflag: tar.TypeReg})
			_, _ = tw.Write(data)
		}
		finish = func() {
			_ = tw.Close()
			if gz != nil {
				_ = gz.Close()
			}
		}
	}
	err = filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		add(path.Join(prefix, filepath.ToSlash(rel)), data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	finish()
	return out
}

type takeOverAnswer struct {
	importer.Summary
	Media        int `json:"media"`
	MediaMissing int `json:"mediaMissing"`
}

// takeOverAnna uploads file to a fresh local instance, takes Anna over and returns the local store, its
// account, the preview and the result.
func takeOverAnna(t *testing.T, file string, anna *domain.User) (*storage.Store, *Server, *domain.User, takeOverAnswer, takeOverAnswer) {
	t.Helper()
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)
	local, _ := store.GetAllUsers()
	me := local[0]

	rec := uploadSnapshot(t, router, token, file)
	var up snapshotUploadResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil || len(up.Accounts) != 2 {
		t.Fatalf("upload of %s: %d %s", filepath.Base(file), rec.Code, rec.Body.String())
	}
	base := "/api/v1/admin/backups/server-snapshot/" + up.Token + "?account=" + anna.ID
	var prev, done takeOverAnswer
	rec = sessionCall(router, http.MethodPost, base+"&preview=1", token, "", "")
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &prev) != nil {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body.String())
	}
	rec = sessionCall(router, http.MethodPost, base+"&mode=merge", token, "", "")
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &done) != nil {
		t.Fatalf("take over: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(srv.snapshotRoot()); !os.IsNotExist(err) {
		t.Errorf("the staged backup is still there: %v", err)
	}
	return store, srv, &me, prev, done
}

// localMedia: the bytes of every media file of the local account.
func localMedia(t *testing.T, store *storage.Store, userID string) [][]byte {
	t.Helper()
	media, err := store.MediaOfUser(userID)
	if err != nil {
		t.Fatal(err)
	}
	var out [][]byte
	for i := range media {
		data, err := os.ReadFile(store.MediaFilePath(&media[i]))
		if err != nil {
			t.Fatalf("media file of %s: %v", media[i].ID, err)
		}
		out = append(out, data)
	}
	return out
}

// The full backup a server keeps (its data folder, packed) brings the chosen account's pictures along,
// and only that account's: from media/ of the data folder, as tar.gz, tar or zip.
func TestDesktopTakesOverAccountWithMediaFromServerDataFolder(t *testing.T) {
	dataDir, anna, annaImg, benImg := serverWithMedia(t)
	for _, kind := range []uploadKind{uploadTarGz, uploadTar, uploadZip} {
		t.Run(string(kind), func(t *testing.T) {
			// Without the daily backups: the pictures must come from media/
			src := t.TempDir()
			if err := os.CopyFS(src, os.DirFS(dataDir)); err != nil {
				t.Fatal(err)
			}
			_ = os.RemoveAll(filepath.Join(src, "backups"))
			file := packDir(t, src, "data", kind)

			store, _, me, prev, done := takeOverAnna(t, file, anna)
			if prev.Media != 1 || prev.MediaMissing != 0 || done.Media != 1 {
				t.Errorf("media counts: preview %+v, result %+v", prev, done)
			}
			got := localMedia(t, store, me.ID)
			if len(got) != 1 || !bytes.Equal(got[0], annaImg) {
				t.Fatalf("local media after the take over: %d files", len(got))
			}
			if bytes.Equal(got[0], benImg) {
				t.Error("Ben's picture came along")
			}
			docs, _ := store.GetDocuments(me.ID)
			if !hasTitle(docs, "Annas Urlaub (Bild)") || hasTitle(docs, "Bens Garten (Bild)") {
				t.Errorf("notes: %v", titles(docs))
			}
		})
	}
}

// A copy of the backups folder alone: the database from the newest daily snapshot, the account's pictures
// from its own daily backup (the server's media/ is not in it).
func TestDesktopTakesOverAccountWithMediaFromBackupsFolder(t *testing.T) {
	dataDir, anna, annaImg, _ := serverWithMedia(t)
	file := packDir(t, filepath.Join(dataDir, "backups"), "", uploadZip)
	store, _, me, prev, _ := takeOverAnna(t, file, anna)
	if prev.Media != 1 || prev.MediaMissing != 0 {
		t.Errorf("media counts: %+v", prev)
	}
	if got := localMedia(t, store, me.ID); len(got) != 1 || !bytes.Equal(got[0], annaImg) {
		t.Fatalf("local media after the take over: %d files", len(got))
	}
}

// The database snapshot alone still works; its pictures are counted as missing.
func TestDesktopSnapshotAloneReportsMissingMedia(t *testing.T) {
	dataDir, anna, _, _ := serverWithMedia(t)
	snaps, _ := filepath.Glob(filepath.Join(dataDir, "backups", "system", "mindsift-db-*.db.gz"))
	if len(snaps) != 1 {
		t.Fatalf("snapshots: %v", snaps)
	}
	store, _, me, prev, _ := takeOverAnna(t, snaps[0], anna)
	if prev.Media != 0 || prev.MediaMissing != 1 {
		t.Errorf("media counts: %+v", prev)
	}
	docs, _ := store.GetDocuments(me.ID)
	if !hasTitle(docs, "Annas Urlaub (Bild)") {
		t.Errorf("notes: %v", titles(docs))
	}
}

// Entries that leave the archive, links and a media entry larger than any picture are passed over; nothing
// is written outside the staging folder.
func TestDesktopServerBackupArchiveIgnoresTricks(t *testing.T) {
	dataDir, anna, annaImg, _ := serverWithMedia(t)
	db, _ := os.ReadFile(filepath.Join(dataDir, "mindsift.db"))
	out := filepath.Join(t.TempDir(), "tricky.tar")
	f, _ := os.Create(out)
	tw := tar.NewWriter(f)
	add := func(h *tar.Header, data []byte) {
		h.Mode, h.Size = 0o600, int64(len(data))
		if h.Typeflag == 0 {
			h.Typeflag = tar.TypeReg
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		_, _ = tw.Write(data)
	}
	add(&tar.Header{Name: "../escape.txt"}, []byte("draußen"))
	add(&tar.Header{Name: "/abs/../../escape2.txt"}, []byte("draußen"))
	add(&tar.Header{Name: "data/mindsift.db"}, db)
	// Anna's picture as a link to a file of the system, and once more as a real file after it
	src := t.TempDir()
	_ = os.CopyFS(src, os.DirFS(filepath.Join(dataDir, "media")))
	_ = filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		data, _ := os.ReadFile(p)
		if bytes.Equal(data, annaImg) {
			add(&tar.Header{Name: "data/media/" + filepath.ToSlash(rel), Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"}, nil)
		}
		return nil
	})
	_ = tw.Close()
	_ = f.Close()

	store, srv, me, prev, _ := takeOverAnna(t, out, anna)
	if prev.Media != 0 || prev.MediaMissing != 1 {
		t.Errorf("a link counted as a picture: %+v", prev)
	}
	if got := localMedia(t, store, me.ID); len(got) != 0 {
		t.Errorf("media from a link: %d", len(got))
	}
	parent := filepath.Dir(srv.snapshotRoot())
	for _, name := range []string{"escape.txt", "escape2.txt"} {
		if _, err := os.Stat(filepath.Join(parent, name)); !os.IsNotExist(err) {
			t.Errorf("%s written outside: %v", name, err)
		}
	}
}

// What is neither a database nor an archive with one is refused with the same message.
func TestDesktopServerBackupRefusesArchiveWithoutDatabase(t *testing.T) {
	src := t.TempDir()
	_ = os.WriteFile(filepath.Join(src, "notiz.md"), []byte("# Hallo"), 0o600)
	file := packDir(t, src, "", uploadZip)
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)
	rec := uploadSnapshot(t, router, token, file)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "kein Backup eines MindSift-Servers") {
		t.Errorf("zip without a database: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(srv.snapshotRoot()); err == nil {
		entries, _ := os.ReadDir(srv.snapshotRoot())
		if len(entries) > 0 {
			t.Errorf("a refused upload stayed: %v", entries)
		}
	}
}

// A local instance has no switch for keeping things for good: the one person decides, even when an older
// version stored the switch as off.
func TestDesktopAlwaysAllowsRetentionNever(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	sys, err := store.GetSystemSettings()
	if err != nil {
		t.Fatal(err)
	}
	off := false
	sys.RetentionAllowNever = &off
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	if store.RetentionAllowNeverSetting() || !srv.allowNeverRetention() {
		t.Errorf("stored %v, allowed %v", store.RetentionAllowNeverSetting(), srv.allowNeverRetention())
	}
}

// fullBackupOf writes a full backup of the server's data folder (as the daily run now does) and returns its
// folder and its download (the tar archive).
func fullBackupOf(t *testing.T, dataDir string) (string, string) {
	t.Helper()
	store, err := storage.NewStore(filepath.Join(dataDir, "mindsift.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	dir := filepath.Join(dataDir, "backups", "system")
	name, err := store.WriteFullBackup(dir, time.Now(), "")
	if err != nil {
		t.Fatal(err)
	}
	_, write, err := storage.WriteFullBackupTar(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), name+".tar")
	f, _ := os.Create(out)
	if err := write(f); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	return filepath.Join(dir, name), out
}

// The full backup as downloaded from the administration (tar with mindsift.db.gz and media/) brings the
// account's pictures along, and so does a backups folder holding full backups (the newest one counts).
func TestDesktopTakesOverAccountFromFullBackup(t *testing.T) {
	dataDir, anna, annaImg, _ := serverWithMedia(t)
	_, file := fullBackupOf(t, dataDir)
	store, _, me, prev, _ := takeOverAnna(t, file, anna)
	if prev.Media != 1 || prev.MediaMissing != 0 {
		t.Errorf("media counts: %+v", prev)
	}
	if got := localMedia(t, store, me.ID); len(got) != 1 || !bytes.Equal(got[0], annaImg) {
		t.Fatalf("local media: %d files", len(got))
	}

	// The backups folder with the full backup, without the accounts' own backups and without media/ of the
	// data folder
	src := t.TempDir()
	if err := os.CopyFS(filepath.Join(src, "system"), os.DirFS(filepath.Join(dataDir, "backups", "system"))); err != nil {
		t.Fatal(err)
	}
	olds, _ := filepath.Glob(filepath.Join(src, "system", "mindsift-db-*.db.gz"))
	for _, old := range olds {
		_ = os.Remove(old)
	}
	store2, _, me2, prev2, _ := takeOverAnna(t, packDir(t, src, "backups", uploadZip), anna)
	if prev2.Media != 1 || prev2.MediaMissing != 0 {
		t.Errorf("media counts from the backups folder: %+v", prev2)
	}
	if got := localMedia(t, store2, me2.ID); len(got) != 1 || !bytes.Equal(got[0], annaImg) {
		t.Fatalf("local media from the backups folder: %d files", len(got))
	}
}
