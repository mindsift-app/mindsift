package clock

import (
	"sync"
	"testing"
	"time"
)

func TestResolvePrecedence(t *testing.T) {
	cases := []struct {
		setting, env   string
		zone, source   string
		skippedSetting bool
	}{
		{"Europe/Berlin", "America/Los_Angeles", "Europe/Berlin", SourceSetting, false},
		{"", "America/Los_Angeles", "America/Los_Angeles", SourceEnv, false},
		{"  ", ":Asia/Tokyo", "Asia/Tokyo", SourceEnv, false}, // POSIX colon as Go reads TZ
		{"", "", "UTC", SourceDefault, false},
		{"Mars/Olympus", "Asia/Tokyo", "Asia/Tokyo", SourceEnv, true},
		{"Mars/Olympus", "", "UTC", SourceDefault, true},
		{"", "Nowhere/Town", "UTC", SourceDefault, true},
		{"UTC", "Asia/Tokyo", "UTC", SourceSetting, false},
	}
	for _, c := range cases {
		z, err := Resolve(c.setting, c.env)
		if z.Name() != c.zone || z.Source != c.source {
			t.Errorf("Resolve(%q, %q) = %s (%s), want %s (%s)", c.setting, c.env, z.Name(), z.Source, c.zone, c.source)
		}
		if (err != nil) != c.skippedSetting {
			t.Errorf("Resolve(%q, %q): err = %v", c.setting, c.env, err)
		}
	}
}

func TestLoadRefusesLocalAndUnknown(t *testing.T) {
	for _, name := range []string{"", "Local", "Mars/Olympus", "../../etc/passwd", "Europe/Berlin\x00"} {
		if _, err := Load(name); err == nil {
			t.Errorf("Load(%q) must fail", name)
		}
	}
	for _, name := range []string{"UTC", "Europe/Berlin", "America/Argentina/Buenos_Aires", "Asia/Kathmandu"} {
		if _, err := Load(name); err != nil {
			t.Errorf("Load(%q): %v", name, err)
		}
	}
}

func TestApplyReadsTZ(t *testing.T) {
	prev := Current()
	t.Cleanup(func() { Set(prev) })
	t.Setenv("TZ", "America/Los_Angeles")
	if z, _ := Apply(""); z.Name() != "America/Los_Angeles" || Location().String() != "America/Los_Angeles" || Current().Source != SourceEnv {
		t.Fatalf("Apply without setting: %s %s", z.Name(), z.Source)
	}
	if z, _ := Apply("Asia/Tokyo"); z.Name() != "Asia/Tokyo" || z.Source != SourceSetting {
		t.Fatalf("Apply with setting: %s %s", z.Name(), z.Source)
	}
	t.Setenv("TZ", "")
	if z, _ := Apply(""); z.Name() != "UTC" || z.Source != SourceDefault {
		t.Fatalf("Apply without anything: %s %s", z.Name(), z.Source)
	}
}

// One instant, two calendar days: the zone decides which day is today
func TestNowAndIn(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	UseInTest(t, tokyo)
	instant := time.Date(2026, 11, 13, 23, 30, 0, 0, time.UTC)
	if got := In(instant).Format("2006-01-02 15:04"); got != "2026-11-14 08:30" {
		t.Fatalf("In: %s", got)
	}
	if Now().Location() != tokyo || len(Today()) != 10 {
		t.Fatalf("Now in %s, Today %q", Now().Location(), Today())
	}
	Set(Zone{}) // no location: UTC
	if Location() != time.UTC || In(instant).Day() != 13 {
		t.Fatalf("empty zone must mean UTC, got %s", Location())
	}
}

// Readers on other goroutines while the administration changes the zone (run with -race)
func TestSetWhileReading(t *testing.T) {
	prev := Current()
	t.Cleanup(func() { Set(prev) })
	berlin, _ := time.LoadLocation("Europe/Berlin")
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = Today()
					_ = In(time.Now()).Hour()
				}
			}
		}()
	}
	for i := range 200 {
		if i%2 == 0 {
			Set(Zone{Loc: berlin, Source: SourceSetting})
		} else {
			Set(Zone{Loc: time.UTC, Source: SourceDefault})
		}
	}
	close(stop)
	wg.Wait()
}
