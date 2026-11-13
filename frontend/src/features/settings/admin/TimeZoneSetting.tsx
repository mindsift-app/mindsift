import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SystemSettings } from '../../../lib/types';
import { SelectMenu } from '../../../components/SelectMenu';
import { formatDateTime } from '../../../lib/format';
import { browserTimeZone, serverWallClock, timeZoneLabel, timeZoneList } from '../../../lib/timeZones';

// How often the shown server time moves on between loads
const TICK_MS = 15_000;

// Administration → the server's time zone: one for the whole installation, in effect as soon as it is saved.
// Shows the zone in effect, its source (this setting, TZ, or UTC by default) and the server's time now.
export function TimeZoneSetting({
  settings,
  onSave,
}: {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  const st = settings.serverTime;
  const setting = settings.timeZone || '';
  const fallback = st?.fallback || 'UTC';
  const options = useMemo(
    () => [
      { value: '', label: t('timeZone.notSet', { zone: timeZoneLabel(fallback) }) },
      ...timeZoneList([setting, st?.zone || '']).map((z) => ({ value: z, label: timeZoneLabel(z) })),
    ],
    [t, fallback, setting, st?.zone],
  );

  // The server's clock moves on locally from the time it last sent
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setLoadedAt(Date.now());
    setNow(Date.now());
  }, [st?.now]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const wall = st ? serverWallClock(st.now, Math.max(0, now - loadedAt)) : null;

  const browser = browserTimeZone();
  return (
    <div data-admin-time-zone>
      <p className="block text-muted font-semibold mb-1">{t('timeZone.title')}</p>
      <div className="w-full max-w-md">
        <SelectMenu
          ariaLabel={t('timeZone.title')}
          value={setting}
          onChange={(timeZone) => onSave({ timeZone })}
          options={options}
        />
      </div>
      {st && wall && (
        <p className="text-xs text-main mt-1.5 max-w-md" data-server-time>
          {t('timeZone.now', {
            time: formatDateTime(wall.wall, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }),
            // "Europe/Berlin, UTC+01:00", for UTC itself only "UTC"
            zone: wall.offset === st.zone ? st.zone : `${timeZoneLabel(st.zone)}, ${wall.offset}`,
          })}
        </p>
      )}
      {st && (
        <p className={`text-[11px] mt-0.5 max-w-md ${st.source === 'default' ? 'text-status-warn' : 'text-muted'}`}>
          {t(`timeZone.source.${st.source}`)}
        </p>
      )}
      <p className="text-[11px] text-muted mt-1 max-w-md">{t('timeZone.hint')}</p>
      {(setting || (browser && browser !== st?.zone)) && (
        <div className="flex flex-wrap gap-2 mt-2">
          {browser && browser !== st?.zone && (
            <button type="button" onClick={() => onSave({ timeZone: browser })} className="btn-action h-11 sm:h-8 px-3 text-xs">
              {t('timeZone.useBrowser', { zone: timeZoneLabel(browser) })}
            </button>
          )}
          {setting && (
            <button type="button" onClick={() => onSave({ timeZone: '' })} className="btn-action h-11 sm:h-8 px-3 text-xs">
              {t('timeZone.reset')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
