import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mail,
  Plus,
  Trash2,
  KeyRound,
  Copy,
  Check,
  Send,
  UserPlus,
  Link2,
  Clock,
  X,
  AtSign,
  Ban,
  UserCheck,
} from 'lucide-react';
import { User, UserRole } from '../../../lib/types';
import { UserAvatar } from '../../../components/UserAvatar';
import { useAdminSettings } from './useAdminSettings';
import { formatDate } from '../../../lib/format';
import { OrganizationPicker } from './OrganizationPicker';
import { MASKED, NO_AUTOFILL } from '../../../lib/noAutofill';

// Administration → Users & invitations (state in useAdminSettings)

// Row actions: 44 px touch targets on phones, small squares from sm on
const iconBtnSize = 'w-11 h-11 sm:w-7 sm:h-7 disabled:opacity-40 disabled:pointer-events-none';
const iconBtn = `btn-icon ${iconBtnSize}`;

export function UsersSection({
  admin,
  currentUser,
  isServerAdmin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
  currentUser: User;
  isServerAdmin: boolean;
}) {
  const { t } = useTranslation('settings');
  const {
    users,
    invites,
    newUserName,
    newUserEmail,
    newUserPassword,
    newUserRole,
    newUserOrgs,
    inviteEmail,
    inviteOrgs,
    inviteMaxUses,
    mailInviteId,
    mailInviteTo,
    mailInviteBusy,
    organizations,
    sharingMode,
    copiedInviteId,
    resetPwdUserId,
    usernameEdit,
    setUsernameEdit,
    handleSaveUsername,
    resetPwdVal,
    handleCreateUser,
    handleCreateInvite,
    handleDeleteInvite,
    inviteLink,
    copiedWhat,
    handleCopyInvite,
    handleSendInvite,
    handleApproveUser,
    handleChangeUserRole,
    handleToggleUserActive,
    handleConfirmResetPassword,
    handleDeleteUser,
    orgName,
    setNewUserName,
    setNewUserEmail,
    setNewUserPassword,
    setNewUserRole,
    setNewUserOrgs,
    setInviteEmail,
    setInviteOrgs,
    setInviteMaxUses,
    setMailInviteId,
    setMailInviteTo,
    setResetPwdUserId,
    setResetPwdVal,
  } = admin;
  // User managers look after members only; admins and other managers stay with server admins
  const canManage = (u: User) => isServerAdmin || u.role === 'member';
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('users.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('users.intro')}
        </p>
      </div>

      {/* Create an account and invite side by side (stacked on smaller screens), fields one below the other */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <form {...NO_AUTOFILL} onSubmit={handleCreateUser} className="p-4 bg-canvas border border-border rounded-card space-y-3">
          <h3 className="font-bold text-main flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5 text-accent" />
            <span>{t('users.create.title')}</span>
          </h3>
          <label className="block">
            <span className="block text-muted mb-1">{t('profile.displayName')}</span>
            <input
              {...NO_AUTOFILL}
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder={t('users.create.namePlaceholder')}
              required
              className="w-full min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-muted mb-1">{t('users.create.email')}</span>
            <input
              {...NO_AUTOFILL}
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder={t('users.create.emailPlaceholder')}
              required
              className="w-full min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-muted mb-1">{t('users.create.password')}</span>
            <input
              {...NO_AUTOFILL}
              type="text"
              style={MASKED}
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              placeholder={t('users.create.passwordPlaceholder')}
              required
              className="w-full min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
            />
          </label>
          {/* Only server admins hand out roles; user managers create members */}
          {isServerAdmin && (
            <label className="block">
              <span className="block text-muted mb-1">{t('users.create.role')}</span>
              <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as UserRole)} className="w-full min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs bg-panel">
                <option value="member">{t('users.create.roleMember')}</option>
                <option value="manager">{t('users.create.roleManager')}</option>
                <option value="admin">{t('users.create.roleAdmin')}</option>
              </select>
            </label>
          )}
          <div>
            <span className="block text-muted mb-1">{t('users.organizations')}</span>
            <OrganizationPicker organizations={organizations} value={newUserOrgs} onChange={setNewUserOrgs} />
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" className="btn-primary w-full sm:w-auto h-11 sm:h-8 px-4 text-xs font-semibold flex items-center justify-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              <span>{t('users.create.submit')}</span>
            </button>
          </div>
        </form>

        <form {...NO_AUTOFILL} onSubmit={handleCreateInvite} className="p-4 bg-canvas border border-border rounded-card space-y-3">
          <h3 className="font-bold text-main flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-accent" />
            <span>{t('users.invite.title')}</span>
          </h3>
          <label className="block">
            <span className="block text-muted mb-1">{t('users.invite.email')}</span>
            <input
              {...NO_AUTOFILL}
              type="email"
              value={inviteMaxUses > 1 ? '' : inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={inviteMaxUses > 1}
              placeholder={inviteMaxUses > 1 ? t('users.invite.emailGroup') : t('users.invite.emailAny')}
              className="w-full min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="block text-muted mb-1">{t('users.invite.uses')}</span>
            <input
              {...NO_AUTOFILL}
              type="number"
              min={1}
              max={1000}
              value={inviteMaxUses}
              onChange={(e) => setInviteMaxUses(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
              className="w-28 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
            />
            <span className="block text-[11px] text-faint mt-1">{t('users.invite.usesHint')}</span>
          </label>
          {/* Invites always make members; who should be an admin becomes one afterwards */}
          <div>
            <span className="block text-muted mb-1">{t('users.organizations')}</span>
            <OrganizationPicker organizations={organizations} value={inviteOrgs} onChange={setInviteOrgs} />
            <p className="text-[11px] text-faint mt-1.5">{t('users.invite.alwaysMember')}</p>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="btn-action w-full sm:w-auto h-11 sm:h-8 px-4 text-xs font-semibold flex items-center justify-center gap-1.5 border-accent text-main"
            >
              <KeyRound className="w-3.5 h-3.5 text-accent" />
              <span>{inviteMaxUses > 1 ? t('users.invite.createLink', { count: inviteMaxUses }) : t('users.invite.createCode')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Active Invites List */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted" title={t('users.invite.keepHint')}>
          {t('users.invite.list')}
        </p>
        {invites.length === 0 ? (
          <p className="p-3 border border-dashed border-border rounded-card text-muted text-xs">{t('users.invite.none')}</p>
        ) : (
          <div className="divide-y divide-border border border-border bg-panel rounded-card overflow-hidden">
            {invites.map((inv) => {
              const maxUses = inv.maxUses || 1;
              const used = inv.useCount ?? (inv.usedBy ? 1 : 0);
              const open = used < maxUses && new Date(inv.expiresAt).getTime() > Date.now();
              const copied = copiedInviteId === inv.id;
              const details = [
                inv.email ? t('users.invite.for', { email: inv.email }) : '',
                (inv.organizationNames || []).join(', '),
                maxUses > 1 ? t('users.invite.used', { used, max: maxUses }) : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <div key={inv.id} className="p-2 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <code className="shrink-0 px-2 py-0.5 bg-canvas border border-border font-mono font-bold text-accent rounded-card">
                        {inv.code}
                      </code>
                      {details && (
                        <span className="text-muted truncate min-w-0" title={details}>
                          {details}
                        </span>
                      )}
                      {open ? (
                        <span className="badge-ok text-[10px] shrink-0">{t('users.invite.open')}</span>
                      ) : (
                        <span className="badge-neutral text-[10px] shrink-0">{used >= maxUses ? t('users.invite.redeemed') : t('users.invite.expired')}</span>
                      )}
                      {!open && inv.removeAt && (
                        <span className="text-[11px] text-faint shrink-0 hidden sm:inline" title={t('users.invite.keepHint')}>
                          {t('users.invite.removeOn', { date: formatDate(inv.removeAt) })}
                        </span>
                      )}
                    </div>

                    {/* Icon actions like in the user list, so they stay in one row on the right */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {open && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopyInvite(inv, 'link')}
                            className={`${iconBtn} ${copied && copiedWhat === 'link' ? '!text-status-ok' : ''}`}
                            title={copied && copiedWhat === 'link' ? t('api.copied') : `${t('users.invite.copyLink')}: ${inviteLink(inv)}`}
                            aria-label={t('users.invite.copyLink')}
                          >
                            {copied && copiedWhat === 'link' ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyInvite(inv, 'code')}
                            className={`${iconBtn} ${copied && copiedWhat === 'code' ? '!text-status-ok' : ''}`}
                            title={copied && copiedWhat === 'code' ? t('api.copied') : t('users.invite.copyCode')}
                            aria-label={t('users.invite.copyCode')}
                          >
                            {copied && copiedWhat === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMailInviteId(mailInviteId === inv.id ? null : inv.id);
                              setMailInviteTo(inv.email || '');
                            }}
                            className={`${iconBtn} ${mailInviteId === inv.id ? '!text-accent' : ''}`}
                            title={t('users.invite.mailTitle')}
                            aria-label={t('users.invite.mailTitle')}
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteInvite(inv.id)}
                        className={`btn-icon-danger ${iconBtnSize}`}
                        title={t('users.invite.delete')}
                        aria-label={t('users.invite.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {mailInviteId === inv.id && (
                    <form
                      {...NO_AUTOFILL}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSendInvite(inv);
                      }}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input
                        {...NO_AUTOFILL}
                        type="email"
                        value={mailInviteTo}
                        onChange={(e) => setMailInviteTo(e.target.value)}
                        readOnly={Boolean(inv.email)}
                        placeholder={t('auth:emailPlaceholder')}
                        required
                        autoFocus
                        className="flex-1 min-w-[12rem] h-8 px-2.5 input-field"
                      />
                      <button
                        type="submit"
                        disabled={mailInviteBusy}
                        className="btn-primary h-8 px-3 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{mailInviteBusy ? t('sending') : t('users.invite.send')}</span>
                      </button>
                      {maxUses === 1 && !inv.email && (
                        <span className="w-full text-[11px] text-faint">{t('users.invite.mailHint')}</span>
                      )}
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Registrations waiting for approval */}
      {users.some((u) => u.pendingApproval) && (
        <div className="space-y-2">
          <h3 className="font-bold text-main flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-status-warn" />
            {t('users.pending', { count: users.filter((u) => u.pendingApproval).length })}
          </h3>
          <div className="border border-status-warn/40 divide-y divide-border bg-canvas rounded-card overflow-hidden">
            {users
              .filter((u) => u.pendingApproval)
              .map((u) => (
                <div key={u.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar user={u} size="sm" className="border border-border/80" />
                    <div className="min-w-0">
                      <p className="font-bold text-main truncate flex items-center gap-2">
                        {u.displayName}
                        {u.emailUnverified && <span className="badge-neutral text-[10px] font-normal">{t('users.emailUnverified')}</span>}
                      </p>
                      <p className="text-muted text-[11px] truncate">
                        {u.email} · {t('users.registeredOn', { date: formatDate(u.createdAt) })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleApproveUser(u)}
                      className="btn-primary h-11 sm:h-8 px-3 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {t('users.approve')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteUser(u)}
                      className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 hover:text-status-err"
                    >
                      <X className="w-3.5 h-3.5" />
                      {t('users.reject')}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="space-y-2">
        <h3 className="font-bold text-main">
          {t('users.registered', { count: users.filter((u) => !u.pendingApproval).length })}
        </h3>
        <div className="border border-border divide-y divide-border bg-canvas rounded-card overflow-hidden">
          {users.filter((u) => !u.pendingApproval).map((u) => (
            <div key={u.id} className="p-3 space-y-2">
              {/* One row from sm on (the text gets shorter, the buttons keep their place on the right);
                  on phones the buttons get a row of their own, aligned right */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <UserAvatar user={u} size="sm" className="border border-border/80" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-main truncate">{u.displayName}</span>
                      {!u.isActive && (
                        <span className={`${u.emailUnverified ? 'badge-neutral' : 'badge-err'} text-[10px]`}>
                          {u.emailUnverified ? t('users.emailUnverified') : t('users.locked')}
                        </span>
                      )}
                    </div>
                    <p className="text-muted text-[11px] truncate" title={[u.username, u.email].filter(Boolean).join(' · ')}>
                      {u.username && <span className="font-mono">{u.username} · </span>}
                      {u.email}
                    </p>
                    {/* Organizations only as information: who belongs where is set in the organization */}
                    <p className="text-[11px] truncate">
                      {(u.organizationIds || []).length > 0 ? (
                        <span className="text-faint">{(u.organizationIds || []).map(orgName).filter(Boolean).join(', ')}</span>
                      ) : (
                        sharingMode === 'organizations' && <span className="text-status-warn">{t('users.noOrgWarning')}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 sm:shrink-0">
                  {/* Role: server admins choose (on phones in a row of its own above the buttons), user
                      managers only see it */}
                  {isServerAdmin ? (
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                      className="w-full sm:w-auto h-11 sm:h-7 px-2 input-field text-base sm:text-[11px] bg-panel"
                      title={t('users.changeRole')}
                    >
                      <option value="member">{t('users.roleMember')}</option>
                      <option value="manager">{t('users.roleManager')}</option>
                      <option value="admin">{t('users.roleAdmin')}</option>
                    </select>
                  ) : (
                    <span className="min-w-0 flex-1 sm:flex-none truncate">
                      <span className="badge-neutral text-[10px]">{t(`common:role.${u.role}`)}</span>
                    </span>
                  )}

                  {/* Icon actions, always all of them so the rows line up; unavailable ones stay greyed out */}
                  <span title={t('users.username')}>
                    <button
                      onClick={() => setUsernameEdit(usernameEdit?.id === u.id ? null : { id: u.id, value: u.username || '' })}
                      disabled={!isServerAdmin}
                      className={iconBtn}
                      aria-label={t('users.username')}
                    >
                      <AtSign className="w-3.5 h-3.5" />
                    </button>
                  </span>

                  {/* Passwords stay with server admins (others use "forgot password") */}
                  <span title={isServerAdmin ? t('users.password') : t('users.passwordAdminOnly')}>
                    <button
                      onClick={() => setResetPwdUserId(resetPwdUserId === u.id ? null : u.id)}
                      disabled={!isServerAdmin}
                      className={iconBtn}
                      aria-label={t('users.password')}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                  </span>

                  <span title={u.id === currentUser.id ? t('users.notSelf') : !canManage(u) ? t('users.adminOnly') : u.isActive ? t('users.lock') : t('users.activate')}>
                    <button
                      onClick={() => handleToggleUserActive(u)}
                      disabled={u.id === currentUser.id || !canManage(u)}
                      className={`${iconBtn} ${u.isActive ? 'hover:!text-status-err' : '!text-status-ok'}`}
                      aria-label={u.isActive ? t('users.lock') : t('users.activate')}
                    >
                      {u.isActive ? <Ban className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                    </button>
                  </span>

                  <span title={u.id === currentUser.id ? t('users.notSelf') : !canManage(u) ? t('users.adminOnly') : t('users.delete')}>
                    <button
                      onClick={() => handleDeleteUser(u)}
                      disabled={u.id === currentUser.id || !canManage(u)}
                      className={`btn-icon-danger ${iconBtnSize}`}
                      aria-label={t('users.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              </div>

              {usernameEdit?.id === u.id && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <input
                    {...NO_AUTOFILL}
                    type="text"
                    value={usernameEdit.value}
                    onChange={(e) => setUsernameEdit({ id: u.id, value: e.target.value.toLowerCase() })}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSaveUsername(u)}
                    maxLength={32}
                    autoCapitalize="none"
                    spellCheck={false}
                    title={t('profile.usernameRules')}
                    className="flex-1 h-7 px-2 input-field font-mono"
                  />
                  <button onClick={() => void handleSaveUsername(u)} className="btn-primary h-7 px-3 text-[11px]">
                    {t('common:save')}
                  </button>
                  <button onClick={() => setUsernameEdit(null)} className="btn-action h-7 px-2 text-[11px]">
                    {t('common:cancel')}
                  </button>
                </div>
              )}

              {resetPwdUserId === u.id && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <input
                    {...NO_AUTOFILL}
                    type="text"
                    style={MASKED}
                    value={resetPwdVal}
                    onChange={(e) => setResetPwdVal(e.target.value)}
                    placeholder={t('users.newPasswordPlaceholder')}
                    className="flex-1 h-7 px-2 input-field"
                  />
                  <button
                    onClick={() => handleConfirmResetPassword(u.id)}
                    className="btn-primary h-7 px-3 text-[11px]"
                  >
                    {t('common:save')}
                  </button>
                  <button
                    onClick={() => setResetPwdUserId(null)}
                    className="btn-action h-7 px-2 text-[11px]"
                  >
                    {t('common:cancel')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
