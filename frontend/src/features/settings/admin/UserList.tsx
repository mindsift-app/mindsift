import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Ban, ChevronDown, ChevronRight, KeyRound, Search, ShieldCheck, ShieldOff, Trash2, UserCheck, X } from 'lucide-react';
import { User, UserRole } from '../../../lib/types';
import { UserAvatar } from '../../../components/UserAvatar';
import { SelectMenu } from '../../../components/SelectMenu';
import { formatDate } from '../../../lib/format';
import { isPhoneWidth } from '../../../lib/breakpoints';
import { MASKED, NO_AUTOFILL } from '../../../lib/noAutofill';
import { useAdminSettings } from './useAdminSettings';
import { isFiltered, matchesUser, OrgFilter, RoleFilter, sortUsers, USER_PAGE_SIZE, UserListFilter, UserSort } from './userListView';

type Admin = ReturnType<typeof useAdminSettings>;

// SelectMenu's small field, but filling its share of the row on phones
const FILTER_BUTTON = 'w-full sm:w-auto h-11 sm:h-8 input-field px-2 gap-1.5 text-sm sm:text-xs bg-panel';

// The chosen order is a per-device convenience
const SORT_KEY = 'mindsift_admin_user_sort';
const readSort = (): UserSort => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'role' || v === 'newest' ? v : 'name';
  } catch {
    return 'name';
  }
};

