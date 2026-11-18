import { useTranslation } from 'react-i18next';
import { SystemSettings } from '../../../lib/types';
import { NumberField } from '../../../components/NumberField';

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
    <div className="p-4 bg-canvas border border-border rounded-card flex flex-wrap items-center justify-between gap-2" data-admin-media-quota>
      <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
        <p className="font-bold text-main">{t('server.mediaQuota')}</p>
        <p className="text-[11px] text-muted mt-0.5">
          {t('server.mediaQuotaHint')}
          {settings.mediaQuotaMBConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_QUOTA_MB' })}`}
        </p>
      </div>
      <NumberField
        value={settings.mediaQuotaMB ?? 0}
        min={0}
        max={MAX_QUOTA_MB}
        unit={t('server.mb')}
        label={t('server.mediaQuota')}
        disabled={Boolean(settings.mediaQuotaMBConfiguredViaEnv)}
        onCommit={(mediaQuotaMB) => onSave({ mediaQuotaMB })}
      />
    </div>
  );
}
