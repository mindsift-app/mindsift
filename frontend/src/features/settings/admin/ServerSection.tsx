import React from 'react';
import { CircleAlert } from 'lucide-react';
import { RegistrationMode, SharingMode } from '../../../lib/types';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { BackupAdminCard } from '../BackupAdminCard';
import { VoiceStatusCard } from '../VoiceStatusCard';
import { OidcStatusCard } from './OidcStatusCard';
import { UpdateStatusCard } from './UpdateStatusCard';
import { TimeZoneSetting } from './TimeZoneSetting';
import { LinkPreviewSetting } from './LinkPreviewSetting';
import { ImageQualitySetting } from './ImageQualitySetting';
import { SHARING_MODES, useAdminSettings } from './useAdminSettings';
import { Trans, useTranslation } from 'react-i18next';
import { FALLBACK_LANGUAGE, LANGUAGES } from '../../../i18n';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { SelectMenu } from '../../../components/SelectMenu';

// The modes' titles are numbered ("1. Privat"); the menu and the warning drop the number
const modeTitle = (title: string) => title.replace(/^\d\.\s*/, '');

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
                <p className="text-[11px] text-muted mt-0.5">{t('defaultLanguage.hint')}</p>
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

          {/* Who may share with whom: one of three modes, stricter first */}
          <div className="p-4 bg-canvas border border-border rounded-card space-y-3" data-admin-sharing-mode>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
                <p className="font-bold text-main">{t('server.sharing')}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {SHARING_MODES.find((m) => m.id === settings.sharingMode)?.text}
                </p>
              </div>
              <SelectMenu<SharingMode>
                size="sm"
                ariaLabel={t('server.sharing')}
                value={settings.sharingMode}
                onChange={(mode) => handleSelectSharingMode(mode)}
                options={SHARING_MODES.map((m) => ({ value: m.id, label: modeTitle(m.title), hint: m.text }))}
              />
            </div>

            {pendingMode && (
              <div className="pt-3 border-t border-border flex flex-wrap items-center gap-2">
                <CircleAlert className="w-4 h-4 text-status-warn shrink-0" />
                <span className="flex-1 min-w-0 text-main">
                  {t('server.switchWarning', {
                    mode: modeTitle(SHARING_MODES.find((m) => m.id === pendingMode.mode)?.title || ''),
                    count: pendingMode.affected,
                  })}
                </span>
                <button
                  onClick={() => {
                    const mode = pendingMode.mode;
                    setPendingMode(null);
                    handleSaveSystemSettings({ sharingMode: mode });
                  }}
                  className="btn-primary h-11 sm:h-7 px-3 text-[11px]"
                >
                  {t('server.switchAnyway')}
                </button>
                <button onClick={() => setPendingMode(null)} className="btn-action h-11 sm:h-7 px-2 text-[11px]">
                  {t('common:cancel')}
                </button>
              </div>
            )}
          </div>

          {/* Finding people: suggestions while typing, or only by exact e-mail address / username */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">{t('server.peopleSearch')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.peopleSearchHint')}
                {settings.peopleSearchConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'PEOPLE_SEARCH' })}`}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.peopleSearch !== false}
              disabled={Boolean(settings.peopleSearchConfiguredViaEnv)}
              onChange={(peopleSearch) => handleSaveSystemSettings({ peopleSearch })}
            />
          </div>

          {/* Public links to notes: read only, always expiring */}
          <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="pr-4">
                <p className="font-bold text-main">{t('server.publicLinks')}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {t('server.publicLinksHint')}
                  {settings.publicLinksConfiguredViaEnv && ` ${t('server.fixedBy', { env: demoMode ? 'MINDSIFT_DEMO' : 'PUBLIC_LINKS' })}`}
                </p>
              </div>
              <ToggleSwitch
                checked={settings.publicLinks !== false}
                disabled={Boolean(settings.publicLinksConfiguredViaEnv)}
                onChange={(publicLinks) => handleSaveSystemSettings({ publicLinks })}
              />
            </div>
            {settings.publicLinks !== false && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
                <span className="text-main font-semibold">{t('server.publicLinkMaxDays')}</span>
                <SelectMenu
                  size="sm"
                  ariaLabel={t('server.publicLinkMaxDays')}
                  value={String(settings.publicLinkMaxDays || 14)}
                  disabled={Boolean(settings.publicLinkMaxDaysConfiguredViaEnv)}
                  onChange={(d) => handleSaveSystemSettings({ publicLinkMaxDays: Number(d) })}
                  options={[1, 3, 7, 14].map((d) => ({ value: String(d), label: t('server.days', { count: d }) }))}
                />
                {settings.publicLinkMaxDaysConfiguredViaEnv && (
                  <span className="w-full text-[11px] text-muted">{t('server.fixedBy', { env: 'PUBLIC_LINKS_MAX_DAYS' })}</span>
                )}
              </div>
            )}
          </div>

          {/* Calendar subscriptions: everyone's read-only feed of their open tasks */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">{t('server.calendarFeeds')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.calendarFeedsHint')}
                {settings.calendarFeedsConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'CALENDAR_FEEDS' })}`}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.calendarFeeds !== false}
              disabled={Boolean(settings.calendarFeedsConfiguredViaEnv)}
              onChange={(calendarFeeds) => handleSaveSystemSettings({ calendarFeeds })}
            />
          </div>

          {/* Link previews for the whole server: off, nothing is fetched and the app shows no cards */}
          <LinkPreviewSetting settings={settings} demoMode={demoMode} onSave={(patch) => handleSaveSystemSettings(patch)} />

          {/* How strongly pictures are compressed before upload (new pictures only) */}
          <ImageQualitySetting settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />

          <BackupAdminCard settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />

          <VoiceStatusCard />

          <OidcStatusCard status={settings.oidc} />

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

          {/* Who must sign in with a second factor; without one the next request leads to its setup */}
          <div className="p-4 bg-canvas border border-border rounded-card flex flex-wrap items-center justify-between gap-4" data-admin-mfa-required>
            <div className="pr-4 min-w-0 flex-1">
              <p className="font-bold text-main">{t('server.mfaRequired')}</p>
              <p className="text-[11px] text-muted mt-0.5">{t('server.mfaRequiredHint')}</p>
            </div>
            <SelectMenu
              size="sm"
              ariaLabel={t('server.mfaRequired')}
              value={settings.mfaRequired || ''}
              disabled={demoMode}
              onChange={(v) => handleSaveSystemSettings({ mfaRequired: v as '' | 'admins' | 'all' })}
              options={[
                { value: '', label: t('server.mfaRequiredNobody') },
                { value: 'admins', label: t('server.mfaRequiredAdmins') },
                { value: 'all', label: t('server.mfaRequiredAll') },
              ]}
            />
          </div>

          {/* Web push only via the push services of the big browsers */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">{t('server.pushKnownOnly')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.pushKnownOnlyHint')}
              </p>
            </div>
            <ToggleSwitch
              checked={Boolean(settings.pushKnownServicesOnly)}
              onChange={(pushKnownServicesOnly) => handleSaveSystemSettings({ pushKnownServicesOnly })}
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
                <SelectMenu<RegistrationMode>
                  ariaLabel={t('server.registration')}
                  value={mode}
                  disabled={locked}
                  onChange={(registrationMode) => handleSaveSystemSettings({ registrationMode })}
                  options={[
                    { value: 'closed', label: t('server.mode.closed') },
                    { value: 'approval', label: t('server.mode.approval') },
                    { value: 'domain', label: t('server.mode.domain') },
                    { value: 'domain+approval', label: t('server.mode.domainApproval') },
                    { value: 'open', label: t('server.mode.open') },
                  ]}
                />
                {needsDomains && (
                  <label className="block text-[11px] text-muted">
                    <Trans t={t} i18nKey="server.domains" components={{ c: <code className="font-mono" /> }} />
                    <input
                      {...NO_AUTOFILL}
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
