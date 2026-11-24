// How the administration shows a row of the audit log (AuditSection): who, what, whom, and the details
// in words ("Rolle: Mitglied → Admin"). Pure functions over the row, the accounts and t.
import type { TFunction } from 'i18next';
import type { AuditEntry, User } from '../../../lib/types';
import { formatDateTime } from '../../../lib/format';
import { scopeChip } from '../../../lib/apiScopes';
import { describeDevice } from '../SessionsPanel';

// The actions the server records (storage/audit.go), in the order of the filter menu
export const AUDIT_ACTIONS = [
  'account.created',
  'account.registered',
  'account.deleted',
  'account.unconfirmed_deleted',
  'account.approved',
  'account.role_changed',
  'account.disabled',
  'account.enabled',
  'account.updated',
  'account.password_reset',
  'account.mfa_reset',
  'account.password_changed',
  'account.totp_disabled',
  'account.passkey_removed',
  'account.recovery_codes_renewed',
  'account.api_key_created',
  'account.api_key_deleted',
  'account.api_key_updated',
  'account.session_ended',
  'account.sessions_revoked',
  'invite.created',
  'invite.sent',
  'invite.redeemed',
  'invite.revoked',
  'organization.created',
  'organization.renamed',
  'organization.deleted',
  'organization.member_added',
  'organization.member_removed',
  'settings.changed',
  'setup.finished',
  'backup.created',
  'backup.deleted',
  'backup.downloaded',
  'backup.restored',
  'backup.restore_failed',
  'backup.taken_over',
  'speech_model.download',
  'speech_model.deleted',
] as const;

// Action keys become i18n keys without dots: account.role_changed → account_role_changed
const actionKey = (action: string) => action.replace(/\./g, '_');

export function actionLabel(t: TFunction, action: string): string {
  return t(`audit.action.${actionKey(action)}`, { defaultValue: action });
}

function nameOf(users: Map<string, User>, id: string | undefined, stored: string | undefined): string | null {
  const u = id ? users.get(id) : undefined;
  if (u) return u.displayName || u.username || stored || null;
  return stored ? stored : null;
}

export function actorLabel(t: TFunction, e: AuditEntry, users: Map<string, User>): string {
  switch (e.actorKind) {
    case 'cli':
      return t('audit.actor.cli');
    case 'oidc':
      return t('audit.actor.oidc');
    case 'system':
      return t('audit.actor.system');
  }
  return nameOf(users, e.actorId, e.actorName) ?? t('audit.deletedAccount');
}

export function targetLabel(t: TFunction, e: AuditEntry, users: Map<string, User>): string {
  switch (e.targetKind) {
    case 'user':
      return nameOf(users, e.targetId, e.targetName) ?? t('audit.deletedAccount');
    case 'settings':
      return t('audit.target.settings');
    case 'invite':
      return e.targetName || t('audit.target.inviteLink');
    case 'organization':
      return e.targetName || t('audit.target.organization');
    case 'backup':
      return e.targetName || t('audit.target.backup');
    case 'speech_model':
      return e.targetName || t('audit.target.speechModel');
  }
  return '–';
}

// A stored value in words: on/off, empty, roles and the modes of the settings
function valueLabel(t: TFunction, key: string, v: unknown): string {
  if (v === true) return t('audit.value.on');
  if (v === false) return t('audit.value.off');
  if (v === null || v === undefined || v === '') return t('audit.value.empty');
  const s = String(v);
  if (key === 'role') return t(`common:role.${s}`, { defaultValue: s });
  if (key === 'sharingMode' || key === 'registrationMode' || key === 'mfaRequired' || key === 'imageQuality' || key === 'audioCompression') {
    return t(`audit.value.${key}.${s.replace('+', '_')}`, { defaultValue: s });
  }
  return s;
}

const settingLabel = (t: TFunction, key: string) => t(`audit.field.${key}`, { defaultValue: key });

interface Change {
  key: string;
  from?: unknown;
  to?: unknown;
  changed?: boolean;
}

