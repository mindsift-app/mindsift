import React from 'react';
import {
  Users,
  AlertCircle,
} from 'lucide-react';
import { RegistrationMode } from '../../../lib/types';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { BackupAdminCard } from '../BackupAdminCard';
import { VoiceStatusCard } from '../VoiceStatusCard';
import { SHARING_MODES, useAdminSettings } from './useAdminSettings';
import { Trans, useTranslation } from 'react-i18next';
import { FALLBACK_LANGUAGE, LANGUAGES } from '../../../i18n';

// Administration → Server & Isolation (state in useAdminSettings)
export function ServerSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const {
    pendingMode,
    settings,
    demoMode,
    handleSelectSharingMode,
    handleSaveSystemSettings,
    setPendingMode,
    setSettings,
  } = admin;
  return (
    <fieldset disabled={demoMode} className="min-w-0 border-0 p-0 m-0">
      <div className="space-y-6">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-bold text-main">
            {t('server.title')}
          </h2>
          <p className="text-muted mt-0.5">
            {t('server.intro')}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-muted font-semibold mb-1">
              {t('server.instanceName')}
            </label>
            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                value={settings.instanceName}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, instanceName: e.target.value }))
                }
                className="flex-1 h-9 px-3 input-field"
              />
              <button
                type="button"
                onClick={() => handleSaveSystemSettings()}
                className="btn-primary h-9 px-4 text-xs"
              >
                Speichern
              </button>
            </div>
          </div>

          {/* Default language: login screen, new accounts and browsers in other languages */}
          <div>
            <label htmlFor="admin-default-language" className="block text-muted font-semibold mb-1">
              {t('defaultLanguage.title')}
            </label>
            <select
              id="admin-default-language"
              value={settings.defaultLanguage || FALLBACK_LANGUAGE}
              onChange={(e) => handleSaveSystemSettings({ defaultLanguage: e.target.value })}
              className="w-full max-w-md h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted mt-1 max-w-md">{t('defaultLanguage.hint')}</p>
          </div>

          {/* Sharing Isolation Cards */}
          <div className="space-y-2">
            <label className="block text-muted font-semibold flex items-center gap-1.5">
              <Users className="w-4 h-4 text-accent" />
              <span>{t('server.sharing')}</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SHARING_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectSharingMode(m.id)}
                  className={`p-4 text-left border rounded-card transition-colors ${
                    settings.sharingMode === m.id
                      ? 'bg-canvas border-accent text-main shadow-panel'
                      : 'bg-canvas/50 border-border text-muted hover:text-main'
                  }`}
                >
                  <p className="font-bold text-xs text-main">{m.title}</p>
                  <p className="text-[11px] text-muted mt-1 leading-relaxed">{m.text}</p>
                </button>
              ))}
            </div>

            {pendingMode && (
              <div className="p-3 border border-status-warn/40 bg-status-warn/5 rounded-card flex flex-wrap items-center gap-2">
                <AlertCircle className="w-4 h-4 text-status-warn shrink-0" />
                <span className="flex-1 min-w-0 text-main">
                  {t('server.switchWarning', {
                    mode: SHARING_MODES.find((m) => m.id === pendingMode.mode)?.title.replace(/^\d\.\s*/, ''),
                    count: pendingMode.affected,
                  })}
                </span>
                <button
                  onClick={() => {
                    const mode = pendingMode.mode;
                    setPendingMode(null);
                    handleSaveSystemSettings({ sharingMode: mode });
                  }}
                  className="btn-primary h-7 px-3 text-[11px]"
                >
                  {t('server.switchAnyway')}
                </button>
                <button onClick={() => setPendingMode(null)} className="btn-action h-7 px-2 text-[11px]">
                  Abbrechen
                </button>
              </div>
            )}
          </div>

          <BackupAdminCard settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />

          <VoiceStatusCard />

          {/* Alarm webhooks into the local network (SSRF protection) */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">{t('server.privateWebhooks')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.privateWebhooksHint')}
              </p>
            </div>
            <ToggleSwitch
              checked={Boolean(settings.allowPrivateWebhooks)}
              onChange={(allowPrivateWebhooks) => handleSaveSystemSettings({ allowPrivateWebhooks })}
            />
          </div>

          {/* Retention: may people keep finished and deleted things for good? */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">{t('server.retentionNever')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.retentionNeverHint')}
                {settings.retentionNeverViaEnv && ` ${t('server.fixedBy', { env: 'RETENTION_ALLOW_NEVER' })}`}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.retentionAllowNever !== false}
              disabled={Boolean(settings.retentionNeverViaEnv)}
              onChange={(retentionAllowNever) => handleSaveSystemSettings({ retentionAllowNever })}
            />
          </div>

          {/* AI agents over MCP (and claude.ai / ChatGPT over OAuth) */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">{t('server.mcp')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.mcpHint')}
                {settings.mcpConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MCP_ENABLED' })}`}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.mcpEnabled !== false}
              disabled={Boolean(settings.mcpConfiguredViaEnv)}
              onChange={(mcpEnabled) => handleSaveSystemSettings({ mcpEnabled })}
            />
          </div>

          {/* Who may register without an invite */}
          {(() => {
            const mode = settings.registrationMode || 'closed';
            const locked = Boolean(settings.registrationConfiguredViaEnv);
            const needsDomains = mode === 'domain' || mode === 'domain+approval';
            return (
              <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
                <div>
                  <p className="font-bold text-main">{t('server.registration')}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {t('server.registrationHint')}
                  </p>
                </div>
                <select
                  value={mode}
                  disabled={locked}
                  onChange={(e) => handleSaveSystemSettings({ registrationMode: e.target.value as RegistrationMode })}
                  className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs disabled:opacity-60"
                >
                  <option value="closed">{t('server.mode.closed')}</option>
                  <option value="approval">{t('server.mode.approval')}</option>
                  <option value="domain">{t('server.mode.domain')}</option>
                  <option value="domain+approval">{t('server.mode.domainApproval')}</option>
                  <option value="open">{t('server.mode.open')}</option>
                </select>
                {needsDomains && (
                  <label className="block text-[11px] text-muted">
                    <Trans t={t} i18nKey="server.domains" components={{ c: <code className="font-mono" /> }} />
                    <input
                      type="text"
                      disabled={locked}
                      value={settings.registrationDomains || ''}
                      onChange={(e) => setSettings((prev) => ({ ...prev, registrationDomains: e.target.value }))}
                      onBlur={() => handleSaveSystemSettings()}
                      placeholder={t('server.domainsPlaceholder')}
                      className="block w-full mt-1 h-11 sm:h-8 px-2.5 input-field font-mono text-base sm:text-xs disabled:opacity-60"
                    />
                  </label>
                )}
                {locked && (
                  <p className="text-[11px] text-status-warn">
                    <Trans t={t} i18nKey="server.registrationFixed" components={{ c: <code className="font-mono" /> }} />
                  </p>
                )}
                {mode !== 'closed' && (
                  <div className="pt-3 border-t border-border flex items-start justify-between gap-4">
                    <div className="pr-2">
                      <p className="font-semibold text-main">{t('server.verify')}</p>
                      <p className="text-[11px] text-muted mt-0.5">
                        {t('server.verifyHint')}
                      </p>
                      {!settings.emailLinksAvailable && (
                        <p className="text-[11px] text-status-warn mt-1">
                          <Trans t={t} i18nKey="server.verifyNeedsMail" components={{ c: <code className="font-mono" /> }} />
                        </p>
                      )}
                      {settings.registrationVerifyConfiguredViaEnv && (
                        <p className="text-[11px] text-status-warn mt-1">
                          <Trans t={t} i18nKey="server.verifyFixed" components={{ c: <code className="font-mono" /> }} />
                        </p>
                      )}
                    </div>
                    <ToggleSwitch
                      checked={Boolean(settings.registrationVerifyEmail)}
                      disabled={Boolean(settings.registrationVerifyConfiguredViaEnv)}
                      onChange={(registrationVerifyEmail) => handleSaveSystemSettings({ registrationVerifyEmail })}
                      title={t('server.verifyTitle')}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </fieldset>
  );
}
