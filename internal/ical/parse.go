package ical

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Parse reads iCalendar text strictly, the way the tests check the feed: every line must end in CRLF,
// be at most 75 octets long and valid UTF-8, components must nest properly and the text must be one
// VCALENDAR. It unfolds lines and unescapes TEXT values. It is not a general parser (no recurrence, no
// quoted parameter values with colons).
func Parse(text string) (*Component, error) {
	if !strings.HasSuffix(text, "\r\n") {
		return nil, errors.New("the text does not end with CRLF")
	}
	raw := strings.Split(strings.TrimSuffix(text, "\r\n"), "\r\n")
	var lines []string
	for i, l := range raw {
		if strings.ContainsAny(l, "\r\n") {
			return nil, fmt.Errorf("line %d: bare CR or LF", i+1)
		}
		if len(l) > maxLineOctets {
			return nil, fmt.Errorf("line %d: %d octets, more than %d", i+1, len(l), maxLineOctets)
		}
		if !utf8.ValidString(l) {
			return nil, fmt.Errorf("line %d: invalid UTF-8 (a character split by folding?)", i+1)
		}
		if strings.HasPrefix(l, " ") || strings.HasPrefix(l, "\t") {
			if len(lines) == 0 {
				return nil, fmt.Errorf("line %d: continuation without a line before", i+1)
			}
			lines[len(lines)-1] += l[1:]
			continue
		}
		lines = append(lines, l)
	}

	var stack []*Component
	var root *Component
	for i, l := range lines {
		name, value, ok := strings.Cut(l, ":")
		if !ok || name == "" {
			return nil, fmt.Errorf("logical line %d: no property name: %q", i+1, l)
		}
		params := map[string]string{}
		parts := strings.Split(name, ";")
		name = strings.ToUpper(parts[0])
		for _, p := range parts[1:] {
			k, v, ok := strings.Cut(p, "=")
			if !ok {
				return nil, fmt.Errorf("logical line %d: broken parameter %q", i+1, p)
			}
			params[strings.ToUpper(k)] = v
		}
		switch name {
		case "BEGIN":
			c := &Component{Name: strings.ToUpper(value)}
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, c)
			} else if root != nil {
				return nil, errors.New("more than one top-level component")
			} else {
				root = c
			}
			stack = append(stack, c)
		case "END":
			if len(stack) == 0 || stack[len(stack)-1].Name != strings.ToUpper(value) {
				return nil, fmt.Errorf("logical line %d: END:%s does not close the open component", i+1, value)
			}
			stack = stack[:len(stack)-1]
		default:
			if len(stack) == 0 {
				return nil, fmt.Errorf("logical line %d: property outside a component", i+1)
			}
			c := stack[len(stack)-1]
			c.Props = append(c.Props, Property{Name: name, Params: params, Value: value})
		}
	}
	if len(stack) > 0 {
		return nil, fmt.Errorf("component %s is not closed", stack[len(stack)-1].Name)
	}
	if root == nil || root.Name != "VCALENDAR" {
		return nil, errors.New("no VCALENDAR")
	}
	return root, nil
}

// Component is a parsed VCALENDAR, VEVENT, VALARM …
type Component struct {
	Name     string
	Props    []Property
	Children []*Component
}

// Property is one property with its raw (still escaped) value.
type Property struct {
	Name   string
	Params map[string]string
	Value  string
}

// Get returns the first property of that name.
func (c *Component) Get(name string) (Property, bool) {
	for _, p := range c.Props {
		if p.Name == name {
			return p, true
		}
	}
	return Property{}, false
}

// Text returns the unescaped TEXT value of the first property of that name ("" when missing).
func (c *Component) Text(name string) string {
	p, _ := c.Get(name)
	return UnescapeText(p.Value)
}

// All returns the child components of that name.
func (c *Component) All(name string) []*Component {
	var out []*Component
	for _, ch := range c.Children {
		if ch.Name == name {
			out = append(out, ch)
		}
	}
	return out
}

// UnescapeText reverses EscapeText.
func UnescapeText(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			i++
			switch s[i] {
			case 'n', 'N':
				b.WriteByte('\n')
			default:
				b.WriteByte(s[i])
			}
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
