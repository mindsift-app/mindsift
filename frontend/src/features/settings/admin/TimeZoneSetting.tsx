import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SystemSettings } from '../../../lib/types';
import { SelectMenu } from '../../../components/SelectMenu';
import { formatDateTime } from '../../../lib/format';
import { browserTimeZone, serverWallClock, timeZoneLabel, timeZoneList } from '../../../lib/timeZones';

// How often the shown server time moves on between loads
const TICK_MS = 15_000;

// Administration → the server's time zone: one for the whole installation, in effect as soon as it is saved.
// A row of the instance group in ServerSection; choosing "not set" in the menu takes the setting back.
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
    // The local clock restarts from each new server time (Date.now() is not for render)
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="p-4 flex flex-wrap items-center justify-between gap-4" data-admin-time-zone>
      <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:pr-4">
        <p className="font-bold text-main">{t('timeZone.title')}</p>
        <p className="text-[11px] text-muted mt-0.5">{t('timeZone.hint')}</p>
        {st && wall && (
          <p className="text-[11px] text-main mt-1.5" data-server-time>
            {t('timeZone.now', {
              time: formatDateTime(wall.wall, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }),
              // "Europe/Berlin, UTC+01:00", for UTC itself only "UTC"
              zone: wall.offset === st.zone ? st.zone : `${timeZoneLabel(st.zone)}, ${wall.offset}`,
            })}
          </p>
        )}
        {st && (
          <p className={`text-[11px] mt-0.5 ${st.source === 'default' ? 'text-status-warn' : 'text-muted'}`}>
            {t(`timeZone.source.${st.source}`)}
          </p>
        )}
        {browser && browser !== st?.zone && (
          <button type="button" onClick={() => onSave({ timeZone: browser })} className="btn-action h-11 sm:h-8 px-3 text-xs mt-2">
            {t('timeZone.useBrowser', { zone: timeZoneLabel(browser) })}
          </button>
        )}
      </div>
      {/* "Not set" is the first option: the server then follows TZ, or UTC */}
      <SelectMenu
        size="sm"
        ariaLabel={t('timeZone.title')}
        value={setting}
        onChange={(timeZone) => onSave({ timeZone })}
        options={options}
      />
    </div>
  );
}
