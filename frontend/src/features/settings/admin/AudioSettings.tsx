import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { SystemSettings } from '../../../lib/types';

type AudioCompression = NonNullable<SystemSettings['audioCompression']>;

// Bitrates offered for recordings (kbit/s); a value set through MEDIA_AUDIO_BITRATE is shown as well
const BITRATES = [16, 24, 32, 48, 64, 96, 128];

// Administration → Media: audio in notes. Recordings made in the app are compressed to the chosen
// bitrate (or left to the browser when off); audio files from the device are stored as they are, up to
// the upload limit. Each part is locked when its MEDIA_AUDIO_* variable fixes it.
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
  const uploadMax = settings.audioUploadMaxMB || 7;
  const maxMB = settings.audioMaxMB || 50;
  const bitrates = BITRATES.includes(bitrate) ? BITRATES : [...BITRATES, bitrate].sort((a, b) => a - b);

  // The limit is typed, so it is saved when the field is left (or with Enter), not on every keystroke
  // (a new value from the server replaces the draft)
  const [draft, setDraft] = useState(String(uploadMax));
  const [shown, setShown] = useState(uploadMax);
  if (shown !== uploadMax) {
    setShown(uploadMax);
    setDraft(String(uploadMax));
  }
  const commitUploadMax = () => {
    const n = parseInt(draft, 10);
    if (Number.isInteger(n) && n >= 1 && n <= maxMB) {
      if (n !== uploadMax) onSave({ audioUploadMaxMB: n });
    } else {
      setDraft(String(uploadMax));
    }
  };

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

      {compression !== 'off' && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
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
            disabled={Boolean(settings.audioBitrateConfiguredViaEnv)}
            onChange={(v) => onSave({ audioBitrate: Number(v) })}
            options={bitrates.map((k) => ({
              value: String(k),
              label: k === 32 ? t('server.audioBitrateDefault', { kbps: k }) : t('server.audioBitrateOption', { kbps: k }),
            }))}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="text-main font-semibold">{t('server.audioUploadMax')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('server.audioUploadMaxHint', { max: maxMB })}
            {settings.audioUploadMaxMBConfiguredViaEnv && ` ${t('server.fixedBy', { env: 'MEDIA_AUDIO_UPLOAD_MAX_MB' })}`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input
            type="number"
            min={1}
            max={maxMB}
            value={draft}
            disabled={Boolean(settings.audioUploadMaxMBConfiguredViaEnv)}
            aria-label={t('server.audioUploadMax')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitUploadMax}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="h-11 sm:h-8 px-2 input-field text-base sm:text-xs w-24"
          />
          {t('server.mb')}
        </label>
      </div>
    </div>
  );
}
