import { useTranslation } from 'react-i18next';
import { SystemSettings } from '../../../lib/types';
import { NumberField } from '../../../components/NumberField';
import { SettingRow } from '../../../components/SettingsCard';

// The largest storage the server takes (storage.MaxMediaQuotaMB)
const MAX_QUOTA_MB = 10000000;

// Administration → Media: how much room images and audio of one person may take, 0 = unlimited. Locked
// when MEDIA_QUOTA_MB fixes it.
export function MediaQuotaSetting({
  settings,
  onSave,
}: {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <SettingRow
      data-admin-media-quota
      title={t('server.mediaQuota')}
      hint={
        <>
          {t('server.mediaQuotaHint')}
          {settings.mediaQuotaMBConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_QUOTA_MB' })}`}
        </>
      }
    >
      <NumberField
        value={settings.mediaQuotaMB ?? 0}
        min={0}
        max={MAX_QUOTA_MB}
        unit={t('server.mb')}
        label={t('server.mediaQuota')}
        disabled={Boolean(settings.mediaQuotaMBConfiguredViaEnv)}
        onCommit={(mediaQuotaMB) => onSave({ mediaQuotaMB })}
      />
    </SettingRow>
  );
}
