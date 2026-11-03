import React, { useRef, useState } from 'react';
import { Upload, Check, AlertCircle, FileArchive } from 'lucide-react';
import { DATA_SECTIONS, DataSection, ImportSummary } from '../../lib/types';
import { SectionPicker } from './SectionPicker';
import { api } from '../../lib/api';

interface ImportCardProps {
  source: 'mindsift' | 'obsidian';
  title: string;
  description: React.ReactNode;
  accept: string;
}

const summaryParts = (s: ImportSummary) =>
  [
    s.folders && `${s.folders} Ordner`,
    s.notes && `${s.notes} ${s.notes === 1 ? 'Notiz' : 'Notizen'}`,
    s.taskLists && `${s.taskLists} Aufgabenliste${s.taskLists === 1 ? '' : 'n'}`,
    s.tasks && `${s.tasks} Aufgabe${s.tasks === 1 ? '' : 'n'}`,
    s.lists && `${s.lists} Liste${s.lists === 1 ? '' : 'n'} mit ${s.listItems} Einträgen`,
    s.inbox && `${s.inbox} Gedanke${s.inbox === 1 ? '' : 'n'} für die Triage`,
    s.themes && `${s.themes} Theme${s.themes === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];

// One import path: drop or pick a file, see a preview of what would be created, then import.
// Touch targets are large enough for phones; the file picker works on mobile browsers.
export const ImportCard: React.FC<ImportCardProps> = ({ source, title, description, accept }) => {
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
    } catch (err: any) {
      setError(err.message || 'Datei konnte nicht gelesen werden');
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
    } catch (err: any) {
      setError(err.message || 'Import fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const shown = result || preview;

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
      <div>
        <h4 className="font-bold text-main">{title}</h4>
        <p className="text-muted text-[11px] mt-0.5">{description}</p>
      </div>

      {source === 'mindsift' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Import-Modus">
          {(
            [
              ['merge', 'Hinzufügen', 'Bestehende Daten behalten, Backup daneben anlegen.'],
              ['restore', 'Wiederherstellen', 'Gewählte Bereiche vorher leeren.'],
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
                .catch((err) => setError(err.message))
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
        <span className="text-[11px] text-muted hidden sm:inline">Datei hierher ziehen oder</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 disabled:opacity-50 w-full sm:w-auto"
        >
          <Upload className="w-3.5 h-3.5 text-accent" />
          <span>Datei auswählen</span>
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

      {busy && <p className="text-[11px] text-muted">{preview ? 'Importiere…' : 'Lese Datei…'}</p>}
      {error && (
        <p className="text-[11px] text-status-err flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}

      {shown && !busy && (
        <div
          className={`p-3 rounded-card border text-xs space-y-2 ${
            result ? 'border-status-ok/40 bg-status-ok/10' : 'border-border bg-panel'
          }`}
        >
          <p className="font-semibold text-main flex items-center gap-1.5">
            {result ? <Check className="w-3.5 h-3.5 text-status-ok" /> : <FileArchive className="w-3.5 h-3.5 text-accent" />}
            <span>{result ? 'Import abgeschlossen' : `Vorschau: ${file?.name}`}</span>
          </p>
          <p className="text-muted">
            {result ? 'Angelegt: ' : 'Wird angelegt: '}
            {summaryParts(shown).join(', ') || 'nichts'}.
          </p>
          {shown.skipped.length > 0 && (
            <details className="text-[11px] text-muted">
              <summary className="cursor-pointer">{shown.skipped.length} übersprungen</summary>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {shown.skipped.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono text-main">{s.path}</span> – {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!result && restoring && (
            <label className="flex items-start gap-2 p-2.5 rounded-card border border-status-err/40 bg-status-err/10 text-[11px] text-main cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRestore}
                onChange={(e) => setConfirmRestore(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0"
              />
              <span>
                <strong className="text-status-err">Achtung:</strong> Deine bisherigen Daten in den gewählten Bereichen
                ({DATA_SECTIONS.filter((x) => sections.includes(x.id)).map((x) => x.label).join(', ')}) werden vor dem Import
                unwiderruflich gelöscht und durch das Backup ersetzt. Mit dir geteilte Inhalte anderer
                bleiben erhalten.
              </span>
            </label>
          )}
          {!result && (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={runImport}
                disabled={restoring && !confirmRestore}
                className={`h-11 sm:h-8 px-4 text-xs font-semibold disabled:opacity-50 ${restoring ? 'btn-action border-status-err text-status-err' : 'btn-primary'}`}
              >
                {restoring ? 'Löschen und wiederherstellen' : 'Jetzt importieren'}
              </button>
              <button type="button" onClick={reset} className="btn-action h-11 sm:h-8 px-3 text-xs">
                Abbrechen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
