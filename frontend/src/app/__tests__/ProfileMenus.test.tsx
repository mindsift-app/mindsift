import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { User } from '../../lib/types';

let desktop = false;
vi.mock('../../lib/api', () => ({
  isDesktopApp: () => desktop,
  isSharingDisabled: () => desktop,
  triggerHaptic: vi.fn(),
}));
const openDesktopStart = vi.fn();
vi.mock('../../lib/desktopStart', () => ({ openDesktopStart: () => openDesktopStart() }));

import { ProfileDropdown, MobileProfileSheet } from '../ProfileMenus';
import { AVAILABLE_THEMES } from '../../lib/theme';

const user = { id: 'u1', username: 'root', displayName: 'root', email: '', role: 'admin' } as unknown as User;

const props = {
  user,
  roleLabel: 'Server-Admin',
  activeTab: 'notes' as never,
  setActiveTab: vi.fn(),
  activeTheme: AVAILABLE_THEMES[0].id,
  allThemes: AVAILABLE_THEMES,
  handleChangeTheme: vi.fn(),
  isServerAdmin: true,
  handleOpenHelp: vi.fn(),
  handleLogout: vi.fn(),
};
const pwa = { isStandaloneApp: true, setShowManualPwaGuide: vi.fn(), setShowPwaInstallModal: vi.fn() } as never;

describe('profile menus', () => {
  beforeEach(() => {
    openDesktopStart.mockClear();
    props.handleLogout.mockClear();
  });

  it('on a server: login name, role and sign-out', () => {
    desktop = false;
    render(<ProfileDropdown {...props} setShowProfileMenu={vi.fn()} />);
    expect(screen.getAllByText('root')).toHaveLength(2);
    expect(screen.getByText('Server-Admin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(props.handleLogout).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Instanz wechseln' })).toBeNull();
  });

  it('in the desktop app: the name once, no role, "Switch instance" instead of sign-out', () => {
    desktop = true;
    const { unmount } = render(<ProfileDropdown {...props} setShowProfileMenu={vi.fn()} />);
    expect(screen.getAllByText('root')).toHaveLength(1);
    expect(screen.queryByText('Server-Admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Instanz wechseln' }));
    expect(openDesktopStart).toHaveBeenCalledTimes(1);
    unmount();

    render(<MobileProfileSheet {...props} setShowMobileProfile={vi.fn()} setShowAbout={vi.fn()} pwa={pwa} />);
    expect(screen.getAllByText('root')).toHaveLength(1);
    expect(screen.queryByText('Server-Admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Instanz wechseln' }));
    expect(openDesktopStart).toHaveBeenCalledTimes(2);
  });
});
