import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
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
      setVaultError(err.message || i18n.t('settings:data.backupFailed'));
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
      setVaultError(err.message || i18n.t('settings:data.exportFailed'));
    } finally {
      setExportingVault(false);
    }
  };

  return { exportingBackup, exportingVault, vaultError, handleExportData, handleExportVault };
}

// Kontoeinstellungen → Export & Import
export function DataSection({ dataExport }: { dataExport: ReturnType<typeof useDataExport> }) {
  const { t } = useTranslation('settings');
  const { exportingBackup, exportingVault, vaultError, handleExportData, handleExportVault } = dataExport;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('data.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('data.intro')}
        </p>
      </div>

      <ServerBackupsCard />

      {/* Full Data Backup */}
      <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-main">{t('data.backupTitle')}</h3>
          <p className="text-muted text-[11px]">
            <Trans t={t} i18nKey="data.backupHint" components={{ c: <code className="font-mono" /> }} />
          </p>
        </div>
        <button
          onClick={handleExportData}
          disabled={exportingBackup}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 flex-shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          <span>{exportingBackup ? t('data.creating') : t('data.backupDownload')}</span>
        </button>
      </div>

      {/* Obsidian-compatible Markdown vault */}
      <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-main">{t('data.vaultTitle')}</h3>
          <p className="text-muted text-[11px]">
            <Trans t={t} i18nKey="data.vaultHint" components={{ c: <code className="font-mono" /> }} />
          </p>
          {vaultError && <p className="text-[11px] text-status-err mt-1">{vaultError}</p>}
        </div>
        <button
          onClick={handleExportVault}
          disabled={exportingVault}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 flex-shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          <span>{exportingVault ? t('data.creating') : t('data.vaultDownload')}</span>
        </button>
      </div>

      {/* Import: two separate paths, never guessed from the file */}
      <div className="pt-4 border-t border-border space-y-3">
        <div>
          <h3 className="font-bold text-main">{t('data.importTitle')}</h3>
          <p className="text-muted text-[11px]">
            {t('data.importHint')}
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ImportCard
            source="mindsift"
            title={t('data.importMindSift')}
            accept=".json,.zip,application/json,application/zip"
            description={
              <Trans t={t} i18nKey="data.importMindSiftHint" components={{ c: <code className="font-mono" /> }} />
            }
          />
          <ImportCard
            source="obsidian"
            title={t('data.importObsidian')}
            accept=".zip,application/zip"
            description={
              <Trans t={t} i18nKey="data.importObsidianHint" components={{ c: <code className="font-mono" /> }} />
            }
          />
        </div>
      </div>
    </div>
  );
}
