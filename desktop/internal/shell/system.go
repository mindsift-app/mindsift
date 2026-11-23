package shell

import (
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
)

// InFlatpak: the app runs in a Flatpak sandbox (flatpak sets FLATPAK_ID). Dialogs and notifications then
// go through the portals, and the app brings its own desktop entry.
func InFlatpak() bool { return os.Getenv("FLATPAK_ID") != "" }

// SystemUser: login name and full name of the system's user, for the account of an instance's first start.
func SystemUser() (login, name string) {
	u, err := user.Current()
	if err != nil {
		return os.Getenv("USER"), ""
	}
	login = u.Username
	if i := strings.LastIndexAny(login, `\/`); i >= 0 { // Windows: DOMAIN\user
		login = login[i+1:]
	}
	// GECOS may carry more fields after the name ("Full Name,Room,Phone")
	name, _, _ = strings.Cut(u.Name, ",")
	name = strings.TrimSpace(name)
	// Flatpak writes "Unknown" into the sandbox's passwd when the GECOS field is empty
	if name == "Unknown" {
		name = ""
	}
	return login, name
}

// SystemLanguage: the language of the system as a two-letter code ("de_DE.UTF-8" → "de"): LANGUAGE,
// LC_ALL, LC_MESSAGES, LANG, then the Windows display language. Empty when unknown.
func SystemLanguage() string {
	for _, v := range []string{"LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"} {
		l := os.Getenv(v)
		if v == "LANGUAGE" {
			l, _, _ = strings.Cut(l, ":") // a list of languages, the first counts
		}
		if l != "" && l != "C" && l != "POSIX" && !strings.HasPrefix(l, "C.") {
			return languageCode(l)
		}
	}
	return languageCode(systemLanguagePlatform())
}

func languageCode(l string) string {
	l, _, _ = strings.Cut(l, ".")
	l, _, _ = strings.Cut(l, "_")
	l, _, _ = strings.Cut(l, "-")
	return strings.ToLower(l)
}

// SystemTimeZone: the IANA name of the system's time zone: on Linux /etc/localtime links into the zoneinfo
// folder (/etc/timezone on Debian-like systems), on Windows the zone's key in the registry is mapped
// (WindowsToIANA); empty where unknown.
func SystemTimeZone() string {
	if runtime.GOOS == "windows" {
		return WindowsToIANA(windowsTimeZoneKey())
	}
	if target, err := os.Readlink("/etc/localtime"); err == nil {
		if _, zone, ok := strings.Cut(filepath.ToSlash(target), "/zoneinfo/"); ok && zone != "" {
			return zone
		}
	}
	if data, err := os.ReadFile("/etc/timezone"); err == nil {
		return strings.TrimSpace(string(data))
	}
	return ""
}
