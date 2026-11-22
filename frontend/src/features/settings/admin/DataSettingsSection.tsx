import React from 'react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { BackupAdminCard } from '../BackupAdminCard';
import { ServerSnapshotCard } from '../ServerSnapshotCard';
import { isDesktopApp } from '../../../lib/api';
import { AdminPage } from './AdminPage';
import { useAdminSettings } from './useAdminSettings';
import { useCapabilities } from '../../../lib/capabilities';
import { useTranslation } from 'react-i18next';

// Administration → Data: backups, in the desktop app taking over an account of a server's backup, and on an
// instance with several accounts whether they may keep things for good (state in useAdminSettings);
// pictures and audio are under Media
export function DataSettingsSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings } = admin;
  const { accounts } = useCapabilities();
  const desktop = isDesktopApp();
  return (
    <AdminPage title={t('admin.nav.data')} intro={t(desktop ? 'admin.pages.dataIntroDesktop' : 'admin.pages.dataIntro')} demoMode={demoMode}>
      <BackupAdminCard settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />

      {/* Desktop app: one account of a server's backup into this instance */}
      {desktop && <ServerSnapshotCard />}

      {/* Retention: may people keep finished and deleted things for good? (one person decides alone) */}
      {accounts && (
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
      )}
    </AdminPage>
  );
}
