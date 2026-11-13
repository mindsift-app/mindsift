import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Users,
  User as UserIcon,
  X,
  Plus,
  Trash,
  Lock,
  Check,
} from 'lucide-react';
import { User, Team, UnifiedShare } from '../lib/types';
import { UserAutocomplete } from '../features/UserAutocomplete';
import { UserAvatar } from './UserAvatar';
import { isSharingDisabled } from '../lib/api';
import { NO_AUTOFILL } from '../lib/noAutofill';
import { SelectMenu } from './SelectMenu';
import { errorMessage } from '../lib/errorMessage';

export interface UnifiedShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  resourceName: string;
  resourceIcon?: string | React.ReactNode;
  isOwner: boolean;
  currentUserId?: string;
  shares: UnifiedShare[];
  teams: Team[];
  collaborators: User[];
  allowRoleSelection?: boolean; // Default true (editor vs viewer)
  fixedPermission?: 'editor' | 'viewer'; // When allowRoleSelection is false, force fixedPermission (default 'viewer' for documents, 'editor' for tasks/lists)
  onAddShare: (targetType: 'team' | 'user', targetId: string, permission: 'editor' | 'viewer') => Promise<void>;
  onRemoveShare: (shareId: string) => Promise<void>;
  /** Shown below the shares, e.g. the public link of a note */
  extraSection?: React.ReactNode;
  /** The owner, named to everyone else ("Shared by …") */
  sharedBy?: { id?: string; name?: string; avatarUrl?: string };
}

