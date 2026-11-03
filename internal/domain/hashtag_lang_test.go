package domain

import (
	"reflect"
	"testing"
)

// Hashtags work with the letters of every language, not only German umlauts.
func TestExtractTagsAnyLetters(t *testing.T) {
	got := ExtractTags("#café #niño #città #Küche")
	if want := []string{"café", "niño", "città", "küche"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
