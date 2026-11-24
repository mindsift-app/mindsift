import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SystemSettings } from '../../../lib/types';
import { ImageQuality } from '../../../lib/media';
import { NumberField } from '../../../components/NumberField';
import { SettingsCard } from '../../../components/SettingsCard';

// The largest limit the server takes (storage.MaxImageLimitMB)
const MAX_LIMIT_MB = 1000;

// Administration → Media: images in notes. Whether new images may go in at all, how strongly the app
// compresses them before upload (size at most 2048 px for every level, "off" uploads them as they
// are), the largest image, and whether images may be fetched from other addresses. While images are
// off the rest stays visible, greyed out. Each part is locked when its MEDIA_* variable fixes it.
export function ImageSettings({
  settings,
  demoMode = false,
  onSave,
}: {
  settings: SystemSettings;
  demoMode?: boolean;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  const enabled = settings.images !== false;
  const grey = enabled ? '' : 'opacity-50';
  return (
    <SettingsCard
      data-admin-images
      title={t('server.images')}
      hint={
        <>
          {t('server.imagesHint')}
          {settings.imagesConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_IMAGES' })}`}
        </>
      }
      action={
        <ToggleSwitch
          checked={enabled}
          disabled={Boolean(settings.imagesConfiguredViaEnv)}
          onChange={(images) => onSave({ images })}
          title={t('server.images')}
        />
      }
    >
      <div className={`flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-border ${grey}`} data-admin-image-quality>
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="text-main font-semibold">{t('server.imageQuality')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.imageQualityHint')}
            {settings.imageQualityConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_IMAGE_QUALITY' })}`}
          </p>
        </div>
        <SelectMenu<ImageQuality>
          size="sm"
          ariaLabel={t('server.imageQuality')}
          value={settings.imageQuality || 'high'}
          disabled={!enabled || Boolean(settings.imageQualityConfiguredViaEnv)}
          onChange={(imageQuality) => onSave({ imageQuality })}
          options={[
            { value: 'high', label: t('server.imageQualityHigh') },
            { value: 'medium', label: t('server.imageQualityMedium') },
            { value: 'low', label: t('server.imageQualityLow') },
            { value: 'off', label: t('server.imageQualityOff') },
          ]}
        />
      </div>

      <div className={`flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border ${grey}`}>
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="text-main font-semibold">{t('server.imageLimit')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.imageLimitHint')}
            {settings.imageLimitMBConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_MAX_IMAGE_MB' })}`}
          </p>
        </div>
        <NumberField
          value={settings.imageLimitMB || 15}
          min={1}
          max={MAX_LIMIT_MB}
          unit={t('server.mb')}
          label={t('server.imageLimit')}
          disabled={!enabled || Boolean(settings.imageLimitMBConfiguredViaEnv)}
          onCommit={(imageLimitMB) => onSave({ imageLimitMB })}
        />
      </div>

      <div className={`flex items-center justify-between gap-4 pt-3 border-t border-border ${grey}`}>
        <div className="pr-4">
          <p className="text-main font-semibold">{t('server.externalImages')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.externalImagesHint')}
            {/* The demo never fetches from other addresses */}
            {settings.externalImagesConfiguredViaEnv && ` ${t('server.fixedBy', { env: demoMode ? 'MINDSIFT_DEMO' : 'MEDIA_EXTERNAL_IMAGES' })}`}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.externalImages !== false}
          disabled={!enabled || Boolean(settings.externalImagesConfiguredViaEnv)}
          onChange={(externalImages) => onSave({ externalImages })}
          title={t('server.externalImages')}
        />
      </div>
    </SettingsCard>
  );
}
