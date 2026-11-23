import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserSettingsView } from '../UserSettingsView';
import { api } from '../../../lib/api';
import { User } from '../../../lib/types';
import { actAsDesktopApp } from '../../../test/desktop';

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
        customThemes={[]}
        onThemeChange={() => {}}
        onCustomThemesChange={() => {}}
        onUserUpdated={onUserUpdated}
        onDataChanged={() => {}}
        onBack={() => {}}
      />
    );

    // Open "Alarme" section
    fireEvent.click(screen.getByText('Alarme'));

    // Without Discord webhook, Discord switches are disabled and hint is visible
    const discordSwitches = screen.getAllByTitle('Bitte zuerst unten eine Discord Webhook URL eintragen');
    expect(discordSwitches.length).toBe(8);
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
    // The time field takes what was typed when it is left
    fireEvent.blur(screen.getByLabelText('Uhrzeit der Tageszusammenfassung'));
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
            due: { email: true, discord: true, webhook: false, push: false, desktop: false },
            shared: { email: true, discord: false, webhook: false, push: false, desktop: false },
            assigned: { email: true, discord: false, webhook: false, push: false, desktop: false },
            mentioned: { email: true, discord: false, webhook: false, push: false, desktop: false },
            taskCreated: { email: true, discord: false, webhook: false, push: false, desktop: false },
            taskDone: { email: true, discord: false, webhook: false, push: false, desktop: false },
            watched: { email: true, discord: false, webhook: false, push: false, desktop: false },
          },
          dailySummary: {
            enabled: true,
            time: '08:30',
            email: true,
            discord: true,
            webhook: false,
            push: false,
            desktop: false,
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
        customThemes={[]}
        onThemeChange={() => {}}
        onCustomThemesChange={() => {}}
        onUserUpdated={() => {}}
        onDataChanged={() => {}}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Alarme'));
    const off = screen.getAllByTitle('Bitte zuerst unten eine eigene Webhook URL eintragen');
    expect(off.length).toBe(8);
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

  it('keeps unsaved input when the account is loaded again, and takes over only what changed', async () => {
    const view = (user: User) => (
      <UserSettingsView
        currentUser={user}
        activeTheme="dark"
        customThemes={[]}
        onThemeChange={() => {}}
        onCustomThemesChange={() => {}}
        onUserUpdated={() => {}}
        onDataChanged={() => {}}
        onBack={() => {}}
      />
    );
    const { rerender } = render(view(baseUser));
    fireEvent.click(screen.getByText('Alarme'));
    const discordUrl = 'https://discord.com/api/webhooks/123/abc';
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/discord\.com\/api\/webhooks/), { target: { value: discordUrl } });
    fireEvent.click(screen.getByTitle('Fällige Aufgaben (sofort) – Discord'));

    // Back in the tab (or after saving the avatar): the same account as a new object
    rerender(view({ ...baseUser }));
    expect((screen.getByPlaceholderText(/https:\/\/discord\.com\/api\/webhooks/) as HTMLInputElement).value).toBe(discordUrl);
    expect(screen.getByTitle('Fällige Aufgaben (sofort) – Discord').getAttribute('aria-checked')).toBe('true');

    // Saved on another device: that field follows, the input here stays
    rerender(view({ ...baseUser, customWebhookUrl: 'https://hooks.example.com/neu' }));
    expect((screen.getByPlaceholderText(/dein-server\.local/) as HTMLInputElement).value).toBe('https://hooks.example.com/neu');
    expect((screen.getByPlaceholderText(/https:\/\/discord\.com\/api\/webhooks/) as HTMLInputElement).value).toBe(discordUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Alarm-Einstellungen speichern' }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    const patch = vi.mocked(api.updateSettings).mock.calls[0][0];
    expect(patch.discordWebhookUrl).toBe(discordUrl);
    expect(patch.customWebhookUrl).toBe('https://hooks.example.com/neu');
    expect(patch.notificationSettings?.events.due.discord).toBe(true);
  });

  it('offers system notifications instead of push where the instance shows them (desktop app)', async () => {
    actAsDesktopApp();
    const testChannel = vi.spyOn(api, 'testAlarmChannel').mockResolvedValue({ status: 'ok' });
    const desktopUser: User = {
      ...baseUser,
      alarmChannels: undefined,
      notificationSettings: {
        paused: false,
        includeOwnWatched: false,
        events: {
          due: { email: false, discord: false, webhook: false, push: false, desktop: true },
        },
        dailySummary: { enabled: false, time: '07:00', email: false, discord: false, webhook: false, push: false, desktop: true },
      } as unknown as User['notificationSettings'],
    };
    render(
      <UserSettingsView
        currentUser={desktopUser}
        activeTheme="dark"
        customThemes={[]}
        onThemeChange={() => {}}
        onCustomThemesChange={() => {}}
        onUserUpdated={() => {}}
        onDataChanged={() => {}}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Alarme'));

    expect(screen.queryByText('Ziel: Push-Benachrichtigungen')).toBeNull();
    expect(screen.getByText('Ziel: Systembenachrichtigung')).toBeTruthy();
    // Nobody else changes a task here: no watched tasks, no switch for the own changes
    expect(screen.queryByTitle('Beobachtete Aufgaben – Systembenachrichtigung')).toBeNull();
    expect(screen.queryByTitle('Auch eigene Änderungen an beobachteten Aufgaben melden')).toBeNull();
    const due = screen.getByTitle('Fällige Aufgaben (sofort) – Systembenachrichtigung');
    expect(due.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTitle('Tageszusammenfassung – Systembenachrichtigung').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Test anzeigen' }));
    await waitFor(() => expect(testChannel).toHaveBeenCalledWith('desktop', ''));

    fireEvent.click(screen.getByTitle('Fällige Aufgaben (sofort) – Systembenachrichtigung'));
    fireEvent.click(screen.getByRole('button', { name: 'Alarm-Einstellungen speichern' }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    const patch = vi.mocked(api.updateSettings).mock.calls[0][0];
    expect(patch.notificationSettings?.events.due.desktop).toBe(false);
    expect(patch.notificationSettings?.dailySummary.desktop).toBe(true);
  });
});
