import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendingEmailNote } from '../user/PendingEmailNote';
import { api } from '../../../lib/api';
import { User } from '../../../lib/types';

const user: User = {
  id: 'usr_1',
  email: 'anna@example.com',
  displayName: 'Anna',
  role: 'member',
  isActive: true,
  createdAt: '2026-11-10T08:00:00Z',
  pendingAlarmEmail: 'alarm@example.org',
  emailLinks: true,
};

describe('PendingEmailNote', () => {
  it('shows the waiting address, sends the link again and keeps the old one on request', async () => {
    const resend = vi.spyOn(api, 'resendEmailChange').mockResolvedValue();
    const cancel = vi.spyOn(api, 'cancelEmailChange').mockResolvedValue();
    const onUserUpdated = vi.fn();
    render(<PendingEmailNote user={user} kind="alarm" onUserUpdated={onUserUpdated} />);
    expect(screen.getByText(/Wartet auf Bestätigung: alarm@example.org/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Link erneut senden' }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith('alarm'));
    fireEvent.click(screen.getByRole('button', { name: 'Bisherige behalten' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('alarm'));
    expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ pendingAlarmEmail: undefined }));
  });

  it('says why nothing comes without a mail server, and shows nothing without a waiting address', () => {
    const { rerender, container } = render(
      <PendingEmailNote user={{ ...user, emailLinks: false }} kind="alarm" onUserUpdated={vi.fn()} />
    );
    expect(screen.getByText(/verschickt keine E-Mails/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link erneut senden' })).toBeNull();
    rerender(<PendingEmailNote user={user} kind="account" onUserUpdated={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
