import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Check, Download, RotateCcw } from 'lucide-react';
import { BackupFile, DataSection, DATA_SECTIONS, ImportSummary } from '../../lib/types';
import { api } from '../../lib/api';
import { formatBytes, saveBlob } from '../../lib/download';
import { SectionPicker } from './SectionPicker';
import { formatDateTime } from '../../lib/format';
import { errorMessage } from '../../lib/errorMessage';

// The user's own automatic backups on the server: download or restore (all or some sections)
export const ServerBackupsCard: React.FC = () => {
  const { t } = useTranslation('settings');
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [open, setOpen] = useState<string | null>(null); // backup being restored
  const [mode, setMode] = useState<'merge' | 'restore'>('restore');
  const [sections, setSections] = useState<DataSection[]>(DATA_SECTIONS.map((s) => s.id));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);

  useEffect(() => {
    api.listMyBackups().then(setFiles).catch(() => {});
  }, []);

  const startRestore = (name: string) => {
    setOpen(open === name ? null : name);
    setConfirm(false);
    setError(null);
    setResult(null);
  };

  const restore = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.restoreMyBackup(open, mode, sections));
      setConfirm(false);
    } catch (err) {
      setError(errorMessage(err, t('backups.restoreFailed')));
    } finally {
      setBusy(false);
    }
  };

  const sectionNames = DATA_SECTIONS.filter((s) => sections.includes(s.id))
    .map((s) => s.label)
    .join(', ');

  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-bold text-main flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5 text-accent" />
          {t('backups.serverTitle')}
        </h3>
        <p className="text-muted text-[11px] mt-0.5">
          {t('backups.serverHint')}
        </p>
      </div>
      <div className="border border-border divide-y divide-border bg-canvas">
        {files.length === 0 ? (
          <p className="p-3 text-[11px] text-faint">{t('backups.none')}</p>
        ) : (
          files.map((f) => (
            <div key={f.name} className="p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-main">{formatDateTime(f.createdAt)}</p>
                  <p className="text-[11px] text-faint">{formatBytes(f.size)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => saveBlob(await api.downloadMyBackup(f.name), f.name)}
                    className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t('common:download')}
                  </button>
                  <button
                    type="button"
                    onClick={() => startRestore(f.name)}
                    aria-expanded={open === f.name}
                    className="btn-action h-11 sm:h-7 px-2.5 text-[11px] inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-accent" />
                    {t('common:restore')}
                  </button>
                </div>
              </div>

              {open === f.name && (
                <div className="p-3 rounded-card border border-border bg-panel space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('backups.restoreMode')}>
                    {(
                      [
                        ['restore', t('backups.replace'), t('import.restoreHint')],
                        ['merge', t('import.merge'), t('backups.mergeHint')],
                      ] as const
                    ).map(([value, label, text]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={mode === value}
                        onClick={() => {
                          setMode(value);
                          setConfirm(false);
                        }}
                        className={`p-2 min-h-[44px] text-left border rounded-card transition-colors ${
                          mode === value ? (value === 'restore' ? 'border-status-err bg-status-err/10' : 'border-accent bg-accent/10') : 'border-border'
                        }`}
                      >
                        <span className="block text-xs font-semibold text-main">{label}</span>
                        <span className="block text-[11px] text-muted">{text}</span>
                      </button>
                    ))}
                  </div>
                  <SectionPicker value={sections} onChange={setSections} />
                  {result ? (
                    <p className="text-[11px] text-status-ok flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />{' '}
                      {t('backups.restored', {
                        notes: result.notes,
                        tasks: result.tasks,
                        lists: result.lists,
                        inbox: result.inbox,
                        themes: result.themes ?? 0,
                      })}
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => (mode === 'restore' && !confirm ? setConfirm(true) : restore())}
                      className={`h-11 sm:h-8 px-4 text-xs font-semibold disabled:opacity-50 ${
                        mode === 'restore' ? 'btn-action border-status-err text-status-err' : 'btn-primary'
                      }`}
                    >
                      {busy
                        ? t('backups.restoring')
                        : mode === 'restore' && confirm
                        ? t('backups.confirmReplace', { sections: sectionNames })
                        : mode === 'restore'
                        ? t('backups.replace')
                        : t('import.merge')}
                    </button>
                  )}
                  {error && <p className="text-[11px] text-status-err">{error}</p>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
