import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';

vi.mock('../../lib/api', () => ({
  api: {
    getTaskLists: vi.fn(async () => []),
    captureThought: vi.fn(async (content: string) => ({ id: 't1', content, status: 'inbox' })),
    getAuthStatus: vi.fn(async () => ({ voice: { mode: 'off' } })),
  },
  triggerHaptic: vi.fn(),
  onRealtimeStatus: vi.fn(() => () => {}),
}));

import { NavRail, NAV_RAIL_KEY } from '../NavRail';
import { QuickDumpWindow, useQuickDumpShortcut } from '../QuickDumpWindow';
import type { ActiveTab } from '../appTabs';
import type { AuthStatus, DashboardStats, User } from '../../lib/types';

const stats: DashboardStats = {
  inboxCount: 6,
  tasksOpenCount: 9,
  tasksDoneCount: 0,
  docsCount: 3,
  listItemsOpenCount: 15,
  listsCount: 2,
  discardedCount: 0,
};
const user = { id: 'u1', displayName: 'Admin', username: 'admin', role: 'admin' } as User;
const authStatus = { needsSetup: false, allowRegistration: false } as AuthStatus;

// The rail and the Quick Dump window wired up as in App.tsx
function Harness({ setActiveTab = () => {} }: { setActiveTab?: (tab: ActiveTab) => void }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [profile, setProfile] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const openQuickDump = useCallback(() => {
    setOpen(true);
    setFocus((n) => n + 1);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  useQuickDumpShortcut(openQuickDump);
  return (
    <>
      <NavRail
        activeTab="workspace"
        setActiveTab={setActiveTab}
        stats={stats}
        authStatus={authStatus}
        demoDeadline={null}
        handleDemoCountdownElapsed={() => {}}
        onQuickDump={openQuickDump}
        onSearch={() => {}}
        handleOpenHelp={() => {}}
        user={user}
        connection="online"
        dropdownRef={dropdownRef}
        showProfileMenu={profile}
        setShowProfileMenu={setProfile}
        profileMenu={<div>Profilmenü</div>}
        renderBell={() => null}
      />
      <QuickDumpWindow open={open} onClose={close} onCaptured={() => {}} lists={[]} focusTrigger={focus} />
      <main>Inhalt</main>
    </>
  );
}

const rail = () => document.querySelector('[data-nav-rail]') as HTMLElement;
const dumpOverlay = () => (screen.getByRole('dialog', { hidden: true, name: 'Quick Dump' }).parentElement as HTMLElement);

describe('NavRail', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts collapsed with the pages reachable by name and their counters', () => {
    const setActiveTab = vi.fn();
    render(<Harness setActiveTab={setActiveTab} />);
    expect(rail().dataset.navRail).toBe('collapsed');
    const tasks = screen.getByRole('button', { name: /^Aufgaben/ });
    expect(tasks.textContent).toContain('9');
    expect(screen.getByRole('button', { name: /^Workspace/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(tasks);
    expect(setActiveTab).toHaveBeenCalledWith('tasks');
    // The account's button is named after the person, also while collapsed
    expect(screen.getByRole('button', { name: /Admin/ })).toBe(screen.getByTitle('Benutzermenü öffnen'));
  });

  it('expands with its button, remembers it per device and folds on a click beside it or Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Navigation ausklappen' }));
    expect(rail().dataset.navRail).toBe('expanded');
    expect(localStorage.getItem(NAV_RAIL_KEY)).toBe('1');
    // The label stands next to the icon (not only for screen readers)
    expect(screen.getByText('Listen').parentElement?.className).not.toContain('sr-only');

    // A click inside keeps it open, one beside it folds it
    fireEvent.mouseDown(screen.getByRole('button', { name: /^Triage/ }));
    expect(rail().dataset.navRail).toBe('expanded');
    fireEvent.mouseDown(screen.getByText('Inhalt'));
    expect(rail().dataset.navRail).toBe('collapsed');
    expect(localStorage.getItem(NAV_RAIL_KEY)).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Navigation ausklappen' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rail().dataset.navRail).toBe('collapsed');

    fireEvent.click(screen.getByRole('button', { name: 'Navigation ausklappen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Navigation einklappen' }));
    expect(rail().dataset.navRail).toBe('collapsed');
  });

  it('opens expanded when it was left expanded on this device', () => {
    localStorage.setItem(NAV_RAIL_KEY, '1');
    render(<Harness />);
    expect(rail().dataset.navRail).toBe('expanded');
  });

  it('opens the profile menu beside the avatar', () => {
    render(<Harness />);
    expect(screen.queryByText('Profilmenü')).toBeNull();
    fireEvent.click(screen.getByTitle('Benutzermenü öffnen'));
    expect(screen.getByText('Profilmenü')).toBeTruthy();
  });
});

describe('Quick Dump window', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens with the + of the rail, takes the focus and closes on Escape', () => {
    render(<Harness />);
    expect(dumpOverlay().className.startsWith('hidden ')).toBe(true);
    fireEvent.click(within(rail()).getByRole('button', { name: /^Quick Dump/ }));
    expect(dumpOverlay().className).toContain('sm:flex');
    const field = screen.getByPlaceholderText(/Quick Dump/);
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dumpOverlay().className.startsWith('hidden ')).toBe(true);
  });

  it('opens on a bare "c", not on Ctrl/Cmd+C or while typing', () => {
    render(<Harness />);
    const ctrlC = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ctrlC);
    expect(ctrlC.defaultPrevented).toBe(false);
    expect(dumpOverlay().className).not.toContain('sm:flex');

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'c' });
    expect(dumpOverlay().className).not.toContain('sm:flex');
    input.remove();

    fireEvent.keyDown(document.body, { key: 'c' });
    expect(dumpOverlay().className).toContain('sm:flex');
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/Quick Dump/));
  });

  it('closes on a click beside the window, not on one inside it', () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: 'c' });
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Quick Dump' }));
    expect(dumpOverlay().className).toContain('sm:flex');
    fireEvent.mouseDown(dumpOverlay());
    expect(dumpOverlay().className).not.toContain('sm:flex');
  });

  it('leaves the key to another window on top (e.g. the drawing editor)', () => {
    render(<Harness />);
    const other = document.createElement('div');
    other.setAttribute('aria-modal', 'true');
    document.body.appendChild(other);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(dumpOverlay().className).not.toContain('sm:flex');
    other.remove();
  });
});
