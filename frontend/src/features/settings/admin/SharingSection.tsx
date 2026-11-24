import React from 'react';
import { CircleAlert } from 'lucide-react';
import { SharingMode } from '../../../lib/types';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { AdminPage } from './AdminPage';
import { SHARING_MODES, useAdminSettings } from './useAdminSettings';
import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { SettingRow, SettingsCard } from '../../../components/SettingsCard';

// Administration → Sharing: who may share with whom, finding people, public links and calendar
// subscriptions (state in useAdminSettings)
export function SharingSection({
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
  } = admin;
  return (
    <AdminPage title={t('admin.nav.sharing')} intro={t('admin.pages.sharingIntro')} demoMode={demoMode}>
      {/* Who may share with whom: one of three modes, stricter first */}
      <SettingsCard
        data-admin-sharing-mode
        title={t('server.sharing')}
        hint={SHARING_MODES.find((m) => m.id === settings.sharingMode)?.text}
        action={
          <SelectMenu<SharingMode>
            size="sm"
            ariaLabel={t('server.sharing')}
            value={settings.sharingMode}
            onChange={(mode) => handleSelectSharingMode(mode)}
            options={SHARING_MODES.map((m) => ({ value: m.id, label: m.title, hint: m.text }))}
          />
        }
      >

        {pendingMode && (
          <div className="pt-3 border-t border-border flex flex-wrap items-center gap-2">
            <CircleAlert className="w-4 h-4 text-status-warn shrink-0" />
            <span className="flex-1 min-w-0 text-main">
              {t('server.switchWarning', {
                mode: SHARING_MODES.find((m) => m.id === pendingMode.mode)?.title || '',
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
      </SettingsCard>

      {/* Finding people: suggestions while typing, or only by exact e-mail address / username */}
      <SettingRow
        title={t('server.peopleSearch')}
        hint={
          <>
            {t('server.peopleSearchHint')}
            {settings.peopleSearchConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'PEOPLE_SEARCH' })}`}
          </>
        }
      >
        <ToggleSwitch
          checked={settings.peopleSearch !== false}
          disabled={Boolean(settings.peopleSearchConfiguredViaEnv)}
          onChange={(peopleSearch) => handleSaveSystemSettings({ peopleSearch })}
        />
      </SettingRow>

      {/* Public links to notes: read only, always expiring */}
      <SettingsCard
        title={t('server.publicLinks')}
        hint={
          <>
            {t('server.publicLinksHint')}
            {settings.publicLinksConfiguredViaEnv && ` ${t('server.fixedBy', { env: demoMode ? 'MINDSIFT_DEMO' : 'PUBLIC_LINKS' })}`}
          </>
        }
        action={
          <ToggleSwitch
            checked={settings.publicLinks !== false}
            disabled={Boolean(settings.publicLinksConfiguredViaEnv)}
            onChange={(publicLinks) => handleSaveSystemSettings({ publicLinks })}
          />
        }
      >
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
      </SettingsCard>

      {/* Calendar subscriptions: everyone's read-only feed of their open tasks */}
      <SettingRow
        title={t('server.calendarFeeds')}
        hint={
          <>
            {t('server.calendarFeedsHint')}
            {settings.calendarFeedsConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'CALENDAR_FEEDS' })}`}
          </>
        }
      >
        <ToggleSwitch
          checked={settings.calendarFeeds !== false}
          disabled={Boolean(settings.calendarFeedsConfiguredViaEnv)}
          onChange={(calendarFeeds) => handleSaveSystemSettings({ calendarFeeds })}
        />
      </SettingRow>
    </AdminPage>
  );
}
