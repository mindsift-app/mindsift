import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Trash2,
  AlertCircle,
  Building2,
  Pencil,
} from 'lucide-react';
import { UserAvatar } from '../../../components/UserAvatar';
import { CountBadge } from '../../../components/CountBadge';
import { useAdminSettings } from './useAdminSettings';

// Administration → Organisationen (state in useAdminSettings)
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
    settings,
    handleCreateOrganization,
    handleRenameOrganization,
    handleDeleteOrganization,
    setNewOrgName,
    setRenamingOrgId,
    setRenameOrgVal,
    setDeletingOrgId,
  } = admin;
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('orgs.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('orgs.intro')}
        </p>
        {settings.sharingMode !== 'organizations' && (
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
          className="flex-1 min-w-0 h-8 px-2.5 input-field"
        />
        <button type="submit" className="btn-primary h-8 px-3 text-xs flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          <span>{t('orgs.create')}</span>
        </button>
      </form>

      {organizations.length === 0 ? (
        <p className="text-muted">{t('orgs.empty')}</p>
      ) : (
        <div className="border border-border divide-y divide-border bg-canvas rounded-card overflow-hidden">
          {organizations.map((o) => {
            const members = users.filter((u) => u.organizationId === o.id);
            return (
              <div key={o.id} className="p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {renamingOrgId === o.id ? (
                    <div className="flex flex-1 min-w-0 gap-2">
                      <input
                        type="text"
                        value={renameOrgVal}
                        onChange={(e) => setRenameOrgVal(e.target.value)}
                        className="flex-1 min-w-0 h-7 px-2 input-field"
                        autoFocus
                      />
                      <button onClick={() => handleRenameOrganization(o.id)} className="btn-primary h-7 px-3 text-[11px]">
                        Speichern
                      </button>
                      <button onClick={() => setRenamingOrgId(null)} className="btn-action h-7 px-2 text-[11px]">
                        {t('common:cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 text-accent shrink-0" />
                      <span className="font-bold text-main truncate">{o.name}</span>
                      <CountBadge count={o.memberCount} showZero />
                    </div>
                  )}
                  {renamingOrgId !== o.id && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setRenamingOrgId(o.id);
                          setRenameOrgVal(o.name);
                        }}
                        className="btn-icon"
                        title={t('orgs.rename')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingOrgId(deletingOrgId === o.id ? null : o.id)}
                        className="btn-icon btn-icon-danger"
                        title={t('orgs.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {members.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-pill bg-panel border border-border text-[11px] text-main"
                      >
                        <UserAvatar user={m} size="xxs" showTitle={false} />
                        <span>{m.displayName}</span>
                      </span>
                    ))}
                  </div>
                )}

                {deletingOrgId === o.id && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                    <AlertCircle className="w-3.5 h-3.5 text-status-warn shrink-0" />
                    <span className="flex-1 min-w-0 text-muted">
                      {t('orgs.deleteWarning', { count: o.memberCount })}
                    </span>
                    <button onClick={() => handleDeleteOrganization(o.id)} className="btn-primary h-7 px-3 text-[11px]">
                      {t('orgs.deleteConfirm')}
                    </button>
                    <button onClick={() => setDeletingOrgId(null)} className="btn-action h-7 px-2 text-[11px]">
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
