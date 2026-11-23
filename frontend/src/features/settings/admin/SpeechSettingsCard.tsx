import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SpeechSettings, SystemSettings } from '../../../lib/types';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { NumberField } from '../../../components/NumberField';
import { SpeechModelPicker } from './SpeechModelPicker';
import { SettingsCard } from '../../../components/SettingsCard';

type Mode = 'server' | 'browser' | 'off';

// The variable that fixes each field, as the server names them in configuredViaEnv
const ENV: Record<string, string> = {
  mode: 'STT_DISABLED',
  allowBrowser: 'STT_ALLOW_BROWSER',
  url: 'STT_URL',
  apiKey: 'STT_API_KEY',
  model: 'STT_MODEL',
  maxSeconds: 'STT_MAX_SECONDS',
  maxUploadMb: 'STT_MAX_UPLOAD_MB',
  maxParallel: 'STT_MAX_PARALLEL',
  perUserPerHour: 'STT_PER_USER_PER_HOUR',
  timeoutSeconds: 'STT_TIMEOUT_SECONDS',
  vadFilter: 'STT_VAD_FILTER',
  chunked: 'STT_CHUNKED',
  chunkSeconds: 'STT_CHUNK_SECONDS',
};

// The limits with their range (as the server checks them) and unit (speech.unit.<unit>)
type Unit = 'seconds' | 'mb' | 'parallel' | 'perHour';
const LIMITS: { key: 'maxSeconds' | 'maxUploadMb' | 'maxParallel' | 'perUserPerHour' | 'timeoutSeconds'; min: number; max: number; unit: Unit }[] = [
  { key: 'maxSeconds', min: 5, max: 3600, unit: 'seconds' },
  { key: 'maxUploadMb', min: 1, max: 500, unit: 'mb' },
  { key: 'maxParallel', min: 1, max: 32, unit: 'parallel' },
  { key: 'perUserPerHour', min: 1, max: 100000, unit: 'perHour' },
  { key: 'timeoutSeconds', min: 5, max: 3600, unit: 'seconds' },
];

// The longest piece of a recording sent while speaking (storage: speech_chunk_seconds)
const CHUNK_SECONDS = { min: 2, max: 30, default: 8 };

