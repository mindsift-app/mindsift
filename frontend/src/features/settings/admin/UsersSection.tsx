import React from 'react';
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
} from 'lucide-react';
import { User, UserRole } from '../../../lib/types';
import { UserAvatar } from '../../../components/UserAvatar';
import { useAdminSettings } from './useAdminSettings';

// Administration → Benutzer & Einladungen (state in useAdminSettings)
export function UsersSection({
  admin,
  currentUser,
  isServerAdmin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
  currentUser: User;
  isServerAdmin: boolean;
}) {
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
        <h2 className="text-sm font-bold text-main">Benutzersteuerung, Rollen & Einladungen</h2>
        <p className="text-muted mt-0.5">
          Lege Benutzerkonten direkt an oder erzeuge Einladungscodes, mit denen sich eingeladene
          Personen selbst registrieren können, auch wenn die öffentliche Registrierung gesperrt ist.
        </p>
      </div>

      {/* Direct User Creation Form */}
      <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
        <h3 className="font-bold text-main flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5 text-accent" />
          <span>Neues Benutzerkonto direkt anlegen</span>
        </h3>

        <form onSubmit={handleCreateUser} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="min-w-0">
              <label className="block text-muted mb-1">Anzeigename</label>
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="z.B. Anna Beispiel"
                required
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">E-Mail-Adresse</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="anna@beispiel.de"
                required
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">Initial-Passwort</label>
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="Mind. 8 Zeichen"
                required
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">Benutzerrolle</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="w-full min-w-0 h-8 px-2 input-field bg-panel"
              >
                <option value="member">Mitglied (Standard)</option>
                <option value="admin">Server-Admin (Vollzugriff)</option>
              </select>
            </div>

            {isServerAdmin && (
              <div className="min-w-0">
                <label className="block text-muted mb-1">Organisation</label>
                <select
                  value={newUserOrg}
                  onChange={(e) => setNewUserOrg(e.target.value)}
                  className="w-full min-w-0 h-8 px-2 input-field bg-panel"
                >
                <option value="">Keine Organisation</option>
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
              <span>Benutzer jetzt anlegen</span>
            </button>
          </div>
        </form>
      </div>

      {/* Invite Code Generator */}
      <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
        <h3 className="font-bold text-main flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-accent" />
          <span>Einladung erzeugen (gültig für 7 Tage)</span>
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
                Gebundene E-Mail (optional)
              </label>
              <input
                type="email"
                value={inviteMaxUses > 1 ? '' : inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteMaxUses > 1}
                placeholder={inviteMaxUses > 1 ? 'Nur bei einmaliger Einladung' : 'Leer lassen für beliebige E-Mail'}
                className="w-full min-w-0 h-8 px-2.5 input-field disabled:opacity-60"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1 whitespace-nowrap">Wie oft verwendbar</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={inviteMaxUses}
                onChange={(e) => setInviteMaxUses(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
                title="1 = ein Code für eine Person; mehr = ein Link für eine ganze Gruppe"
                className="w-full min-w-0 h-8 px-2.5 input-field"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-muted mb-1">Rolle</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="w-full min-w-0 h-8 px-2 input-field bg-panel"
              >
                <option value="member">Mitglied</option>
                <option value="admin">Server-Admin</option>
              </select>
            </div>

            {isServerAdmin && (
              <div className="min-w-0">
                <label className="block text-muted mb-1">Organisation</label>
                <select
                  value={inviteOrg}
                  onChange={(e) => setInviteOrg(e.target.value)}
                  className="w-full min-w-0 h-8 px-2 input-field bg-panel"
                >
                <option value="">Keine Organisation</option>
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
              <span>{inviteMaxUses > 1 ? `Einladungslink für ${inviteMaxUses} Personen erzeugen` : 'Einladungscode generieren'}</span>
            </button>
          </div>
        </form>

        {/* Active Invites List */}
        {invites.length > 0 && (
          <div className="pt-2 border-t border-border space-y-1.5">
            <p className="text-[11px] font-semibold text-muted">
              Aktive & bisherige Einladungscodes:
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
                          Rolle: <strong className="text-main">{inv.role}</strong>
                          {inv.email ? ` · Für: ${inv.email}` : ''}
                          {inv.organizationName ? ` · ${inv.organizationName}` : ''}
                          {maxUses > 1 ? ` · ${used} von ${maxUses} verwendet` : ''}
                        </span>
                        {open ? (
                          <span className="badge-ok text-[10px]">Offen</span>
                        ) : (
                          <span className="badge-neutral text-[10px]">{used >= maxUses ? 'Eingelöst' : 'Abgelaufen'}</span>
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
                              <span>{copied && copiedWhat === 'link' ? 'Kopiert!' : 'Link kopieren'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyInvite(inv, 'code')}
                              className="btn-action h-7 px-2 text-[11px] flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copied && copiedWhat === 'code' ? 'Kopiert!' : 'Code'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMailInviteId(mailInviteId === inv.id ? null : inv.id);
                                setMailInviteTo(inv.email || '');
                              }}
                              className="btn-action h-7 px-2 text-[11px] flex items-center gap-1"
                              title="Einladung per E-Mail verschicken"
                            >
                              <Mail className="w-3 h-3" />
                              <span>Per E-Mail</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteInvite(inv.id)}
                          className="btn-icon btn-icon-danger"
                          title="Einladung löschen"
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
                          placeholder="name@beispiel.de"
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
                          <span>{mailInviteBusy ? 'Sende…' : 'Einladung senden'}</span>
                        </button>
                        {maxUses === 1 && !inv.email && (
                          <span className="w-full text-[11px] text-faint">Die Einladung gilt danach nur noch für diese Adresse.</span>
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
            Wartet auf Freigabe ({users.filter((u) => u.pendingApproval).length})
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
                        {u.emailUnverified && <span className="badge-neutral text-[10px] font-normal">E-Mail unbestätigt</span>}
                      </p>
                      <p className="text-muted text-[11px] truncate">
                        {u.email} · registriert am {new Date(u.createdAt).toLocaleDateString('de-DE')}
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
                      Freigeben
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteUser(u)}
                      className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 hover:text-status-err"
                    >
                      <X className="w-3.5 h-3.5" />
                      Ablehnen
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
          Registrierte Benutzer ({users.filter((u) => !u.pendingApproval).length})
        </h3>
        <div className="border border-border divide-y divide-border bg-canvas rounded-card overflow-hidden">
          {users.filter((u) => !u.pendingApproval).map((u) => (
            <div key={u.id} className="p-3 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <UserAvatar user={u} size="sm" className="border border-border/80" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-main">{u.displayName}</span>
                      {!u.isActive && (
                        <span className={`${u.emailUnverified ? 'badge-neutral' : 'badge-err'} text-[10px]`}>
                          {u.emailUnverified ? 'E-Mail unbestätigt' : 'Gesperrt'}
                        </span>
                      )}
                    </div>
                    <p className="text-muted text-[11px]">
                      {u.email}
                      {isServerAdmin && settings.sharingMode === 'organizations' && !u.organizationId && (
                        <span className="text-status-warn"> · ohne Organisation, sieht niemanden</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Role selector */}
                  <select
                    value={u.role}
                    disabled={!isServerAdmin && u.role === 'admin'}
                    onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                    className="h-7 px-2 input-field text-[11px] bg-panel"
                    title="Benutzerrolle ändern"
                  >
                    <option value="member">Mitglied</option>
                    <option value="admin">Server-Admin</option>
                  </select>

                  {isServerAdmin && (
                    <select
                      value={u.organizationId || ''}
                      onChange={(e) => handleChangeUserOrganization(u, e.target.value)}
                      className="h-7 px-2 input-field text-[11px] bg-panel max-w-[11rem]"
                      title="Organisation"
                    >
                      <option value="">Keine Organisation</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {isServerAdmin && (
                    <>
                      <button
                        onClick={() =>
                          setResetPwdUserId(resetPwdUserId === u.id ? null : u.id)
                        }
                        className="btn-action h-7 px-2 text-[11px]"
                      >
                        Passwort
                      </button>

                      {u.id !== currentUser.id && (
                        <>
                          <button
                            onClick={() => handleToggleUserActive(u)}
                            className="btn-action h-7 px-2 text-[11px]"
                          >
                            {u.isActive ? 'Sperren' : 'Aktivieren'}
                          </button>

                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="btn-icon btn-icon-danger"
                            title="Benutzer löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {pendingMove?.user.id === u.id && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <AlertCircle className="w-3.5 h-3.5 text-status-warn shrink-0" />
                  <span className="flex-1 min-w-0 text-muted">
                    {u.displayName} verlässt „{orgName(u.organizationId)}“ und verliert dort alle Freigaben,
                    Gruppen und Aufgaben-Zuweisungen.
                  </span>
                  <button
                    onClick={() => applyUserOrganization(u, pendingMove.orgId)}
                    className="btn-primary h-7 px-3 text-[11px]"
                  >
                    {pendingMove.orgId ? `Nach „${orgName(pendingMove.orgId)}“ verschieben` : 'Entfernen'}
                  </button>
                  <button onClick={() => setPendingMove(null)} className="btn-action h-7 px-2 text-[11px]">
                    Abbrechen
                  </button>
                </div>
              )}

              {resetPwdUserId === u.id && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <input
                    type="password"
                    value={resetPwdVal}
                    onChange={(e) => setResetPwdVal(e.target.value)}
                    placeholder="Neues Passwort (mind. 8 Zeichen)…"
                    className="flex-1 h-7 px-2 input-field"
                  />
                  <button
                    onClick={() => handleConfirmResetPassword(u.id)}
                    className="btn-primary h-7 px-3 text-[11px]"
                  >
                    Speichern
                  </button>
                  <button
                    onClick={() => setResetPwdUserId(null)}
                    className="btn-action h-7 px-2 text-[11px]"
                  >
                    Abbrechen
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
