import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UserList } from '../admin/UserList';
import { UsersSection } from '../admin/UsersSection';
import { useAdminSettings } from '../admin/useAdminSettings';
import { Organization, User } from '../../../lib/types';
import { setViewportWidth } from '../../../test/viewport';

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

// Rows are the buttons that open a person (aria-expanded), not the filters. A plain selector, not a role
// query: with a hundred rows in the page the role queries take seconds on a busy machine
const rows = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')).filter((b) => b.textContent?.includes('person'));
// The "show more" button by its text, for the same reason
const showMore = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement;

describe('UserList', () => {
  beforeEach(() => localStorage.clear());

  it('renders the first 50 of many people and more on request', () => {
    const users = [me, ...Array.from({ length: 129 }, (_, i) => person(i + 1))];
    render(<UserList admin={fakeAdmin(users)} currentUser={me} isServerAdmin />);
    expect(rows()).toHaveLength(50);
    expect(screen.getByText('50 von 130 angezeigt')).toBeTruthy();
    fireEvent.click(showMore('50 weitere anzeigen'));
    expect(rows()).toHaveLength(100);
    fireEvent.click(showMore('30 weitere anzeigen'));
    expect(rows()).toHaveLength(130);
    expect(screen.queryByText(/angezeigt/)).toBeNull();
  });

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

  it('marks people who have to choose a new password at the next sign-in', () => {
    const users = [me, person(1, { displayName: 'Anna', mustChangePassword: true }), person(2, { displayName: 'Ben' })];
    render(<UserList admin={fakeAdmin(users)} currentUser={me} isServerAdmin />);
    const [anna, ben] = rows().filter((b) => /Anna|Ben/.test(b.textContent || ''));
    const badge = within(anna).getByText('Muss Passwort ändern');
    expect(badge.getAttribute('title')).toBe('Muss bei der nächsten Anmeldung ein neues Passwort wählen');
    expect(within(ben).queryByText('Muss Passwort ändern')).toBeNull();
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

  it('offers two switches with the password reset, both off: change at the next sign-in, revoke API keys', () => {
    const admin = fakeAdmin([me, person(1)], {
      resetPwdUserId: 'usr_1',
      resetPwdVal: 'ein-neues-Passwort',
      resetPwdMustChange: false,
      setResetPwdMustChange: vi.fn(),
      resetPwdRevokeKeys: false,
      setResetPwdRevokeKeys: vi.fn(),
    } as Partial<Admin>);
    render(<UserList admin={admin} currentUser={me} isServerAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /Person 001/ }));
    const mustChange = screen.getByRole('switch', { name: 'Bei der nächsten Anmeldung ändern' });
    const revoke = screen.getByRole('switch', { name: 'API-Schlüssel, KI-Zugänge und Kalender-Abo widerrufen' });
    expect(mustChange.getAttribute('aria-checked')).toBe('false');
    expect(revoke.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(mustChange);
    expect(admin.setResetPwdMustChange).toHaveBeenCalledWith(true);
    fireEvent.click(revoke);
    expect(admin.setResetPwdRevokeKeys).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(admin.handleConfirmResetPassword).toHaveBeenCalledWith('usr_1');
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
    expect((screen.getByRole('button', { name: 'E-Mail-Adresse' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns before an empty address is saved for an account with a password, not for one without', () => {
    const hint = /kann Person 001 das Passwort nicht mehr per Mail zurücksetzen/;
    const open = (u: User, value: string) => {
      const admin = fakeAdmin([me, u], { emailEdit: { id: u.id, value }, setEmailEdit: vi.fn(), handleSaveEmail: vi.fn() });
      const view = render(<UserList admin={admin} currentUser={me} isServerAdmin />);
      fireEvent.click(screen.getByRole('button', { name: new RegExp(u.displayName) }));
      return { admin, view };
    };
    // with an address in the field: no hint
    let { admin, view } = open(person(1), 'neu@beispiel.de');
    expect(screen.getByRole('textbox', { name: 'E-Mail-Adresse' })).toBeTruthy();
    expect(screen.queryByText(hint)).toBeNull();
    view.unmount();
    // emptied: the hint, and saving stays possible
    ({ admin, view } = open(person(1), '  '));
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(admin.handleSaveEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 'usr_1' }));
    view.unmount();
    // an account from the OIDC provider without a password of its own: nothing to reset
    ({ view } = open(person(1, { noPassword: true }), ''));
    expect(screen.queryByText(hint)).toBeNull();
    view.unmount();
    // the action opens the form with the current address
    const setEmailEdit = vi.fn();
    render(<UserList admin={fakeAdmin([me, person(1)], { emailEdit: null, setEmailEdit })} currentUser={me} isServerAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /Person 001/ }));
    fireEvent.click(screen.getByRole('button', { name: 'E-Mail-Adresse' }));
    expect(setEmailEdit).toHaveBeenCalledWith({ id: 'usr_1', value: 'person1@beispiel.de' });
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
    setViewportWidth(400);
    render(<UserList admin={fakeAdmin([me, person(1)])} currentUser={me} isServerAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /Person 001/ }));
    const sheet = screen.getByRole('dialog', { name: 'Person 001' });
    expect(within(sheet).getByRole('button', { name: 'Sperren' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
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
