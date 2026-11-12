// Package metrics keeps a few counters and histograms in memory and writes them in the Prometheus text
// format (version 0.0.4). Small on purpose: the official client library would bring a dozen modules for the
// handful of numbers MindSift reports. Label values must come from a bounded set (methods, route patterns,
// status codes, results), never from users, ids or addresses.
package metrics

import (
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// CounterVec counts per combination of label values.
type CounterVec struct {
	name, help string
	labels     []string
	mu         sync.Mutex
	values     map[string]float64
}

func NewCounterVec(name, help string, labels ...string) *CounterVec {
	return &CounterVec{name: name, help: help, labels: labels, values: map[string]float64{}}
}

// Inc adds one for the label values (in the order of the labels).
func (c *CounterVec) Inc(values ...string) { c.Add(1, values...) }

func (c *CounterVec) Add(n float64, values ...string) {
	key := joinValues(values)
	c.mu.Lock()
	c.values[key] += n
	c.mu.Unlock()
}

// Value: the count for the label values (tests).
func (c *CounterVec) Value(values ...string) float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.values[joinValues(values)]
}

func (c *CounterVec) write(w io.Writer) {
	c.mu.Lock()
	defer c.mu.Unlock()
	header(w, c.name, c.help, "counter")
	for _, key := range sortedKeys(c.values) {
		fmt.Fprintf(w, "%s%s %s\n", c.name, labelText(c.labels, splitValues(key), "", ""), number(c.values[key]))
	}
}

// HistogramVec counts observations into buckets per combination of label values.
type HistogramVec struct {
	name, help string
	labels     []string
	buckets    []float64
	mu         sync.Mutex
	series     map[string]*histogram
}

type histogram struct {
	counts []uint64 // per bucket, not cumulative
	count  uint64
	sum    float64
}

// DurationBuckets: seconds, from a quick read to a slow export.
var DurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

func NewHistogramVec(name, help string, buckets []float64, labels ...string) *HistogramVec {
	return &HistogramVec{name: name, help: help, labels: labels, buckets: buckets, series: map[string]*histogram{}}
}

func (h *HistogramVec) Observe(v float64, values ...string) {
	key := joinValues(values)
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.series[key]
	if s == nil {
		s = &histogram{counts: make([]uint64, len(h.buckets))}
		h.series[key] = s
	}
	for i, b := range h.buckets {
		if v <= b {
			s.counts[i]++
			break
		}
	}
	s.count++
	s.sum += v
}

func (h *HistogramVec) write(w io.Writer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	header(w, h.name, h.help, "histogram")
	keys := make([]string, 0, len(h.series))
	for k := range h.series {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		s := h.series[key]
		values := splitValues(key)
		var cumulative uint64
		for i, b := range h.buckets {
			cumulative += s.counts[i]
			fmt.Fprintf(w, "%s_bucket%s %d\n", h.name, labelText(h.labels, values, "le", number(b)), cumulative)
		}
		fmt.Fprintf(w, "%s_bucket%s %d\n", h.name, labelText(h.labels, values, "le", "+Inf"), s.count)
		fmt.Fprintf(w, "%s_sum%s %s\n", h.name, labelText(h.labels, values, "", ""), number(s.sum))
		fmt.Fprintf(w, "%s_count%s %d\n", h.name, labelText(h.labels, values, "", ""), s.count)
	}
}

// Sample: one value of a gauge or counter read at scrape time.
type Sample struct {
	Labels []string // label values, in the order of the metric's labels
	Value  float64
}

// Read is a metric whose values are read when Prometheus asks (memory, database, counts).
type Read struct {
	Name, Help, Type string // Type: gauge or counter
	Labels           []string
	Samples          func() []Sample
}

func (m Read) write(w io.Writer) {
	samples := m.Samples()
	if len(samples) == 0 {
		return
	}
	header(w, m.Name, m.Help, m.Type)
	for _, s := range samples {
		fmt.Fprintf(w, "%s%s %s\n", m.Name, labelText(m.Labels, s.Labels, "", ""), number(s.Value))
	}
}

// Registry: the metrics of one server, written in the order they were added.
type Registry struct {
	mu      sync.Mutex
	writers []interface{ write(io.Writer) }
}

func (r *Registry) add(m interface{ write(io.Writer) }) {
	r.mu.Lock()
	r.writers = append(r.writers, m)
	r.mu.Unlock()
}

func (r *Registry) Counter(c *CounterVec) *CounterVec       { r.add(c); return c }
func (r *Registry) Histogram(h *HistogramVec) *HistogramVec { r.add(h); return h }
func (r *Registry) Read(m Read)                             { r.add(m) }

// Write writes every metric in the Prometheus text format.
func (r *Registry) Write(w io.Writer) {
	r.mu.Lock()
	writers := append([]interface{ write(io.Writer) }(nil), r.writers...)
	r.mu.Unlock()
	for _, m := range writers {
		m.write(w)
	}
}

// ContentType of Write's output.
const ContentType = "text/plain; version=0.0.4; charset=utf-8"

func header(w io.Writer, name, help, kind string) {
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n", name, escapeHelp(help), name, kind)
}

func labelText(names, values []string, extraName, extraValue string) string {
	var parts []string
	for i, n := range names {
		v := ""
		if i < len(values) {
			v = values[i]
		}
		parts = append(parts, n+`="`+escapeLabel(v)+`"`)
	}
	if extraName != "" {
		parts = append(parts, extraName+`="`+extraValue+`"`)
	}
	if len(parts) == 0 {
		return ""
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// Label values are joined with a byte that cannot occur in them (bounded sets of plain words)
const sep = "\x00"

func joinValues(values []string) string { return strings.Join(values, sep) }

func splitValues(key string) []string {
	if key == "" {
		return nil
	}
	return strings.Split(key, sep)
}

func sortedKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func number(v float64) string {
	switch {
	case math.IsInf(v, 1):
		return "+Inf"
	case math.IsInf(v, -1):
		return "-Inf"
	case math.IsNaN(v):
		return "NaN"
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}

var labelEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
var helpEscaper = strings.NewReplacer(`\`, `\\`, "\n", `\n`)

func escapeLabel(v string) string { return labelEscaper.Replace(v) }
func escapeHelp(v string) string  { return helpEscaper.Replace(v) }
