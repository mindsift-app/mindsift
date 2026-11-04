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
  AlertCircle,
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
    newUserOrg,
    inviteEmail,
    inviteRole,
    inviteOrg,
    inviteMaxUses,
    mailInviteId,
    mailInviteTo,
    mailInviteBusy,
    organizations,
    pendingMove,
    copiedInviteId,
    resetPwdUserId,
    usernameEdit,
    setUsernameEdit,
    handleSaveUsername,
    resetPwdVal,
    settings,
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
    applyUserOrganization,
    handleChangeUserOrganization,
    orgName,
    setNewUserName,
    setNewUserEmail,
    setNewUserPassword,
    setNewUserRole,
    setNewUserOrg,
    setInviteEmail,
    setInviteRole,
    setInviteOrg,
    setInviteMaxUses,
    setMailInviteId,
    setMailInviteTo,
    setPendingMove,
    setResetPwdUserId,
    setResetPwdVal,
  } = admin;
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('users.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('users.intro')}
        </p>
      </div>

      {/* Direct User Creation Form */}
      <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
        <h3 className="font-bold text-main flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5 text-accent" />
          <span>{t('users.create.title')}</span>
        </h3>

        <form onSubmit={handleCreateUser} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="min-w-0">
              <label className="block text-muted mb-1">{t('profile.displayName')}</label>
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder={t('users.create.namePlaceholder')}
                required
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">{t('users.create.email')}</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder={t('users.create.emailPlaceholder')}
                required
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">{t('users.create.password')}</label>
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder={t('users.create.passwordPlaceholder')}
                required
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">{t('users.create.role')}</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="w-full min-w-0 h-8 px-2 input-field bg-panel"
              >
                <option value="member">{t('users.create.roleMember')}</option>
                <option value="admin">{t('users.create.roleAdmin')}</option>
              </select>
            </div>

            {isServerAdmin && (
              <div className="min-w-0">
                <label className="block text-muted mb-1">{t('users.organization')}</label>
                <select
                  value={newUserOrg}
                  onChange={(e) => setNewUserOrg(e.target.value)}
                  className="w-full min-w-0 h-8 px-2 input-field bg-panel"
                >
                <option value="">{t('users.noOrganization')}</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary h-8 px-4 text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('users.create.submit')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Invite Code Generator */}
      <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
        <h3 className="font-bold text-main flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-accent" />
          <span>{t('users.invite.title')}</span>
        </h3>

        <form onSubmit={handleCreateInvite} className="space-y-3">
          {/* E-mail gets the room, "how often" only needs a few digits */}
          <div
            className={`grid grid-cols-1 gap-3 ${
              isServerAdmin ? 'sm:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)_minmax(0,1fr)]' : 'sm:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)]'
            }`}
          >
            <div className="min-w-0">
              <label className="block text-muted mb-1">
                {t('users.invite.email')}
              </label>
              <input
                type="email"
                value={inviteMaxUses > 1 ? '' : inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteMaxUses > 1}
                placeholder={inviteMaxUses > 1 ? t('users.invite.emailGroup') : t('users.invite.emailAny')}
                className="w-full min-w-0 h-8 px-2.5 input-field disabled:opacity-60"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1 whitespace-nowrap">{t('users.invite.uses')}</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={inviteMaxUses}
                onChange={(e) => setInviteMaxUses(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
                title={t('users.invite.usesHint')}
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">{t('users.invite.role')}</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="w-full min-w-0 h-8 px-2 input-field bg-panel"
              >
                <option value="member">{t('users.roleMember')}</option>
                <option value="admin">{t('users.roleAdmin')}</option>
              </select>
            </div>

            {isServerAdmin && (
              <div className="min-w-0">
                <label className="block text-muted mb-1">{t('users.organization')}</label>
                <select
                  value={inviteOrg}
                  onChange={(e) => setInviteOrg(e.target.value)}
                  className="w-full min-w-0 h-8 px-2 input-field bg-panel"
                >
                <option value="">{t('users.noOrganization')}</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-action h-8 px-4 text-xs font-semibold flex items-center gap-1.5 border-accent text-main"
            >
              <KeyRound className="w-3.5 h-3.5 text-accent" />
              <span>{inviteMaxUses > 1 ? t('users.invite.createLink', { count: inviteMaxUses }) : t('users.invite.createCode')}</span>
            </button>
          </div>
        </form>

        {/* Active Invites List */}
        {invites.length > 0 && (
          <div className="pt-2 border-t border-border space-y-1.5">
            <p className="text-[11px] font-semibold text-muted">
              {t('users.invite.list')}
            </p>
            <div className="divide-y divide-border border border-border bg-panel rounded-card overflow-hidden">
              {invites.map((inv) => {
                const maxUses = inv.maxUses || 1;
                const used = inv.useCount ?? (inv.usedBy ? 1 : 0);
                const open = used < maxUses && new Date(inv.expiresAt).getTime() > Date.now();
                const copied = copiedInviteId === inv.id;
                return (
                  <div key={inv.id} className="p-2 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                        <code className="px-2 py-0.5 bg-canvas border border-border font-mono font-bold text-accent rounded-card">
                          {inv.code}
                        </code>
                        <span className="text-muted">
                          {t('user.role')} <strong className="text-main">{inv.role}</strong>
                          {inv.email ? ` · ${t('users.invite.for', { email: inv.email })}` : ''}
                          {inv.organizationName ? ` · ${inv.organizationName}` : ''}
                          {maxUses > 1 ? ` · ${t('users.invite.used', { used, max: maxUses })}` : ''}
                        </span>
                        {open ? (
                          <span className="badge-ok text-[10px]">{t('users.invite.open')}</span>
                        ) : (
                          <span className="badge-neutral text-[10px]">{used >= maxUses ? t('users.invite.redeemed') : t('users.invite.expired')}</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {open && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopyInvite(inv, 'link')}
                              className="btn-action h-7 px-2 text-[11px] flex items-center gap-1"
                              title={inviteLink(inv)}
                            >
                              <Link2 className="w-3 h-3" />
                              <span>{copied && copiedWhat === 'link' ? t('api.copied') : t('users.invite.copyLink')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyInvite(inv, 'code')}
                              className="btn-action h-7 px-2 text-[11px] flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copied && copiedWhat === 'code' ? t('api.copied') : t('users.invite.code')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMailInviteId(mailInviteId === inv.id ? null : inv.id);
                                setMailInviteTo(inv.email || '');
                              }}
                              className="btn-action h-7 px-2 text-[11px] flex items-center gap-1"
                              title={t('users.invite.mailTitle')}
                            >
                              <Mail className="w-3 h-3" />
                              <span>{t('users.invite.mail')}</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteInvite(inv.id)}
                          className="btn-icon btn-icon-danger"
                          title={t('users.invite.delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {mailInviteId === inv.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleSendInvite(inv);
                        }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                      {isServerAdmin && settings.sharingMode === 'organizations' && !u.organizationId && (
                        <span className="text-status-warn"> {t('users.noOrgWarning')}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Role selector */}
                  <select
                    value={u.role}
                    disabled={!isServerAdmin && u.role === 'admin'}
                    onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                    className="h-7 px-2 input-field text-[11px] bg-panel"
                    title={t('users.changeRole')}
                  >
                    <option value="member">{t('users.roleMember')}</option>
                    <option value="admin">{t('users.roleAdmin')}</option>
                  </select>

                  {isServerAdmin && (
                    <select
                      value={u.organizationId || ''}
                      onChange={(e) => handleChangeUserOrganization(u, e.target.value)}
                      className="h-7 px-2 input-field text-[11px] bg-panel max-w-[11rem]"
                      title={t('users.organization')}
                    >
                      <option value="">{t('users.noOrganization')}</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Icon actions, always all of them so the rows line up; unavailable ones stay greyed out */}
                  <span title={t('users.username')}>
                    <button
                      onClick={() => setUsernameEdit(usernameEdit?.id === u.id ? null : { id: u.id, value: u.username || '' })}
                      disabled={!isServerAdmin && u.role === 'admin'}
                      className={iconBtn}
                      aria-label={t('users.username')}
                    >
                      <AtSign className="w-3.5 h-3.5" />
                    </button>
                  </span>

                  {isServerAdmin && (
                    <>
                      <span title={t('users.password')}>
                        <button
                          onClick={() => setResetPwdUserId(resetPwdUserId === u.id ? null : u.id)}
                          className={iconBtn}
                          aria-label={t('users.password')}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                      </span>

                      <span title={u.id === currentUser.id ? t('users.notSelf') : u.isActive ? t('users.lock') : t('users.activate')}>
                        <button
                          onClick={() => handleToggleUserActive(u)}
                          disabled={u.id === currentUser.id}
                          className={`${iconBtn} ${u.isActive ? 'hover:!text-status-err' : '!text-status-ok'}`}
                          aria-label={u.isActive ? t('users.lock') : t('users.activate')}
                        >
                          {u.isActive ? <Ban className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                      </span>

                      <span title={u.id === currentUser.id ? t('users.notSelf') : t('users.delete')}>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          disabled={u.id === currentUser.id}
                          className={`btn-icon-danger ${iconBtnSize}`}
                          aria-label={t('users.delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {pendingMove?.user.id === u.id && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <AlertCircle className="w-3.5 h-3.5 text-status-warn shrink-0" />
                  <span className="flex-1 min-w-0 text-muted">
                    {t('users.leaveOrg', { name: u.displayName, org: orgName(u.organizationId) })}
                  </span>
                  <button
                    onClick={() => applyUserOrganization(u, pendingMove.orgId)}
                    className="btn-primary h-7 px-3 text-[11px]"
                  >
                    {pendingMove.orgId ? t('users.moveTo', { org: orgName(pendingMove.orgId) }) : t('profile.remove')}
                  </button>
                  <button onClick={() => setPendingMove(null)} className="btn-action h-7 px-2 text-[11px]">
                    {t('common:cancel')}
                  </button>
                </div>
              )}

              {usernameEdit?.id === u.id && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <input
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
                    type="password"
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
