package collab

import (
	"errors"
	"strings"
)

// Order keys sort siblings lexicographically (ties broken by block ID) and allow inserting between any two
// keys without renumbering. Format as in the "fractional-indexing" scheme: an integer part whose first
// character encodes its length ('a'..'z' positive, 'A'..'Z' negative) followed by base-62 digits, then an
// optional fraction without trailing '0'. Appending stays short ("a0", "a1", …, "az", "b00", …).
const keyDigits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

const smallestInteger = "A00000000000000000000000000"

var errInvalidOrderKey = errors.New("ungültiger Sortierschlüssel")

func digitIndex(c byte) int {
	return strings.IndexByte(keyDigits, c)
}

func integerLength(head byte) int {
	switch {
	case head >= 'a' && head <= 'z':
		return int(head-'a') + 2
	case head >= 'A' && head <= 'Z':
		return int('Z'-head) + 2
	}
	return 0
}

func integerPart(key string) (string, bool) {
	if key == "" {
		return "", false
	}
	n := integerLength(key[0])
	if n == 0 || n > len(key) {
		return "", false
	}
	return key[:n], true
}

// ValidOrderKey reports whether k is a well-formed key.
func ValidOrderKey(k string) bool {
	if k == "" || len(k) > 256 || k == smallestInteger {
		return false
	}
	ip, ok := integerPart(k)
	if !ok {
		return false
	}
	for i := 1; i < len(k); i++ {
		if digitIndex(k[i]) < 0 {
			return false
		}
	}
	frac := k[len(ip):]
	return frac == "" || frac[len(frac)-1] != '0'
}

func incrementInteger(x string) (string, bool) {
	head, digs := x[0], []byte(x[1:])
	carry := true
	for i := len(digs) - 1; carry && i >= 0; i-- {
		d := digitIndex(digs[i]) + 1
		if d == len(keyDigits) {
			digs[i] = '0'
		} else {
			digs[i] = keyDigits[d]
			carry = false
		}
	}
	if !carry {
		return string(head) + string(digs), true
	}
	if head == 'Z' {
		return "a0", true
	}
	if head == 'z' {
		return "", false
	}
	h := head + 1
	if h > 'a' {
		digs = append(digs, '0')
	} else {
		digs = digs[:len(digs)-1]
	}
	return string(h) + string(digs), true
}

func decrementInteger(x string) (string, bool) {
	head, digs := x[0], []byte(x[1:])
	borrow := true
	for i := len(digs) - 1; borrow && i >= 0; i-- {
		d := digitIndex(digs[i]) - 1
		if d == -1 {
			digs[i] = 'z'
		} else {
			digs[i] = keyDigits[d]
			borrow = false
		}
	}
	if !borrow {
		return string(head) + string(digs), true
	}
	if head == 'a' {
		return "Z" + string(keyDigits[len(keyDigits)-1]), true
	}
	if head == 'A' {
		return "", false
	}
	h := head - 1
	if h < 'Z' {
		digs = append(digs, 'z')
	} else {
		digs = digs[:len(digs)-1]
	}
	return string(h) + string(digs), true
}

// midpoint returns a fraction between a and b (a may be "" = 0, b may be "" = 1).
func midpoint(a, b string) string {
	if b != "" {
		n := 0
		for n < len(b) {
			ca := byte('0')
			if n < len(a) {
				ca = a[n]
			}
			if ca != b[n] {
				break
			}
			n++
		}
		if n > 0 {
			rest := ""
			if n < len(a) {
				rest = a[n:]
			}
			return b[:n] + midpoint(rest, b[n:])
		}
	}
	da := 0
	if a != "" {
		da = digitIndex(a[0])
	}
	db := len(keyDigits)
	if b != "" {
		db = digitIndex(b[0])
	}
	if db-da > 1 {
		return string(keyDigits[(da+db)/2])
	}
	if b != "" && len(b) > 1 {
		return b[:1]
	}
	rest := ""
	if len(a) > 1 {
		rest = a[1:]
	}
	return string(keyDigits[da]) + midpoint(rest, "")
}

// KeyBetween returns a key strictly between a and b. An empty a means "before everything",
// an empty b means "after everything".
func KeyBetween(a, b string) (string, error) {
	if (a != "" && !ValidOrderKey(a)) || (b != "" && !ValidOrderKey(b)) {
		return "", errInvalidOrderKey
	}
	if a != "" && b != "" && a >= b {
		return "", errInvalidOrderKey
	}
	switch {
	case a == "" && b == "":
		return "a0", nil
	case a == "":
		ib, _ := integerPart(b)
		fb := b[len(ib):]
		if ib == smallestInteger {
			return ib + midpoint("", fb), nil
		}
		if ib < b {
			return ib, nil
		}
		res, ok := decrementInteger(ib)
		if !ok {
			return "", errInvalidOrderKey
		}
		return res, nil
	case b == "":
		ia, _ := integerPart(a)
		fa := a[len(ia):]
		if i, ok := incrementInteger(ia); ok {
			return i, nil
		}
		return ia + midpoint(fa, ""), nil
	}
	ia, _ := integerPart(a)
	fa := a[len(ia):]
	ib, _ := integerPart(b)
	fb := b[len(ib):]
	if ia == ib {
		return ia + midpoint(fa, fb), nil
	}
	i, ok := incrementInteger(ia)
	if !ok {
		return "", errInvalidOrderKey
	}
	if i < b {
		return i, nil
	}
	return ia + midpoint(fa, ""), nil
}

// KeysBetween returns n increasing keys between a and b, spread so that bulk inserts stay short.
func KeysBetween(a, b string, n int) ([]string, error) {
	if n <= 0 {
		return nil, nil
	}
	if n == 1 {
		k, err := KeyBetween(a, b)
		if err != nil {
			return nil, err
		}
		return []string{k}, nil
	}
	if b == "" {
		keys := make([]string, 0, n)
		prev := a
		for i := 0; i < n; i++ {
			k, err := KeyBetween(prev, "")
			if err != nil {
				return nil, err
			}
			keys = append(keys, k)
			prev = k
		}
		return keys, nil
	}
	if a == "" {
		keys := make([]string, n)
		next := b
		for i := n - 1; i >= 0; i-- {
			k, err := KeyBetween("", next)
			if err != nil {
				return nil, err
			}
			keys[i] = k
			next = k
		}
		return keys, nil
	}
	mid := n / 2
	c, err := KeyBetween(a, b)
	if err != nil {
		return nil, err
	}
	left, err := KeysBetween(a, c, mid)
	if err != nil {
		return nil, err
	}
	right, err := KeysBetween(c, b, n-mid-1)
	if err != nil {
		return nil, err
	}
	return append(append(left, c), right...), nil
}
