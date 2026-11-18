import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectMenu } from '../../../components/SelectMenu';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SpeechSettings, SystemSettings } from '../../../lib/types';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { MbLimitField } from './MbLimitField';
import { SpeechModelPicker } from './SpeechModelPicker';

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
};

// The numbers with their range (as the server checks them) and unit
const LIMITS: { key: 'maxSeconds' | 'maxUploadMb' | 'maxParallel' | 'perUserPerHour' | 'timeoutSeconds'; min: number; max: number; unit: string }[] = [
  { key: 'maxSeconds', min: 5, max: 3600, unit: 's' },
  { key: 'maxUploadMb', min: 1, max: 500, unit: 'MB' },
  { key: 'maxParallel', min: 1, max: 32, unit: '' },
  { key: 'perUserPerHour', min: 1, max: 100000, unit: '' },
  { key: 'timeoutSeconds', min: 5, max: 3600, unit: 's' },
];

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
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3" data-admin-speech>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
          <p className="font-bold text-main">{t('speech.mode')}</p>
          <p className="text-[11px] text-muted mt-0.5">
            {t('speech.modeHint')}
            {fixed('mode')}
          </p>
        </div>
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
      </div>

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

      {/* Limits of the Whisper server */}
      <div className={`space-y-2 pt-3 border-t border-border ${mode === 'server' ? '' : 'opacity-50'}`}>
        <p className="text-main font-semibold">{t('speech.limits')}</p>
        {LIMITS.map((l) => (
          <div key={l.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {t(`speech.limit.${l.key}`)}
              {fixed(l.key)}
            </span>
            <MbLimitField
              value={sp[l.key] ?? 0}
              min={l.min}
              max={l.max}
              unit={l.unit}
              label={t(`speech.limit.${l.key}`)}
              disabled={locked(l.key)}
              onSave={(n) => save({ [l.key]: n })}
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[11px] text-muted pr-4">
            {t('speech.vadFilter')}
            {fixed('vadFilter')}
          </span>
          <ToggleSwitch
            checked={sp.vadFilter !== false}
            disabled={locked('vadFilter')}
            onChange={(vadFilter) => save({ vadFilter })}
            title={t('speech.vadFilter')}
          />
        </div>
      </div>
    </div>
  );
}
