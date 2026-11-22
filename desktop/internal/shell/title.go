package shell

import (
	"net/url"
	"strings"
)

// AppTitle: the window's title on the start view; with an entry open "<name> – MindSift"
const AppTitle = "MindSift"

// EntryTitle: the window's title while the entry is shown
func EntryTitle(e Entry) string { return e.Name + " – " + AppTitle }

// TitleFor: the window's title for the page it shows now (its address), so it follows the history too: a
// page of the window's own origin is the start view or the open local instance, a page of a server is that
// server's entry (the one whose address it lies under, the longest match), anything else the app's name.
func (s *Shell) TitleFor(address string) string {
	if OwnPage(address, s.Origin) {
		if u, err := url.Parse(address); err == nil && !strings.HasPrefix(u.Path, "/__desktop/") {
			if e, ok := s.Settings.Get(s.Local.Current()); ok {
				return EntryTitle(e)
			}
		}
		return AppTitle
	}
	u, err := url.Parse(address)
	if err != nil {
		return AppTitle
	}
	var best Entry
	bestLen := -1
	for _, e := range s.Settings.Entries() {
		if e.Kind != KindServer {
			continue
		}
		eu, err := url.Parse(e.URL)
		if err != nil || !strings.EqualFold(eu.Scheme, u.Scheme) || !strings.EqualFold(eu.Host, u.Host) {
			continue
		}
		// A server may live under a path ("https://host/mindsift/"): its entry counts for the pages below it
		base := strings.TrimSuffix(eu.Path, "/")
		if (u.Path == base || strings.HasPrefix(u.Path, base+"/")) && len(base) > bestLen {
			best, bestLen = e, len(base)
		}
	}
	if bestLen < 0 {
		return AppTitle
	}
	return EntryTitle(best)
}
