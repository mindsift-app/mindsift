import React from 'react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { UpdateStatusCard } from './UpdateStatusCard';
import { TimeZoneSetting } from './TimeZoneSetting';
import { LinkPreviewSetting } from './LinkPreviewSetting';
import { AdminPage } from './AdminPage';
import { useAdminSettings } from './useAdminSettings';
import { LegalSettingsCard } from './LegalSettingsCard';
import { useTranslation } from 'react-i18next';
import { FALLBACK_LANGUAGE, LANGUAGES } from '../../../i18n';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { SelectMenu } from '../../../components/SelectMenu';
import { isDesktopApp } from '../../../lib/api';

// Administration → Server: the instance itself, its version and what the server may reach outside
// (state in useAdminSettings)
export function ServerSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings, setSettings } = admin;
  return (
    <AdminPage
      title={isDesktopApp() ? t('admin.nav.serverDesktop') : t('admin.nav.server')}
      intro={isDesktopApp() ? t('admin.pages.serverIntroDesktop') : t('admin.pages.serverIntro')}
      demoMode={demoMode}
    >
      {/* Installed and latest release (read only) */}
      <UpdateStatusCard />

      {/* The instance: its name, the default language and the server's time zone */}
      <div className="bg-canvas border border-border rounded-card divide-y divide-border" data-admin-instance>
        <div className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
            <p className="font-bold text-main">{t('server.instanceName')}</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <input
              {...NO_AUTOFILL}
              type="text"
              aria-label={t('server.instanceName')}
              value={settings.instanceName}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, instanceName: e.target.value }))
              }
              className="flex-1 min-w-0 sm:flex-none sm:w-56 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
            />
            <button
              type="button"
              onClick={() => handleSaveSystemSettings()}
              className="btn-primary h-11 sm:h-8 px-4 text-xs"
            >
              {t('common:save')}
            </button>
          </div>
        </div>

        {/* Default language: login screen, new accounts and browsers in other languages */}
        <div className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
            <p className="font-bold text-main">{t('defaultLanguage.title')}</p>
            <p className="text-[11px] text-muted mt-0.5">{isDesktopApp() ? t('defaultLanguage.hintDesktop') : t('defaultLanguage.hint')}</p>
          </div>
          <SelectMenu
            size="sm"
            ariaLabel={t('defaultLanguage.title')}
            value={settings.defaultLanguage || FALLBACK_LANGUAGE}
            onChange={(defaultLanguage) => handleSaveSystemSettings({ defaultLanguage })}
            options={LANGUAGES.map((l) => ({ value: l.id, label: l.name }))}
          />
        </div>

        {/* The server's time zone: due dates, alarms, the daily summary and backups follow it */}
        <TimeZoneSetting settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />
      </div>

      {/* Imprint, privacy notice and the footer's own link; the desktop app has no public pages */}
      {!isDesktopApp() && <LegalSettingsCard settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />}

      {/* Link previews for the whole server: off, nothing is fetched and the app shows no cards */}
      <LinkPreviewSetting settings={settings} demoMode={demoMode} onSave={(patch) => handleSaveSystemSettings(patch)} />

      {/* Alarm webhooks into the local network (SSRF protection) */}
      <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
        <div className="pr-4">
          <p className="font-bold text-main">{t('server.privateWebhooks')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.privateWebhooksHint')}
            {settings.allowPrivateWebhooksConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'ALLOW_PRIVATE_WEBHOOKS' })}`}
          </p>
        </div>
        <ToggleSwitch
          checked={Boolean(settings.allowPrivateWebhooks)}
          disabled={Boolean(settings.allowPrivateWebhooksConfiguredViaEnv)}
          onChange={(allowPrivateWebhooks) => handleSaveSystemSettings({ allowPrivateWebhooks })}
        />
      </div>

      {/* Web push only via the push services of the big browsers; the desktop app has no web push */}
      {!isDesktopApp() && (
        <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
          <div className="pr-4">
            <p className="font-bold text-main">{t('server.pushKnownOnly')}</p>
            <p className="text-[11px] text-muted mt-0.5">
              {t('server.pushKnownOnlyHint')}
              {settings.pushKnownServicesOnlyConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'PUSH_KNOWN_SERVICES_ONLY' })}`}
            </p>
          </div>
          <ToggleSwitch
            checked={Boolean(settings.pushKnownServicesOnly)}
            disabled={Boolean(settings.pushKnownServicesOnlyConfiguredViaEnv)}
            onChange={(pushKnownServicesOnly) => handleSaveSystemSettings({ pushKnownServicesOnly })}
          />
        </div>
      )}
    </AdminPage>
  );
}
