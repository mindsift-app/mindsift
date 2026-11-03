import React, { useEffect, useState } from 'react';
import { Archive, Download, Loader2, Trash2 } from 'lucide-react';
import { BackupFile, SystemSettings } from '../../lib/types';
import { api } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { formatBytes, saveBlob } from '../../lib/download';
import { formatDateTime } from '../../lib/format';

interface BackupAdminCardProps {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}

// Admin: automatic daily backups (whole database + one backup per user), list and manual run
export const BackupAdminCard: React.FC<BackupAdminCardProps> = ({ settings, onSave }) => {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminListBackups().then(setFiles).catch(() => {});
  }, []);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      setFiles(await api.adminRunBackup());
    } catch (err: any) {
      setError(err.message || 'Backup fehlgeschlagen');
      api.adminListBackups().then(setFiles).catch(() => {});
    } finally {
      setRunning(false);
    }
  };

  const download = async (name: string) => {
    try {
      saveBlob(await api.adminDownloadBackup(name), name);
    } catch (err: any) {
      setError(err.message || 'Download fehlgeschlagen');
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Backup ${name} endgültig löschen?`)) return;
    setError(null);
    try {
      setFiles(await api.adminDeleteBackup(name));
    } catch (err: any) {
      setError(err.message || 'Löschen fehlgeschlagen');
    }
  };

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="pr-4">
          <p className="font-bold text-main flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5 text-accent" />
            Automatische Backups
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            Täglich ein Abzug der ganzen Datenbank und ein Backup je Benutzer unter <code className="font-mono">backups/</code> im
            Datenverzeichnis. Das schützt vor Fehlbedienung, nicht vor einer kaputten Platte: den Ordner zusätzlich woanders sichern.
          </p>
        </div>
        <ToggleSwitch
          checked={Boolean(settings.backupEnabled)}
          onChange={(backupEnabled) => onSave({ backupEnabled })}
          title={settings.backupEnabled ? 'Automatische Backups ausschalten' : 'Automatische Backups einschalten'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-muted">
          Uhrzeit
          <input
            type="time"
            value={settings.backupTime || '03:00'}
            onChange={(e) => e.target.value && onSave({ backupTime: e.target.value })}
            className="block mt-1 h-11 sm:h-8 px-2 input-field text-base sm:text-xs w-28"
          />
        </label>
        <label className="text-[11px] text-muted">
          Aufbewahren (Tage)
          <input
            type="number"
            min={1}
            max={365}
            value={settings.backupRetentionDays || 3}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (n >= 1 && n <= 365) onSave({ backupRetentionDays: n });
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
          {running ? 'Sichere…' : 'Jetzt sichern'}
        </button>
      </div>
      {error && <p className="text-[11px] text-status-err">{error}</p>}

      <div className="border border-border divide-y divide-border bg-panel">
        {files.length === 0 ? (
          <p className="p-3 text-[11px] text-faint">Noch keine Server-Backups vorhanden.</p>
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
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => remove(f.name)}
                  title="Backup löschen"
                  aria-label={`Backup ${f.name} löschen`}
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
        Zurückspielen eines Datenbank-Abzugs: Container stoppen, <code className="font-mono">mindsift.db</code> durch die entpackte Datei
        ersetzen (<code className="font-mono">gunzip</code>), Container starten. Einzelne Benutzer stellen ihre Daten selbst in den
        Kontoeinstellungen wieder her.
      </p>
    </div>
  );
};
