import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, Copy, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { CalendarFeedState } from '../../../lib/types';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { askConfirm } from '../../../components/askConfirm';
import { StatusMessage, StatusToast } from '../../../components/StatusToast';
import { errorMessage } from '../../../lib/errorMessage';
import { SettingsCard } from '../../../components/SettingsCard';

// Calendar apps with a short how-to each (settings:calendarFeed.apps.<key>)
const CALENDAR_APPS = ['google', 'apple', 'thunderbird', 'outlook'] as const;

/** Kontoeinstellungen → Kalender-Abo: a read-only iCalendar feed of the own open tasks behind a secret
 *  address (internal/api/calendar_feed.go). Switching on creates the address, a new link invalidates the
 *  old one, switching off deletes it; both ask first, as subscribed calendars stop updating. */
export const CalendarFeedSection: React.FC = () => {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<CalendarFeedState | null>(null);
  const [busy, setBusy] = useState(false);
  // The answer to a switch or a new link, and loading errors (StatusToast, Doku/ui-patterns.md)
  const [msg, setMsg] = useState<StatusMessage | null>(null);
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getCalendarFeed()
      .then(setState)
      .catch((err) => setMsg({ type: 'err', text: errorMessage(err, t('calendarFeed.loadFailed')) }));
  }, [t]);

  const run = async (fn: () => Promise<CalendarFeedState>) => {
    setBusy(true);
    try {
      setState(await fn());
      setMsg({ type: 'ok', text: t('api.saved') });
    } catch (err) {
      setMsg({ type: 'err', text: errorMessage(err, t('api.saveFailed')) });
    } finally {
      setBusy(false);
    }
  };

  const url = state?.token ? state.url || `${window.location.origin}/calendar/${state.token}.ics` : '';

  const toggle = async (on: boolean) => {
    if (on) {
      await run(() => api.renewCalendarFeed());
      return;
    }
    const ok = await askConfirm({ message: t('calendarFeed.confirmOff'), confirmLabel: t('calendarFeed.off'), danger: true });
    if (ok) await run(() => api.disableCalendarFeed());
  };

  const renew = async () => {
    const ok = await askConfirm({ message: t('calendarFeed.confirmRenew'), confirmLabel: t('calendarFeed.renew'), danger: true });
    if (ok) await run(() => api.renewCalendarFeed());
  };

  const copy = () => {
    urlRef.current?.select();
    void navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('calendarFeed.title')}</h2>
        <p className="text-muted mt-0.5">{t('calendarFeed.intro')}</p>
      </div>

      <StatusToast msg={msg} onClose={() => setMsg(null)} />

      {state && !state.enabled && <p className="text-muted">{t('calendarFeed.serverOff')}</p>}

      {state?.enabled && (
        <>
          <SettingsCard
            title={t('calendarFeed.switch')}
            icon={<CalendarDays className="w-3.5 h-3.5 text-accent" />}
            hint={t('calendarFeed.switchHint')}
            action={
              <ToggleSwitch checked={state.active} disabled={busy} title={t('calendarFeed.switch')} onChange={(on) => void toggle(on)} />
            }
          >
            {state.active && state.unreadable && (
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-[11px] text-status-err">{t('calendarFeed.unreadable')}</p>
                <button type="button" disabled={busy} onClick={() => void run(() => api.renewCalendarFeed())} className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('calendarFeed.renew')}
                </button>
              </div>
            )}

            {state.active && url && (
              <div className="pt-3 border-t border-border space-y-2">
                <label className="block text-[11px] font-semibold text-main" htmlFor="calendar-feed-url">
                  {t('calendarFeed.linkLabel')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="calendar-feed-url"
                    ref={urlRef}
                    readOnly
                    {...NO_AUTOFILL}
                    value={url}
                    onFocus={(e) => e.target.select()}
                    className="input-field flex-1 min-w-0 h-11 sm:h-8 px-2.5 text-xs font-mono"
                  />
                  <button type="button" onClick={copy} className="btn-action h-11 sm:h-8 px-2.5 text-xs flex items-center gap-1.5 shrink-0">
                    {copied ? <Check className="w-3.5 h-3.5 text-status-ok" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? t('calendarFeed.copied') : t('calendarFeed.copy')}</span>
                  </button>
                </div>
                <p className="text-[11px] text-muted">{t('calendarFeed.secret')}</p>
                <div className="flex justify-end">
                  <button type="button" disabled={busy} onClick={() => void renew()} className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                    {t('calendarFeed.renew')}
                  </button>
                </div>
              </div>
            )}
          </SettingsCard>

          {state.active && url && (
            <div className="space-y-2">
              <h3 className="font-bold text-main">{t('calendarFeed.howTo')}</h3>
              <ul className="space-y-1.5">
                {CALENDAR_APPS.map((app) => (
                  <li key={app} className="text-[11px] text-muted">
                    <span className="font-semibold text-main">{t(`calendarFeed.apps.${app}.name`)}:</span> {t(`calendarFeed.apps.${app}.steps`)}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted">{t('calendarFeed.note')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
