import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { Download } from 'lucide-react';
import { api } from '../../../lib/api';
import { saveBlob } from '../../../lib/download';
import { ImportCard } from '../ImportCard';
import { ServerBackupsCard } from '../ServerBackupsCard';
import { errorMessage } from '../../../lib/errorMessage';
import { SettingRow, SettingsHeading } from '../../../components/SettingsCard';

// Export of the own data: full backup (JSON) and the notes as an Obsidian vault
export function useDataExport() {
  // Works on mobile browsers too: the link must be in the document and the URL alive until the click ran

  const [exportingBackup, setExportingBackup] = useState(false);
  const handleExportData = async () => {
    setExportingBackup(true);
    try {
      saveBlob(await api.exportBackupZip(), `mindsift-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) {
      setVaultError(errorMessage(err, i18n.t('settings:data.backupFailed')));
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
    } catch (err) {
      setVaultError(errorMessage(err, i18n.t('settings:data.exportFailed')));
    } finally {
      setExportingVault(false);
    }
  };

  return { exportingBackup, exportingVault, vaultError, handleExportData, handleExportVault };
}

// Kontoeinstellungen → Export & Import
export function DataSection({
  dataExport,
  onDataChanged,
}: {
  dataExport: ReturnType<typeof useDataExport>;
  onDataChanged: () => void;
}) {
  const { t } = useTranslation('settings');
  const { exportingBackup, exportingVault, vaultError, handleExportData, handleExportVault } = dataExport;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('data.title')}</h2>
      </div>

      <ServerBackupsCard onRestored={onDataChanged} />

      {/* Full Data Backup */}
      <SettingRow
        title={t('data.backupTitle')}
        hint={<Trans t={t} i18nKey="data.backupHint" components={{ c: <code className="font-mono" /> }} />}
      >
        <button
          onClick={handleExportData}
          disabled={exportingBackup}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          <span>{exportingBackup ? t('data.creating') : t('data.backupDownload')}</span>
        </button>
      </SettingRow>

      {/* Obsidian-compatible Markdown vault */}
      <SettingRow
        title={t('data.vaultTitle')}
        hint={
          <>
            <Trans t={t} i18nKey="data.vaultHint" components={{ c: <code className="font-mono" /> }} />
            {vaultError && <span className="block text-status-err mt-1">{vaultError}</span>}
          </>
        }
      >
        <button
          onClick={handleExportVault}
          disabled={exportingVault}
          className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          <span>{exportingVault ? t('data.creating') : t('data.vaultDownload')}</span>
        </button>
      </SettingRow>

      {/* Import: two separate paths, never guessed from the file */}
      <div className="pt-2 space-y-3">
        <SettingsHeading title={t('data.importTitle')} hint={t('data.importHint')} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ImportCard
            source="mindsift"
            onImported={onDataChanged}
            title={t('data.importMindSift')}
            accept=".json,.zip,application/json,application/zip"
            description={
              <Trans t={t} i18nKey="data.importMindSiftHint" components={{ c: <code className="font-mono" /> }} />
            }
          />
          <ImportCard
            source="obsidian"
            onImported={onDataChanged}
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
