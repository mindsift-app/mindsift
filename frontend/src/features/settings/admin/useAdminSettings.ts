import React, { useEffect, useState } from 'react';
import i18n from '../../../i18n';
import { Organization, SharingMode, SystemSettings, User, UserInvite, UserRole } from '../../../lib/types';
import { api, setCurrentPeopleSearch, setCurrentSharingMode, triggerHaptic } from '../../../lib/api';
import { passwordProblem } from '../../../lib/password';
import { DEFAULT_BACKUP_RETENTION_DAYS, DEFAULT_BACKUP_TIME } from '../../../lib/backupDefaults';
import { askConfirm } from '../../../components/askConfirm';
import { errorMessage } from '../../../lib/errorMessage';
import { setServerLinkPreviews } from '../../../lib/linkPreview';

// The three sharing modes, stricter first; texts in settings:sharing.<id> in the language shown when read
const sharingMode = (id: SharingMode) => ({
  id,
  get title() {
    return i18n.t(`settings:sharing.${id}.title`);
  },
  get text() {
    return i18n.t(`settings:sharing.${id}.text`);
  },
});
export const SHARING_MODES = [sharingMode('private'), sharingMode('organizations'), sharingMode('open')];
// Stricter modes come first; switching to a stricter one can remove shares
export const modeRank = (m: SharingMode) => SHARING_MODES.findIndex((x) => x.id === m);

