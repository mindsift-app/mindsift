import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleArrowUp, Check, ExternalLink, Info } from 'lucide-react';
import { api, isDesktopApp } from '../../../lib/api';
import type { UpdateStatus } from '../../../lib/types';
import { formatDate } from '../../../lib/format';
import { APP_VERSION } from '../../../version';

const UPDATE_COMMAND = 'docker compose pull && docker compose up -d';

// Admin: installed and latest MindSift release (the server's daily look at GitHub, api/update.go). Only shows;
// updating stays with the admin, so the card names the command instead of offering a button.
export const UpdateStatusCard: React.FC = () => {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  // The desktop app is updated by installing its new version, not with Docker Compose
  const desktop = isDesktopApp();

  useEffect(() => {
    let cancelled = false;
    api
      .adminUpdateStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  const latest = status.latest;
  const rows: [string, React.ReactNode][] = [
    [t('update.admin.installed'), <span className="font-mono">{status.current || APP_VERSION}</span>],
  ];
  if (status.enabled && latest) {
    rows.push([
      t('update.admin.latest'),
      <span>
        <span className="font-mono">{latest}</span>
        {status.publishedAt && <span className="text-muted"> · {formatDate(status.publishedAt)}</span>}
      </span>,
    ]);
  }
  if (status.enabled && status.checkedAt) {
    rows.push([t('update.admin.checked'), formatDate(status.checkedAt)]);
  }

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3" data-update-status>
      <div>
        <p className="font-bold text-main flex items-center gap-1.5">
          <CircleArrowUp className="w-3.5 h-3.5 text-accent" />
          <span>{t('update.admin.title')}</span>
        </p>
        <p className="text-[11px] text-muted mt-0.5">
          {status.enabled ? t('update.admin.hint') : t(`update.admin.${status.reason ?? 'off'}`)}
        </p>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-main min-w-0">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {status.enabled && !latest && (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Info className="w-4 h-4 shrink-0" />
          <span>{t('update.admin.notYet')}</span>
        </p>
      )}
      {status.enabled && latest && !status.available && (
        <div role="status" className="alert-ok flex items-center gap-2 text-xs">
          <Check className="w-4 h-4 text-status-ok shrink-0" />
          <span>{t('update.admin.upToDate')}</span>
        </div>
      )}
      {status.available && latest && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-main">
              {t('update.admin.available', { version: latest.replace(/^v/, '') })}
            </span>
            {status.url && (
              <a
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 min-h-11 sm:min-h-0 text-accent hover:underline"
              >
                <span>{t('update.admin.whatsNew')}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <p className="text-[11px] text-muted">{t(desktop ? 'update.admin.howToDesktop' : 'update.admin.howTo')}</p>
          {!desktop && (
            <code className="block w-fit max-w-full overflow-x-auto px-2 py-1 rounded-btn bg-panel border border-border font-mono text-[11px] text-main select-all">
              {UPDATE_COMMAND}
            </code>
          )}
        </div>
      )}
    </div>
  );
};
