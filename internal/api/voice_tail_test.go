package api

import "testing"

// Whisper sometimes repeats earlier sentences or the last words at the end of a longer recording.
func TestDropRepeatedTail(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"Morgen den Filter wechseln. Dann die Heizung prüfen. Morgen den Filter wechseln.", "Morgen den Filter wechseln. Dann die Heizung prüfen."},
		{"Erst einkaufen. Dann kochen. Danach abwaschen. Dann kochen. Danach abwaschen.", "Erst einkaufen. Dann kochen. Danach abwaschen."},
		{"bitte die neue Version auf dem Server einspielen bitte die neue Version auf dem Server einspielen", "bitte die neue Version auf dem Server einspielen"},
		// Nothing repeated, or only a short word: unchanged
		{"Ja. Nein. Ja.", "Ja. Nein. Ja."},
		{"Kauf Milch, Brot und Eier. Und Butter.", "Kauf Milch, Brot und Eier. Und Butter."},
		{"", ""},
	} {
		if got := dropRepeatedTail(tc.in); got != tc.want {
			t.Errorf("dropRepeatedTail(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
