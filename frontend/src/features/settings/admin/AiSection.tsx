import React, { useState } from 'react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { VoiceStatusCard } from '../VoiceStatusCard';
import { SpeechSettingsCard } from './SpeechSettingsCard';
import { AdminPage } from './AdminPage';
import { useAdminSettings } from './useAdminSettings';
import { useTranslation } from 'react-i18next';
import { can } from '../../../lib/capabilities';
import { SettingRow } from '../../../components/SettingsCard';

// Administration → Voice input & AI: the server's speech recognition and AI agents over MCP
// (state in useAdminSettings)
export function AiSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings, reloadSettings } = admin;
  // A new setting or model: the status card checks the Whisper server again
  const [statusKey, setStatusKey] = useState(0);
  const changed = () => {
    void reloadSettings();
    setStatusKey((k) => k + 1);
  };
  return (
    <AdminPage title={t('admin.nav.ai')} intro={t('admin.pages.aiIntro')} demoMode={demoMode}>
      <SpeechSettingsCard
        settings={settings}
        onSave={async (patch) => {
          await handleSaveSystemSettings(patch);
          setStatusKey((k) => k + 1);
        }}
        onChanged={changed}
      />
      <VoiceStatusCard key={statusKey} />

      {/* AI agents over MCP (and claude.ai / ChatGPT over OAuth) */}
      <SettingRow
        title={t('server.mcp')}
        hint={
          <>
            {t('server.mcpHint')}
            {can('publicAddress') && ` ${t('server.mcpHintConnectors')}`}
            {settings.mcpConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MCP_ENABLED' })}`}
          </>
        }
      >
        <ToggleSwitch
          checked={settings.mcpEnabled !== false}
          disabled={Boolean(settings.mcpConfiguredViaEnv)}
          onChange={(mcpEnabled) => handleSaveSystemSettings({ mcpEnabled })}
        />
      </SettingRow>
    </AdminPage>
  );
}
