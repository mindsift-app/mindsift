import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { SystemSettings } from '../../../lib/types';
import { ImageQuality } from '../../../lib/media';

// Administration → Media: how strongly the app compresses pictures before upload. The size stays at
// 2048 px for every level (text in screenshots stays readable); "off" uploads pictures as they are.
// Applies to new pictures only. Locked when MEDIA_IMAGE_QUALITY fixes it.
export function ImageQualitySetting({
  settings,
  onSave,
}: {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  const locked = Boolean(settings.imageQualityConfiguredViaEnv);
  return (
    <div className="p-4 bg-canvas border border-border rounded-card flex flex-wrap items-center justify-between gap-4" data-admin-image-quality>
      <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
        <p className="font-bold text-main">{t('server.imageQuality')}</p>
        <p className="text-[11px] text-muted mt-0.5">
          {t('server.imageQualityHint')}
          {locked && ` ${t('server.fixedBy', { env: 'MEDIA_IMAGE_QUALITY' })}`}
        </p>
      </div>
      <SelectMenu<ImageQuality>
        size="sm"
        ariaLabel={t('server.imageQuality')}
        value={settings.imageQuality || 'high'}
        disabled={locked}
        onChange={(imageQuality) => onSave({ imageQuality })}
        options={[
          { value: 'high', label: t('server.imageQualityHigh') },
          { value: 'medium', label: t('server.imageQualityMedium') },
          { value: 'low', label: t('server.imageQualityLow') },
          { value: 'off', label: t('server.imageQualityOff') },
        ]}
      />
    </div>
  );
}
