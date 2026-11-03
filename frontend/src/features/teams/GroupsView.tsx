import React, { useEffect, useState } from 'react';
import {
  Users,
  Plus,
  Trash2,
  ArrowLeft,
  Check,
  AlertCircle,
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

interface GroupsViewProps {
  currentUser: User;
  onBack: () => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({ currentUser, onBack }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create Group Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Laden der Gruppen' });
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
      const created = await api.createTeam(name, newGroupDesc.trim());
      setNewGroupName('');
      setNewGroupDesc('');
      setShowCreateModal(false);
      await loadData();
      setStatusMsg({ type: 'ok', text: `Gruppe "${created.name}" erfolgreich erstellt.` });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Erstellen der Gruppe' });
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
      setStatusMsg({ type: 'ok', text: 'Gruppe erfolgreich aktualisiert.' });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Aktualisieren der Gruppe' });
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    if (!window.confirm(`Gruppe "${team.name}" wirklich löschen? Alle Freigaben für diese Gruppe werden entfernt.`)) {
      return;
    }
    setStatusMsg(null);
    triggerHaptic(15);
    try {
      await api.deleteTeam(team.id);
      await loadData();
      setStatusMsg({ type: 'ok', text: `Gruppe "${team.name}" gelöscht.` });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Löschen der Gruppe' });
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
      setStatusMsg({ type: 'ok', text: `${user.displayName} wurde zur Gruppe hinzugefügt.` });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Hinzufügen des Mitglieds' });
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
        text: `Rolle erfolgreich zu "${newRole === 'admin' ? 'Gruppen-Admin' : 'Mitglied'}" geändert.`,
      });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Ändern der Rolle' });
    }
  };

  const handleRemoveMember = async (teamId: string, memberUserId: string, memberName: string) => {
    const isSelf = memberUserId === currentUser.id;
    const msg = isSelf
      ? 'Möchtest du diese Gruppe wirklich verlassen?'
      : `Mitglied "${memberName}" wirklich aus der Gruppe entfernen?`;

    if (!window.confirm(msg)) return;

    setStatusMsg(null);
    triggerHaptic(10);
    try {
      await api.removeTeamMember(teamId, memberUserId);
      await loadData();
      setStatusMsg({
        type: 'ok',
        text: isSelf ? 'Du hast die Gruppe verlassen.' : `Mitglied "${memberName}" wurde entfernt.`,
      });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || 'Fehler beim Entfernen des Mitglieds' });
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
          <span>Zurück</span>
        </button>
        <p className="text-xs text-muted">Gruppen sind auf diesem Server deaktiviert (Sichtbarkeits-Modus „Privat“).</p>
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
            title="Zurück"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Zurück</span>
          </button>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <span>Gruppen</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-panel-elevated text-muted border border-border">
                {teams.length}
              </span>
            </h1>
            <p className="text-xs text-muted mt-0.5">
              Erstelle Gruppen (z. B. Familie, WG oder Projektteam) aus Personen, die du sehen kannst, und teile Notizen, Aufgaben und Listen mit allen auf einmal.
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
          <span>Neue Gruppe</span>
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
              <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-muted hover:text-main text-[11px] cursor-pointer"
          >
            Schließen
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
                <h3 className="font-bold text-sm text-main">Neue Gruppe erstellen</h3>
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
                  Name der Gruppe *
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="z. B. Familie, WG, Arbeit, Projekt X…"
                  required
                  autoFocus
                  className="w-full h-8 px-2.5 input-field text-xs"
                />
              </div>

              <div>
                <label className="block text-muted text-xs mb-1 font-medium">
                  Beschreibung (optional)
                </label>
                <input
                  type="text"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="z. B. Gemeinsame Einkaufslisten & Notizen…"
                  className="w-full h-8 px-2.5 input-field text-xs"
                />
              </div>

              <div className="p-3 bg-canvas border border-border rounded-btn text-[11px] text-muted space-y-1">
                <p className="font-semibold text-main flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-accent" />
                  <span>Du wirst Gruppen-Admin</span>
                </p>
                <p>
                  Als Ersteller kannst du weitere Mitglieder hinzufügen, Rollen zuweisen und die Gruppe verwalten.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-action h-8 px-3 text-xs cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={creating || !newGroupName.trim()}
                  className="btn-primary h-8 px-4 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Gruppe anlegen</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="p-8 text-center text-muted text-xs">Lade Gruppen…</div>
      ) : teams.length === 0 ? (
        <div className="p-10 bg-canvas border border-border rounded-card text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-panel-elevated text-muted mx-auto flex items-center justify-center">
            <Users className="w-6 h-6 text-accent opacity-75" />
          </div>
          <div>
            <h3 className="font-bold text-main text-sm">Noch keine Gruppen vorhanden</h3>
            <p className="text-muted text-xs mt-1 max-w-md mx-auto">
              Erstelle deine erste Gruppe, um Aufgaben, Einkaufslisten oder Dokumente gemeinsam mit anderen zu nutzen.
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
            <span>Erste Gruppe anlegen</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* SECTION 1: Gruppen, die ich verwalte */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-main uppercase tracking-wider text-muted flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-accent" />
                <span>Gruppen, die ich verwalte ({managedTeams.length})</span>
              </h2>
            </div>

            {managedTeams.length === 0 ? (
              <div className="p-4 bg-canvas border border-border rounded-card text-xs text-muted">
                Du bist derzeit noch in keiner Gruppe als Admin eingetragen. Klicke oben auf &quot;Neue Gruppe&quot;, um eine eigene Gruppe zu erstellen.
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
                                placeholder="Gruppenname"
                                className="w-full h-8 px-2.5 input-field text-xs font-bold"
                              />
                              <input
                                type="text"
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                                placeholder="Optionale Beschreibung"
                                className="w-full h-7 px-2.5 input-field text-xs"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(team.id)}
                                  className="btn-primary h-7 px-3 text-[11px] cursor-pointer"
                                >
                                  Speichern
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTeamId(null)}
                                  className="btn-action h-7 px-2.5 text-[11px] cursor-pointer"
                                >
                                  Abbrechen
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
                                  Gruppen-Admin
                                </span>
                                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-panel-elevated text-muted border border-border">
                                  {members.length} {members.length === 1 ? 'Mitglied' : 'Mitglieder'}
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
                              title="Gruppe bearbeiten"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Bearbeiten</span>
                            </button>
                            <button
                              onClick={() => handleDeleteTeam(team)}
                              className="btn-icon btn-icon-danger"
                              title="Gruppe löschen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Members List */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                          Mitglieder ({members.length})
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
                                  <UserAvatar user={{ displayName: m.displayName, email: m.email, avatarUrl: m.avatarUrl }} size="xs" />
                                  <div className="min-w-0">
                                    <p className="text-main font-medium truncate text-xs">
                                      {m.displayName} {isSelf && <span className="text-faint">(Du)</span>}
                                    </p>
                                    <p className="text-[10px] text-muted truncate">
                                      {m.email}
                                    </p>
                                  </div>
                                </div>

                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <select
                                      value={m.role}
                                      onChange={(e) =>
                                        handleChangeMemberRole(
                                          team.id,
                                          m.userId,
                                          e.target.value as 'admin' | 'member'
                                        )
                                      }
                                      className={`h-6 px-1.5 text-[10px] rounded input-field bg-panel cursor-pointer ${
                                        isAdmin
                                          ? 'border-accent text-accent font-semibold'
                                          : 'text-muted'
                                      }`}
                                      title="Rolle ändern"
                                    >
                                      <option value="member" className="bg-panel text-main">Mitglied</option>
                                      <option value="admin" className="bg-panel text-main">Gruppen-Admin</option>
                                    </select>

                                  <button
                                    onClick={() => handleRemoveMember(team.id, m.userId, m.displayName)}
                                    className="p-1 text-faint hover:text-status-err rounded transition-colors cursor-pointer"
                                    title={isSelf ? 'Gruppe verlassen' : 'Mitglied entfernen'}
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
                            placeholder="Benutzer suchen zum Hinzufügen…"
                          />
                        </div>

                        <select
                          value={memberRoleByTeam[team.id] || 'member'}
                          onChange={(e) =>
                            setMemberRoleByTeam((prev) => ({
                              ...prev,
                              [team.id]: e.target.value as 'admin' | 'member',
                            }))
                          }
                          className="h-8 px-2.5 input-field text-xs bg-panel"
                        >
                          <option value="member">Mitglied</option>
                          <option value="admin">Gruppen-Admin</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => handleAddMember(team.id)}
                          disabled={!selectedUserByTeam[team.id]}
                          className="btn-primary h-8 px-3.5 text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Hinzufügen</span>
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
                <span>Meine Mitgliedschaften ({memberTeams.length})</span>
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
                                {members.length} {members.length === 1 ? 'Mitglied' : 'Mitglieder'}
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
                          title="Gruppe verlassen"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Gruppe verlassen</span>
                        </button>
                      </div>

                      {/* Admins & Members list in read-only mode */}
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-muted">
                          Gruppen-Admins:{' '}
                          <span className="text-main font-normal">
                            {admins.map((a) => a.displayName).join(', ') || 'Keiner'}
                          </span>
                        </p>
                        <p className="text-[11px] font-semibold text-muted">
                          Alle Mitglieder:{' '}
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
