package shell

import (
	"testing"
	"time"
	_ "time/tzdata"
)

func TestWindowsToIANA(t *testing.T) {
	for key, want := range map[string]string{
		"W. Europe Standard Time":        "Europe/Berlin",
		"Pacific Standard Time":          "America/Los_Angeles",
		"Tokyo Standard Time":            "Asia/Tokyo",
		"UTC":                            "Etc/UTC",
		"India Standard Time":            "Asia/Calcutta",
		"Central European Standard Time": "Europe/Warsaw",
		"  W. Europe Standard Time  ":    "Europe/Berlin",
		"w. europe standard time":        "Europe/Berlin",
		"":                               "",
		"Nowhere Standard Time":          "",
	} {
		if got := WindowsToIANA(key); got != want {
			t.Errorf("WindowsToIANA(%q) = %q, want %q", key, got, want)
		}
	}
}

// Every name of the table must be one the server can load, or the instance would fall back to UTC again
func TestWindowsZonesAreLoadable(t *testing.T) {
	if len(windowsZones) < 100 {
		t.Fatalf("only %d zones in the table", len(windowsZones))
	}
	for key, zone := range windowsZones {
		if _, err := time.LoadLocation(zone); err != nil {
			t.Errorf("%q -> %q: %v", key, zone, err)
		}
	}
}
