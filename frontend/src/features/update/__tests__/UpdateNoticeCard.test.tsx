import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api';
import type { UpdateStatus, User } from '../../../lib/types';
import { UpdateNoticeCard } from '../UpdateNoticeCard';
import { UpdateStatusCard } from '../../settings/admin/UpdateStatusCard';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, api: { ...actual.api, adminUpdateStatus: vi.fn(), adminDismissUpdate: vi.fn() } };
});

const person = (role: 'admin' | 'member', tourOffered = true) =>
  ({ id: 'usr_anna', email: 'anna@example.com', displayName: 'Anna', role, tourOffered }) as User;

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true,
  current: 'v1.1.0',
  latest: 'v1.2.0',
  url: 'https://github.com/mindsift-app/mindsift/releases/tag/v1.2.0',
  publishedAt: '2026-11-10T09:30:00Z',
  checkedAt: '2026-11-15T08:00:00Z',
  available: true,
  dismissed: false,
  ...over,
});

const card = () => screen.queryByRole('dialog', { name: 'MindSift 1.2.0 ist erschienen' });

describe('UpdateNoticeCard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.adminUpdateStatus).mockReset();
    vi.mocked(api.adminDismissUpdate).mockReset();
    vi.mocked(api.adminUpdateStatus).mockResolvedValue(status());
    vi.mocked(api.adminDismissUpdate).mockResolvedValue(status({ dismissed: true }));
  });

  it('tells an admin about a newer release, with a link to its page in a new tab', async () => {
    render(<UpdateNoticeCard user={person('admin')} demoMode={false} />);
    await waitFor(() => expect(card()).not.toBeNull());
    expect(screen.getByText(/Installiert ist v1\.1\.0/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Was ist neu/ });
    expect(link.getAttribute('href')).toBe('https://github.com/mindsift-app/mindsift/releases/tag/v1.2.0');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('never asks the server for members', async () => {
    render(<UpdateNoticeCard user={person('member')} demoMode={false} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.adminUpdateStatus).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('stays away in the demo', async () => {
    render(<UpdateNoticeCard user={person('admin')} demoMode />);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.adminUpdateStatus).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('shows nothing when up to date, switched off or already put aside', async () => {
    for (const s of [
      status({ available: false, latest: 'v1.1.0' }),
      status({ enabled: false, reason: 'off', available: false, latest: undefined }),
      status({ dismissed: true }),
    ]) {
      vi.mocked(api.adminUpdateStatus).mockResolvedValueOnce(s);
      const { unmount } = render(<UpdateNoticeCard user={person('admin')} demoMode={false} />);
      await waitFor(() => expect(api.adminUpdateStatus).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(card()).toBeNull();
      unmount();
      vi.mocked(api.adminUpdateStatus).mockClear();
    }
  });

  it('"Später" puts this release aside on the server', async () => {
    render(<UpdateNoticeCard user={person('admin')} demoMode={false} />);
    await waitFor(() => expect(card()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));
    expect(card()).toBeNull();
    expect(api.adminDismissUpdate).toHaveBeenCalledWith('v1.2.0');
  });

  it('closing with × counts as well', async () => {
    render(<UpdateNoticeCard user={person('admin')} demoMode={false} />);
    await waitFor(() => expect(card()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(card()).toBeNull();
    expect(api.adminDismissUpdate).toHaveBeenCalledWith('v1.2.0');
  });

  it('waits while the tour is still to be offered, and while something else holds the screen', async () => {
    const { rerender } = render(<UpdateNoticeCard user={person('admin', false)} demoMode={false} />);
    await waitFor(() => expect(api.adminUpdateStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(card()).toBeNull();
    // The tour was answered: now it may show
    rerender(<UpdateNoticeCard user={person('admin', true)} demoMode={false} />);
    await waitFor(() => expect(card()).not.toBeNull());
    rerender(<UpdateNoticeCard user={person('admin', true)} demoMode={false} suppressed />);
    expect(card()).toBeNull();
  });
});

describe('UpdateStatusCard', () => {
  beforeEach(() => vi.mocked(api.adminUpdateStatus).mockReset());

  it('names installed and latest release, the link and how to update', async () => {
    vi.mocked(api.adminUpdateStatus).mockResolvedValue(status());
    render(<UpdateStatusCard />);
    await waitFor(() => expect(screen.getByText('MindSift 1.2.0 ist erschienen.')).toBeTruthy());
    expect(screen.getByText('v1.1.0')).toBeTruthy();
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Was ist neu/ }).getAttribute('target')).toBe('_blank');
    expect(screen.getByText('docker compose pull && docker compose up -d')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull(); // no update button
  });

  it('says when it is up to date', async () => {
    vi.mocked(api.adminUpdateStatus).mockResolvedValue(status({ current: 'v1.2.0', available: false }));
    render(<UpdateStatusCard />);
    await waitFor(() => expect(screen.getByText('Du verwendest die neueste Version.')).toBeTruthy());
    expect(screen.queryByText(/docker compose pull/)).toBeNull();
  });

  it('says why there is no check', async () => {
    vi.mocked(api.adminUpdateStatus).mockResolvedValue(
      status({ enabled: false, reason: 'off', current: 'v1.1.0', latest: undefined, available: false }),
    );
    render(<UpdateStatusCard />);
    await waitFor(() => expect(screen.getByText(/UPDATE_CHECK=false/)).toBeTruthy());
    expect(screen.queryByText('Neueste')).toBeNull();
  });
});
