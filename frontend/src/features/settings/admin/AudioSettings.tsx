import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { NumberField } from '../../../components/NumberField';
import { SystemSettings } from '../../../lib/types';

type AudioCompression = NonNullable<SystemSettings['audioCompression']>;

// Bitrates offered for recordings (kbit/s); a value set through MEDIA_AUDIO_BITRATE is shown as well
const BITRATES = [16, 24, 32, 48, 64, 96, 128];
// The largest limit the server takes (storage.MaxAudioLimitMB)
const MAX_LIMIT_MB = 2000;

// Administration → Media: audio in notes. Recordings made in the app are compressed to the chosen
// bitrate (or left to the browser when off); audio files from the device are stored as they are and may
// be switched off. One size limit holds for both. Each part is locked when its variable fixes it
// (MEDIA_AUDIO_*, MEDIA_MAX_AUDIO_MB); the bitrate is greyed out while compression is off.
export function AudioSettings({
  settings,
  onSave,
}: {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  const compression = settings.audioCompression || 'recordings';
  const bitrate = settings.audioBitrate || 32;
  const limit = settings.audioLimitMB || 7;
  const bitrates = BITRATES.includes(bitrate) ? BITRATES : [...BITRATES, bitrate].sort((a, b) => a - b);

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3" data-admin-audio>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="font-bold text-main">{t('server.audioCompression')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.audioCompressionHint')}
            {settings.audioCompressionConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_AUDIO_COMPRESSION' })}`}
          </p>
        </div>
        <SelectMenu<AudioCompression>
          size="sm"
          ariaLabel={t('server.audioCompression')}
          value={compression}
          disabled={Boolean(settings.audioCompressionConfiguredViaEnv)}
          onChange={(audioCompression) => onSave({ audioCompression })}
          options={[
            { value: 'recordings', label: t('server.audioCompressionRecordings') },
            { value: 'off', label: t('server.audioCompressionOff') },
          ]}
        />
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border ${compression === 'off' ? 'opacity-50' : ''}`}
        data-admin-audio-bitrate
      >
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="text-main font-semibold">{t('server.audioBitrate')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.audioBitrateHint')}
            {settings.audioBitrateConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_AUDIO_BITRATE' })}`}
          </p>
        </div>
        <SelectMenu
          size="sm"
          ariaLabel={t('server.audioBitrate')}
          value={String(bitrate)}
          disabled={compression === 'off' || Boolean(settings.audioBitrateConfiguredViaEnv)}
          onChange={(v) => onSave({ audioBitrate: Number(v) })}
          options={bitrates.map((k) => ({
            value: String(k),
            label: k === 32 ? t('server.audioBitrateDefault', { kbps: k }) : t('server.audioBitrateOption', { kbps: k }),
          }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="text-main font-semibold">{t('server.audioLimit')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.audioLimitHint')}
            {settings.audioLimitMBConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_MAX_AUDIO_MB' })}`}
          </p>
        </div>
        <NumberField
          value={limit}
          min={1}
          max={MAX_LIMIT_MB}
          unit={t('server.mb')}
          label={t('server.audioLimit')}
          disabled={Boolean(settings.audioLimitMBConfiguredViaEnv)}
          onCommit={(audioLimitMB) => onSave({ audioLimitMB })}
        />
      </div>

      <div className="flex items-center justify-between gap-4 pt-3 border-t border-border">
        <div className="pr-4">
          <p className="text-main font-semibold">{t('server.audioUploads')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.audioUploadsHint')}
            {settings.audioUploadsConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_AUDIO_UPLOADS' })}`}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.audioUploads !== false}
          disabled={Boolean(settings.audioUploadsConfiguredViaEnv)}
          onChange={(audioUploads) => onSave({ audioUploads })}
          title={t('server.audioUploads')}
        />
      </div>
    </div>
  );
}
