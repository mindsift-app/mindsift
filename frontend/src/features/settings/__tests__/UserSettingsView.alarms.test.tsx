import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
};

describe('UserSettingsView notification matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives events.due from alarmChannels, disables Discord without webhook, and saves the exact notificationSettings object', async () => {
    const onUserUpdated = vi.fn();
    render(
      <UserSettingsView
        currentUser={baseUser}
        activeTheme="dark"
        themes={[]}
        customThemes={[]}
        onThemeChange={() => {}}
        onCustomThemesChange={() => {}}
        onUserUpdated={onUserUpdated}
        onBack={() => {}}
      />
    );

    // Open "Alarme" section
    fireEvent.click(screen.getByText('Alarme'));

    // Without Discord webhook, Discord switches are disabled and hint is visible
    const discordSwitches = screen.getAllByTitle('Bitte zuerst unten eine Discord Webhook URL eintragen');
    expect(discordSwitches.length).toBe(7);
    expect((discordSwitches[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Discord-Schalter sind deaktiviert/)).toBeTruthy();

    // Enter a Discord Webhook URL to enable the Discord column
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/discord\.com\/api\/webhooks/), {
      target: { value: 'https://discord.com/api/webhooks/123/abc' },
    });

    // Derive check: alarmChannels=['email'] -> due.email=true, due.discord=false
    expect(screen.getByTitle('Fällige Aufgaben (sofort) – E-Mail').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTitle('Fällige Aufgaben (sofort) – Discord').getAttribute('aria-checked')).toBe('false');

    // Toggle settings in the matrix, daily summary, and global switches
    fireEvent.click(screen.getByTitle('Fällige Aufgaben (sofort) – Discord'));
    fireEvent.click(screen.getByTitle('Geteilte Aufgabe erledigt – E-Mail'));
    fireEvent.click(screen.getByTitle('Neue Aufgabe in geteilter Liste – E-Mail'));
    fireEvent.click(screen.getByTitle('Beobachtete Aufgaben – Discord'));
    fireEvent.click(screen.getByTitle('Alle Benachrichtigungen pausieren'));
    fireEvent.click(screen.getByTitle('Auch eigene Änderungen an beobachteten Aufgaben melden'));
    fireEvent.click(screen.getByTitle('Tageszusammenfassung'));
    fireEvent.change(screen.getByLabelText('Uhrzeit der Tageszusammenfassung'), {
      target: { value: '08:30' },
    });
    fireEvent.click(screen.getByTitle('Tageszusammenfassung – Discord'));

    fireEvent.click(screen.getByRole('button', { name: 'Alarm-Einstellungen speichern' }));

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
        notificationSettings: {
          paused: true,
          includeOwnWatched: true,
          events: {
            due: { email: true, discord: true, webhook: false, push: false },
            shared: { email: true, discord: false, webhook: false, push: false },
            assigned: { email: true, discord: false, webhook: false, push: false },
            taskCreated: { email: true, discord: false, webhook: false, push: false },
            taskDone: { email: true, discord: false, webhook: false, push: false },
            watched: { email: true, discord: false, webhook: false, push: false },
          },
          dailySummary: {
            enabled: true,
            time: '08:30',
            email: true,
            discord: true,
            webhook: false,
            push: false,
          },
        },
      })
    );
  });

  it('enables the webhook column once an own webhook URL is entered and saves it as due channel', async () => {
    render(
      <UserSettingsView
        currentUser={baseUser}
        activeTheme="dark"
        themes={[]}
        customThemes={[]}
        onThemeChange={() => {}}
        onCustomThemesChange={() => {}}
        onUserUpdated={() => {}}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Alarme'));
    const off = screen.getAllByTitle('Bitte zuerst unten eine eigene Webhook URL eintragen');
    expect(off.length).toBe(7);
    expect((off[0] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/dein-server\.local/), {
      target: { value: 'https://hooks.example.com/mindsift' },
    });
    fireEvent.click(screen.getByTitle('Fällige Aufgaben (sofort) – Webhook'));
    fireEvent.click(screen.getByTitle('Freigabe erhalten – Webhook'));
    fireEvent.click(screen.getByRole('button', { name: 'Alarm-Einstellungen speichern' }));

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    const patch = vi.mocked(api.updateSettings).mock.calls[0][0];
    expect(patch.customWebhookUrl).toBe('https://hooks.example.com/mindsift');
    expect(patch.alarmChannels).toEqual(['email', 'webhook']);
    expect(patch.notificationSettings?.events.due.webhook).toBe(true);
    expect(patch.notificationSettings?.events.shared.webhook).toBe(true);
  });
});
