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
	"syscall"
	"time"
	_ "time/tzdata" // time zones without system tzdata (scratch/alpine images)

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

//go:embed all:dist
var embeddedDist embed.FS

func main() {
	// Due dates and alarms use the server's local time; without TZ that is Europe/Berlin
	if os.Getenv("TZ") == "" {
		if loc, err := time.LoadLocation("Europe/Berlin"); err == nil {
			time.Local = loc
		}
	}
	cfg := config.Load()

	level := cfg.SlogLevel()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	slog.Info("MindSift Server starting", "port", cfg.Port, "log_level", level.String())

	store, err := storage.NewStore(cfg.DatabasePath)
	if err != nil {
		slog.Error("Failed to initialize storage", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	if cfg.DemoMode {
		slog.Info("🧪 Demo-Modus aktiv: Setze Datenbank zurück und richte Demo-Accounts ein...")
		_ = os.RemoveAll(filepath.Join(filepath.Dir(cfg.DatabasePath), "media")) // uploads of the last run
		if err := store.ResetAndSeedDemo(); err != nil {
			slog.Warn("⚠️ Fehler beim Einrichten des Demo-Modus", "error", err)
		} else {
			slog.Info("✅ Demo-Accounts bereit: admin / admin (Admin-Rolle) und user / user (Standard-Rolle)")
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
	}

	go func() {
		slog.Info("✨ MindSift ready", "url", "http://0.0.0.0:"+cfg.Port)
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
