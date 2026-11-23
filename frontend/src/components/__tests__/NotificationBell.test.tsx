import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { api } from '../../lib/api';
import { NotificationBell } from '../NotificationBell';
import { setCenter } from '../notificationCenter';

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getNotifications').mockResolvedValue({ items: [], unread: 0 } as never);
    setCenter({ items: [], unread: 0 });
  });

  it('opens with the bell; a press outside and Escape close the list, a press inside does not', () => {
    render(<NotificationBell variant="desktop" onOpen={vi.fn()} />);
    const bell = screen.getByRole('button', { name: 'Benachrichtigungen' });
    fireEvent.click(bell);
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(bell);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