// Phone layout follows the window (rotating, resizing the desktop window)
function usePhoneWidth() {
  const [phone, setPhone] = useState(isPhoneWidth);
  useEffect(() => {
    const onResize = () => setPhone(isPhoneWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return phone;
}

// "Weitere anzeigen" under a list that renders only its first rows
export function ShowMoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const { t } = useTranslation('settings');
  if (shown >= total) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1">
      <span className="text-[11px] text-faint">{t('users.list.shownOf', { shown, total })}</span>
      <button type="button" onClick={onMore} className="btn-action h-11 sm:h-8 px-4 text-xs font-semibold">
        {t('users.list.showMore', { count: Math.min(USER_PAGE_SIZE, total - shown) })}
      </button>
    </div>
  );
}

// Role as a small badge; members get none, so the few admins and managers stand out
function RoleBadge({ role }: { role: UserRole }) {
  const { t } = useTranslation('settings');
  if (role === 'member') return null;
  return <span className={`${role === 'admin' ? 'badge-accent' : 'badge-neutral'} text-[10px] shrink-0`}>{t(`common:role.${role}`)}</span>;
}

function StatusBadge({ u }: { u: User }) {
  const { t } = useTranslation('settings');
  if (u.isActive) return null;
  return (
    <span className={`${u.emailUnverified ? 'badge-neutral' : 'badge-err'} text-[10px] shrink-0`}>
      {u.emailUnverified ? t('users.emailUnverified') : t('users.locked')}
    </span>
  );
}

// Registered users: search and filters on top, compact rows, editing after a tap on a row (desktop: opens
// below the row; phone: a sheet from below). Only the first rows are rendered, more on request.
export function UserList({ admin, currentUser, isServerAdmin }: { admin: Admin; currentUser: User; isServerAdmin: boolean }) {
  const { t, i18n } = useTranslation('settings');
  const { users, organizations, orgName, setUsernameEdit, setResetPwdUserId, setResetPwdVal } = admin;
  const phone = usePhoneWidth();
  const [filter, setFilter] = useState<UserListFilter>({ query: '', role: 'all', org: 'all' });
  const [sort, setSort] = useState<UserSort>(readSort);
  const [limit, setLimit] = useState(USER_PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);

  const registered = useMemo(() => users.filter((u) => !u.pendingApproval), [users]);
  const visible = useMemo(
    () => sortUsers(registered.filter((u) => matchesUser(u, filter)), sort, i18n.language),
    [registered, filter, sort, i18n.language]
  );
  const filtered = isFiltered(filter);
  const open = openId ? registered.find((u) => u.id === openId) || null : null;

  const changeFilter = (patch: Partial<UserListFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(USER_PAGE_SIZE);
  };
  const changeSort = (s: UserSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // storage blocked: the order holds until the page is left
    }
  };
  // Opening another person (or closing) drops half-typed username or password fields
  const toggle = (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    setUsernameEdit(null);
    setResetPwdUserId(null);
    setResetPwdVal('');
  };

  const roleOptions: { value: RoleFilter; label: string }[] = [
    { value: 'all', label: t('users.list.roleAll') },
    { value: 'admin', label: t('users.list.roleAdmins') },
    { value: 'manager', label: t('users.list.roleManagers') },
    { value: 'member', label: t('users.list.roleMembers') },
  ];
  const orgOptions: { value: OrgFilter; label: string }[] = [
    { value: 'all', label: t('users.list.orgAll') },
    ...organizations.map((o) => ({ value: o.id, label: o.name })),
    { value: 'none', label: t('users.noOrganization') },
  ];
  const sortOptions: { value: UserSort; label: string }[] = [
    { value: 'name', label: t('users.list.sortName') },
    { value: 'role', label: t('users.list.sortRole') },
    { value: 'newest', label: t('users.list.sortNewest') },
  ];

  return (
    <div className="space-y-2">
      {/* The exact number as text: a CountBadge stops at 99+ */}
      <h3 className="font-bold text-main">{t('users.registered', { count: registered.length })}</h3>

      {/* Search and filters: one row from sm on, on phones the search gets a row of its own */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <label className="relative flex-1 min-w-0 sm:min-w-[14rem]">
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            {...NO_AUTOFILL}
            type="search"
            value={filter.query}
            onChange={(e) => changeFilter({ query: e.target.value })}
            placeholder={t('users.list.searchPlaceholder')}
            aria-label={t('users.list.search')}
            className="w-full h-11 sm:h-8 pl-8 pr-2.5 input-field text-base sm:text-xs"
          />
        </label>
        {/* Phones: the three menus share one row, each label cut short when needed */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 sm:flex-none">
            <SelectMenu<RoleFilter> size="sm" buttonClassName={FILTER_BUTTON} ariaLabel={t('users.list.roleFilter')} title={t('users.list.roleFilter')} value={filter.role} onChange={(role) => changeFilter({ role })} options={roleOptions} />
          </div>
          {organizations.length > 0 && (
            <div className="flex-1 min-w-0 sm:flex-none">
              <SelectMenu<OrgFilter> size="sm" buttonClassName={FILTER_BUTTON} ariaLabel={t('users.list.orgFilter')} title={t('users.list.orgFilter')} value={filter.org} onChange={(org) => changeFilter({ org })} options={orgOptions} />
            </div>
          )}
          <div className="flex-1 min-w-0 sm:flex-none">
            <SelectMenu<UserSort> size="sm" buttonClassName={FILTER_BUTTON} ariaLabel={t('users.list.sort')} title={t('users.list.sort')} value={sort} onChange={changeSort} options={sortOptions} />
          </div>
        </div>
      </div>

      {filtered && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted" aria-live="polite">
          <span>{t('users.list.matches', { count: visible.length, total: registered.length })}</span>
          <button
            type="button"
            onClick={() => changeFilter({ query: '', role: 'all', org: 'all' })}
            className="h-11 sm:h-auto text-accent hover:underline"
          >
            {t('users.list.resetFilters')}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="p-3 border border-dashed border-border rounded-card text-muted text-xs">{t('users.list.noMatch')}</p>
      ) : (
        <div className="border border-border divide-y divide-border bg-canvas rounded-card overflow-hidden">
          {visible.slice(0, limit).map((u) => (
            <div key={u.id}>
              <UserRow u={u} open={openId === u.id} orgNames={(u.organizationIds || []).map(orgName).filter(Boolean)} showNoOrg={admin.sharingMode === 'organizations'} onToggle={() => toggle(u.id)} />
              {!phone && openId === u.id && (
                <div className="px-3 pb-3 pt-1 bg-panel border-t border-border">
                  <UserDetails u={u} admin={admin} currentUser={currentUser} isServerAdmin={isServerAdmin} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ShowMoreButton shown={Math.min(limit, visible.length)} total={visible.length} onMore={() => setLimit((l) => l + USER_PAGE_SIZE)} />

      {phone && open && (
        <UserSheet u={open} onClose={() => toggle(open.id)}>
          <UserDetails u={open} admin={admin} currentUser={currentUser} isServerAdmin={isServerAdmin} />
        </UserSheet>
      )}
    </div>
  );
}

// One person in one line: avatar, name with badges, username and e-mail below, organizations on the right
function UserRow({ u, open, orgNames, showNoOrg, onToggle }: { u: User; open: boolean; orgNames: string[]; showNoOrg: boolean; onToggle: () => void }) {
  const { t } = useTranslation('settings');
  const sub = [u.username, u.email].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full min-h-11 px-3 py-1.5 flex items-center gap-2.5 text-left cursor-pointer transition-colors ${open ? 'bg-panel' : 'hover:bg-panel'}`}
    >
      <UserAvatar user={u} size="sm" showTitle={false} className="border border-border/80" />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-main truncate">{u.displayName}</span>
          <RoleBadge role={u.role} />
          <StatusBadge u={u} />
          {u.mfaEnabled && (
            <span className="badge-neutral text-[10px] shrink-0 inline-flex items-center gap-0.5" title={t('users.mfaOn')}>
              <ShieldCheck className="w-2.5 h-2.5" />
              {t('users.mfaBadge')}
            </span>
          )}
        </span>
        <span className="block text-muted text-[11px] truncate" title={sub}>
          {sub}
        </span>
      </span>
      {/* Organizations only from sm on; on phones they are in the sheet */}
      <span className="hidden sm:block max-w-[35%] text-[11px] truncate text-right" title={orgNames.join(', ')}>
        {orgNames.length > 0 ? <span className="text-faint">{orgNames.join(', ')}</span> : showNoOrg && <span className="text-status-warn">{t('users.noOrganization')}</span>}
      </span>
      {open ? <ChevronDown className="w-3.5 h-3.5 text-accent shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />}
    </button>
  );
}

// Phone: the details of one person in a sheet from below (Escape and the backdrop close it)
function UserSheet({ u, onClose, children }: { u: User; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('settings');
  useEffect(() => {
    // An open role menu takes Escape first (defaultPrevented) and the sheet stays
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-end justify-center modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={u.displayName}
        className="w-full max-h-[85vh] overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3 text-xs animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto" aria-hidden="true" />
        <div className="flex items-center gap-2.5">
          <UserAvatar user={u} size="md" showTitle={false} className="border border-border/80" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-main truncate">{u.displayName}</p>
            <p className="text-muted text-[11px] truncate">{[u.username, u.email].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} className="w-11 h-11 -mr-2 flex items-center justify-center text-muted hover:text-main" title={t('common:close')} aria-label={t('common:close')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Everything one can do with an account: role, username, password, lock, delete; organizations as information
function UserDetails({ u, admin, currentUser, isServerAdmin }: { u: User; admin: Admin; currentUser: User; isServerAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const {
    orgName,
    sharingMode,
    usernameEdit,
    setUsernameEdit,
    handleSaveUsername,
    resetPwdUserId,
    setResetPwdUserId,
    resetPwdVal,
    setResetPwdVal,
    handleChangeUserRole,
    handleToggleUserActive,
    handleConfirmResetPassword,
    handleDeleteUser,
    handleResetMfa,
  } = admin;
  // User managers look after members only; admins and other managers stay with server admins
  const canManage = isServerAdmin || u.role === 'member';
  const self = u.id === currentUser.id;
  const lockReason = self ? t('users.notSelf') : !canManage ? t('users.adminOnly') : '';
  const orgs = (u.organizationIds || []).map(orgName).filter(Boolean);
  const btn = 'btn-action h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className="block text-muted mb-1">{t('users.create.role')}</span>
          {/* Server admins choose; user managers only see it */}
          {isServerAdmin ? (
            <SelectMenu<UserRole>
              ariaLabel={t('users.changeRole')}
              title={t('users.changeRole')}
              value={u.role}
              onChange={(role) => handleChangeUserRole(u, role)}
              options={[
                { value: 'member', label: t('users.roleMember') },
                { value: 'manager', label: t('users.roleManager') },
                { value: 'admin', label: t('users.roleAdmin') },
              ]}
            />
          ) : (
            <span className="badge-neutral text-[10px]">{t(`common:role.${u.role}`)}</span>
          )}
        </div>
        <div className="min-w-0">
          {/* Organizations only as information: who belongs where is set in the organization */}
          <span className="block text-muted mb-1">{t('users.organizations')}</span>
          {orgs.length > 0 ? (
            <p className="text-main break-words">{orgs.join(', ')}</p>
          ) : (
            <p className={sharingMode === 'organizations' ? 'text-status-warn' : 'text-faint'}>
              {sharingMode === 'organizations' ? t('users.noOrgWarning') : t('users.noOrganization')}
            </p>
          )}
          <p className="text-[11px] text-faint mt-0.5">{t('users.list.orgsHint')}</p>
        </div>
      </div>

      <p className="text-[11px] text-faint">{t('users.registeredOn', { date: formatDate(u.createdAt) })}</p>

      {/* Actions with words; unavailable ones stay greyed out with the reason below */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setUsernameEdit(usernameEdit?.id === u.id ? null : { id: u.id, value: u.username || '' })}
          disabled={!isServerAdmin}
          aria-expanded={usernameEdit?.id === u.id}
          className={`${btn} ${usernameEdit?.id === u.id ? '!border-accent' : ''}`}
        >
          <AtSign className="w-3.5 h-3.5" />
          <span>{t('users.username')}</span>
        </button>
        {/* Passwords stay with server admins (others use "forgot password") */}
        <button
          type="button"
          onClick={() => setResetPwdUserId(resetPwdUserId === u.id ? null : u.id)}
          disabled={!isServerAdmin}
          aria-expanded={resetPwdUserId === u.id}
          title={isServerAdmin ? undefined : t('users.passwordAdminOnly')}
          className={`${btn} ${resetPwdUserId === u.id ? '!border-accent' : ''}`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>{t('users.password')}</span>
        </button>
        <button
          type="button"
          onClick={() => handleToggleUserActive(u)}
          disabled={Boolean(lockReason)}
          title={lockReason || undefined}
          className={`${btn} ${u.isActive ? 'hover:text-status-err' : 'text-status-ok'}`}
        >
          {u.isActive ? <Ban className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
          <span>{u.isActive ? t('users.lock') : t('users.activate')}</span>
        </button>
        {/* Somebody who lost every second factor signs in with the password alone again */}
        {u.mfaEnabled && (
          <button
            type="button"
            onClick={() => handleResetMfa(u)}
            disabled={Boolean(lockReason)}
            title={lockReason || t('users.resetMfaHint')}
            className={`${btn} hover:text-status-err`}
            data-reset-mfa
          >
            <ShieldOff className="w-3.5 h-3.5" />
            <span>{t('users.resetMfa')}</span>
          </button>
        )}
        <button type="button" onClick={() => handleDeleteUser(u)} disabled={Boolean(lockReason)} title={lockReason || undefined} className={`${btn} hover:text-status-err`}>
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t('users.delete')}</span>
        </button>
      </div>
      {(lockReason || !isServerAdmin) && <p className="text-[11px] text-faint">{lockReason || t('users.passwordAdminOnly')}</p>}

      {usernameEdit?.id === u.id && (
        <form
          {...NO_AUTOFILL}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveUsername(u);
          }}
          className="flex items-center gap-2 pt-2 border-t border-border"
        >
          <input
            {...NO_AUTOFILL}
            type="text"
            value={usernameEdit.value}
            onChange={(e) => setUsernameEdit({ id: u.id, value: e.target.value.toLowerCase() })}
            maxLength={32}
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-label={t('users.username')}
            title={t('profile.usernameRules')}
            className="flex-1 min-w-0 h-11 sm:h-8 px-2 input-field font-mono text-base sm:text-xs"
          />
          <button type="submit" className="btn-primary h-11 sm:h-8 px-3 text-xs">
            {t('common:save')}
          </button>
          <button type="button" onClick={() => setUsernameEdit(null)} className="btn-action h-11 sm:h-8 px-2 text-xs">
            {t('common:cancel')}
          </button>
        </form>
      )}

      {resetPwdUserId === u.id && (
        <form
          {...NO_AUTOFILL}
          onSubmit={(e) => {
            e.preventDefault();
            void handleConfirmResetPassword(u.id);
          }}
          className="flex items-center gap-2 pt-2 border-t border-border"
        >
          <input
            {...NO_AUTOFILL}
            type="text"
            style={MASKED}
            value={resetPwdVal}
            onChange={(e) => setResetPwdVal(e.target.value)}
            placeholder={t('users.newPasswordPlaceholder')}
            autoFocus
            aria-label={t('users.password')}
            className="flex-1 min-w-0 h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
          />
          <button type="submit" className="btn-primary h-11 sm:h-8 px-3 text-xs">
            {t('common:save')}
          </button>
          <button type="button" onClick={() => setResetPwdUserId(null)} className="btn-action h-11 sm:h-8 px-2 text-xs">
            {t('common:cancel')}
          </button>
        </form>
      )}
    </div>
  );
}
