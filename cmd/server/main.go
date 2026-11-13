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
	"path/filepath"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // time zones without system tzdata (scratch/alpine images)

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

//go:embed all:dist
var embeddedDist embed.FS

func main() {
	privateFiles()
	// The server's time zone (internal/clock): TZ or UTC until the stored setting is read (srv.ApplyTimeZone)
	_, _ = clock.Apply("")

	// The logger comes before config.Load, whose warnings (no JWT_SECRET …) would otherwise appear in the
	// standard library's plain format. Errors meant for people are German catalog texts; the log shows them
	// in English.
	level := config.LogLevelFromEnv()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level, ReplaceAttr: i18n.LogInEnglish}))
	slog.SetDefault(logger)
	cfg := config.Load()

	slog.Info("MindSift Server starting", "port", cfg.Port, "log_level", level.String())

	// OIDC_*: half a configuration would leave a sign-in button that cannot work, so the start stops here
	if err := cfg.OIDC.Resolve(); err != nil {
		slog.Error("The sign-in through an OIDC provider is not set up correctly; fix or remove the OIDC_* variables. MindSift does not start", "error", err)
		os.Exit(1)
	}

	store, err := storage.NewStore(cfg.DatabasePath)
	if err != nil {
		slog.Error("Failed to initialize storage", "error", err)
		os.Exit(1)
	}
	defer func() { _ = store.Close() }()
	store.ConfiguredLanguage = cfg.DefaultLanguage
	if v, err := store.SQLiteVersion(); err == nil {
		slog.Info("Database opened", "sqlite", v)
	}

	if cfg.DemoMode {
		slog.Info("Demo mode: resetting the database and setting up the demo accounts...")
		_ = os.RemoveAll(filepath.Join(filepath.Dir(cfg.DatabasePath), "media")) // uploads of the last run
		if err := store.ResetAndSeedDemo(); err != nil {
			slog.Warn("Setting up demo mode failed", "error", err)
		} else {
			slog.Info("Demo accounts ready: admin / admin (admin role) and user / user (member role)")
		}
	}

	// Seed SMTP defaults from environment variables into DB if not yet configured in DB
	store.SeedSMTPDefaultsFromEnv(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPFrom, cfg.SMTPFromName, cfg.SMTPTLS, cfg.SMTPSkipVerify)

	wsHub := ws.NewHub()

	staticFS, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		slog.Error("Failed to mount embedded dist filesystem", "error", err)
		os.Exit(1)
	}

	srv := api.NewServer(cfg, store, wsHub, staticFS)
	srv.ApplyTimeZone()
	// ADMIN_USER / ADMIN_PASSWORD: the first admin exists before anyone can reach the setup wizard. Set
	// but unusable, the server does not start: it would wait for the first visitor to become admin.
	if err := srv.CreateInitialAdmin(); err != nil {
		slog.Error("Creating the first administrator from ADMIN_USER / ADMIN_PASSWORD failed; fix or remove the variables. MindSift does not start, so the setup is not left open", "error", err)
		os.Exit(1)
	}

	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()

	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: srv.Router(),
		BaseContext: func(l net.Listener) context.Context {
			return serverCtx
		},
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
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
	wsHub.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Warn("HTTP server shutdown finished with error", "error", err)
	}
	// Let a running compaction finish before the deferred store.Close
	srv.Close()
}
