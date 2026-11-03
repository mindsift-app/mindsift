package collab

import (
	"math/rand"
	"sort"
	"testing"
)

func TestKeyBetweenBasics(t *testing.T) {
	cases := [][2]string{{"", ""}, {"", "a0"}, {"a0", ""}, {"a0", "a1"}, {"a0", "a0V"}, {"a1", "a2"}, {"a0V", "a1"}, {"Zz", "a0"}, {"az", ""}, {"", "Zz"}}
	for _, c := range cases {
		k, err := KeyBetween(c[0], c[1])
		if err != nil {
			t.Fatalf("KeyBetween(%q,%q): %v", c[0], c[1], err)
		}
		if !ValidOrderKey(k) {
			t.Fatalf("KeyBetween(%q,%q) = %q is not a valid key", c[0], c[1], k)
		}
		if (c[0] != "" && k <= c[0]) || (c[1] != "" && k >= c[1]) {
			t.Fatalf("KeyBetween(%q,%q) = %q is not between", c[0], c[1], k)
		}
	}
	if _, err := KeyBetween("a1", "a0"); err == nil {
		t.Fatal("reversed range must fail")
	}
	if _, err := KeyBetween("a0V0", ""); err == nil {
		t.Fatal("trailing zero key must be rejected")
	}
}

// Random inserts between neighbours must always produce a strictly increasing sequence.
func TestKeyBetweenRandomInserts(t *testing.T) {
	r := rand.New(rand.NewSource(42))
	keys := []string{}
	for i := 0; i < 3000; i++ {
		pos := r.Intn(len(keys) + 1)
		a, b := "", ""
		if pos > 0 {
			a = keys[pos-1]
		}
		if pos < len(keys) {
			b = keys[pos]
		}
		k, err := KeyBetween(a, b)
		if err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
		keys = append(keys[:pos], append([]string{k}, keys[pos:]...)...)
	}
	if !sort.StringsAreSorted(keys) {
		t.Fatal("keys are not sorted")
	}
	for i := 1; i < len(keys); i++ {
		if keys[i] == keys[i-1] {
			t.Fatalf("duplicate key %q", keys[i])
		}
	}
}

// Appending at the end, the most common case, must keep keys short.
func TestKeyBetweenAppendStaysShort(t *testing.T) {
	last := ""
	for i := 0; i < 1000; i++ {
		k, _ := KeyBetween(last, "")
		last = k
	}
	if len(last) > 4 {
		t.Fatalf("key after 1000 appends too long: %d chars", len(last))
	}
}

func TestKeysBetweenBulk(t *testing.T) {
	for _, r := range [][2]string{{"", ""}, {"a0", ""}, {"", "a0"}, {"a0", "a1"}} {
		keys, err := KeysBetween(r[0], r[1], 500)
		if err != nil {
			t.Fatalf("%v: %v", r, err)
		}
		if len(keys) != 500 || !sort.StringsAreSorted(keys) {
			t.Fatalf("%v: wrong or unsorted result", r)
		}
		for i, k := range keys {
			if !ValidOrderKey(k) || (i > 0 && keys[i-1] == k) {
				t.Fatalf("%v: bad key %q", r, k)
			}
			if (r[0] != "" && k <= r[0]) || (r[1] != "" && k >= r[1]) {
				t.Fatalf("%v: key %q out of range", r, k)
			}
		}
	}
}
