import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServerSection } from '../admin/ServerSection';
import type { useAdminSettings } from '../admin/useAdminSettings';
import { SystemSettings } from '../../../lib/types';

// The cards that load their own state are not what this test is about
vi.mock('../admin/UpdateStatusCard', () => ({ UpdateStatusCard: () => null }));

type Admin = ReturnType<typeof useAdminSettings>;

const settings: SystemSettings = {
  sharingMode: 'organizations',
  allowRegistration: false,
  instanceName: 'MindSift',
  defaultLanguage: 'de',
  timeZone: '',
  serverTime: { zone: 'UTC', source: 'default', now: '2026-11-13T13:05:00Z', fallback: 'UTC' },
};

function renderSection(over: Partial<Admin> = {}) {
  const admin = {
    pendingMode: null,
    settings,
    demoMode: false,
    handleSelectSharingMode: vi.fn(),
    handleSaveSystemSettings: vi.fn(),
    setPendingMode: vi.fn(),
    setSettings: vi.fn(),
    ...over,
  } as unknown as Admin;
  render(<ServerSection admin={admin} />);
  return admin;
}

describe('ServerSection (Administration → Server)', () => {
  it('groups name, default language and time zone as rows of one frame', () => {
    renderSection();
    expect(screen.getByRole('heading', { name: 'Server' })).toBeTruthy();
    const group = document.querySelector('[data-admin-instance]') as HTMLElement;
    expect(group.querySelector('input[aria-label="Name der MindSift-Instanz"]')).toBeTruthy();
    expect(group.textContent).toContain('Standardsprache');
    expect(group.querySelector('[data-admin-time-zone]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nicht mehr festlegen' })).toBeNull();
  });

  it('is read only in the demo', () => {
    renderSection({ demoMode: true });
    expect((document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });
});
