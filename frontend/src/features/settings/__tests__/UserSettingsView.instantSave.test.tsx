import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UserSettingsView } from '../UserSettingsView';
import { api } from '../../../lib/api';
import { User } from '../../../lib/types';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      getMe: vi.fn(async () => ({ isLastAdmin: false })),
      getAuthStatus: vi.fn(async () => ({ demoMode: false })),
      getPushDevices: vi.fn(async () => []),
      updateSettings: vi.fn(async (patch) => ({ ...baseUser, ...patch })),
    },
  };
});

const baseUser: User = {
  id: 'u1',
  email: 'anna@example.com',
  displayName: 'Anna',
  role: 'member',
  isActive: true,
  alarmChannels: ['email'],
  createdAt: '2026-10-30T00:00:00Z',
  retention: { doneTasks: 30, taskTrash: 30, triageTrash: 30, noteTrash: 30, listDone: 30 },
};

function renderView(onUserUpdated = vi.fn(), onDataChanged = vi.fn()) {
  render(
    <UserSettingsView
      currentUser={baseUser}
      activeTheme="dark"
      customThemes={[]}
      onThemeChange={() => {}}
      onCustomThemesChange={() => {}}
      onUserUpdated={onUserUpdated}
      onDataChanged={onDataChanged}
      onBack={() => {}}
    />
  );
  return { onUserUpdated, onDataChanged };
}

describe('Kontoeinstellungen, die sofort speichern', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('confirms a retention change with "Gespeichert" and reloads nothing else', async () => {
    const { onUserUpdated, onDataChanged } = renderView();
    fireEvent.click(screen.getByText('Aufbewahrung'));
    fireEvent.click(screen.getByRole('button', { name: 'Erledigte Aufgaben: in den Papierkorb nach' }));
    fireEvent.click(screen.getByRole('option', { name: '14 Tagen' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Gespeichert'));
    expect(api.updateSettings).toHaveBeenCalledWith({ retention: { ...baseUser.retention, doneTasks: 14 } });
    expect(onUserUpdated).toHaveBeenCalledTimes(1);
    expect(onDataChanged).not.toHaveBeenCalled();
  });

  it('confirms the switch for typed dates in Sprache, and shows an error until it is closed', async () => {
    renderView();
    fireEvent.click(screen.getByText('Sprache'));
    fireEvent.click(screen.getByTitle('Datum und Menge beim Tippen erkennen'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Gespeichert'));
    expect(api.updateSettings).toHaveBeenCalledWith({ typedRecognition: false });

    vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error('Server nicht erreichbar'));
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Server nicht erreichbar'));
    // The error replaced the confirmation
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.getByRole('alert').textContent).toBe('');
  });

  it('never shows a confirmation older than its few seconds after returning; an error waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish: (u: User) => void = () => {};
    vi.mocked(api.updateSettings).mockImplementationOnce(() => new Promise<User>((resolve) => (finish = resolve)));
    renderView();
    fireEvent.click(screen.getByText('Sprache'));
    fireEvent.click(screen.getByTitle('Datum und Menge beim Tippen erkennen'));
    // The save ends only after the section was left
    fireEvent.click(screen.getByText('Profil'));
    await act(async () => finish({ ...baseUser, typedRecognition: false }));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    fireEvent.click(screen.getByText('Sprache'));
    expect(screen.queryByText('Gespeichert')).toBeNull();

    let fail: (e: Error) => void = () => {};
    vi.mocked(api.updateSettings).mockImplementationOnce(() => new Promise<User>((_, reject) => (fail = reject)));
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    fireEvent.click(screen.getByText('Profil'));
    await act(async () => fail(new Error('Server nicht erreichbar')));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    fireEvent.click(screen.getByText('Sprache'));
    expect(screen.getByRole('alert').textContent).toContain('Server nicht erreichbar');
  });
});