// Administration → Voice input & AI: how voice input works on this server. The mode (own Whisper server,
// the browser's recognition, off), whether people may pick the browser in server mode, address and key of
// the Whisper server, its model and the limits. Each field STT_* fixes shows its value and stays locked.
export function SpeechSettingsCard({
  settings,
  onSave,
  onChanged,
}: {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => Promise<void> | void;
  // after a model was chosen or downloaded (the settings and the status are read again)
  onChanged: () => void;
}) {
  const { t } = useTranslation('settings');
  const sp: SpeechSettings = settings.speech ?? { mode: '', url: '', model: '' };
  const locked = (field: string) => (sp.configuredViaEnv ?? []).includes(field);
  const fixed = (field: string) => (locked(field) ? ` ${t('server.fixedBy', { env: ENV[field] })}` : '');
  const save = (patch: Partial<SpeechSettings>) => onSave({ speech: { ...sp, apiKey: undefined, configuredViaEnv: undefined, ...patch } });
  const mode: Mode = sp.mode === 'off' || sp.mode === 'browser' ? sp.mode : sp.url ? 'server' : 'browser';

  // Address and key are typed and saved together with the button
  const [url, setUrl] = useState(sp.url);
  const [key, setKey] = useState('');
  const [shownUrl, setShownUrl] = useState(sp.url);
  if (shownUrl !== sp.url) {
    setShownUrl(sp.url);
    setUrl(sp.url);
  }

  return (
    <SettingsCard
      data-admin-speech
      title={t('speech.mode')}
      hint={
        <>
          {t('speech.modeHint')}
          {fixed('mode')}
        </>
      }
      action={
        <SelectMenu<Mode>
          size="sm"
          ariaLabel={t('speech.mode')}
          value={mode}
          disabled={locked('mode')}
          onChange={(m) => save({ mode: m })}
          options={[
            { value: 'server', label: t('speech.modeServer') },
            { value: 'browser', label: t('speech.modeBrowser') },
            { value: 'off', label: t('speech.modeOff') },
          ]}
        />
      }
    >
      <div className={`flex items-center justify-between gap-4 pt-3 border-t border-border ${mode === 'off' ? 'opacity-50' : ''}`}>
        <div className="pr-4">
          <p className="text-main font-semibold">{t('speech.allowBrowser')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('speech.allowBrowserHint')}
            {fixed('allowBrowser')}
          </p>
        </div>
        <ToggleSwitch
          checked={sp.allowBrowser !== false}
          disabled={mode === 'off' || locked('allowBrowser')}
          onChange={(allowBrowser) => save({ allowBrowser })}
          title={t('speech.allowBrowser')}
        />
      </div>

      {/* The Whisper server: address and key, then its models */}
      <div className={`space-y-2 pt-3 border-t border-border ${mode === 'server' ? '' : 'opacity-50'}`}>
        <p className="text-main font-semibold">{t('speech.server')}</p>
        <p className="text-[11px] text-muted">{t('speech.serverHint')}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            {...NO_AUTOFILL}
            type="url"
            value={url}
            disabled={locked('url')}
            placeholder="http://whisper:8000"
            aria-label={t('speech.url')}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 h-11 sm:h-8 px-2 input-field text-base sm:text-xs font-mono"
          />
          <input
            {...NO_AUTOFILL}
            type="password"
            value={key}
            disabled={locked('apiKey')}
            placeholder={sp.apiKeySet ? t('speech.keySet') : t('speech.keyPlaceholder')}
            aria-label={t('speech.key')}
            onChange={(e) => setKey(e.target.value)}
            className="sm:w-48 h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
          />
          <button
            type="button"
            disabled={(url.trim() === sp.url && !key) || (locked('url') && locked('apiKey'))}
            onClick={() => {
              void save({ url: url.trim(), ...(key ? { apiKey: key } : {}) });
              setKey('');
            }}
            className="btn-primary h-11 sm:h-8 px-4 text-xs disabled:opacity-40"
          >
            {t('speech.saveServer')}
          </button>
        </div>
        {(locked('url') || locked('apiKey')) && (
          <p className="text-[11px] text-muted">{[fixed('url'), fixed('apiKey')].filter(Boolean).join(' ').trim()}</p>
        )}
        {sp.apiKeyUnreadable && <p className="text-[11px] text-status-warn">{t('speech.keyUnreadable')}</p>}
        {sp.apiKeySet && !locked('apiKey') && (
          <button type="button" onClick={() => save({ clearApiKey: true })} className="text-[11px] text-muted underline hover:text-main">
            {t('speech.keyRemove')}
          </button>
        )}
        {sp.url && (
          <div className="space-y-1.5 pt-1">
            <p className="text-main font-semibold">{t('speech.model')}</p>
            <p className="text-[11px] text-muted">
              {t('speech.modelHint')}
              {fixed('model')}
            </p>
            <SpeechModelPicker locked={locked('model')} onChanged={onChanged} />
          </div>
        )}
      </div>

      {/* Limits of the Whisper server: two columns, each label above its field */}
      <div className={`space-y-2 pt-3 border-t border-border ${mode === 'server' ? '' : 'opacity-50'}`} data-speech-limits>
        <p className="text-main font-semibold">{t('speech.limits')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {LIMITS.map((l) => (
            <label key={l.key} className="block min-w-0">
              <span className="block text-[11px] text-muted mb-1">{t(`speech.limit.${l.key}`)}</span>
              <NumberField
                value={sp[l.key] ?? 0}
                min={l.min}
                max={l.max}
                unit={t(`speech.unit.${l.unit}`, { count: sp[l.key] ?? 0 })}
                label={t(`speech.limit.${l.key}`)}
                disabled={locked(l.key)}
                onCommit={(n) => save({ [l.key]: n })}
                className="w-full"
              />
              {locked(l.key) && <span className="block text-[11px] text-faint mt-1">{fixed(l.key).trim()}</span>}
            </label>
          ))}
        </div>
      </div>

      {/* How the Whisper server works on a recording */}
      <div className={`space-y-3 pt-3 border-t border-border ${mode === 'server' ? '' : 'opacity-50'}`} data-speech-recognition>
        <p className="text-main font-semibold">{t('speech.recognition')}</p>
        <div className="flex items-center justify-between gap-4">
          <div className="pr-4">
            <p className="text-main">{t('speech.chunked')}</p>
            <p className="text-[11px] text-muted mt-0.5">
              {t('speech.chunkedHint')}
              {fixed('chunked')}
            </p>
          </div>
          <ToggleSwitch
            checked={sp.chunked !== false}
            disabled={locked('chunked')}
            onChange={(chunked) => save({ chunked })}
            title={t('speech.chunked')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
            <p className="text-main">{t('speech.chunkSeconds')}</p>
            <p className="text-[11px] text-muted mt-0.5">
              {t('speech.chunkSecondsHint')}
              {fixed('chunkSeconds')}
            </p>
          </div>
          <NumberField
            value={sp.chunkSeconds || CHUNK_SECONDS.default}
            min={CHUNK_SECONDS.min}
            max={CHUNK_SECONDS.max}
            unit={t('speech.unit.seconds', { count: sp.chunkSeconds || CHUNK_SECONDS.default })}
            label={t('speech.chunkSeconds')}
            disabled={locked('chunkSeconds')}
            onCommit={(chunkSeconds) => save({ chunkSeconds })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="pr-4">
            <p className="text-main">{t('speech.vadFilter')}</p>
            <p className="text-[11px] text-muted mt-0.5">
              {t('speech.vadFilterHint')}
              {fixed('vadFilter')}
            </p>
          </div>
          <ToggleSwitch
            checked={sp.vadFilter !== false}
            disabled={locked('vadFilter')}
            onChange={(vadFilter) => save({ vadFilter })}
            title={t('speech.vadFilter')}
          />
        </div>
      </div>
    </SettingsCard>
  );
}
