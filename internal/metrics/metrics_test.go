package metrics

import (
	"strings"
	"testing"
)

func TestTextFormat(t *testing.T) {
	var r Registry
	req := r.Counter(NewCounterVec("app_requests_total", "Requests answered.", "method", "status"))
	req.Inc("GET", "200")
	req.Inc("GET", "200")
	req.Inc("POST", "500")
	dur := r.Histogram(NewHistogramVec("app_duration_seconds", "Time to answer.", []float64{0.1, 1}, "method"))
	dur.Observe(0.05, "GET")
	dur.Observe(0.5, "GET")
	dur.Observe(3, "GET")
	r.Read(Read{Name: "app_users", Help: "Accounts.", Type: "gauge", Samples: func() []Sample { return []Sample{{Value: 7}} }})
	r.Read(Read{Name: "app_empty", Help: "Left out.", Type: "gauge", Samples: func() []Sample { return nil }})

	var b strings.Builder
	r.Write(&b)
	want := `# HELP app_requests_total Requests answered.
# TYPE app_requests_total counter
app_requests_total{method="GET",status="200"} 2
app_requests_total{method="POST",status="500"} 1
# HELP app_duration_seconds Time to answer.
# TYPE app_duration_seconds histogram
app_duration_seconds_bucket{method="GET",le="0.1"} 1
app_duration_seconds_bucket{method="GET",le="1"} 2
app_duration_seconds_bucket{method="GET",le="+Inf"} 3
app_duration_seconds_sum{method="GET"} 3.55
app_duration_seconds_count{method="GET"} 3
# HELP app_users Accounts.
# TYPE app_users gauge
app_users 7
`
	if b.String() != want {
		t.Fatalf("got\n%s\nwant\n%s", b.String(), want)
	}
}

func TestLabelEscaping(t *testing.T) {
	var r Registry
	c := r.Counter(NewCounterVec("x_total", "Line one\nline two.", "route"))
	c.Inc(`/a"b\c`)
	var b strings.Builder
	r.Write(&b)
	if !strings.Contains(b.String(), `x_total{route="/a\"b\\c"} 1`) || !strings.Contains(b.String(), `# HELP x_total Line one\nline two.`) {
		t.Fatalf("escaping: %s", b.String())
	}
}
