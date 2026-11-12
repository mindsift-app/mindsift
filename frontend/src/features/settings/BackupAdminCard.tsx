import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, Download, Loader2, Trash2 } from 'lucide-react';
import { BackupFile, DeletedAccountBackups, SystemSettings } from '../../lib/types';
import { api } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { formatBytes, saveBlob } from '../../lib/download';
import { formatDateTime } from '../../lib/format';
import { askConfirm } from '../../components/askConfirm';
import { TimeField } from '../../components/TimeField';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_BACKUP_TIME,
  MAX_BACKUP_RETENTION_DAYS,
  validBackupRetentionDays,
} from '../../lib/backupDefaults';

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

  useEffect(() => {
    api.adminListBackups().then(setFiles).catch(() => {});
    api.adminDeletedBackups().then(setDeleted).catch(() => {});
  }, []);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      setFiles(await api.adminRunBackup());
    } catch (err: any) {
      setError(err.message || t('data.backupFailed'));
      api.adminListBackups().then(setFiles).catch(() => {});
    } finally {
      setRunning(false);
    }
  };

  const download = async (name: string) => {
    try {
      saveBlob(await api.adminDownloadBackup(name), name);
    } catch (err: any) {
      setError(err.message || t('backups.downloadFailed'));
    }
  };

  const downloadDeleted = async (userId: string, name: string) => {
    try {
      saveBlob(await api.adminDownloadDeletedBackup(userId, name), name);
    } catch (err: any) {
      setError(err.message || t('backups.downloadFailed'));
    }
  };

  const remove = async (name: string) => {
    if (!(await askConfirm({ message: t('backups.confirmDelete', { name }), confirmLabel: t('common:delete'), danger: true }))) return;
    setError(null);
    try {
      setFiles(await api.adminDeleteBackup(name));
    } catch (err: any) {
      setError(err.message || t('backups.deleteFailed'));
    }
  };

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="pr-4">
          <p className="font-bold text-main flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5 text-accent" />
            {t('backups.autoTitle')}
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            <Trans t={t} i18nKey="backups.autoHint" components={{ c: <code className="font-mono" /> }} />
          </p>
        </div>
        <ToggleSwitch
          checked={Boolean(settings.backupEnabled)}
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
            onChange={(time) => time && onSave({ backupTime: time })}
            // block: on touch the field is the bare system input, which would sit beside the label
            className="block mt-1 w-36 sm:w-28"
            inputClassName="h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
          />
        </div>
        <label className="text-[11px] text-muted">
          {t('backups.keepDays')}
          <input
            type="number"
            min={1}
            max={MAX_BACKUP_RETENTION_DAYS}
            value={settings.backupRetentionDays || DEFAULT_BACKUP_RETENTION_DAYS}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (validBackupRetentionDays(n)) onSave({ backupRetentionDays: n });
            }}
            className="block mt-1 h-11 sm:h-8 px-2 input-field text-base sm:text-xs w-24"
          />
        </label>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 text-accent" />}
          {running ? t('backups.running') : t('backups.runNow')}
        </button>
      </div>
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
                  className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1"
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
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-[11px] text-faint">
        <Trans t={t} i18nKey="backups.restoreHint" components={{ c: <code className="font-mono" /> }} />
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
                      className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1"
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
