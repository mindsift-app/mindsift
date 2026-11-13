import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UserList } from '../admin/UserList';
import { UsersSection } from '../admin/UsersSection';
import { useAdminSettings } from '../admin/useAdminSettings';
import { Organization, User } from '../../../lib/types';

type Admin = ReturnType<typeof useAdminSettings>;

const person = (i: number, extra: Partial<User> = {}): User => ({
  id: `usr_${i}`,
  displayName: `Person ${String(i).padStart(3, '0')}`,
  email: `person${i}@beispiel.de`,
  username: `person${i}`,
  role: 'member',
  isActive: true,
  createdAt: '2026-11-01T08:00:00Z',
  organizationIds: ['org_v'],
  ...extra,
});

const me = person(0, { displayName: 'Chef', role: 'admin' });
const organizations: Organization[] = [{ id: 'org_v', name: 'Vertrieb', memberCount: 1 } as Organization];

function fakeAdmin(users: User[], extra: Partial<Admin> = {}): Admin {
  return {
    users,
    organizations,
    sharingMode: 'organizations',
    orgName: (id?: string) => organizations.find((o) => o.id === id)?.name || '',
    usernameEdit: null,
    setUsernameEdit: vi.fn(),
    handleSaveUsername: vi.fn(),
    resetPwdUserId: null,
    setResetPwdUserId: vi.fn(),
    resetPwdVal: '',
    setResetPwdVal: vi.fn(),
    handleChangeUserRole: vi.fn(),
    handleToggleUserActive: vi.fn(),
    handleConfirmResetPassword: vi.fn(),
    handleDeleteUser: vi.fn(),
    ...extra,
  } as unknown as Admin;
}

// Rows are the buttons that open a person (aria-expanded), not the filters
const rows = () => screen.getAllByRole('button', { expanded: false }).filter((b) => b.textContent?.includes('person'));

