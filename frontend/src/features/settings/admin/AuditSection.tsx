import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { api } from '../../../lib/api';
import { can } from '../../../lib/capabilities';
import i18n from '../../../i18n';
import type { AuditEntry, User } from '../../../lib/types';
import { SelectMenu } from '../../../components/SelectMenu';
import { compareText, formatDateTime } from '../../../lib/format';
import { errorMessage } from '../../../lib/errorMessage';
import { AUDIT_ACTIONS, actionLabel, actorLabel, detailLines, targetLabel } from './auditView';
import { LoadingState } from '../../../components/Spinner';
import { EmptyState } from '../../../components/EmptyState';

// SelectMenu's small field, but filling its share of the row on phones (as in the user list)
const FILTER_BUTTON = 'w-full sm:w-auto sm:max-w-[16rem] h-11 sm:h-8 input-field px-2 gap-1.5 text-sm sm:text-xs bg-panel';
const PAGE_SIZE = 50;

// Administration → Protokoll (server admins): who changed accounts, roles and server settings, newest
// first, filtered by action and account, 50 rows at a time. Desktop a table, phones one card per row.
export function AuditSection({ users }: { users: User[] }) {
  const { t } = useTranslation('settings');
  const [action, setAction] = useState('all');
  const [account, setAccount] = useState('all');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const fetchPage = useCallback(
    (before: number) =>
      api.adminGetAudit({
        action: action === 'all' ? undefined : action,
        user: account === 'all' ? undefined : account,
        before: before || undefined,
        limit: PAGE_SIZE,
      }),
    [action, account]
  );

  // A new filter starts again at the newest rows
  useEffect(() => {
    let current = true;
    fetchPage(0).then(
      (page) => {
        if (!current) return;
        setEntries(page.entries);
        setNextBefore(page.nextBefore);
        setLoading(false);
      },
      (err) => {
        if (!current) return;
        setError(errorMessage(err, i18n.t('settings:audit.loadFailed')));
        setLoading(false);
      }
    );
    return () => {
      current = false;
    };
  }, [fetchPage]);

  const changeFilter = (next: { action?: string; account?: string }) => {
    setLoading(true);
    setError(null);
    if (next.action !== undefined) setAction(next.action);
    if (next.account !== undefined) setAccount(next.account);
  };

  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(nextBefore);
      setEntries((prev) => [...prev, ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err, t('audit.loadFailed')));
    } finally {
      setLoading(false);
    }
  };

  const actionOptions = useMemo(
    () => [{ value: 'all', label: t('audit.filter.allActions') }, ...AUDIT_ACTIONS.map((a) => ({ value: a as string, label: actionLabel(t, a) }))],
    [t]
  );
  const accountOptions = useMemo(
    () => [
      { value: 'all', label: t('audit.filter.allAccounts') },
      ...[...users]
        .sort((a, b) => compareText(a.displayName || a.username || '', b.displayName || b.username || ''))
        .map((u) => ({ value: u.id, label: u.displayName || u.username || u.email || u.id, hint: u.username ? `@${u.username}` : undefined })),
    ],
    [users, t]
  );
  const filtered = action !== 'all' || account !== 'all';

  return (
    <div className="space-y-4">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('audit.title')}</h2>
        <p className="text-muted mt-0.5">{t('audit.intro')}</p>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 sm:flex-none">
          <SelectMenu<string> size="sm" buttonClassName={FILTER_BUTTON} ariaLabel={t('audit.filter.action')} title={t('audit.filter.action')} value={action} onChange={(v) => changeFilter({ action: v })} options={actionOptions} />
        </div>
        {/* One account (the desktop app): nothing to filter by */}
        {can('accounts') && (
          <div className="flex-1 min-w-0 sm:flex-none">
            <SelectMenu<string> size="sm" buttonClassName={FILTER_BUTTON} ariaLabel={t('audit.filter.account')} title={t('audit.filter.account')} value={account} onChange={(v) => changeFilter({ account: v })} options={accountOptions} />
          </div>
        )}
        {filtered && (
          <button
            type="button"
            onClick={() => changeFilter({ action: 'all', account: 'all' })}
            className="hidden sm:inline text-[11px] text-accent hover:underline"
          >
            {t('audit.filter.reset')}
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-status-err">
          <CircleAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <EmptyState framed>{filtered ? t('audit.emptyFiltered') : t('audit.empty')}</EmptyState>
      )}

      {entries.length > 0 && (
        <>
          {/* Desktop: a calm table */}
          <table className="hidden sm:table w-full text-left border-collapse" aria-label={t('audit.title')}>
            <thead>
              <tr className="border-b border-border text-[11px] text-muted">
                <th className="py-1.5 pr-3 font-medium whitespace-nowrap">{t('audit.col.time')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('audit.col.actor')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('audit.col.action')}</th>
                <th className="py-1.5 font-medium">{t('audit.col.target')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const lines = detailLines(t, e);
                return (
                  <tr key={e.id} className="border-b border-border align-top">
                    <td className="py-2 pr-3 text-muted whitespace-nowrap">{formatDateTime(e.at)}</td>
                    <td className="py-2 pr-3 text-main">{actorLabel(t, e, byId)}</td>
                    <td className="py-2 pr-3">
                      <p className="text-main">{actionLabel(t, e.action)}</p>
                      {lines.map((l, i) => (
                        <p key={i} className="text-[11px] text-muted break-words">
                          {l}
                        </p>
                      ))}
                    </td>
                    <td className="py-2 text-main break-words">{targetLabel(t, e, byId)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Phones: one card per row */}
          <ul className="sm:hidden space-y-2" aria-label={t('audit.title')}>
            {entries.map((e) => {
              const lines = detailLines(t, e);
              return (
                <li key={e.id} className="border border-border rounded-card bg-canvas px-3 py-2.5 space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-main">{actionLabel(t, e.action)}</p>
                    <p className="text-[11px] text-muted whitespace-nowrap">{formatDateTime(e.at)}</p>
                  </div>
                  <p className="text-xs text-main">
                    <span className="text-muted">{t('audit.col.target')}: </span>
                    {targetLabel(t, e, byId)}
                  </p>
                  <p className="text-xs text-main">
                    <span className="text-muted">{t('audit.col.actor')}: </span>
                    {actorLabel(t, e, byId)}
                  </p>
                  {lines.map((l, i) => (
                    <p key={i} className="text-xs text-muted break-words">
                      {l}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {nextBefore > 0 && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadMore()}
          className="btn-action w-full sm:w-auto h-11 sm:h-8 px-3 text-xs"
        >
          {t('audit.more')}
        </button>
      )}
      {loading && <LoadingState inline />}
    </div>
  );
}
