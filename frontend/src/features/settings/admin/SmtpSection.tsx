import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleAlert,
  Send,
} from 'lucide-react';
import { useAdminSettings } from './useAdminSettings';
import { SmtpFields } from './SmtpFields';
import { NO_AUTOFILL } from '../../../lib/noAutofill';

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

          {settings.smtpConfiguredViaEnv && (
            <span className="badge-ok text-[11px] flex-shrink-0">
              {t('smtp.envDetected')}
            </span>
          )}
        </div>

        <SmtpFields
          value={settings}
          passwordSet={settings.smtpPassSet}
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
            className="btn-primary h-9 px-5 text-xs font-semibold"
          >
            {t('settings:smtp.save')}
          </button>
        </div>

        {/* Test SMTP Delivery */}
        <div className="p-4 bg-canvas border border-border rounded-card space-y-2">
          <h3 className="font-bold text-main">{t('smtp.test')}</h3>
          <p className="text-[11px] text-muted">
            {t('smtp.testHint')}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              {...NO_AUTOFILL}
              type="email"
              value={testSmtpEmail}
              onChange={(e) => setTestSmtpEmail(e.target.value)}
              placeholder={t('smtp.testPlaceholder')}
              className="flex-1 h-8 px-3 input-field"
            />
            <button
              type="button"
              onClick={handleTestSmtp}
              disabled={testingSmtp || !testSmtpEmail.trim()}
              className="btn-action h-8 px-4 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5 text-accent" />
              <span>{testingSmtp ? t('smtp.testSending') : t('smtp.testSend')}</span>
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
