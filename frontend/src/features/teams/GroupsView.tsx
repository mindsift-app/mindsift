import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  Users,
  Plus,
  Trash,
  ArrowLeft,
  Check,
  CircleAlert,
  UserPlus,
  Shield,
  Pencil,
  X,
  LogOut,
} from 'lucide-react';
import { Team, User } from '../../lib/types';
import { api, isSharingDisabled, triggerHaptic } from '../../lib/api';
import { UserAutocomplete } from '../UserAutocomplete';
import { UserAvatar } from '../../components/UserAvatar';
import { askConfirm } from '../../components/askConfirm';
import { NO_AUTOFILL } from '../../lib/noAutofill';
import { SelectMenu } from '../../components/SelectMenu';
import { errorMessage } from '../../lib/errorMessage';

interface GroupsViewProps {
  currentUser: User;
  onBack: () => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({ currentUser, onBack }) => {
  const { t } = useTranslation('groups');
  const [teams, setTeams] = useState<Team[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create Group Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  // Whoever is in several organizations picks the group's one (its members come from there)
  const myOrgs = currentUser.organizations || [];
  const [newGroupOrg, setNewGroupOrg] = useState(myOrgs[0]?.id || '');
  const [creating, setCreating] = useState(false);

  // Edit Group State
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // Add Member State per Team
  const [selectedUserByTeam, setSelectedUserByTeam] = useState<Record<string, User | null>>({});
  const [memberRoleByTeam, setMemberRoleByTeam] = useState<Record<string, 'admin' | 'member'>>({});

  const loadData = async () => {
    try {
      const [userTeams, allUsers] = await Promise.all([
        api.getUserTeams(),
        api.getUsersDirectory().catch(() => []),
      ]);
      setTeams(userTeams);
      setDirectoryUsers(allUsers);
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:loadFailed')) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;

    setCreating(true);
    setStatusMsg(null);
    triggerHaptic(15);

    try {
      const created = await api.createTeam(name, newGroupDesc.trim(), myOrgs.length > 1 ? newGroupOrg : '');
      setNewGroupName('');
      setNewGroupDesc('');
      setShowCreateModal(false);
      await loadData();
      setStatusMsg({ type: 'ok', text: i18n.t('groups:created', { name: created.name }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:createFailed')) });
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = (team: Team) => {
    setEditingTeamId(team.id);
    setEditName(team.name);
    setEditDesc(team.description || '');
  };

  const handleSaveEdit = async (teamId: string) => {
    const name = editName.trim();
    if (!name) return;

    setStatusMsg(null);
    triggerHaptic(10);
    try {
      await api.updateTeam(teamId, name, editDesc.trim());
      setEditingTeamId(null);
      await loadData();
      setStatusMsg({ type: 'ok', text: i18n.t('groups:updated') });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:updateFailed')) });
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    const ok = await askConfirm({
      message: i18n.t('groups:confirmDelete', { name: team.name }),
      confirmLabel: i18n.t('common:delete'),
      danger: true,
    });
    if (!ok) return;
    setStatusMsg(null);
    triggerHaptic(15);
    try {
      await api.deleteTeam(team.id);
      await loadData();
      setStatusMsg({ type: 'ok', text: i18n.t('groups:deleted', { name: team.name }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:deleteFailed')) });
    }
  };

  const handleAddMember = async (teamId: string) => {
    const user = selectedUserByTeam[teamId];
    if (!user) return;
    const role = memberRoleByTeam[teamId] || 'member';

    setStatusMsg(null);
    triggerHaptic(10);
    try {
      await api.addTeamMember(teamId, { userId: user.id, role });
      setSelectedUserByTeam((prev) => ({ ...prev, [teamId]: null }));
      await loadData();
      setStatusMsg({ type: 'ok', text: i18n.t('groups:memberAdded', { name: user.displayName }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:addFailed')) });
    }
  };

  const handleChangeMemberRole = async (teamId: string, memberUserId: string, newRole: 'admin' | 'member') => {
    setStatusMsg(null);
    triggerHaptic(10);
    try {
      await api.updateTeamMemberRole(teamId, memberUserId, newRole);
      await loadData();
      setStatusMsg({
        type: 'ok',
        text: i18n.t('groups:roleChanged', { role: newRole === 'admin' ? i18n.t('groups:roleAdmin') : i18n.t('groups:roleMember') }),
      });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:roleFailed')) });
    }
  };

  const handleRemoveMember = async (teamId: string, memberUserId: string, memberName: string) => {
    // No question: a member is quickly added again
    const isSelf = memberUserId === currentUser.id;

    setStatusMsg(null);
    triggerHaptic(10);
    try {
      await api.removeTeamMember(teamId, memberUserId);
      await loadData();
      setStatusMsg({
        type: 'ok',
        text: isSelf ? i18n.t('groups:left') : i18n.t('groups:removed', { name: memberName }),
      });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('groups:removeFailed')) });
    }
  };

  // Group teams into managed (admin) and member-only
  const managedTeams = teams.filter((t) =>
    (t.members || []).some((m) => m.userId === currentUser.id && m.role === 'admin')
  );

  const memberTeams = teams.filter(
    (t) =>
      (t.members || []).some((m) => m.userId === currentUser.id && m.role === 'member') &&
      !managedTeams.some((mt) => mt.id === t.id)
  );

  if (isSharingDisabled()) {
    return (
      <div className="w-full space-y-3">
        <button onClick={onBack} className="btn-action h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('back')}</span>
        </button>
        <p className="text-xs text-muted">{t('disabled')}</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn-action h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
            title={t('back')}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('back')}</span>
          </button>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <span>{t('title')}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-panel-elevated text-muted border border-border">
                {teams.length}
              </span>
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {t('intro')}
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            triggerHaptic(10);
            setShowCreateModal(true);
          }}
          className="btn-primary h-8 px-3.5 text-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('newGroup')}</span>
        </button>
      </div>

      {/* Status Messages */}
      {statusMsg && (
        <div
          className={`p-3 text-xs flex items-center justify-between gap-2 rounded-card ${
            statusMsg.type === 'ok' ? 'alert-ok' : 'alert-err'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMsg.type === 'ok' ? (
              <Check className="w-4 h-4 text-accent flex-shrink-0" />
            ) : (
              <CircleAlert className="w-4 h-4 text-status-err flex-shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-muted hover:text-main text-[11px] cursor-pointer"
          >
            {t('close')}
          </button>
        </div>
      )}

      {/* Modal: Neue Gruppe erstellen */}
      {showCreateModal && (
        <div
          className="fixed inset-0 !m-0 modal-overlay z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="w-full max-w-md bg-panel border border-border rounded-xl shadow-panel p-5 space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-btn bg-accent/15 text-accent flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-main">{t('create.title')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-muted hover:text-main rounded-btn transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-muted text-xs mb-1 font-medium">
                  {t('create.name')}
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t('create.namePlaceholder')}
                  required
                  autoFocus
                  className="w-full h-8 px-2.5 input-field text-xs"
                />
              </div>

              <div>
                <label className="block text-muted text-xs mb-1 font-medium">
                  {t('create.description')}
                </label>
                <input
                  type="text"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder={t('create.descriptionPlaceholder')}
                  className="w-full h-8 px-2.5 input-field text-xs"
                />
              </div>

              {myOrgs.length > 1 && (
                <div>
                  <label className="block text-muted text-xs mb-1 font-medium">{t('create.organization')}</label>
                  <SelectMenu
                    ariaLabel={t('create.organization')}
                    value={newGroupOrg}
                    onChange={setNewGroupOrg}
                    options={myOrgs.map((o) => ({ value: o.id, label: o.name }))}
                  />
                  <p className="text-[11px] text-faint mt-1">{t('create.organizationHint')}</p>
                </div>
              )}

              <div className="p-3 bg-canvas border border-border rounded-btn text-[11px] text-muted space-y-1">
                <p className="font-semibold text-main flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-accent" />
                  <span>{t('create.youAdmin')}</span>
                </p>
                <p>
                  {t('create.youAdminHint')}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-action h-8 px-3 text-xs cursor-pointer"
                >
                  {t('common:cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating || !newGroupName.trim()}
                  className="btn-primary h-8 px-4 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('create.submit')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="p-8 text-center text-muted text-xs">{t('loading')}</div>
      ) : teams.length === 0 ? (
        <div className="p-10 bg-canvas border border-border rounded-card text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-panel-elevated text-muted mx-auto flex items-center justify-center">
            <Users className="w-6 h-6 text-accent opacity-75" />
          </div>
          <div>
            <h3 className="font-bold text-main text-sm">{t('empty.title')}</h3>
            <p className="text-muted text-xs mt-1 max-w-md mx-auto">
              {t('empty.text')}
            </p>
          </div>
          <button
            onClick={() => {
              triggerHaptic(10);
              setShowCreateModal(true);
            }}
            className="btn-primary h-8 px-4 text-xs inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('empty.create')}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* SECTION 1: groups I manage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-main uppercase tracking-wider text-muted flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-accent" />
                <span>{t('managed', { count: managedTeams.length })}</span>
              </h2>
            </div>

            {managedTeams.length === 0 ? (
              <div className="p-4 bg-canvas border border-border rounded-card text-xs text-muted">
                {t('noAdmin')}
              </div>
            ) : (
              <div className="space-y-4">
                {managedTeams.map((team) => {
                  const members = team.members || [];
                  const isEditing = editingTeamId === team.id;
                  const memberUserIds = members.map((m) => m.userId);

                  return (
                    <div
                      key={team.id}
                      className="p-4 bg-canvas border border-border rounded-card space-y-4 shadow-sm"
                    >
                      {/* Team Header */}
                      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <div className="w-8 h-8 rounded-btn bg-accent/15 text-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Users className="w-4 h-4" />
                          </div>

                          {isEditing ? (
                            <div className="flex-1 space-y-2 max-w-lg">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder={t('namePlaceholder')}
                                className="w-full h-8 px-2.5 input-field text-xs font-bold"
                              />
                              <input
                                type="text"
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                                placeholder={t('descriptionPlaceholder')}
                                className="w-full h-7 px-2.5 input-field text-xs"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(team.id)}
                                  className="btn-primary h-7 px-3 text-[11px] cursor-pointer"
                                >
                                  {t('common:save')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTeamId(null)}
                                  className="btn-action h-7 px-2.5 text-[11px] cursor-pointer"
                                >
                                  {t('common:cancel')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-main truncate">
                                  {team.name}
                                </span>
                                <span className="badge-accent text-[10px] py-0.5 px-2">
                                  {t('roleAdmin')}
                                </span>
                                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-panel-elevated text-muted border border-border">
                                  {members.length} {members.length === 1 ? t('roleMember') : 'Mitglieder'}
                                </span>
                              </div>
                              {team.description && (
                                <p className="text-xs text-muted mt-1 break-words">
                                  {team.description}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleStartEdit(team)}
                              className="btn-action h-7 px-2.5 text-xs flex items-center gap-1 cursor-pointer"
                              title={t('edit')}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{t('editShort')}</span>
                            </button>
                            <button
                              onClick={() => handleDeleteTeam(team)}
                              className="btn-icon btn-icon-danger"
                              title={t('delete')}
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Members List */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                          {t('membersCount', { count: members.length })}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {members.map((m) => {
                            const isSelf = m.userId === currentUser.id;
                            const isAdmin = m.role === 'admin';

                            return (
                              <div
                                key={m.userId}
                                className="p-2.5 bg-panel border border-border rounded-btn flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <UserAvatar user={{ id: m.userId, displayName: m.displayName, email: m.email, avatarUrl: m.avatarUrl }} size="xs" />
                                  <div className="min-w-0">
                                    <p className="text-main font-medium truncate text-xs">
                                      {m.displayName} {isSelf && <span className="text-faint">{t('you')}</span>}
                                    </p>
                                    {m.email && (
                                      <p className="text-[10px] text-muted truncate">
                                        {m.email}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <SelectMenu<'admin' | 'member'>
                                      ariaLabel={t('changeRole')}
                                      title={t('changeRole')}
                                      value={m.role as 'admin' | 'member'}
                                      onChange={(role) => handleChangeMemberRole(team.id, m.userId, role)}
                                      buttonClassName={`h-6 px-1.5 gap-1 text-[10px] rounded input-field bg-panel ${
                                        isAdmin ? 'border-accent text-accent font-semibold' : 'text-muted'
                                      }`}
                                      options={[
                                        { value: 'member', label: t('roleMember') },
                                        { value: 'admin', label: t('roleAdmin') },
                                      ]}
                                    />

                                  <button
                                    onClick={() => handleRemoveMember(team.id, m.userId, m.displayName)}
                                    className="p-1 text-faint hover:text-status-err rounded transition-colors cursor-pointer"
                                    title={isSelf ? t('leave') : t('removeMember')}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Add Member Row */}
                      <div className="pt-3 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <div className="flex-1 min-w-[220px]">
                          <UserAutocomplete
                            users={directoryUsers}
                            selectedUser={selectedUserByTeam[team.id] || null}
                            onSelectUser={(u) =>
                              setSelectedUserByTeam((prev) => ({ ...prev, [team.id]: u }))
                            }
                            excludeUserIds={memberUserIds}
                            {...NO_AUTOFILL}
                            placeholder={t('searchPlaceholder')}
                          />
                        </div>

                        <SelectMenu<'admin' | 'member'>
                          size="sm"
                          ariaLabel={t('changeRole')}
                          value={memberRoleByTeam[team.id] || 'member'}
                          onChange={(role) => setMemberRoleByTeam((prev) => ({ ...prev, [team.id]: role }))}
                          options={[
                            { value: 'member', label: t('roleMember') },
                            { value: 'admin', label: t('roleAdmin') },
                          ]}
                        />

                        <button
                          type="button"
                          onClick={() => handleAddMember(team.id)}
                          disabled={!selectedUserByTeam[team.id]}
                          className="btn-primary h-8 px-3.5 text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>{t('add')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: Meine Mitgliedschaften (als Mitglied) */}
          {memberTeams.length > 0 && (
            <div className="space-y-3 pt-2">
              <h2 className="text-xs font-bold text-main uppercase tracking-wider text-muted flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-accent" />
                <span>{t('memberships', { count: memberTeams.length })}</span>
              </h2>

              <div className="space-y-3">
                {memberTeams.map((team) => {
                  const members = team.members || [];
                  const admins = members.filter((m) => m.role === 'admin');

                  return (
                    <div
                      key={team.id}
                      className="p-4 bg-canvas border border-border rounded-card space-y-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                        <div className="flex items-start gap-2.5">
                          <div className="w-8 h-8 rounded-btn bg-panel-elevated text-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Users className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-main">{team.name}</span>
                              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-panel-elevated text-muted border border-border">
                                {members.length} {members.length === 1 ? t('roleMember') : 'Mitglieder'}
                              </span>
                            </div>
                            {team.description && (
                              <p className="text-xs text-muted mt-1">{team.description}</p>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => handleRemoveMember(team.id, currentUser.id, currentUser.displayName)}
                          className="btn-action text-status-err hover:bg-status-err-bg h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                          title={t('leave')}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>{t('leave')}</span>
                        </button>
                      </div>

                      {/* Admins & Members list in read-only mode */}
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-muted">
                          {t('admins')}{' '}
                          <span className="text-main font-normal">
                            {admins.map((a) => a.displayName).join(', ') || t('nobody')}
                          </span>
                        </p>
                        <p className="text-[11px] font-semibold text-muted">
                          {t('allMembers')}{' '}
                          <span className="text-faint font-normal">
                            {members.map((m) => m.displayName).join(', ')}
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
