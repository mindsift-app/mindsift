import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Globe, KeyRound, Link2Off, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { PublicLinkState } from '../../lib/types';
import { activeThemeFamily } from '../../lib/theme';
import { formatDateTime } from '../../lib/format';
import { NO_AUTOFILL } from '../../lib/noAutofill';

// Durations offered for a public link, in hours; the server's limit cuts the list (there is no "for good")
const DURATIONS = [1, 24, 72, 168, 336];
const DEFAULT_HOURS = 72;

/** Part of the share dialog of a note: share it read only with anyone who has the link (owner only;
 *  hidden when the server does not allow public links). */
export const PublicLinkSection: React.FC<{ docId: string }> = ({ docId }) => {
  const { t } = useTranslation('workspace');
  const [state, setState] = useState<PublicLinkState | null>(null);
  const [creating, setCreating] = useState(false);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getPublicLink(docId).then(setState).catch(() => setState(null));
  }, [docId]);

  if (!state || !state.enabled) return null;
  const durations = DURATIONS.filter((h) => h <= state.maxDays * 24);
  const url = state.link ? `${window.location.origin}/p/${state.link.token}` : '';

  const run = async (fn: () => Promise<PublicLinkState>) => {
    setBusy(true);
    setError('');
    try {
      setState(await fn());
      setCreating(false);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    urlRef.current?.select();
    void navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const h = durations.includes(hours) ? hours : durations[durations.length - 1];
        void run(() => api.setPublicLink(docId, h, password, activeThemeFamily()));
      }}
      className="space-y-2"
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={durations.includes(hours) ? hours : durations[durations.length - 1]}
          onChange={(e) => setHours(Number(e.target.value))}
          className="input-field bg-panel h-11 sm:h-8 px-2.5 text-xs sm:w-40 cursor-pointer"
          title={t('publicLink.duration')}
        >
          {durations.map((h) => (
            <option key={h} value={h}>
              {t(`publicLink.for.${h}`)}
            </option>
          ))}
        </select>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('publicLink.passwordOptional')}
          {...NO_AUTOFILL}
          className="input-field flex-1 min-w-0 h-11 sm:h-8 px-2.5 text-base sm:text-xs"
        />
      </div>
      <div className="flex justify-end gap-2">
        {state.link && (
          <button type="button" onClick={() => setCreating(false)} className="btn-action h-11 sm:h-8 px-3 text-xs">
            {t('common:cancel')}
          </button>
        )}
        <button type="submit" disabled={busy} className="btn-primary h-11 sm:h-8 px-3.5 text-xs flex items-center gap-1.5 disabled:opacity-50">
          <Globe className="w-3.5 h-3.5" />
          {state.link ? t('publicLink.replace') : t('publicLink.create')}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-2 p-3 bg-panel-elevated border border-border rounded-card">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-main">
        <Globe className="w-3.5 h-3.5 text-accent" />
        <span>{t('publicLink.title')}</span>
      </div>
      <p className="text-[11px] text-muted">{t('publicLink.hint')}</p>
      {error && <p className="text-[11px] text-status-err">{error}</p>}

      {state.link && !creating ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              ref={urlRef}
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="input-field flex-1 min-w-0 h-11 sm:h-8 px-2.5 text-xs font-mono"
            />
            <button type="button" onClick={copy} className="btn-action h-11 sm:h-8 px-2.5 text-xs flex items-center gap-1.5 shrink-0">
              {copied ? <Check className="w-3.5 h-3.5 text-status-ok" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? t('publicLink.copied') : t('publicLink.copy')}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted flex items-center gap-1.5">
              {t('publicLink.expires', { date: formatDateTime(state.link.expiresAt) })}
              {state.link.hasPassword && (
                <span className="badge-neutral text-[10px] inline-flex items-center gap-1">
                  <KeyRound className="w-2.5 h-2.5" />
                  {t('publicLink.withPassword')}
                </span>
              )}
            </span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setCreating(true)} className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                {t('publicLink.new')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.deletePublicLink(docId))}
                className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center gap-1 hover:text-status-err"
              >
                <Link2Off className="w-3 h-3" />
                {t('publicLink.revoke')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        form
      )}
    </div>
  );
};