describe('UserList', () => {
  beforeEach(() => localStorage.clear());

  it('renders the first 50 of many people and more on request', () => {
    const users = [me, ...Array.from({ length: 129 }, (_, i) => person(i + 1))];
    render(<UserList admin={fakeAdmin(users)} currentUser={me} isServerAdmin />);
    expect(rows()).toHaveLength(50);
    expect(screen.getByText('50 von 130 angezeigt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '50 weitere anzeigen' }));
    expect(rows()).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: '30 weitere anzeigen' }));
    expect(screen.queryByText(/angezeigt/)).toBeNull();
    // Renders up to 130 rows in jsdom: on a busy machine (parallel builds) that took longer than the 5 s default
  }, 20_000);

  it('searches name, username and e-mail and says how many match', () => {
    const users = [me, person(1), person(2, { displayName: 'Anna Müller' }), person(3, { email: 'anna@firma.de' })];
    render(<UserList admin={fakeAdmin(users)} currentUser={me} isServerAdmin />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Benutzer suchen' }), { target: { value: 'anna' } });
    expect(screen.getByText('2 von 4')).toBeTruthy();
    expect(screen.getByText('Anna Müller')).toBeTruthy();
    expect(screen.queryByText('Person 001')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Benutzer suchen' }), { target: { value: 'niemand' } });
    expect(screen.getByText('Niemand passt zu Suche und Filter.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getByText('Person 001')).toBeTruthy();
  });

  it('sorts by name and keeps rows compact: role only as a badge for admins and managers', () => {
    const users = [person(2, { displayName: 'Zoe' }), me, person(1, { displayName: 'Anna', role: 'manager' })];
    render(<UserList admin={fakeAdmin(users)} currentUser={me} isServerAdmin />);
    const list = rows();
    const names = list.map((b) => within(b).getAllByText(/^(Anna|Chef|Zoe)$/)[0].textContent);
    expect(names).toEqual(['Anna', 'Chef', 'Zoe']);
    expect(within(list[0]).getByText('Benutzerverwaltung')).toBeTruthy();
    expect(within(list[1]).getByText('Server-Admin')).toBeTruthy();
    expect(within(list[2]).queryByText('Mitglied')).toBeNull();
    // no role menu in the rows
    expect(screen.queryByRole('button', { name: 'Benutzerrolle ändern' })).toBeNull();
  });

  it('opens a person on a tap with all actions; the own account cannot be locked or deleted', () => {
    const admin = fakeAdmin([me, person(1)]);
    render(<UserList admin={admin} currentUser={me} isServerAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /Person 001/ }));
    expect(screen.getByRole('button', { name: 'Benutzerrolle ändern' })).toBeTruthy();
    expect(screen.getByText('Vertrieb', { selector: 'p' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sperren' }));
    expect(admin.handleToggleUserActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'usr_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer löschen' }));
    expect(admin.handleDeleteUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'usr_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Passwort' }));
    expect(admin.setResetPwdUserId).toHaveBeenCalledWith('usr_1');

    // another person: the first one closes
    fireEvent.click(screen.getByRole('button', { name: /Chef/ }));
    expect(screen.getAllByRole('button', { name: 'Sperren' })).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Sperren' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Benutzer löschen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Nicht beim eigenen Konto')).toBeTruthy();
  });

  it('lets user managers change members only, without passwords or roles', () => {
    const manager = person(9, { displayName: 'Mona', role: 'manager' });
    render(<UserList admin={fakeAdmin([me, manager, person(1)])} currentUser={manager} isServerAdmin={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Chef/ }));
    expect(screen.queryByRole('button', { name: 'Benutzerrolle ändern' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Sperren' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Nur Server-Admins können dieses Konto ändern')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Person 001/ }));
    expect((screen.getByRole('button', { name: 'Sperren' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Passwort' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('filters by organization, including people without one', () => {
    const users = [me, person(1), person(2, { displayName: 'Ohne Org', organizationIds: [] })];
    render(<UserList admin={fakeAdmin(users)} currentUser={me} isServerAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Nach Organisation filtern' }));
    fireEvent.click(screen.getByRole('option', { name: 'Keine Organisation' }));
    expect(screen.getByText('Ohne Org')).toBeTruthy();
    expect(screen.queryByText('Person 001')).toBeNull();
  });

  it('shows details in a sheet on phones', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    try {
      render(<UserList admin={fakeAdmin([me, person(1)])} currentUser={me} isServerAdmin />);
      fireEvent.click(screen.getByRole('button', { name: /Person 001/ }));
      const sheet = screen.getByRole('dialog', { name: 'Person 001' });
      expect(within(sheet).getByRole('button', { name: 'Sperren' })).toBeTruthy();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
});

describe('UsersSection', () => {
  it('puts registrations waiting for approval on top with a counter, outside the list', () => {
    const waiting = [person(1, { displayName: 'Petra Neu', pendingApproval: true }), person(2, { displayName: 'Rainer Wartend', pendingApproval: true })];
    const admin = fakeAdmin([me, person(3), ...waiting], {
      invites: [],
      newUserName: '',
      newUserEmail: '',
      newUserPassword: '',
      newUserRole: 'member',
      newUserOrgs: [],
      inviteEmail: '',
      inviteOrgs: [],
      inviteMaxUses: 1,
      handleApproveUser: vi.fn(),
    });
    const { container } = render(<UsersSection admin={admin} currentUser={me} isServerAdmin />);
    const heading = screen.getByRole('heading', { name: /Wartet auf Freigabe/ });
    expect(within(heading).getByText('2')).toBeTruthy();
    // above the forms for new accounts
    const text = container.textContent || '';
    expect(text.indexOf('Wartet auf Freigabe')).toBeLessThan(text.indexOf('Neues Benutzerkonto direkt anlegen'));
    expect(screen.getByRole('heading', { name: 'Registrierte Benutzer (2)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Petra Neu/ })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Freigeben' })[0]);
    expect(admin.handleApproveUser).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Petra Neu' }));
  });
});
