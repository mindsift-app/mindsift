import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, CircleAlert } from 'lucide-react';
import { DATA_SECTIONS, DataSection, ImportSummary } from '../../lib/types';
import { SectionPicker } from './SectionPicker';
import { RestoreConfirm, RestoreResult } from './RestoreResult';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errorMessage';
import { SettingsCard } from '../../components/SettingsCard';

interface ImportCardProps {
  source: 'mindsift' | 'obsidian';
  title: string;
  description: React.ReactNode;
  accept: string;
  // After an import: the app loads the own data again
  onImported?: () => void;
}


// One import path: drop or pick a file, see a preview of what would be created, then import.
// Touch targets are large enough for phones; the file picker works on mobile browsers.
export const ImportCard: React.FC<ImportCardProps> = ({ source, title, description, accept, onImported }) => {
  const { t } = useTranslation('settings');
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // MindSift data can replace the current state instead of being added next to it
  const [mode, setMode] = useState<'merge' | 'restore'>('merge');
  const [confirmRestore, setConfirmRestore] = useState(false);
  // MindSift data: which parts to take from the file
  const [sections, setSections] = useState<DataSection[]>(DATA_SECTIONS.map((s) => s.id));
  const sectionParam = source === 'mindsift' ? sections : undefined;
  const restoring = source === 'mindsift' && mode === 'restore';

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setConfirmRestore(false);
  };

  const pick = async (f?: File) => {
    if (!f) return;
    reset();
    setResult(null);
    setFile(f);
    setBusy(true);
    try {
      setPreview(await api.importData(source, f, true, 'merge', sectionParam));
    } catch (err) {
      setError(errorMessage(err, t('import.readFailed')));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importData(source, file, false, restoring ? 'restore' : 'merge', sectionParam));
      setFile(null);
      setPreview(null);
      setConfirmRestore(false);
      onImported?.();
    } catch (err) {
      setError(errorMessage(err, t('import.failed')));
    } finally {
      setBusy(false);
    }
  };

  const shown = result || preview;

  return (
    <SettingsCard
      title={title}
      hint={description}
    >
      {source === 'mindsift' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('import.mode')}>
          {(
            [
              ['merge', t('import.merge'), t('import.mergeHint')],
              ['restore', t('import.restore'), t('import.restoreHint')],
            ] as const
          ).map(([value, label, text]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => {
                setMode(value);
                setConfirmRestore(false);
              }}
              className={`p-2.5 min-h-[44px] text-left border rounded-card transition-colors ${
                mode === value
                  ? value === 'restore'
                    ? 'border-status-err bg-status-err/10'
                    : 'border-accent bg-accent/10'
                  : 'border-border hover:border-strong'
              }`}
            >
              <span className={`block text-xs font-semibold ${value === 'restore' && mode === value ? 'text-status-err' : 'text-main'}`}>{label}</span>
              <span className="block text-[11px] text-muted">{text}</span>
            </button>
          ))}
        </div>
      )}

      {source === 'mindsift' && (
        <SectionPicker
          value={sections}
          onChange={(next) => {
            setSections(next);
            // The preview depends on the sections, so a picked file is read again
            if (file) {
              setBusy(true);
              api
                .importData(source, file, true, 'merge', next)
                .then(setPreview)
                .catch((err) => setError(errorMessage(err)))
                .finally(() => setBusy(false));
            }
          }}
        />
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={`p-4 border border-dashed rounded-card flex flex-col sm:flex-row items-center justify-center gap-3 text-center transition-colors ${
          dragOver ? 'border-accent bg-accent/10' : 'border-border'
        }`}
      >
        <span className="text-[11px] text-muted hidden sm:inline">{t('import.dropHint')}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 disabled:opacity-50 w-full sm:w-auto"
        >
          <Upload className="w-3.5 h-3.5 text-accent" />
          <span>{t('import.choose')}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {busy && <p className="text-[11px] text-muted">{preview ? t('import.importing') : t('import.reading')}</p>}
      {error && (
        <p className="text-[11px] text-status-err flex items-start gap-1.5">
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}

      {shown && !busy && (
        <RestoreResult summary={shown} done={!!result} title={result ? t('import.done') : t('import.preview', { name: file?.name })}>
          {!result && restoring && <RestoreConfirm checked={confirmRestore} onChange={setConfirmRestore} sections={sections} />}
          {!result && (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={runImport}
                disabled={restoring && !confirmRestore}
                className={`h-11 sm:h-8 px-4 text-xs font-semibold disabled:opacity-50 ${restoring ? 'btn-action border-status-err text-status-err' : 'btn-primary'}`}
              >
                {restoring ? t('import.restoreNow') : t('import.importNow')}
              </button>
              <button type="button" onClick={reset} className="btn-action h-11 sm:h-8 px-3 text-xs">
                {t('common:cancel')}
              </button>
            </div>
          )}
        </RestoreResult>
      )}
    </SettingsCard>
  );
};
