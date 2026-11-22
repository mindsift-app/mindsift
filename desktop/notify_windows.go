//go:build windows

package main

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
)

// Toast notifications through Wails' notification service (go-toast). Its start registers the app for
// toasts under the AppUserModelID "MindSift" (the app's name): HKCU\Software\Classes\AppUserModelId\MindSift
// with display name, icon (the exe's, saved as a PNG in the temp folder) and a COM activator
// (HKCU\Software\Classes\CLSID\{…}\LocalServer32 = this exe), so an unpackaged exe (portable or installed)
// needs no shortcut with an AUMID. A click comes back through the activator while the app runs; clicked
// after the app quit, Windows starts the exe again (the instance used last opens, the task does not).

type toastNotes struct {
	svc   *notifications.NotificationService
	ready atomic.Bool
}

// newNoteShower registers the service with the app, so it starts on the main thread with the app's services
// (COM is set up there).
func newNoteShower(app *application.App, onClick func(data string)) shell.NoteShower {
	t := &toastNotes{svc: notifications.New()}
	t.svc.OnNotificationResponse(func(r notifications.NotificationResult) {
		if r.Error != nil {
			slog.Warn("Reading a clicked notification failed", "error", r.Error)
			return
		}
		if r.Response.ActionIdentifier != notifications.DefaultActionIdentifier {
			return
		}
		if data, ok := r.Response.UserInfo["data"].(string); ok {
			onClick(data)
		}
	})
	app.RegisterService(application.NewService(&toastService{t: t}))
	return t
}

// toastService starts Wails' service; a failure leaves the app running without toasts (registered
// directly, Wails would not start the app at all).
type toastService struct{ t *toastNotes }

func (s *toastService) ServiceName() string { return "mindsift-notifications" }

func (s *toastService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if err := s.t.svc.ServiceStartup(ctx, options); err != nil {
		slog.Warn("Windows notifications not available", "error", err)
		return nil
	}
	s.t.ready.Store(true)
	return nil
}

func (s *toastService) ServiceShutdown() error {
	if s.t.ready.Load() {
		return s.t.svc.ServiceShutdown()
	}
	return nil
}

func (t *toastNotes) Show(n shell.Note) error {
	if !t.ready.Load() {
		return errors.New("windows notifications are not available")
	}
	return t.svc.SendNotification(notifications.NotificationOptions{
		ID: n.ID, Title: n.Title, Body: n.Body, Data: map[string]any{"data": n.Data},
	})
}
