import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, Download, LoaderCircle, Trash } from 'lucide-react';
import { BackupFile, BackupLocation, DeletedAccountBackups, SystemSettings } from '../../lib/types';
import { api, isDesktopApp } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { formatBytes, saveBlob } from '../../lib/download';
import { formatDateTime } from '../../lib/format';
import { askConfirm } from '../../components/askConfirm';
import { TimeField } from '../../components/TimeField';
import { NumberField } from '../../components/NumberField';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_BACKUP_TIME,
  MAX_BACKUP_RETENTION_DAYS,
  validBackupRetentionDays,
} from '../../lib/backupDefaults';
import { errorMessage } from '../../lib/errorMessage';
import { BackupFolderField } from './BackupFolderField';

interface BackupAdminCardProps {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}

// Admin: automatic daily backups (whole database + one backup per user), list and manual run
export const BackupAdminCard: React.FC<BackupAdminCardProps> = ({ settings, onSave }) => {
  const { t } = useTranslation('settings');
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [deleted, setDeleted] = useState<DeletedAccountBackups[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Desktop app: the folder the backups go to (the list shows that folder's)
  const desktop = isDesktopApp();
  const [location, setLocation] = useState<BackupLocation | null>(null);

  useEffect(() => {
    api.adminListBackups().then(setFiles).catch(() => {});
    api.adminDeletedBackups().then(setDeleted).catch(() => {});
    if (desktop) api.adminGetBackupLocation().then(setLocation).catch(() => {});
  }, [desktop]);

  const moveTo = async (dir: string) => {
    setError(null);
    try {
      setLocation(await api.adminSetBackupLocation(dir));
      setFiles(await api.adminListBackups());
    } catch (err) {
      setError(errorMessage(err, t('backups.folderFailed')));
    }
  };

  // A second click before the button shows it is busy starts no second run (the server also makes none)
  const runningRef = useRef(false);
  const runNow = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      setFiles(await api.adminRunBackup());
    } catch (err) {
      setError(errorMessage(err, t('data.backupFailed')));
      api.adminListBackups().then(setFiles).catch(() => {});
    } finally {
      runningRef.current = false;
      setRunning(false);
      // The folder may have been missing (drive not mounted) or be back
      if (desktop) api.adminGetBackupLocation().then(setLocation).catch(() => {});
    }
  };

  // The backup being fetched: its button waits, so a second click does not fetch (and save) it twice
  const [downloading, setDownloading] = useState<string | null>(null);
  const fetchAndSave = async (key: string, name: string, fetchBlob: () => Promise<Blob>) => {
    setDownloading(key);
    try {
      saveBlob(await fetchBlob(), name);
    } catch (err) {
      setError(errorMessage(err, t('backups.downloadFailed')));
    } finally {
      setDownloading(null);
    }
  };
  const download = (name: string) => fetchAndSave(name, name, () => api.adminDownloadBackup(name));
  const downloadDeleted = (userId: string, name: string) =>
    fetchAndSave(`${userId}/${name}`, name, () => api.adminDownloadDeletedBackup(userId, name));

  const remove = async (name: string) => {
    if (!(await askConfirm({ message: t('backups.confirmDelete', { name }), confirmLabel: t('common:delete'), danger: true }))) return;
    setError(null);
    try {
      setFiles(await api.adminDeleteBackup(name));
    } catch (err) {
      setError(errorMessage(err, t('backups.deleteFailed')));
    }
  };

  // What a provider fixes through the environment (BACKUP_*) stays as it is here
  const lockedBy = [
    settings.backupEnabledConfiguredViaEnv && 'BACKUP_ENABLED',
    settings.backupTimeConfiguredViaEnv && 'BACKUP_TIME',
    settings.backupRetentionDaysConfiguredViaEnv && 'BACKUP_RETENTION_DAYS',
  ].filter(Boolean) as string[];

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="pr-4">
          <p className="font-bold text-main flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5 text-accent" />
            {t('backups.autoTitle')}
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            <Trans t={t} i18nKey={desktop ? 'backups.autoHintDesktop' : 'backups.autoHint'} components={{ c: <code className="font-mono" /> }} />
            {lockedBy.length > 0 && ` ${t('settings:server.fixedBy', { env: lockedBy.join(', ') })}`}
          </p>
        </div>
        <ToggleSwitch
          checked={Boolean(settings.backupEnabled)}
          disabled={Boolean(settings.backupEnabledConfiguredViaEnv)}
          onChange={(backupEnabled) => onSave({ backupEnabled })}
          title={settings.backupEnabled ? t('backups.autoOff') : t('backups.autoOn')}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="text-[11px] text-muted">
          {t('backups.time')}
          <TimeField
            ariaLabel={t('backups.time')}
            value={settings.backupTime || DEFAULT_BACKUP_TIME}
            disabled={Boolean(settings.backupTimeConfiguredViaEnv)}
            onChange={(time) => time && onSave({ backupTime: time })}
            // block: on touch the field is the bare system input, which would sit beside the label
            className="block mt-1 w-36 sm:w-28"
            inputClassName="h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
          />
        </div>
        <label className="text-[11px] text-muted">
          {t('backups.keepDays')}
          <NumberField
            value={settings.backupRetentionDays || DEFAULT_BACKUP_RETENTION_DAYS}
            min={1}
            max={MAX_BACKUP_RETENTION_DAYS}
            unit={t('backups.days', { count: settings.backupRetentionDays || DEFAULT_BACKUP_RETENTION_DAYS })}
            label={t('backups.keepDays')}
            disabled={Boolean(settings.backupRetentionDaysConfiguredViaEnv)}
            onCommit={(n) => {
              if (validBackupRetentionDays(n)) onSave({ backupRetentionDays: n });
            }}
            className="mt-1 w-28"
          />
        </label>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {running ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 text-accent" />}
          {running ? t('backups.running') : t('backups.runNow')}
        </button>
      </div>
      {desktop && location && (
        <div className="text-[11px] text-muted space-y-1">
          <p>{t('backups.folder')}</p>
          <BackupFolderField
            value={location.custom ? (location.chosen ?? location.dir) : ''}
            shown={location.custom ? (location.chosen ? location.chosenShown : location.dirShown) : ''}
            defaultDir={location.defaultDir}
            onCommit={moveTo}
          />
          {location.custom && (
            <p>
              <Trans t={t} i18nKey="backups.folderTarget" values={{ dir: location.dirShown || location.dir }} components={{ c: <code className="font-mono break-all" /> }} />
            </p>
          )}
          {location.chosenMissing && (
            <p role="alert" className="p-2 rounded-card border border-status-err/40 bg-status-err/10 text-main">
              <Trans t={t} i18nKey="backups.folderMissing" values={{ dir: location.chosenShown || location.chosen || '' }} components={{ c: <code className="font-mono break-all" /> }} />
            </p>
          )}
          <p>{t('backups.folderHint')}</p>
        </div>
      )}
      {error && <p className="text-[11px] text-status-err">{error}</p>}

      <div className="border border-border divide-y divide-border bg-panel">
        {files.length === 0 ? (
          <p className="p-3 text-[11px] text-faint">{t('backups.none')}</p>
        ) : (
          files.map((f) => (
            <div key={f.name} className="px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-main truncate">{f.name}</p>
                <p className="text-[11px] text-faint">
                  {formatDateTime(f.createdAt)} · {formatBytes(f.size)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => download(f.name)}
                  disabled={downloading === f.name}
                  className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t('common:download')}
                </button>
                <button
                  type="button"
                  onClick={() => remove(f.name)}
                  title={t('backups.delete')}
                  aria-label={t('backups.deleteNamed', { name: f.name })}
                  className="btn-action h-11 w-11 sm:h-7 sm:w-7 inline-flex items-center justify-center text-faint hover:text-status-err"
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-[11px] text-faint">
        <Trans t={t} i18nKey={desktop ? 'backups.restoreHintDesktop' : 'backups.restoreHint'} components={{ c: <code className="font-mono" /> }} />
      </p>

      {/* Accounts deleted by an admin: their backups stay until the retention period ends */}
      {deleted.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <p className="font-semibold text-main">{t('backups.deletedTitle')}</p>
          <p className="text-[11px] text-muted">{t('backups.deletedHint')}</p>
          <div className="border border-border divide-y divide-border bg-panel">
            {deleted.map((d) => (
              <div key={d.userId} className="px-3 py-2 space-y-1.5">
                <p className="text-xs text-main truncate">
                  <span className="font-semibold">{d.displayName || d.userId}</span>
                  {d.email && <span className="text-muted"> · {d.email}</span>}
                </p>
                <p className="text-[11px] text-faint">
                  {t('backups.deletedOn', { deleted: formatDateTime(d.deletedAt), remove: formatDateTime(d.removeAt) })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {d.files.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => downloadDeleted(d.userId, f.name)}
                      disabled={downloading === `${d.userId}/${f.name}`}
                      className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                      title={f.name}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {formatDateTime(f.createdAt)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