// State and actions of the administration: users and invites, organizations, server and mail settings.
// The sections share it (users show their organization, everything loads together), so it lives in one hook.
export function useAdminSettings(currentUser: User, isServerAdmin: boolean) {
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('member');
  // Organizations a new account or invite joins (a person can be in several)
  const [newUserOrgs, setNewUserOrgs] = useState<string[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteOrgs, setInviteOrgs] = useState<string[]>([]);
  // A link for several people (1 = classic single-use code)
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  // "Per E-Mail einladen": which invite the address field is open for
  const [mailInviteId, setMailInviteId] = useState<string | null>(null);
  const [mailInviteTo, setMailInviteTo] = useState('');
  const [mailInviteBusy, setMailInviteBusy] = useState(false);

  // --- Organizations State ---
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [newOrgName, setNewOrgName] = useState('');
  const [renamingOrgId, setRenamingOrgId] = useState<string | null>(null);
  const [renameOrgVal, setRenameOrgVal] = useState('');
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
  // The organization opened to manage its members
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  // Taking someone out of an organization that costs shares asks first (affected: what would go)
  const [pendingRemoval, setPendingRemoval] = useState<{ orgId: string; user: User; affected: number } | null>(null);
  // The server's sharing mode, also for user managers (they cannot read the server settings)
  const [sharingMode, setSharingMode] = useState<SharingMode>('organizations');
  const [pendingMode, setPendingMode] = useState<{ mode: SharingMode; affected: number } | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [resetPwdVal, setResetPwdVal] = useState('');

  // --- Server & SMTP Settings State ---
  const [settings, setSettings] = useState<SystemSettings>({
    sharingMode: 'organizations',
    allowRegistration: false,
    instanceName: 'MindSift',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    smtpFromName: '',
    smtpTls: true,
    smtpSkipVerify: false,
    smtpConfiguredViaEnv: false,
  });
  const [testSmtpEmail, setTestSmtpEmail] = useState(currentUser.email || '');
  const [testingSmtp, setTestingSmtp] = useState(false);

  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadAll = async () => {
    try {
      const [uList, invList, orgs] = await Promise.all([
        api.adminGetUsers(),
        api.adminGetInvites(),
        api.adminGetOrganizations(),
      ]);
      setUsers(uList);
      setInvites(invList);
      setOrganizations(orgs);

      if (isServerAdmin) {
        const sys = await api.adminGetSettings();
        setSettings({
          sharingMode: sys.sharingMode || 'organizations',
          allowRegistration: Boolean(sys.allowRegistration),
          registrationMode: sys.registrationMode || (sys.allowRegistration ? 'open' : 'closed'),
          registrationDomains: sys.registrationDomains || '',
          registrationConfiguredViaEnv: Boolean(sys.registrationConfiguredViaEnv),
          registrationVerifyEmail: Boolean(sys.registrationVerifyEmail),
          registrationVerifyConfiguredViaEnv: Boolean(sys.registrationVerifyConfiguredViaEnv),
          emailLinksAvailable: Boolean(sys.emailLinksAvailable),
          instanceName: sys.instanceName || 'MindSift',
          smtpHost: sys.smtpHost || '',
          smtpPort: sys.smtpPort ? String(sys.smtpPort) : '587',
          smtpUser: sys.smtpUser || '',
          smtpPass: sys.smtpPass || '',
          smtpPassSet: Boolean(sys.smtpPassSet),
          smtpPassUnreadable: Boolean(sys.smtpPassUnreadable),
          smtpFrom: sys.smtpFrom || '',
          smtpFromName: sys.smtpFromName || '',
          smtpTls: sys.smtpTls ?? true,
          smtpSkipVerify: Boolean(sys.smtpSkipVerify),
          allowPrivateWebhooks: Boolean(sys.allowPrivateWebhooks),
          pushKnownServicesOnly: Boolean(sys.pushKnownServicesOnly),
          mfaRequired: sys.mfaRequired || '',
          smtpConfiguredViaEnv: Boolean(sys.smtpConfiguredViaEnv),
          backupEnabled: Boolean(sys.backupEnabled),
          backupTime: sys.backupTime || DEFAULT_BACKUP_TIME,
          backupRetentionDays: sys.backupRetentionDays || DEFAULT_BACKUP_RETENTION_DAYS,
          retentionAllowNever: sys.retentionAllowNever ?? true,
          retentionNeverViaEnv: Boolean(sys.retentionNeverViaEnv),
          mcpEnabled: sys.mcpEnabled ?? true,
          mcpConfiguredViaEnv: Boolean(sys.mcpConfiguredViaEnv),
          peopleSearch: sys.peopleSearch ?? true,
          peopleSearchConfiguredViaEnv: Boolean(sys.peopleSearchConfiguredViaEnv),
          publicLinks: sys.publicLinks ?? true,
          publicLinksConfiguredViaEnv: Boolean(sys.publicLinksConfiguredViaEnv),
          publicLinkMaxDays: sys.publicLinkMaxDays || 14,
          publicLinkMaxDaysConfiguredViaEnv: Boolean(sys.publicLinkMaxDaysConfiguredViaEnv),
          linkPreviews: sys.linkPreviews ?? true,
          // Shown only (OIDC_* environment)
          oidc: sys.oidc,
          timeZone: sys.timeZone ?? '',
          serverTime: sys.serverTime,
        });
      }
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:admin.loadFailed')) });
    }
  };

  // Read-only in the public demo (FLAW-33)
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    // Loads the settings when the administration opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
    api
      .getAuthStatus()
      .then((st) => {
        setDemoMode(Boolean(st.demoMode));
        if (st.sharingMode) setSharingMode(st.sharingMode);
      })
      .catch(() => {});
    // Loaded once when the administration opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // HANDLERS: USERS & INVITES
  // ============================================================================
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    const problem = passwordProblem(newUserPassword);
    if (problem) {
      setStatusMsg({ type: 'err', text: problem });
      return;
    }
    triggerHaptic(15);
    try {
      const created = await api.adminCreateUser({
        email: newUserEmail.trim(),
        password: newUserPassword,
        // Left empty, the server uses the new account's username
        displayName: newUserName.trim(),
        role: isServerAdmin ? newUserRole : 'member',
        organizationIds: newUserOrgs,
      });
      setUsers((prev) => [...prev, created]);
      if (newUserOrgs.length > 0) await reloadOrganizations();
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('member');
      setNewUserOrgs([]);
      setStatusMsg({ type: 'ok', text: i18n.t('settings:admin.userCreated', { name: created.displayName }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:users.create.failed')) });
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    triggerHaptic(15);
    try {
      const inv = await api.adminCreateInvite({
        email: inviteMaxUses > 1 ? '' : inviteEmail.trim(),
        organizationIds: inviteOrgs,
        maxUses: inviteMaxUses,
      });
      setInvites((prev) => [inv, ...prev]);
      setInviteEmail('');
      setStatusMsg({
        type: 'ok',
        text:
          inv.maxUses > 1
            ? i18n.t('settings:users.invite.linkCreated', { count: inv.maxUses, code: inv.code })
            : i18n.t('settings:users.invite.codeCreated', { code: inv.code }),
      });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:users.invite.failed')) });
    }
  };

  const handleDeleteInvite = async (id: string) => {
    try {
      await api.adminDeleteInvite(id);
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  // Copies the code or the link that opens the sign-up form with the code filled in
  const inviteLink = (inv: UserInvite) => `${window.location.origin}/?invite=${encodeURIComponent(inv.code)}`;
  const [copiedWhat, setCopiedWhat] = useState<'code' | 'link'>('code');
  const handleCopyInvite = (inv: UserInvite, what: 'code' | 'link') => {
    navigator.clipboard.writeText(what === 'link' ? inviteLink(inv) : inv.code);
    setCopiedWhat(what);
    setCopiedInviteId(inv.id);
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  const handleSendInvite = async (inv: UserInvite) => {
    if (!mailInviteTo.trim()) return;
    setMailInviteBusy(true);
    setStatusMsg(null);
    try {
      const updated = await api.adminSendInvite(inv.id, mailInviteTo.trim());
      setInvites((prev) => prev.map((i) => (i.id === inv.id ? { ...i, ...updated } : i)));
      setStatusMsg({ type: 'ok', text: i18n.t('settings:admin.inviteSent', { email: mailInviteTo.trim() }) });
      setMailInviteId(null);
      setMailInviteTo('');
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:users.invite.mailFailed')) });
    } finally {
      setMailInviteBusy(false);
    }
  };

  // Registrations waiting for approval (registration mode "Mit Freigabe")
  const handleApproveUser = async (u: User) => {
    setStatusMsg(null);
    try {
      const updated = await api.adminApproveUser(u.id);
      setUsers((prev) => prev.map((item) => (item.id === u.id ? { ...updated, pendingApproval: false } : item)));
      setStatusMsg({ type: 'ok', text: i18n.t('settings:admin.userApproved', { name: u.displayName }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  const handleChangeUserRole = async (u: User, role: UserRole) => {
    setStatusMsg(null);
    try {
      const updated = await api.adminUpdateUser(u.id, { role });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
      setStatusMsg({
        type: 'ok',
        text: i18n.t('settings:users.roleChanged', { name: updated.displayName, role: i18n.t(`common:role.${role}`) }),
      });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  // Username for signing in, set by an admin (the person can change it in the profile, too)
  const [usernameEdit, setUsernameEdit] = useState<{ id: string; value: string } | null>(null);
  const handleSaveUsername = async (u: User) => {
    if (!usernameEdit || usernameEdit.id !== u.id) return;
    setStatusMsg(null);
    try {
      const updated = await api.adminUpdateUser(u.id, { username: usernameEdit.value.trim().toLowerCase() });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
      setUsernameEdit(null);
      setStatusMsg({ type: 'ok', text: i18n.t('settings:users.usernameChanged', { name: updated.displayName, username: updated.username }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  const handleToggleUserActive = async (u: User) => {
    setStatusMsg(null);
    try {
      const updated = await api.adminUpdateUser(u.id, { isActive: !u.isActive });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  const handleConfirmResetPassword = async (userId: string) => {
    if (!resetPwdVal.trim()) return;
    setStatusMsg(null);
    const problem = passwordProblem(resetPwdVal);
    if (problem) {
      setStatusMsg({ type: 'err', text: problem });
      return;
    }
    try {
      // Not trimmed: login compares the password exactly as typed
      await api.adminResetPassword(userId, resetPwdVal);
      setResetPwdUserId(null);
      setResetPwdVal('');
      setStatusMsg({ type: 'ok', text: i18n.t('settings:users.passwordReset') });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  const handleDeleteUser = async (u: User) => {
    const ok = await askConfirm({
      message: u.pendingApproval
        ? i18n.t('settings:users.confirmReject', { name: u.displayName, email: u.email })
        : i18n.t('settings:users.confirmDelete', { name: u.displayName, email: u.email }),
      confirmLabel: u.pendingApproval ? i18n.t('settings:users.reject') : i18n.t('common:delete'),
      danger: true,
    });
    if (!ok) return;
    setStatusMsg(null);
    try {
      await api.adminDeleteUser(u.id);
      setUsers((prev) => prev.filter((item) => item.id !== u.id));
      setStatusMsg({ type: 'ok', text: i18n.t('settings:users.deleted') });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };



  // Somebody lost every second factor: they sign in with the password alone again and are told by mail
  const handleResetMfa = async (u: User) => {
    const ok = await askConfirm({
      message: i18n.t('settings:users.confirmResetMfa', { name: u.displayName }),
      confirmLabel: i18n.t('settings:users.resetMfa'),
      danger: true,
    });
    if (!ok) return;
    setStatusMsg(null);
    try {
      await api.adminResetMfa(u.id);
      setUsers((prev) => prev.map((item) => (item.id === u.id ? { ...item, mfaEnabled: false } : item)));
      setStatusMsg({ type: 'ok', text: i18n.t('settings:users.mfaReset', { name: u.displayName }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err) });
    }
  };

  // ============================================================================
  // HANDLERS: SERVER & SMTP SETTINGS
  // ============================================================================
  // ============================================================================
  // HANDLERS: ORGANIZATIONS
  // ============================================================================
  const reloadOrganizations = async () => {
    try {
      setOrganizations(await api.adminGetOrganizations());
    } catch {
      // keep the old list
    }
  };

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    try {
      await api.adminCreateOrganization(newOrgName.trim());
      setNewOrgName('');
      await reloadOrganizations();
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:orgs.createFailed')) });
    }
  };

  const handleRenameOrganization = async (orgId: string) => {
    try {
      await api.adminRenameOrganization(orgId, renameOrgVal.trim());
      setRenamingOrgId(null);
      await reloadOrganizations();
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:orgs.renameFailed')) });
    }
  };

  const handleDeleteOrganization = async (orgId: string) => {
    try {
      await api.adminDeleteOrganization(orgId);
      setDeletingOrgId(null);
      setUsers((prev) => prev.map((u) => ({ ...u, organizationIds: (u.organizationIds || []).filter((id) => id !== orgId) })));
      await reloadOrganizations();
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:orgs.deleteFailed')) });
    }
  };

  const setUserOrgs = (userId: string, change: (ids: string[]) => string[]) =>
    setUsers((prev) => prev.map((x) => (x.id === userId ? { ...x, organizationIds: change(x.organizationIds || []) } : x)));

  const handleAddOrgMember = async (orgId: string, u: User) => {
    try {
      await api.adminAddOrganizationMember(orgId, u.id);
      setUserOrgs(u.id, (ids) => (ids.includes(orgId) ? ids : [...ids, orgId]));
      await reloadOrganizations();
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:orgs.assignFailed')) });
    }
  };

  // Removes at once when nothing is lost; otherwise asks first and says how much would go
  const handleRemoveOrgMember = async (orgId: string, u: User, confirmed = false) => {
    try {
      if (!confirmed) {
        const affected = await api.adminRemoveOrganizationMember(orgId, u.id, true);
        if (affected > 0) {
          setPendingRemoval({ orgId, user: u, affected });
          return;
        }
      }
      setPendingRemoval(null);
      await api.adminRemoveOrganizationMember(orgId, u.id);
      setUserOrgs(u.id, (ids) => ids.filter((id) => id !== orgId));
      await reloadOrganizations();
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:orgs.assignFailed')) });
    }
  };

  const orgName = (id?: string) => organizations.find((o) => o.id === id)?.name || '';

  // Tightening the mode first asks how much sharing would be lost
  const handleSelectSharingMode = async (mode: SharingMode) => {
    if (mode === settings.sharingMode) return;
    if (modeRank(mode) < modeRank(settings.sharingMode)) {
      try {
        const affected = await api.adminSharingImpact(mode);
        if (affected > 0) {
          setPendingMode({ mode, affected });
          return;
        }
      } catch {
        // fall through and save
      }
    }
    setPendingMode(null);
    handleSaveSystemSettings({ sharingMode: mode });
  };

  const handleSaveSystemSettings = async (patch?: Partial<SystemSettings>) => {
    setStatusMsg(null);
    const next = { ...settings, ...(patch || {}) };
    setSettings(next);
    try {
      const saved = await api.adminUpdateSettings(next);
      // The password flags are left out of the answer when false, so they are set, not merged
      setSettings((prev) => ({
        ...prev,
        ...saved,
        smtpPassSet: Boolean(saved.smtpPassSet),
        smtpPassUnreadable: Boolean(saved.smtpPassUnreadable),
      }));
      setCurrentSharingMode(saved.sharingMode);
      setSharingMode(saved.sharingMode);
      if (saved.peopleSearch !== undefined) setCurrentPeopleSearch(saved.peopleSearch);
      // This app follows the server's switch at once (others at their next start or preview request)
      if (saved.linkPreviews !== undefined) setServerLinkPreviews(saved.linkPreviews);
      setStatusMsg({ type: 'ok', text: i18n.t('settings:server.saved') });
    } catch (err) {
      setStatusMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:profile.saveFailed')) });
    }
  };

  const handleTestSmtp = async () => {
    if (!testSmtpEmail.trim()) return;
    setTestingSmtp(true);
    setStatusMsg(null);
    try {
      await api.adminUpdateSettings(settings);
      await api.adminTestSMTP(testSmtpEmail.trim());
      setStatusMsg({ type: 'ok', text: i18n.t('settings:smtp.testSent', { email: testSmtpEmail.trim() }) });
    } catch (err) {
      setStatusMsg({ type: 'err', text: i18n.t('settings:smtp.testFailed', { error: errorMessage(err) }) });
    } finally {
      setTestingSmtp(false);
    }
  };

  return {
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
    newOrgName,
    renamingOrgId,
    renameOrgVal,
    deletingOrgId,
    openOrgId,
    setOpenOrgId,
    pendingRemoval,
    setPendingRemoval,
    sharingMode,
    pendingMode,
    copiedInviteId,
    resetPwdUserId,
    usernameEdit,
    setUsernameEdit,
    handleSaveUsername,
    resetPwdVal,
    settings,
    testSmtpEmail,
    testingSmtp,
    statusMsg,
    demoMode,
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
    handleResetMfa,
    handleCreateOrganization,
    handleRenameOrganization,
    handleDeleteOrganization,
    handleAddOrgMember,
    handleRemoveOrgMember,
    orgName,
    handleSelectSharingMode,
    handleSaveSystemSettings,
    handleTestSmtp,
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
    setNewOrgName,
    setRenamingOrgId,
    setRenameOrgVal,
    setDeletingOrgId,
    setPendingMode,
    setResetPwdUserId,
    setResetPwdVal,
    setSettings,
    setTestSmtpEmail,
    setStatusMsg,
  };
}
