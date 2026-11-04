import React, { useEffect, useState } from 'react';
import i18n from '../../../i18n';
import { Organization, SharingMode, SystemSettings, User, UserInvite, UserRole } from '../../../lib/types';
import { api, setCurrentSharingMode, triggerHaptic } from '../../../lib/api';
import { passwordProblem } from '../../../lib/password';
import { askConfirm } from '../../../components/askConfirm';

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
  const [newUserOrg, setNewUserOrg] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [inviteOrg, setInviteOrg] = useState('');
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
  // Moving someone out of an organization removes their shares there, so it needs a confirmation
  const [pendingMove, setPendingMove] = useState<{ user: User; orgId: string } | null>(null);
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
      const [uList, invList] = await Promise.all([
        api.adminGetUsers(),
        api.adminGetInvites(),
      ]);
      setUsers(uList);
      setInvites(invList);

      if (isServerAdmin) {
        const [sys, orgs] = await Promise.all([api.adminGetSettings(), api.adminGetOrganizations()]);
        setOrganizations(orgs);
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
          smtpFrom: sys.smtpFrom || '',
          smtpFromName: sys.smtpFromName || '',
          smtpTls: sys.smtpTls ?? true,
          smtpSkipVerify: Boolean(sys.smtpSkipVerify),
          allowPrivateWebhooks: Boolean(sys.allowPrivateWebhooks),
          smtpConfiguredViaEnv: Boolean(sys.smtpConfiguredViaEnv),
          backupEnabled: Boolean(sys.backupEnabled),
          backupTime: sys.backupTime || '03:00',
          backupRetentionDays: sys.backupRetentionDays || 3,
          retentionAllowNever: sys.retentionAllowNever ?? true,
          retentionNeverViaEnv: Boolean(sys.retentionNeverViaEnv),
          mcpEnabled: sys.mcpEnabled ?? true,
          mcpConfiguredViaEnv: Boolean(sys.mcpConfiguredViaEnv),
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:admin.loadFailed') });
    }
  };

  // Read-only in the public demo (FLAW-33)
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    loadAll();
    api
      .getAuthStatus()
      .then((st) => setDemoMode(Boolean(st.demoMode)))
      .catch(() => {});
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
        displayName: newUserName.trim() || newUserEmail.split('@')[0],
        role: newUserRole,
        organizationId: newUserOrg || undefined,
      });
      setUsers((prev) => [...prev, created]);
      if (newUserOrg) await reloadOrganizations();
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('member');
      setStatusMsg({ type: 'ok', text: i18n.t('settings:admin.userCreated', { name: created.displayName }) });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:users.create.failed') });
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    triggerHaptic(15);
    try {
      const inv = await api.adminCreateInvite({
        email: inviteMaxUses > 1 ? '' : inviteEmail.trim(),
        role: inviteRole,
        organizationId: inviteOrg || undefined,
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:users.invite.failed') });
    }
  };

  const handleDeleteInvite = async (id: string) => {
    try {
      await api.adminDeleteInvite(id);
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message });
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:users.invite.mailFailed') });
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message });
    }
  };

  const handleChangeUserRole = async (u: User, role: UserRole) => {
    setStatusMsg(null);
    try {
      const updated = await api.adminUpdateUser(u.id, { role });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
      setStatusMsg({
        type: 'ok',
        text: i18n.t('settings:users.roleChanged', { name: updated.displayName, role }),
      });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message });
    }
  };

  const handleToggleUserActive = async (u: User) => {
    setStatusMsg(null);
    try {
      const updated = await api.adminUpdateUser(u.id, { isActive: !u.isActive });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message });
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message });
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message });
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
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:orgs.createFailed') });
    }
  };

  const handleRenameOrganization = async (orgId: string) => {
    try {
      await api.adminRenameOrganization(orgId, renameOrgVal.trim());
      setRenamingOrgId(null);
      await reloadOrganizations();
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:orgs.renameFailed') });
    }
  };

  const handleDeleteOrganization = async (orgId: string) => {
    try {
      await api.adminDeleteOrganization(orgId);
      setDeletingOrgId(null);
      setUsers((prev) => prev.map((u) => (u.organizationId === orgId ? { ...u, organizationId: '' } : u)));
      await reloadOrganizations();
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:orgs.deleteFailed') });
    }
  };

  const applyUserOrganization = async (u: User, orgId: string) => {
    setPendingMove(null);
    try {
      await api.adminSetUserOrganization(u.id, orgId);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, organizationId: orgId } : x)));
      await reloadOrganizations();
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:orgs.assignFailed') });
    }
  };

  const handleChangeUserOrganization = (u: User, orgId: string) => {
    if (u.organizationId) setPendingMove({ user: u, orgId });
    else applyUserOrganization(u, orgId);
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
      setSettings((prev) => ({ ...prev, ...saved }));
      setCurrentSharingMode(saved.sharingMode);
      setStatusMsg({ type: 'ok', text: i18n.t('settings:server.saved') });
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err.message || i18n.t('settings:profile.saveFailed') });
    }
  };

  const handleTestSmtp = async () => {
    if (!testSmtpEmail.trim()) return;
    setTestingSmtp(true);
    setStatusMsg(null);
    try {
      await api.adminUpdateSettings(settings);
      await api.adminTestSMTP(testSmtpEmail.trim());
      setStatusMsg({
        type: 'ok',
        text: `Test-E-Mail erfolgreich an ${testSmtpEmail.trim()} gesendet!`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: `SMTP-Test fehlgeschlagen: ${err.message}`,
      });
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
    newUserOrg,
    inviteEmail,
    inviteRole,
    inviteOrg,
    inviteMaxUses,
    mailInviteId,
    mailInviteTo,
    mailInviteBusy,
    organizations,
    newOrgName,
    renamingOrgId,
    renameOrgVal,
    deletingOrgId,
    pendingMove,
    pendingMode,
    copiedInviteId,
    resetPwdUserId,
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
    handleCreateOrganization,
    handleRenameOrganization,
    handleDeleteOrganization,
    applyUserOrganization,
    handleChangeUserOrganization,
    orgName,
    handleSelectSharingMode,
    handleSaveSystemSettings,
    handleTestSmtp,
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
    setNewOrgName,
    setRenamingOrgId,
    setRenameOrgVal,
    setDeletingOrgId,
    setPendingMove,
    setPendingMode,
    setResetPwdUserId,
    setResetPwdVal,
    setSettings,
    setTestSmtpEmail,
    setStatusMsg,
  };
}
