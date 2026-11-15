import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18n from '../../../i18n';
import { AuditSection } from '../admin/AuditSection';
import { detailLines } from '../admin/auditView';
import type { AuditEntry, AuditPage, User } from '../../../lib/types';

const adminGetAudit = vi.fn<(p: { action?: string; user?: string; before?: number; limit?: number }) => Promise<AuditPage>>();
vi.mock('../../../lib/api', () => ({
  api: { adminGetAudit: (p: { action?: string; user?: string; before?: number; limit?: number }) => adminGetAudit(p) },
  triggerHaptic: vi.fn(),
}));

const users = [
  { id: 'u-admin', username: 'admin', displayName: 'Sandra Admin', email: 'admin@example.com', role: 'admin' },
  { id: 'u-anna', username: 'anna', displayName: 'Anna Berg', email: 'anna@example.com', role: 'member' },
] as unknown as User[];

const row = (e: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  at: '2026-11-15T09:30:00Z',
  actorKind: 'user',
  actorId: 'u-admin',
  actorName: 'admin',
  action: 'account.role_changed',
  targetKind: 'user',
  targetId: 'u-anna',
  targetName: 'anna',
  source: 'web',
  ...e,
});

const t = i18n.getFixedT('de', 'settings');

describe('audit log details in words', () => {
  it('role, settings with secrets only as changed, and the command line', () => {
    expect(detailLines(t, row({ details: { from: 'member', to: 'admin' } }))).toEqual(['Rolle: Mitglied → Server-Admin']);
    expect(
      detailLines(
        t,
        row({
          action: 'settings.changed',
          targetKind: 'settings',
          details: {
            changes: [
              { key: 'instanceName', from: 'MindSift', to: 'Unser Server' },
              { key: 'mcpEnabled', from: true, to: false },
              { key: 'sharingMode', from: 'organizations', to: 'open' },
              { key: 'smtpPass', changed: true },
              { key: 'timeZone', from: '', to: 'Europe/Berlin' },
            ],
          },
        })
      )
    ).toEqual([
      'Name der Instanz: MindSift → Unser Server',
      'KI-Agenten (MCP): an → aus',
      'Teilen: Innerhalb der Organisationen → Offen',
      'SMTP-Passwort: geändert',
      'Zeitzone: (leer) → Europe/Berlin',
    ]);
    expect(detailLines(t, row({ action: 'account.password_reset', actorKind: 'cli', details: { secondFactorsRemoved: true } }))).toEqual([
      'Zweite Faktoren entfernt',
    ]);
    expect(detailLines(t, row({ action: 'organization.renamed', targetKind: 'organization', details: { from: 'A', to: 'B' } }))).toEqual([
      '„A“ → „B“',
    ]);
  });

  it('password reset with its switches, sign-ups, redeemed invites and accounts deleted unconfirmed', () => {
    expect(
      detailLines(t, row({ action: 'account.password_reset', details: { mustChange: true, keysRevoked: 2, connectionsRevoked: 1 } }))
    ).toEqual(['Neues Passwort bei der nächsten Anmeldung verlangt', '2 API-Schlüssel und 1 KI-Zugänge widerrufen']);
    expect(detailLines(t, row({ action: 'account.registered', details: { awaitingApproval: true, emailConfirmation: true } }))).toEqual([
      'Wartet auf Bestätigung der E-Mail-Adresse',
      'Wartet auf Freigabe',
    ]);
    expect(
      detailLines(
        t,
        row({ action: 'invite.redeemed', targetKind: 'invite', details: { account: 'gast', invitedBy: 'admin', organizations: ['Gäste'] } })
      )
    ).toEqual(['Organisationen: Gäste', 'Konto: gast', 'Eingeladen von: admin']);
    expect(detailLines(t, row({ action: 'account.unconfirmed_deleted', actorKind: 'system' }))).toEqual([
      'E-Mail-Adresse nicht innerhalb von 48 Stunden bestätigt',
    ]);
  });
});

describe('AuditSection (Administration → Protokoll)', () => {
  beforeEach(() => {
    adminGetAudit.mockReset();
  });

  it('shows who did what to whom, filters by action and account, and loads older rows', async () => {
    adminGetAudit.mockResolvedValueOnce({
      entries: [
        row({ id: 3 }),
        row({ id: 2, action: 'account.created', actorKind: 'cli', actorId: '', actorName: '', details: { role: 'member' } }),
        row({ id: 1, action: 'account.deleted', targetId: 'u-gone', targetName: 'carl' }),
      ],
      nextBefore: 1,
    });
    render(<AuditSection users={users} />);

    const table = await screen.findByRole('table', { name: 'Protokoll' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header and three rows
    expect(rows[1].textContent).toContain('Sandra Admin');
    expect(rows[1].textContent).toContain('Rolle geändert');
    expect(rows[1].textContent).toContain('Anna Berg');
    expect(rows[2].textContent).toContain('Kommandozeile');
    expect(rows[2].textContent).toContain('Rolle: Mitglied');
    // A deleted account keeps the name it had
    expect(rows[3].textContent).toContain('carl');
    expect(adminGetAudit).toHaveBeenLastCalledWith({ action: undefined, user: undefined, before: undefined, limit: 50 });

    // Older rows are added below
    adminGetAudit.mockResolvedValueOnce({ entries: [row({ id: 0, action: 'invite.created', targetKind: 'invite', targetName: '' })], nextBefore: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Ältere Einträge laden' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(5));
    expect(adminGetAudit).toHaveBeenLastCalledWith({ action: undefined, user: undefined, before: 1, limit: 50 });
    expect(screen.queryByRole('button', { name: 'Ältere Einträge laden' })).toBeNull();
    expect(table.textContent).toContain('Einladungslink');

    // Filter by action: the list starts again from the newest
    adminGetAudit.mockResolvedValueOnce({ entries: [], nextBefore: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Aktion' }));
    fireEvent.click(screen.getByRole('option', { name: 'Konto gelöscht' }));
    await screen.findByText('Keine Einträge für diesen Filter.');
    expect(adminGetAudit).toHaveBeenLastCalledWith({ action: 'account.deleted', user: undefined, before: undefined, limit: 50 });

    adminGetAudit.mockResolvedValueOnce({ entries: [row({ id: 3 })], nextBefore: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Konto' }));
    fireEvent.click(screen.getByRole('option', { name: /Anna Berg/ }));
    await waitFor(() =>
      expect(adminGetAudit).toHaveBeenLastCalledWith({ action: 'account.deleted', user: 'u-anna', before: undefined, limit: 50 })
    );
  });

  it('phones get one card per row', async () => {
    adminGetAudit.mockResolvedValueOnce({ entries: [row({ id: 3 })], nextBefore: 0 });
    render(<AuditSection users={users} />);
    const cards = await screen.findByRole('list', { name: 'Protokoll' });
    const card = within(cards).getAllByRole('listitem')[0];
    expect(card.textContent).toContain('Rolle geändert');
    expect(card.textContent).toContain('Betroffen: Anna Berg');
    expect(card.textContent).toContain('Wer: Sandra Admin');
  });
});
