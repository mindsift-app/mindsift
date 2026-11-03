import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../../lib/api';
import { saveBlob } from '../../../lib/download';
import { ImportCard } from '../ImportCard';
import { ServerBackupsCard } from '../ServerBackupsCard';

// Export of the own data: full backup (JSON) and the notes as an Obsidian vault
export function useDataExport() {
  // Works on mobile browsers too: the link must be in the document and the URL alive until the click ran

  const [exportingBackup, setExportingBackup] = useState(false);
  const handleExportData = async () => {
    setExportingBackup(true);
    try {
      saveBlob(await api.exportBackupZip(), `mindsift-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err: any) {
      setVaultError(err.message || 'Backup fehlgeschlagen');
    } finally {
      setExportingBackup(false);
    }
  };

  const [exportingVault, setExportingVault] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const handleExportVault = async () => {
    setExportingVault(true);
    setVaultError(null);
    try {
      saveBlob(await api.exportMarkdownVault(), `mindsift-vault-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err: any) {
      setVaultError(err.message || 'Export fehlgeschlagen');
    } finally {
      setExportingVault(false);
    }
  };

  return { exportingBackup, exportingVault, vaultError, handleExportData, handleExportVault };
}

// Kontoeinstellungen → Export & Import
export function DataSection({ dataExport }: { dataExport: ReturnType<typeof useDataExport> }) {
  const { exportingBackup, exportingVault, vaultError, handleExportData, handleExportVault } = dataExport;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">Export & Import</h2>
        <p className="text-muted mt-0.5">
          Lade deine Daten als Backup oder Markdown-Archiv herunter, spiele Server-Backups zurück oder importiere
          MindSift-Daten und Obsidian-Vaults.
        </p>
      </div>

      <ServerBackupsCard />

      {/* Full Data Backup */}
      <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-main">Vollständiges Backup (.zip)</h3>
          <p className="text-muted text-[11px]">
            Alle deine Gedanken, Aufgaben, Notizen und Listen als JSON, mit den Bildern und Sprachnotizen deiner
            Notizen, gepackt in eine ZIP-Datei. Über „MindSift-Daten importieren“ lässt es sich vollständig zurückspielen.
          </p>
        </div>
        <button
          onClick={handleExportData}
          disabled={exportingBackup}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 flex-shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          <span>{exportingBackup ? 'Wird erstellt…' : 'Backup herunterladen'}</span>
        </button>
      </div>

      {/* Obsidian-compatible Markdown vault */}
      <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-main">Markdown-Archiv für Obsidian (.zip)</h3>
          <p className="text-muted text-[11px]">
            Alle Notizen als <code className="font-mono">.md</code>-Dateien in deiner Ordnerstruktur (mit Titel, Tags und
            Datum im Kopf), Aufgaben je Liste unter <code className="font-mono">Aufgaben/</code> im Format des
            Obsidian-Tasks-Plugins, Listen unter <code className="font-mono">Listen/</code>, Bilder und Sprachnotizen unter{' '}
            <code className="font-mono">attachments/</code>. Mit dir geteilte Notizen sind dabei.
          </p>
          {vaultError && <p className="text-[11px] text-status-err mt-1">{vaultError}</p>}
        </div>
        <button
          onClick={handleExportVault}
          disabled={exportingVault}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 flex-shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          <span>{exportingVault ? 'Wird erstellt…' : 'Markdown-Archiv herunterladen'}</span>
        </button>
      </div>

      {/* Import: two separate paths, never guessed from the file */}
      <div className="pt-4 border-t border-border space-y-3">
        <div>
          <h3 className="font-bold text-main">Daten importieren</h3>
          <p className="text-muted text-[11px]">
            Ein Import legt alles neu an und ändert nichts Bestehendes. Vor dem Import siehst du, was angelegt wird.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ImportCard
            source="mindsift"
            title="MindSift-Daten"
            accept=".json,.zip,application/json,application/zip"
            description={
              <>
                Eigenes Backup zurückspielen: JSON-Backup (<code className="font-mono">.json</code>) oder Markdown-Archiv
                (<code className="font-mono">.zip</code>). Notizen kommen in ihre Ordner, Aufgabenlisten mit Unteraufgaben,
                Fälligkeiten und Prioritäten sowie Listen werden wiederhergestellt.
              </>
            }
          />
          <ImportCard
            source="obsidian"
            title="Obsidian-Vault"
            accept=".zip,application/zip"
            description={
              <>
                Vault als <code className="font-mono">.zip</code>. Alle Notizen landen in einem eigenen Ordner mit dem Namen
                des Vaults, Unterordner bleiben erhalten. Checkboxen bleiben Checkboxen in der Notiz, Frontmatter-Tags werden zu
                #Hashtags. Bilder und Audiodateien, die eine Notiz einbettet (<code className="font-mono">![[bild.png]]</code>{' '}
                oder <code className="font-mono">![](bild.png)</code>), werden übernommen; andere Anhänge wie PDFs nicht.
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
