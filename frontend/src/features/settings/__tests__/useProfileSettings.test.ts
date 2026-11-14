import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { api } from '../../../lib/api';
import type { User } from '../../../lib/types';
import { useProfileSettings } from '../user/useProfileSettings';

// The server stores an empty display name as the username
vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      getMe: vi.fn(async () => ({ isLastAdmin: false })),
      updateSettings: vi.fn(async (patch: { displayName?: string }) => ({
        ...user,
        displayName: patch.displayName?.trim() || user.username,
      })),
    },
  };
});

const user: User = {
  id: 'u1',
  email: 'sandro@email.de',
  username: 'sandro',
  displayName: 'sandro',
  role: 'member',
  isActive: true,
  alarmChannels: [],
  createdAt: '2026-11-14T00:00:00Z',
};

const submit = { preventDefault: () => {} } as React.FormEvent;

describe('useProfileSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves an empty display name and then shows the username the server stored', async () => {
    const onUserUpdated = vi.fn();
    const { result } = renderHook(() => useProfileSettings(user, onUserUpdated));

    // The name already was the username: clearing it changes nothing the server would send back
    act(() => result.current.setDisplayName(''));
    expect(result.current.profileDirty).toBe(true);
    await act(async () => {
      await result.current.handleSaveProfile(submit);
    });

    expect(api.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ displayName: '' }));
    expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'sandro' }));
    expect(result.current.displayName).toBe('sandro');
    expect(result.current.profileDirty).toBe(false);
    expect(result.current.profileMsg?.type).toBe('ok');
  });
});
