package shell

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// All path logic of local instances is in this file. Every instance lives in a folder of its own below
// the app's base folder (<base>/instances/<Name>); the instance of phase 1 stays in <base>/data. Nothing
// outside the base folder is ever opened, so a Flatpak needs no portal: the base folder lies in its
// sandbox ($XDG_DATA_HOME points there).

// DatabaseFile: the database of an instance, in its folder (the server's DATA_DIR)
const DatabaseFile = "mindsift.db"

// instancesDir: the folder below the base folder that holds the instances
const instancesDir = "instances"

// legacyDir: the one data folder of phase 1, an instance named "MindSift" since phase 2
const legacyDir = "data"

// InstancesDir: where new instances are created, <base>/instances
func InstancesDir(base string) string { return filepath.Join(base, instancesDir) }

// FoundInstance: an instance folder in the base folder (also one copied there by hand)
type FoundInstance struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// FindInstances lists the folders in <base>/instances that hold a database, and <base>/data when it holds
// one, sorted by name.
func FindInstances(base string) []FoundInstance {
	var out []FoundInstance
	if isInstance(filepath.Join(base, legacyDir)) {
		out = append(out, FoundInstance{Name: "MindSift", Path: filepath.Join(base, legacyDir)})
	}
	entries, _ := os.ReadDir(InstancesDir(base))
	for _, e := range entries {
		dir := filepath.Join(InstancesDir(base), e.Name())
		if e.IsDir() && isInstance(dir) {
			out = append(out, FoundInstance{Name: e.Name(), Path: dir})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func isInstance(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, DatabaseFile))
	return err == nil && st.Mode().IsRegular()
}

// InBase: dir is an instance folder the app may open: <base>/data or a folder directly in
// <base>/instances. Guards the endpoints against paths from anywhere else.
func InBase(base, dir string) bool {
	dir = filepath.Clean(dir)
	if samePath(dir, filepath.Join(base, legacyDir)) {
		return true
	}
	return samePath(filepath.Dir(dir), InstancesDir(base)) && filepath.Base(dir) != "." && filepath.Base(dir) != ".."
}

// NewInstanceFolder: the folder for a new instance of this name, <base>/instances/<Name>; a name already
// taken by a folder gets a number ("Arbeit 2"). The folder is not created here.
func NewInstanceFolder(base, name string) string {
	folder := FolderName(name)
	dir := filepath.Join(InstancesDir(base), folder)
	for i := 2; exists(dir); i++ {
		dir = filepath.Join(InstancesDir(base), folder+" "+strconv.Itoa(i))
	}
	return dir
}

func exists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// CreateFolder makes the folder of a new instance (only the person may read it, as the server's data
// folder).
func CreateFolder(dir string) error {
	return os.MkdirAll(dir, 0o700)
}

// FolderName: a name as a folder name on every system (no separators, no characters Windows refuses, no
// dots or spaces at either end)
func FolderName(name string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			r = '-'
		}
		b.WriteRune(r)
	}
	out := strings.Trim(b.String(), ". ")
	if out == "" {
		return "MindSift"
	}
	// Names Windows keeps for devices
	switch strings.ToUpper(out) {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3":
		out = "_" + out
	}
	return out
}

// samePath compares two folders after cleaning them; Windows paths ignore case
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
