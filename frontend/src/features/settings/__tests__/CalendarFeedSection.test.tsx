import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { CalendarFeedState } from '../../../lib/types';

const off: CalendarFeedState = { enabled: true, active: false, token: null, url: null };
const on = (token: string): CalendarFeedState => ({ enabled: true, active: true, token, url: null, createdAt: '2026-11-15T10:00:00Z' });

const getCalendarFeed = vi.fn(async (): Promise<CalendarFeedState> => off);
const renewCalendarFeed = vi.fn(async (): Promise<CalendarFeedState> => on('tok1'));
const disableCalendarFeed = vi.fn(async (): Promise<CalendarFeedState> => off);
vi.mock('../../../lib/api', () => ({
  api: {
    getCalendarFeed: () => getCalendarFeed(),
    renewCalendarFeed: () => renewCalendarFeed(),
    disableCalendarFeed: () => disableCalendarFeed(),
  },
}));
const askConfirm = vi.fn(async (_opts: { message: unknown; confirmLabel: string; danger?: boolean }) => true);
vi.mock('../../../components/askConfirm', () => ({ askConfirm: (opts: { message: unknown; confirmLabel: string; danger?: boolean }) => askConfirm(opts) }));

import { CalendarFeedSection } from '../user/CalendarFeedSection';

describe('CalendarFeedSection', () => {
  beforeEach(() => {
    getCalendarFeed.mockReset().mockResolvedValue(off);
    renewCalendarFeed.mockClear();
    disableCalendarFeed.mockClear();
    askConfirm.mockReset().mockResolvedValue(true);
  });

  it('switching on shows the link with copy button and the instructions per app', async () => {
    render(<CalendarFeedSection />);
    const sw = await screen.findByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Abo-Link')).toBeNull();
    await act(async () => {
      fireEvent.click(sw);
    });
    expect(renewCalendarFeed).toHaveBeenCalledTimes(1);
    expect(askConfirm).not.toHaveBeenCalled(); // switching on loses nothing
    const input = screen.getByLabelText('Abo-Link') as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/calendar/tok1.ics`);
    expect(screen.getByRole('button', { name: /Kopieren/ })).toBeTruthy();
    for (const app of ['Google Kalender', 'Apple Kalender', 'Thunderbird', 'Outlook']) {
      expect(screen.getByText(`${app}:`)).toBeTruthy();
    }
  });

  it('uses the server address when BASE_URL gives one', async () => {
    getCalendarFeed.mockResolvedValue({ ...on('tok9'), url: 'https://ms.example/calendar/tok9.ics' });
    render(<CalendarFeedSection />);
    const input = (await screen.findByLabelText('Abo-Link')) as HTMLInputElement;
    expect(input.value).toBe('https://ms.example/calendar/tok9.ics');
  });

  it('a new link asks first and replaces the old one; cancelling keeps it', async () => {
    getCalendarFeed.mockResolvedValue(on('alt'));
    renewCalendarFeed.mockResolvedValue(on('neu'));
    render(<CalendarFeedSection />);
    const renew = await screen.findByRole('button', { name: /Neuen Link erzeugen/ });

    askConfirm.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(renew);
    });
    expect(renewCalendarFeed).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Abo-Link') as HTMLInputElement).value).toContain('/calendar/alt.ics');

    await act(async () => {
      fireEvent.click(renew);
    });
    expect(askConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ danger: true, confirmLabel: 'Neuen Link erzeugen' }));
    expect(renewCalendarFeed).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Abo-Link') as HTMLInputElement).value).toContain('/calendar/neu.ics');
  });

  it('switching off asks and deletes the link', async () => {
    getCalendarFeed.mockResolvedValue(on('tok1'));
    render(<CalendarFeedSection />);
    const sw = await screen.findByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(sw);
    });
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(disableCalendarFeed).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Abo-Link')).toBeNull();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });

  it('says so when the server does not allow calendar subscriptions', async () => {
    getCalendarFeed.mockResolvedValue({ enabled: false, active: false, token: null, url: null });
    render(<CalendarFeedSection />);
    expect(await screen.findByText('Kalender-Abos sind auf diesem Server ausgeschaltet.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
