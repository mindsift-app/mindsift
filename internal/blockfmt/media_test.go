package blockfmt

import "testing"

// An image sized by hand carries its width after the caption (![caption|320](media:…)); old content
// and captions with a "|" stay what they were.
func TestMediaContentWidth(t *testing.T) {
	cases := []struct {
		in      string
		caption string
		width   int
	}{
		{"![Hafen](media:med_ab)", "Hafen", 0},
		{"![Hafen|320](media:med_ab)", "Hafen", 320},
		{"![|48](media:med_ab)", "", 48},
		{`![A\|5](media:med_ab)`, "A|5", 0},
		{`![A\|5|640](media:med_ab)`, "A|5", 640},
		{"![A|B](media:med_ab)", "A|B", 0},
		{"![Riesig|99999](media:med_ab)", "Riesig", MaxMediaWidth},
		{"[Spur|2](media:med_ab)", "Spur|2", 0}, // recordings have no width
	}
	for _, c := range cases {
		ref, ok := ParseMediaContent(c.in)
		if !ok || ref.ID != "med_ab" || ref.Caption != c.caption || ref.Width != c.width {
			t.Errorf("%q: got %+v %v, want caption %q width %d", c.in, ref, ok, c.caption, c.width)
		}
	}
	for _, caption := range []string{"", "Hafen", "A|B", "Seite|12", `C:\|5`, "Plan [Entwurf]"} {
		for _, width := range []int{0, 320} {
			ref, ok := ParseMediaContent(MediaContentSized("image", "med_ab", caption, width))
			if !ok || ref.Caption != caption || ref.Width != width {
				t.Errorf("round trip %q %d: %+v", caption, width, ref)
			}
		}
	}
	if got := MediaContentSized("image", "med_ab", "Hafen", 320); got != "![Hafen|320](media:med_ab)" {
		t.Errorf("sized: %q", got)
	}
	if got := MediaContentSized("audio", "med_ab", "Notiz", 320); got != "[Notiz](media:med_ab)" {
		t.Errorf("audio with width: %q", got)
	}
}
