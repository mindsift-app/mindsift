package shell

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Problem is an error the start view shows in the person's language: Code names the text
// (desktop.json of the frontend, errors.<code>), Detail is shown as it is (a status, a system error).
type Problem struct {
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

func (p *Problem) Error() string {
	if p.Detail == "" {
		return p.Code
	}
	return p.Code + ": " + p.Detail
}

func problem(code string, detail ...any) *Problem {
	p := &Problem{Code: code}
	if len(detail) > 0 {
		p.Detail = fmt.Sprint(detail...)
	}
	return p
}

// NormalizeServerURL: a server address as typed ("notes.example.com") as https://notes.example.com/
func NormalizeServerURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", problem("urlMissing")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		return "", problem("urlInvalid", raw)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/"
	u.RawQuery, u.Fragment = "", ""
	return u.String(), nil
}

// CheckServer: the address answers like a MindSift server (GET api/v1/health)
func CheckServer(ctx context.Context, base string) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"api/v1/health", nil)
	if err != nil {
		return problem("urlInvalid", base)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return problem("serverUnreachable", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return problem("notMindSift", resp.StatusCode)
	}
	return nil
}
