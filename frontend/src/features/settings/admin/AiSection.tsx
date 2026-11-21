import React, { useState } from 'react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { VoiceStatusCard } from '../VoiceStatusCard';
import { SpeechSettingsCard } from './SpeechSettingsCard';
import { AdminPage } from './AdminPage';
import { useAdminSettings } from './useAdminSettings';
import { useTranslation } from 'react-i18next';
import { isDesktopApp } from '../../../lib/api';

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
    <AdminPage title={t('admin.nav.ai')} intro={t(isDesktopApp() ? 'admin.pages.aiIntroDesktop' : 'admin.pages.aiIntro')} demoMode={demoMode}>
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
      <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
        <div className="pr-4">
          <p className="font-bold text-main">{t('server.mcp')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t(isDesktopApp() ? 'server.mcpHintDesktop' : 'server.mcpHint')}
            {settings.mcpConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MCP_ENABLED' })}`}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.mcpEnabled !== false}
          disabled={Boolean(settings.mcpConfiguredViaEnv)}
          onChange={(mcpEnabled) => handleSaveSystemSettings({ mcpEnabled })}
        />
      </div>
    </AdminPage>
  );
}