// detailLines: the details of a row as short lines, empty when there is nothing to add.
export function detailLines(t: TFunction, e: AuditEntry): string[] {
  const d = (e.details ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  const role = (from: unknown, to: unknown) =>
    t('audit.detail.fromTo', { label: t('audit.field.role'), from: valueLabel(t, 'role', from), to: valueLabel(t, 'role', to) });

  if (Array.isArray(d.changes)) {
    for (const c of d.changes as Change[]) {
      const label = settingLabel(t, c.key);
      lines.push(
        c.changed
          ? t('audit.detail.changed', { label })
          : t('audit.detail.fromTo', { label, from: valueLabel(t, c.key, c.from), to: valueLabel(t, c.key, c.to) })
      );
    }
  }
  switch (e.action) {
    case 'account.role_changed':
      lines.push(role(d.from, d.to));
      break;
    case 'organization.renamed':
      lines.push(t('audit.detail.renamed', { from: String(d.from ?? ''), to: String(d.to ?? '') }));
      break;
    case 'account.created':
      if (d.role) lines.push(t('audit.detail.value', { label: t('audit.field.role'), value: valueLabel(t, 'role', d.role) }));
      break;
    case 'speech_model.download':
      if (d.select === true) lines.push(t('audit.detail.speechModelSelect'));
      break;
    // What a person did to their own account: the key or passkey by name, never a secret
    case 'account.api_key_created':
    case 'account.api_key_deleted':
    case 'account.api_key_updated':
    case 'account.passkey_removed':
      if (typeof d.name === 'string' && d.name) lines.push(t('audit.detail.value', { label: t('audit.field.name'), value: d.name }));
      if (d.kind === 'oauth') lines.push(t('audit.detail.aiConnection'));
      if (Array.isArray(d.scopes) && d.scopes.length > 0) {
        lines.push(t('audit.detail.value', { label: t('audit.field.scopes'), value: (d.scopes as string[]).map(scopeChip).join(', ') }));
      }
      if (typeof d.previousName === 'string') {
        lines.push(t('audit.detail.value', { label: t('audit.field.previousName'), value: d.previousName }));
      }
      if (Array.isArray(d.previousScopes)) {
        lines.push(t('audit.detail.value', { label: t('audit.field.previousScopes'), value: (d.previousScopes as string[]).map(scopeChip).join(', ') }));
      }
      break;
    case 'account.session_ended':
      if (typeof d.device === 'string' && d.device) {
        lines.push(t('audit.detail.value', { label: t('audit.field.device'), value: describeDevice(d.device).label }));
      }
      break;
  }
  if (d.via === 'emailLink') lines.push(t('audit.detail.viaEmailLink'));
  if (d.mfaOff) lines.push(t('audit.detail.mfaOff'));
  if (typeof d.group === 'string' && d.group) {
    lines.push(t('audit.detail.value', { label: t('audit.field.group'), value: d.group }));
  }
  if (Array.isArray(d.organizations) && d.organizations.length > 0) {
    lines.push(t('audit.detail.value', { label: t('audit.field.organizations'), value: (d.organizations as string[]).join(', ') }));
  }
  if (typeof d.organization === 'string' && d.organization) {
    lines.push(t('audit.detail.value', { label: t('audit.field.organization'), value: d.organization }));
  }
  if (typeof d.provider === 'string' && d.provider) {
    lines.push(t('audit.detail.value', { label: t('audit.field.provider'), value: d.provider }));
  }
  if (d.via === 'ADMIN_USER') lines.push(t('audit.detail.viaEnv'));
  if (typeof d.email === 'string' && d.email) {
    lines.push(t('audit.detail.value', { label: t('audit.field.recipient'), value: d.email }));
  }
  if (typeof d.maxUses === 'number') {
    lines.push(t('audit.detail.value', { label: t('audit.field.maxUses'), value: String(d.maxUses) }));
  }
  if (typeof d.expiresAt === 'string' && d.expiresAt) {
    lines.push(t('audit.detail.value', { label: t('audit.field.expiresAt'), value: formatDateTime(d.expiresAt) }));
  }
  if (typeof d.account === 'string' && d.account) {
    lines.push(t('audit.detail.value', { label: t('audit.field.account'), value: d.account }));
  }
  if (typeof d.invitedBy === 'string' && d.invitedBy) {
    lines.push(t('audit.detail.value', { label: t('audit.field.invitedBy'), value: d.invitedBy }));
  }
  if (d.emailConfirmation) lines.push(t('audit.detail.emailConfirmation'));
  if (d.awaitingApproval) lines.push(t('audit.detail.awaitingApproval'));
  if (e.action === 'account.unconfirmed_deleted') lines.push(t('audit.detail.unconfirmedDeleted'));
  if (d.mustChange) lines.push(t('audit.detail.mustChange'));
  if (typeof d.keysRevoked === 'number') {
    lines.push(t('audit.detail.keysRevoked', { keys: d.keysRevoked, connections: d.connectionsRevoked ?? 0 }));
  }
  if (d.calendarFeedRevoked) lines.push(t('audit.detail.calendarFeedRevoked'));
  if (d.secondFactorsRemoved) lines.push(t('audit.detail.secondFactorsRemoved'));
  if (d.pendingRegistration) lines.push(t('audit.detail.pendingRegistration'));
  if (typeof d.notes === 'number') {
    lines.push(t('audit.detail.content', { notes: d.notes, tasks: d.tasks ?? 0, lists: d.lists ?? 0 }));
  }
  if (typeof d.file === 'string') {
    lines.push(t('audit.detail.value', { label: t('audit.field.file'), value: d.file }));
  }
  return lines;
}