export const UnifiedShareModal: React.FC<UnifiedShareModalProps> = ({
  isOpen,
  onClose,
  title,
  resourceName,
  resourceIcon,
  isOwner,
  currentUserId,
  shares,
  teams,
  collaborators,
  allowRoleSelection = true,
  fixedPermission,
  onAddShare,
  onRemoveShare,
  extraSection,
  sharedBy,
}) => {
  const { t } = useTranslation();
  const effectiveFixedPerm = fixedPermission || 'viewer';
  const [shareType, setShareType] = useState<'team' | 'user'>('user');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<'editor' | 'viewer'>(
    allowRoleSelection ? 'editor' : effectiveFixedPerm
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const targetId = shareType === 'team' ? selectedTeamId : selectedUser?.id;
    if (!targetId) {
      setError(shareType === 'team' ? t('share.chooseGroup') : t('share.chooseUser'));
      return;
    }

    setLoading(true);
    try {
      const permToUse = allowRoleSelection ? selectedPermission : effectiveFixedPerm;
      await onAddShare(shareType, targetId, permToUse);
      setSelectedTeamId('');
      setSelectedUser(null);
    } catch (err) {
      setError(errorMessage(err, t('share.addFailed')));
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (shareId: string) => {
    setError(null);
    setLoading(true);
    try {
      await onRemoveShare(shareId);
    } catch (err) {
      setError(errorMessage(err, t('share.removeFailed')));
    } finally {
      setLoading(false);
    }
  };

  const excludedUserIds = [
    ...(currentUserId ? [currentUserId] : []),
    ...shares.filter((s) => s.targetType === 'user').map((s) => s.targetId),
  ];

  const availableTeams = teams.filter(
    (t) => !shares.some((s) => s.targetType === 'team' && s.targetId === t.id)
  );

  return (
    <div
      className="fixed inset-0 !m-0 modal-overlay z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-surface w-full max-w-lg p-5 shadow-panel rounded-card border border-border space-y-4 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-btn bg-accent/15 text-accent flex items-center justify-center shrink-0">
              {resourceIcon ? (
                typeof resourceIcon === 'string' ? (
                  <span className="text-base">{resourceIcon}</span>
                ) : (
                  resourceIcon
                )
              ) : (
                <Users className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              {/* What is shared, small; its name large below (the name only once) */}
              <p className="text-[11px] text-muted truncate">{title ?? t('share.defaultTitle')}</p>
              <h3 className="text-sm font-bold text-main truncate">{resourceName}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted hover:text-main rounded-btn hover:bg-panel transition-colors cursor-pointer"
            title={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-status-danger/10 border border-status-danger/30 text-status-danger rounded text-xs">
            {error}
          </div>
        )}

        {/* Who shared it, for everyone but the owner */}
        {!isOwner && sharedBy?.name && (
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <UserAvatar userId={sharedBy.id} name={sharedBy.name} avatarUrl={sharedBy.avatarUrl} size="sm" className="border border-border/80" />
            <span className="min-w-0 truncate">
              <Trans t={t} i18nKey="share.sharedBy" values={{ name: sharedBy.name }} components={{ b: <span className="font-semibold text-main" /> }} />
            </span>
          </div>
        )}

        {/* Add Share Section (Only if owner / manager) */}
        {isSharingDisabled() ? (
          <div className="p-3 bg-panel-elevated border border-border rounded-card text-xs text-muted">
            {t('share.disabled')}
          </div>
        ) : isOwner ? (
          <form onSubmit={handleAdd} className="space-y-3 p-3 bg-panel-elevated border border-border rounded-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-main">{t('share.add')}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setShareType('user');
                    setSelectedTeamId('');
                    setError(null);
                  }}
                  className={`h-7 px-2.5 text-xs rounded-btn font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                    shareType === 'user'
                      ? 'bg-panel border-accent text-accent font-semibold shadow-xs'
                      : 'bg-canvas border-border text-muted hover:text-main'
                  }`}
                >
                  <UserIcon className="w-3.5 h-3.5" />
                  <span>{t('share.user')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShareType('team');
                    setSelectedUser(null);
                    setError(null);
                  }}
                  className={`h-7 px-2.5 text-xs rounded-btn font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                    shareType === 'team'
                      ? 'bg-panel border-accent text-accent font-semibold shadow-xs'
                      : 'bg-canvas border-border text-muted hover:text-main'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{t('share.group')}</span>
                </button>
              </div>
            </div>

            {shareType === 'team' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <SelectMenu
                    ariaLabel={t('share.group')}
                    value={selectedTeamId}
                    onChange={setSelectedTeamId}
                    disabled={loading}
                    options={[
                      { value: '', label: t('share.pickGroup') },
                      ...availableTeams.map((team) => ({
                        value: team.id,
                        label: t('share.teamOption', { name: team.name, count: team.members?.length || 1 }),
                        lead: <Users className="w-3.5 h-3.5 text-muted" />,
                      })),
                    ]}
                  />
                </div>
                {allowRoleSelection ? (
                  <div className="w-full sm:w-36 shrink-0">
                    <SelectMenu<'editor' | 'viewer'>
                      ariaLabel={t('share.permission')}
                      value={selectedPermission}
                      onChange={setSelectedPermission}
                      disabled={loading}
                      options={[
                        { value: 'editor', label: t('share.edit') },
                        { value: 'viewer', label: t('share.readOnly') },
                      ]}
                    />
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted px-2 py-1 bg-panel rounded border border-border shrink-0 self-center">
                    {effectiveFixedPerm === 'editor' ? (
                      <>
                        <Check className="w-3 h-3 text-accent" />
                        {t('share.edit')}
                      </>
                    ) : (
                      <>
                        <Lock className="w-3 h-3 text-faint" />
                        {t('share.readOnly')}
                      </>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <UserAutocomplete
                    users={collaborators}
                    selectedUser={selectedUser}
                    onSelectUser={setSelectedUser}
                    excludeUserIds={excludedUserIds}
                    disabled={loading}
                    {...NO_AUTOFILL}
                    placeholder={t('share.searchUser')}
                  />
                </div>
                {allowRoleSelection ? (
                  <div className="w-full sm:w-36 shrink-0">
                    <SelectMenu<'editor' | 'viewer'>
                      ariaLabel={t('share.permission')}
                      value={selectedPermission}
                      onChange={setSelectedPermission}
                      disabled={loading}
                      options={[
                        { value: 'editor', label: t('share.edit') },
                        { value: 'viewer', label: t('share.readOnly') },
                      ]}
                    />
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted px-2 py-1 bg-panel rounded border border-border shrink-0 self-center">
                    {effectiveFixedPerm === 'editor' ? (
                      <>
                        <Check className="w-3 h-3 text-accent" />
                        {t('share.edit')}
                      </>
                    ) : (
                      <>
                        <Lock className="w-3 h-3 text-faint" />
                        {t('share.readOnly')}
                      </>
                    )}
                  </span>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={loading || (shareType === 'team' ? !selectedTeamId : !selectedUser)}
                className="btn-primary text-xs h-8 px-3.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {loading
                    ? t('share.saving')
                    : shareType === 'team'
                    ? t('share.shareGroup')
                    : t('share.addUser')}
                </span>
              </button>
            </div>
          </form>
        ) : (
          <div className="p-3 bg-panel-elevated border border-border rounded-card text-xs text-muted flex items-center gap-2">
            <Lock className="w-4 h-4 text-faint shrink-0" />
            <span>{t('share.ownerOnly')}</span>
          </div>
        )}

        {/* Active Shares List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider px-0.5">
            <span>{t('share.active')}</span>
            <span className="font-mono text-[11px] font-normal lowercase">
              {t('share.count', { count: shares.length })}
            </span>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
            {shares.length === 0 ? (
              <div className="p-4 bg-canvas border border-border rounded-card text-xs text-muted flex items-center gap-2.5 justify-center text-center">
                <Lock className="w-4 h-4 text-faint shrink-0" />
                <span>{t('share.private')}</span>
              </div>
            ) : (
              shares.map((sh) => {
                const isTeam = sh.targetType === 'team';
                const isEditor = !(sh.permission === 'viewer' || sh.role === 'viewer');
                const roleLabel = isEditor ? t('share.editorRole') : t('share.viewerRole');

                return (
                  <div
                    key={sh.id}
                    className="p-2.5 bg-canvas border border-border rounded-btn flex items-center justify-between gap-3 text-xs hover:border-border/80 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isTeam ? (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-accent/15 text-accent border border-accent/25">
                          <Users className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <UserAvatar
                          userId={sh.targetId}
                          avatarUrl={sh.avatarUrl || collaborators.find((c) => c.id === sh.targetId)?.avatarUrl}
                          name={sh.targetName || sh.targetEmail}
                          size="sm"
                          className="border border-border/80"
                        />
                      )}
                      <div className="truncate">
                        <div className="font-medium text-main truncate flex items-center gap-1.5">
                          <span className="truncate">{sh.targetName || (isTeam ? t('share.group') : sh.targetEmail || t('share.user'))}</span>
                          <span
                            className={`text-[9px] uppercase font-semibold px-1 py-0.2 rounded ${
                              isTeam ? 'badge-neutral' : 'bg-surface-2 text-faint'
                            }`}
                          >
                            {isTeam ? t('share.group') : t('share.user')}
                          </span>
                        </div>
                        {sh.targetEmail && sh.targetEmail !== sh.targetName && (
                          <div className="text-[11px] text-muted truncate">{sh.targetEmail}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                          isEditor
                            ? 'bg-accent/15 text-accent border border-accent/30'
                            : 'bg-surface-2 text-muted border border-border'
                        }`}
                      >
                        {roleLabel}
                      </span>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => handleRemove(sh.id)}
                          disabled={loading}
                          className="p-1 text-faint hover:text-status-err rounded transition-colors cursor-pointer"
                          title={t('share.remove')}
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {extraSection}

        {/* Footer */}
        <div className="pt-2 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-action text-xs h-8 px-4 cursor-pointer"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};
