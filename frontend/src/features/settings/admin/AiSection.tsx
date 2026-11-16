import React from 'react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { VoiceStatusCard } from '../VoiceStatusCard';
import { AdminPage } from './AdminPage';
import { useAdminSettings } from './useAdminSettings';
import { useTranslation } from 'react-i18next';

// Administration → Voice input & AI: the server's speech recognition and AI agents over MCP
// (state in useAdminSettings)
export function AiSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings } = admin;
  return (
    <AdminPage title={t('admin.nav.ai')} intro={t('admin.pages.aiIntro')} demoMode={demoMode}>
      <VoiceStatusCard />

      {/* AI agents over MCP (and claude.ai / ChatGPT over OAuth) */}
      <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
        <div className="pr-4">
          <p className="font-bold text-main">{t('server.mcp')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.mcpHint')}
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
