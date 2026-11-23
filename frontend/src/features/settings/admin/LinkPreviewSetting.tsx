import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SystemSettings } from '../../../lib/types';
import { SettingRow } from '../../../components/SettingsCard';

// Administration → Server: link previews for the whole server. Off, the server fetches no pages and the
// app shows neither preview cards nor the switch per device. Always off in the demo.
export function LinkPreviewSetting({
  settings,
  demoMode,
  onSave,
}: {
  settings: SystemSettings;
  demoMode: boolean;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <SettingRow
      data-admin-link-previews
      title={t('server.linkPreviews')}
      hint={
        <>
          {t('server.linkPreviewsHint')}
          {demoMode
          ? ` ${t('server.fixedBy', { env: 'MINDSIFT_DEMO' })}`
          : settings.linkPreviewsConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'LINK_PREVIEWS' })}`}
        </>
      }
    >
      <ToggleSwitch
        checked={!demoMode && settings.linkPreviews !== false}
        disabled={demoMode || Boolean(settings.linkPreviewsConfiguredViaEnv)}
        onChange={(linkPreviews) => onSave({ linkPreviews })}
        title={t('server.linkPreviews')}
      />
    </SettingRow>
  );
}
