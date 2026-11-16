import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharingSection } from '../admin/SharingSection';
import type { useAdminSettings } from '../admin/useAdminSettings';
import { SystemSettings } from '../../../lib/types';

type Admin = ReturnType<typeof useAdminSettings>;

const settings: SystemSettings = {
  sharingMode: 'organizations',
  allowRegistration: false,
  instanceName: 'MindSift',
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
  render(<SharingSection admin={admin} />);
  return admin;
}

describe('SharingSection (Administration → Teilen)', () => {
  it('picks who may share with whom from a menu and explains the chosen mode', () => {
    const admin = renderSection();
    const button = screen.getByRole('button', { name: 'Wer mit wem teilen darf' });
    expect(button.textContent).toContain('Innerhalb der Organisationen (empfohlen)');
    expect(button.textContent).not.toContain('2.');
    expect(screen.getByText(/mindestens eine Organisation gemeinsam/)).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('option', { name: /^Offen/ }));
    expect(admin.handleSelectSharingMode).toHaveBeenCalledWith('open');
  });

  it('asks before a stricter mode removes shares', () => {
    const admin = renderSection({ pendingMode: { mode: 'private', affected: 3 } });
    expect(screen.getByText(/Beim Wechsel zu „Privat“ fallen 3 Freigaben/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem wechseln' }));
    expect(admin.setPendingMode).toHaveBeenCalledWith(null);
    expect(admin.handleSaveSystemSettings).toHaveBeenCalledWith({ sharingMode: 'private' });
  });
});
