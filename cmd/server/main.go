package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // time zones without system tzdata (scratch/alpine images)

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/cli"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

//go:embed all:dist
var embeddedDist embed.FS

// version: the release the binary was built as, set by the image build (-ldflags "-X main.version=…" from
// APP_VERSION). Empty for local builds; only a release version looks for newer releases (api/update.go).
var version = ""

func main() {
	privateFiles()
	// mindsift <command>: the operator's command line (users, reset-password, check …); without one,
	// or with "serve", the server starts as always
	if cli.IsCommand(os.Args[1:]) {
		os.Exit(cli.Main(os.Args[1:]))
	}
	// The server's time zone (internal/clock): TZ or UTC until the stored setting is read (srv.ApplyTimeZone)
	_, _ = clock.Apply("")

	// The logger comes before config.Load, whose warnings (no JWT_SECRET …) would otherwise appear in the
	// standard library's plain format. Errors meant for people are German catalog texts; the log shows them
	// in English.
	level := config.LogLevelFromEnv()
	logOpts := &slog.HandlerOptions{Level: level, ReplaceAttr: i18n.LogInEnglish}
	var handler slog.Handler = slog.NewTextHandler(os.Stdout, logOpts)
	if config.LogJSONFromEnv() {
		handler = slog.NewJSONHandler(os.Stdout, logOpts)
	}
	logger := slog.New(handler)
	slog.SetDefault(logger)
	cfg := config.Load()
	cfg.AppVersion = version

	slog.Info("MindSift Server starting", "port", cfg.Port, "log_level", level.String(), "version", version)

	// OIDC_*: half a configuration would leave a sign-in button that cannot work, so the start stops here
	if err := cfg.OIDC.Resolve(); err != nil {
		slog.Error("The sign-in through an OIDC provider is not set up correctly; fix or remove the OIDC_* variables. MindSift does not start", "error", err)
		os.Exit(1)
	}

	staticFS, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		slog.Error("Failed to mount embedded dist filesystem", "error", err)
		os.Exit(1)
	}
	rn := &runner{cfg: cfg, static: staticFS}
	first, err := rn.open(true)
	if err != nil {
		slog.Error("Failed to initialize storage", "error", err)
		os.Exit(1)
	}
	rn.cur = first

	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()

	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: rn,
		BaseContext: func(l net.Listener) context.Context {
			return serverCtx
		},
		ReadTimeout:  api.ReadTimeout,
		WriteTimeout: api.WriteTimeout,
		IdleTimeout:  api.IdleTimeout,
		// MindSift sets no cookies and uses short headers; Go's default of 1 MiB per request only helps
		// someone filling the server's memory
		MaxHeaderBytes: 64 << 10,
	}

	go func() {
		// The port it listens on, and the address people reach it at when BASE_URL says so (behind a proxy
		// that is not the port)
		ready := []any{"listen", ":" + cfg.Port}
		if cfg.BaseURLSet {
			ready = append(ready, "url", strings.TrimRight(cfg.BaseURL, "/"))
		}
		slog.Info("MindSift ready", ready...)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	slog.Info("Shutting down MindSift server gracefully...")
	serverCancel()
	rn.mu.Lock()
	cur := rn.cur
	rn.mu.Unlock()
	if cur != nil {
		cur.hub.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Warn("HTTP server shutdown finished with error", "error", err)
	}
	// Let a running compaction finish before the store closes
	if cur != nil {
		cur.close(0)
	}
}
