package api

import (
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// withEnvLocks puts what the environment fixes into a copy of the system settings and marks it (the
// ...ViaEnv fields): ALLOW_PRIVATE_WEBHOOKS, PUSH_KNOWN_SERVICES_ONLY, LINK_PREVIEWS and the backup
// variables. Everything that reads these settings goes through here, so a provider's choice holds
// whatever is stored. nil stays nil.
func (s *Server) withEnvLocks(sys *domain.SystemSettings) *domain.SystemSettings {
	if sys == nil {
		return nil
	}
	out := *sys
	c := s.cfg
	if c.AllowPrivateWebhooks != nil {
		out.AllowPrivateWebhooks, out.AllowPrivateWebhooksViaEnv = *c.AllowPrivateWebhooks, true
	}
	if c.PushKnownServicesOnly != nil {
		on := *c.PushKnownServicesOnly
		out.PushKnownServicesOnly, out.PushKnownServicesOnlyViaEnv = &on, true
	}
	if c.LinkPreviews != nil {
		on := *c.LinkPreviews
		out.LinkPreviews, out.LinkPreviewsViaEnv = &on, true
	}
	if c.BackupEnabled != nil {
		out.BackupEnabled, out.BackupEnabledViaEnv = *c.BackupEnabled, true
	}
	if c.BackupTime != "" {
		out.BackupTime, out.BackupTimeViaEnv = c.BackupTime, true
	}
	if c.BackupRetentionDays > 0 {
		out.BackupRetentionDays, out.BackupRetentionDaysViaEnv = c.BackupRetentionDays, true
	}
	return &out
}

// effectiveSettings: the stored system settings with what the environment fixes (nil when unreadable).
func (s *Server) effectiveSettings() *domain.SystemSettings {
	sys, _ := s.store.GetSystemSettings()
	return s.withEnvLocks(sys)
}

// keepEnvLocked puts the stored value back into an update for every setting the environment fixes, so
// a save from the administration (or the setup wizard) never overwrites it.
func (s *Server) keepEnvLocked(update, stored *domain.SystemSettings) {
	if stored == nil {
		return
	}
	c := s.cfg
	if c.AllowPrivateWebhooks != nil {
		update.AllowPrivateWebhooks = stored.AllowPrivateWebhooks
	}
	if c.PushKnownServicesOnly != nil {
		update.PushKnownServicesOnly = nil
	}
	if c.LinkPreviews != nil {
		update.LinkPreviews = nil
	}
	if c.BackupEnabled != nil {
		update.BackupEnabled = stored.BackupEnabled
	}
	if c.BackupTime != "" {
		update.BackupTime = stored.BackupTime
	}
	if c.BackupRetentionDays > 0 {
		update.BackupRetentionDays = stored.BackupRetentionDays
	}
	// The mail server: the environment's (SMTP_HOST) or none at all (SMTP_DISABLED); what is stored stays
	s.keepLegalEnvLocked(update.Legal, stored.Legal)
	s.keepSpeechEnvLocked(update.Speech, stored.Speech)
	if c.SMTPDisabled || s.smtpViaEnv() {
		update.SMTPHost, update.SMTPPort, update.SMTPUser, update.SMTPPass = stored.SMTPHost, stored.SMTPPort, stored.SMTPUser, stored.SMTPPass
		update.SMTPFrom, update.SMTPFromName, update.SMTPTLS, update.SMTPSkipVerify = stored.SMTPFrom, stored.SMTPFromName, stored.SMTPTLS, stored.SMTPSkipVerify
		update.SMTPPassUnreadable = stored.SMTPPassUnreadable
	}
	update.AllowPrivateWebhooksViaEnv, update.PushKnownServicesOnlyViaEnv, update.LinkPreviewsViaEnv = false, false, false
	update.BackupEnabledViaEnv, update.BackupTimeViaEnv, update.BackupRetentionDaysViaEnv, update.SMTPDisabledViaEnv = false, false, false, false
}

// smtpFromEnv: the mail server the SMTP_* variables describe (SMTP_HOST set).
func (s *Server) smtpFromEnv() smtpSettings {
	c := s.cfg
	return smtpSettings{
		Host: strings.TrimSpace(c.SMTPHost), Port: strings.TrimSpace(c.SMTPPort),
		User: strings.TrimSpace(c.SMTPUser), Pass: c.SMTPPass, From: strings.TrimSpace(c.SMTPFrom),
		FromName: strings.TrimSpace(c.SMTPFromName),
		TLS:      c.SMTPTLS, SkipVerify: c.SMTPSkipVerify,
	}
}

// legal: imprint, privacy notice and the footer's own link as they apply. Each LEGAL_* variable that is
// set fixes its field (the footer link as label and address together); the rest comes from the
// administration. ConfiguredViaEnv names the fixed fields.
func (s *Server) legal() domain.LegalSettings {
	var out domain.LegalSettings
	if sys, _ := s.store.GetSystemSettings(); sys != nil && sys.Legal != nil {
		out = *sys.Legal
	}
	out.ConfiguredViaEnv = nil
	env := s.cfg.Legal
	for _, f := range []struct {
		name  string
		value string
		field *string
	}{
		{"imprintUrl", env.ImprintURL, &out.ImprintURL},
		{"imprintContent", env.ImprintContent, &out.ImprintContent},
		{"privacyUrl", env.PrivacyURL, &out.PrivacyURL},
		{"privacyContent", env.PrivacyContent, &out.PrivacyContent},
	} {
		if f.value != "" {
			*f.field = f.value
			out.ConfiguredViaEnv = append(out.ConfiguredViaEnv, f.name)
		}
	}
	if env.CustomLinkURL != "" {
		out.CustomLinkLabel, out.CustomLinkURL = env.CustomLinkLabel, env.CustomLinkURL
		out.ConfiguredViaEnv = append(out.ConfiguredViaEnv, "customLink")
	}
	return out
}

// keepLegalEnvLocked puts the stored value back for every legal field the environment fixes.
func (s *Server) keepLegalEnvLocked(update, stored *domain.LegalSettings) {
	if update == nil {
		return
	}
	if stored == nil {
		stored = &domain.LegalSettings{}
	}
	env := s.cfg.Legal
	if env.ImprintURL != "" {
		update.ImprintURL = stored.ImprintURL
	}
	if env.ImprintContent != "" {
		update.ImprintContent = stored.ImprintContent
	}
	if env.PrivacyURL != "" {
		update.PrivacyURL = stored.PrivacyURL
	}
	if env.PrivacyContent != "" {
		update.PrivacyContent = stored.PrivacyContent
	}
	if env.CustomLinkURL != "" {
		update.CustomLinkLabel, update.CustomLinkURL = stored.CustomLinkLabel, stored.CustomLinkURL
	}
	update.ConfiguredViaEnv = nil
}
