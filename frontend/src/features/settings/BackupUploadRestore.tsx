import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { askConfirm } from '../../components/askConfirm';
import { errorMessage } from '../../lib/errorMessage';
import { formatBytes } from '../../lib/download';
import { forgetUpload, uploadBackup, type FinishedUpload, type UploadProgress } from '../../lib/backupUpload';

interface Props {
  // The restore was accepted: the server reopens its data now (boot: its start before, lib/restoreReload.ts)
  onRestoring: (boot: string | null) => void;
}

// Administration → Data: upload a downloaded backup (moving to a new server) in resumable chunks with a
// progress bar, then restore it after a confirmation (lib/backupUpload.ts, internal/api/backup_upload.go)
export const BackupUploadRestore: React.FC<Props> = ({ onRestoring }) => {
  const { t } = useTranslation('settings');
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [done, setDone] = useState<FinishedUpload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (up: FinishedUpload) => {
    if (!(await askConfirm({ message: t('backups.full.confirmUpload', { name: up.name }), confirmLabel: t('backups.full.restore'), danger: true }))) return;
    setError(null);
    try {
      const boot = await api.serverBoot();
      await api.adminRestoreUpload(up.id, up.name, up.sha256);
      forgetUpload();
      setDone(null);
      onRestoring(boot);
    } catch (err) {
      setError(errorMessage(err, t('backups.full.restoreFailed')));
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    abort.current = new AbortController();
    try {
      const up = await uploadBackup(file, setProgress, abort.current.signal);
      setProgress(null);
      setDone(up);
      await restore(up);
    } catch (err) {
      setProgress(null);
      if ((err as Error)?.name !== 'AbortError') setError(errorMessage(err, t('backups.full.uploadFailed')));
    } finally {
      abort.current = null;
    }
  };

  const discard = async () => {
    if (done) await api.adminDiscardUpload(done.id).catch(() => {});
    forgetUpload();
    setDone(null);
  };

  const percent = progress && progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-1.5 pt-2 border-t border-border">
      <p className="font-semibold text-main">{t('backups.full.upload')}</p>
      <p className="text-[11px] text-muted">{t('backups.full.uploadHint')}</p>
      <input
        ref={input}
        type="file"
        accept=".tar,.gz,.tgz,.db"
        className="hidden"
        data-testid="backup-upload-input"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {progress ? (
        <div className="space-y-1" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
            <span>{t(progress.phase === 'upload' ? 'backups.full.uploading' : 'backups.full.checking', { percent })}</span>
            <span>
              {formatBytes(progress.done)} / {formatBytes(progress.total)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="h-2 flex-1 rounded-full bg-panel border border-border overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              title={t('common:cancel')}
              aria-label={t('common:cancel')}
              className="btn-action h-11 w-11 sm:h-7 sm:w-7 inline-flex items-center justify-center text-faint"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : done ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[11px] text-main mr-auto">{t('backups.full.uploaded', { name: done.name })}</p>
          <button type="button" onClick={() => void restore(done)} className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" />
            {t('backups.full.restore')}
          </button>
          <button type="button" onClick={() => void discard()} className="btn-action h-11 sm:h-7 px-2.5 text-[11px]">
            {t('backups.full.discard')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 text-accent" />
          {t('backups.full.upload')}
        </button>
      )}
      {error && <p className="text-[11px] text-status-err">{error}</p>}
    </div>
  );
};
