import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeZoneSetting } from '../admin/TimeZoneSetting';
import { SystemSettings } from '../../../lib/types';

let browserZone = 'UTC';
vi.mock('../../../lib/timeZones', async (orig) => ({
  ...(await orig<typeof import('../../../lib/timeZones')>()),
  browserTimeZone: () => browserZone,
}));

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };

describe('TimeZoneSetting (server time zone in the administration)', () => {
  it('shows the server time, the zone and that UTC is only the default', () => {
    browserZone = 'Europe/Berlin';
    render(
      <TimeZoneSetting
        settings={{ ...base, timeZone: '', serverTime: { zone: 'UTC', source: 'default', now: '2026-11-13T13:05:00Z', fallback: 'UTC' } }}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zeitzone' }).textContent).toContain('Nicht festgelegt (UTC)');
    const time = document.querySelector('[data-server-time]')?.textContent || '';
    expect(time).toContain('Serverzeit jetzt:');
    expect(time).toContain('13:05');
    expect(time).toContain('(UTC)');
    expect(time).not.toContain('UTC, UTC');
    expect(screen.getByText(/Quelle: Standard UTC/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nicht mehr festlegen' })).toBeNull();
  });

  it('saves a zone picked from the searchable list', () => {
    browserZone = 'UTC';
    const onSave = vi.fn();
    render(
      <TimeZoneSetting
        settings={{ ...base, timeZone: '', serverTime: { zone: 'UTC', source: 'default', now: '2026-11-13T13:05:00Z', fallback: 'UTC' } }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zeitzone' }));
    fireEvent.change(screen.getByLabelText('Suchen …'), { target: { value: 'tokyo' } });
    fireEvent.click(screen.getByRole('option', { name: 'Asia/Tokyo' }));
    expect(onSave).toHaveBeenCalledWith({ timeZone: 'Asia/Tokyo' });
  });

  it('offers the browser zone and taking the setting back', () => {
    browserZone = 'America/Los_Angeles';
    const onSave = vi.fn();
    render(
      <TimeZoneSetting
        settings={{
          ...base,
          timeZone: 'Europe/Berlin',
          serverTime: { zone: 'Europe/Berlin', source: 'setting', now: '2026-11-13T14:05:00+01:00', fallback: 'Asia/Tokyo' },
        }}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zeitzone' }).textContent).toContain('Europe/Berlin');
    expect(document.querySelector('[data-server-time]')?.textContent).toContain('(Europe/Berlin, UTC+01:00)');
    expect(screen.getByText('Quelle: diese Einstellung')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zeitzone dieses Browsers übernehmen (America/Los Angeles)' }));
    expect(onSave).toHaveBeenLastCalledWith({ timeZone: 'America/Los_Angeles' });
    fireEvent.click(screen.getByRole('button', { name: 'Nicht mehr festlegen' }));
    expect(onSave).toHaveBeenLastCalledWith({ timeZone: '' });
    // Without the setting the server would use TZ: the empty choice says so
    fireEvent.click(screen.getByRole('button', { name: 'Zeitzone' }));
    expect(screen.getByRole('option', { name: 'Nicht festgelegt (Asia/Tokyo)' })).toBeTruthy();
  });
});
