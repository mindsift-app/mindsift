import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Trash2,
  AlertCircle,
  Building2,
  Pencil,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { UserAvatar } from '../../../components/UserAvatar';
import { CountBadge } from '../../../components/CountBadge';
import { UserAutocomplete } from '../../UserAutocomplete';
import { User } from '../../../lib/types';
import { useAdminSettings } from './useAdminSettings';

// Administration → Organisationen (state in useAdminSettings). An organization opens on click: its
// members with ✕ to take them out, a field to add someone, rename and delete.
export function OrganizationsSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const {
    users,
    organizations,
    newOrgName,
    renamingOrgId,
    renameOrgVal,
    deletingOrgId,
    openOrgId,
    pendingRemoval,
    sharingMode,
    handleCreateOrganization,
    handleRenameOrganization,
    handleDeleteOrganization,
    handleAddOrgMember,
    handleRemoveOrgMember,
    setNewOrgName,
    setRenamingOrgId,
    setRenameOrgVal,
    setDeletingOrgId,
    setOpenOrgId,
    setPendingRemoval,
  } = admin;
  const [adding, setAdding] = useState<User | null>(null);
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('orgs.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('orgs.intro')}
        </p>
        {sharingMode !== 'organizations' && (
          <p className="mt-2 text-status-warn">
            {t('orgs.notActive')}
          </p>
        )}
      </div>

      <form onSubmit={handleCreateOrganization} className="flex gap-2 max-w-md">
        <input
          type="text"
          value={newOrgName}
          onChange={(e) => setNewOrgName(e.target.value)}
          placeholder={t('orgs.namePlaceholder')}
          className="flex-1 min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
        />
        <button type="submit" className="btn-primary h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          <span>{t('orgs.create')}</span>
        </button>
      </form>

      {organizations.length === 0 ? (
        <p className="text-muted">{t('orgs.empty')}</p>
      ) : (
        <div className="border border-border divide-y divide-border bg-canvas rounded-card overflow-hidden">
          {organizations.map((o) => {
            const members = users.filter((u) => (u.organizationIds || []).includes(o.id));
            const open = openOrgId === o.id;
            return (
              <div key={o.id} className="p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {renamingOrgId === o.id ? (
                    <form
                      className="flex flex-1 min-w-0 gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleRenameOrganization(o.id);
                      }}
                    >
                      <input
                        type="text"
                        value={renameOrgVal}
                        onChange={(e) => setRenameOrgVal(e.target.value)}
                        className="flex-1 min-w-0 h-11 sm:h-7 px-2 input-field text-base sm:text-xs"
                        autoFocus
                      />
                      <button type="submit" className="btn-primary h-11 sm:h-7 px-3 text-[11px]">
                        {t('common:save')}
                      </button>
                      <button type="button" onClick={() => setRenamingOrgId(null)} className="btn-action h-11 sm:h-7 px-2 text-[11px]">
                        {t('common:cancel')}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenOrgId(open ? null : o.id);
                        setAdding(null);
                        setPendingRemoval(null);
                      }}
                      aria-expanded={open}
                      className="flex flex-1 items-center gap-2 min-w-0 min-h-11 sm:min-h-0 text-left cursor-pointer group"
                    >
                      {open ? (
                        <ChevronDown className="w-3.5 h-3.5 text-accent shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted group-hover:text-main shrink-0" />
                      )}
                      <Building2 className="w-4 h-4 text-accent shrink-0" />
                      <span className="font-bold text-main truncate">{o.name}</span>
                      <CountBadge count={o.memberCount} showZero />
                    </button>
                  )}
                  {renamingOrgId !== o.id && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setRenamingOrgId(o.id);
                          setRenameOrgVal(o.name);
                        }}
                        className="btn-icon w-11 h-11 sm:w-7 sm:h-7"
                        title={t('orgs.rename')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingOrgId(deletingOrgId === o.id ? null : o.id)}
                        className="btn-icon btn-icon-danger w-11 h-11 sm:w-7 sm:h-7"
                        title={t('orgs.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Closed: the members as quiet chips; open: with ✕ and a field to add someone */}
                {members.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => (
                      <span
                        key={m.id}
                        className={`inline-flex items-center gap-1.5 pl-0.5 ${open ? 'pr-0.5' : 'pr-2'} py-0.5 rounded-pill bg-panel border border-border text-[11px] text-main`}
                      >
                        <UserAvatar user={m} size="xxs" showTitle={false} />
                        <span>{m.displayName}</span>
                        {open && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveOrgMember(o.id, m)}
                            className="p-1 text-muted hover:text-status-err rounded-full"
                            title={t('orgs.removeMember', { name: m.displayName })}
                            aria-label={t('orgs.removeMember', { name: m.displayName })}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {open && pendingRemoval?.orgId === o.id && (
                  <div className="flex flex-wrap items-center gap-2 p-2 border border-status-warn/40 bg-status-warn/5 rounded-card">
                    <AlertCircle className="w-3.5 h-3.5 text-status-warn shrink-0" />
                    <span className="flex-1 min-w-0 text-main">
                      {t('orgs.removeWarning', { name: pendingRemoval.user.displayName, org: o.name, count: pendingRemoval.affected })}
                    </span>
                    <button
                      onClick={() => void handleRemoveOrgMember(o.id, pendingRemoval.user, true)}
                      className="btn-primary h-11 sm:h-7 px-3 text-[11px]"
                    >
                      {t('orgs.removeConfirm')}
                    </button>
                    <button onClick={() => setPendingRemoval(null)} className="btn-action h-11 sm:h-7 px-2 text-[11px]">
                      {t('common:cancel')}
                    </button>
                  </div>
                )}

                {open && (
                  <form
                    className="flex flex-col sm:flex-row gap-2 max-w-lg"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!adding) return;
                      void handleAddOrgMember(o.id, adding);
                      setAdding(null);
                    }}
                  >
                    <UserAutocomplete
                      className="flex-1 min-w-0"
                      users={users.filter((u) => !u.pendingApproval)}
                      selectedUser={adding}
                      onSelectUser={setAdding}
                      excludeUserIds={members.map((m) => m.id)}
                      allUsers
                      placeholder={t('orgs.addMemberPlaceholder')}
                    />
                    <button type="submit" disabled={!adding} className="btn-primary h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
                      <Plus className="w-3.5 h-3.5" />
                      {t('orgs.addMember')}
                    </button>
                  </form>
                )}

                {deletingOrgId === o.id && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                    <AlertCircle className="w-3.5 h-3.5 text-status-warn shrink-0" />
                    <span className="flex-1 min-w-0 text-muted">
                      {t('orgs.deleteWarning', { count: o.memberCount })}
                    </span>
                    <button onClick={() => handleDeleteOrganization(o.id)} className="btn-primary h-11 sm:h-7 px-3 text-[11px]">
                      {t('orgs.deleteConfirm')}
                    </button>
                    <button onClick={() => setDeletingOrgId(null)} className="btn-action h-11 sm:h-7 px-2 text-[11px]">
                      {t('common:cancel')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
