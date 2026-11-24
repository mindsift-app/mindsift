import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleAlert,
  Send,
} from 'lucide-react';
import { useAdminSettings } from './useAdminSettings';
import { SmtpFields } from './SmtpFields';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { SettingsCard } from '../../../components/SettingsCard';

// Administration → E-Mail / SMTP-Server (state in useAdminSettings)
export function SmtpSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const {
    settings,
    testSmtpEmail,
    testingSmtp,
    demoMode,
    handleSaveSystemSettings,
    handleTestSmtp,
    setSettings,
    setTestSmtpEmail,
  } = admin;
  // SMTP_PASS applies to the mail server and user the form names right now (as the server compares them),
  // so the field frees up as soon as another server is entered, before saving
  const passwordViaEnv = smtpPassAppliesTo(settings.smtpHost, settings.smtpUser, settings.smtpPassEnvHost, settings.smtpPassEnvUser);
  return (
    <fieldset disabled={demoMode} className="min-w-0 border-0 p-0 m-0">
      <div className="space-y-6">
        <div className="border-b border-border pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-main">
              {t('smtp.title')}
            </h2>
            <p className="text-muted mt-0.5">
              {t('smtp.intro')}
            </p>
          </div>

          {(settings.smtpConfiguredViaEnv || settings.smtpDisabledViaEnv) && (
            <span className="badge-ok text-[11px] shrink-0">
              {t('smtp.envDetected')}
            </span>
          )}
        </div>

        {/* The environment names the mail server (SMTP_HOST) or switches mail off (SMTP_DISABLED): the
            form only shows it */}
        {(settings.smtpConfiguredViaEnv || settings.smtpDisabledViaEnv) && (
          <p className="text-[11px] text-muted" data-smtp-locked>
            {settings.smtpDisabledViaEnv ? t('smtp.disabledByEnv') : t('smtp.lockedByEnv')}
          </p>
        )}

        <fieldset disabled={Boolean(settings.smtpConfiguredViaEnv || settings.smtpDisabledViaEnv)} className="min-w-0 border-0 p-0 m-0 space-y-6 disabled:opacity-60">
        <SmtpFields
          value={settings}
          passwordSet={passwordViaEnv || (settings.smtpPassSet && !settings.smtpPassViaEnv)}
          passwordViaEnv={passwordViaEnv}
          onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
        />

        {settings.smtpPassUnreadable && (
          <p className="text-[11px] text-status-warn flex items-start gap-1.5" data-smtp-pass-unreadable>
            <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{t('smtp.passwordUnreadable')}</span>
          </p>
        )}

        <div className="flex justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => handleSaveSystemSettings()}
            className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold"
          >
            {t('settings:smtp.save')}
          </button>
        </div>
        </fieldset>

        {/* Test SMTP Delivery (not while mail is switched off) */}
        <fieldset disabled={Boolean(settings.smtpDisabledViaEnv)} className="min-w-0 border-0 p-0 m-0">
        <SettingsCard
          title={t('smtp.test')}
          hint={t('smtp.testHint')}
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              {...NO_AUTOFILL}
              type="email"
              value={testSmtpEmail}
              onChange={(e) => setTestSmtpEmail(e.target.value)}
              placeholder={t('smtp.testPlaceholder')}
              className="flex-1 h-11 sm:h-8 px-3 input-field text-base sm:text-xs"
            />
            <button
              type="button"
              onClick={handleTestSmtp}
              disabled={testingSmtp || !testSmtpEmail.trim()}
              className="btn-action h-11 sm:h-8 px-4 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5 text-accent" />
              <span>{testingSmtp ? t('smtp.testSending') : t('smtp.testSend')}</span>
            </button>
          </div>
        </SettingsCard>
        </fieldset>
      </div>
    </fieldset>
  );
}

// smtpPassAppliesTo mirrors storage.SMTPMatchesEnv: same host (any case) and same user.
export function smtpPassAppliesTo(host?: string, user?: string, envHost?: string, envUser?: string): boolean {
  const eh = (envHost || '').trim();
  return eh !== '' && (host || '').trim().toLowerCase() === eh.toLowerCase() && (user || '').trim() === (envUser || '').trim();
}
