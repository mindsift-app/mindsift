import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminSettingsView } from '../AdminSettingsView';
import type { useAdminSettings } from '../admin/useAdminSettings';
import { SystemSettings, User, UserRole } from '../../../lib/types';

type Admin = ReturnType<typeof useAdminSettings>;

// Mock factories are hoisted above the imports; what they use is made there too
const { admin, stub } = vi.hoisted(() => {
  const settings: SystemSettings = {
    sharingMode: 'organizations',
    allowRegistration: false,
    registrationMode: 'domain',
    instanceName: 'MindSift',
    defaultLanguage: 'de',
    timeZone: '',
    serverTime: { zone: 'UTC', source: 'default', now: '2026-11-13T13:05:00Z', fallback: 'UTC' },
  };

  const admin = {
    statusMsg: null,
    setStatusMsg: vi.fn(),
    demoMode: false,
    pendingMode: null,
    settings,
    users: [],
    handleSelectSharingMode: vi.fn(),
    handleSaveSystemSettings: vi.fn(),
    setPendingMode: vi.fn(),
    setSettings: vi.fn(),
  } as unknown as Admin;
  // Pages and cards that load their own state stand in with their title
  const stub = (title: string) => () => React.createElement('p', null, title);
  return { admin, stub };
});

vi.mock('../admin/useAdminSettings', async (orig) => ({
  ...(await orig<typeof import('../admin/useAdminSettings')>()),
  useAdminSettings: () => admin,
}));
vi.mock('../admin/UsersSection', () => ({ UsersSection: stub('Konten') }));
vi.mock('../admin/OrganizationsSection', () => ({ OrganizationsSection: stub('Organisationen verwalten') }));
vi.mock('../admin/SmtpSection', () => ({ SmtpSection: stub('Mailserver') }));
vi.mock('../admin/AuditSection', () => ({ AuditSection: stub('Änderungen') }));
vi.mock('../admin/UpdateStatusCard', () => ({ UpdateStatusCard: stub('MindSift-Version') }));
vi.mock('../BackupAdminCard', () => ({ BackupAdminCard: stub('Automatische Backups') }));
vi.mock('../VoiceStatusCard', () => ({ VoiceStatusCard: stub('Spracherkennung') }));
vi.mock('../admin/OidcStatusCard', () => ({ OidcStatusCard: stub('Anmeldung über OIDC') }));

const user = (role: UserRole) => ({ id: 'u1', email: 'a@b.de', displayName: 'Admin', role, isActive: true }) as User;

// The left column of a server admin, top to bottom, and what each page holds
const PAGES: [string, string[]][] = [
  ['Benutzer & Einladungen', ['Konten']],
  ['Anmeldung & Registrierung', [
    'Registrierung ohne Einladung',
    'E-Mail-Adresse bestätigen lassen',
    'Zwei-Faktor-Anmeldung verlangen',
    'Anmeldung über OIDC',
  ]],
  ['Organisationen', ['Organisationen verwalten']],
  ['Teilen', [
    'Wer mit wem teilen darf',
    'Personensuche',
    'Öffentliche Links zu Notizen',
    'Längste Laufzeit eines Links',
    'Kalender-Abos',
  ]],
  ['Server', [
    'MindSift-Version',
    'Name der MindSift-Instanz',
    'Standardsprache',
    'Zeitzone',
    'Link-Vorschauen',
    'Alarm-Webhooks ins lokale Netz erlauben',
    'Push nur über bekannte Push-Dienste',
  ]],
  ['Daten', ['Automatische Backups', 'Dauerhaftes Aufbewahren erlauben']],
  ['Medien', ['Bildqualität', 'Audio-Komprimierung', 'Bitrate der Aufnahmen', 'Größte Audiodatei', 'Audiodateien hochladen']],
  ['Spracheingabe & KI', ['Spracherkennung', 'KI-Agenten (MCP) erlauben']],
  ['E-Mail / SMTP-Server', ['Mailserver']],
  ['Protokoll', ['Änderungen']],
];

const navLabels = () =>
  Array.from(document.querySelectorAll('aside button')).map((b) => b.querySelector('p')?.textContent);

describe('AdminSettingsView (categories of the administration)', () => {
  it('lists the categories with a hint each, sign-in right below the users', () => {
    render(<AdminSettingsView currentUser={user('admin')} onBack={() => {}} />);
    expect(navLabels()).toEqual(PAGES.map(([label]) => label));
    for (const b of Array.from(document.querySelectorAll('aside button'))) {
      expect(b.querySelectorAll('p')[1].textContent).not.toBe('');
    }
  });

  it('shows every setting in exactly one category', () => {
    render(<AdminSettingsView currentUser={user('admin')} onBack={() => {}} />);
    const all = PAGES.flatMap(([, items]) => items);
    const seen = new Map<string, string[]>(all.map((item) => [item, []]));
    for (const [label] of PAGES) {
      fireEvent.click(document.querySelector(`aside button:nth-child(${PAGES.findIndex(([l]) => l === label) + 1})`)!);
      for (const item of all) {
        // (outside the left column: a hint there may name a setting)
        if (screen.queryAllByText(item).some((el) => !el.closest('aside'))) seen.get(item)!.push(label);
      }
    }
    const expected = new Map(PAGES.flatMap(([label, items]) => items.map((item) => [item, [label]] as const)));
    expect(Object.fromEntries(seen)).toEqual(Object.fromEntries(expected));
  });

  it('shows user managers only people and organizations', () => {
    render(<AdminSettingsView currentUser={user('manager')} onBack={() => {}} />);
    expect(navLabels()).toEqual(['Benutzer & Einladungen', 'Organisationen']);
  });
});
