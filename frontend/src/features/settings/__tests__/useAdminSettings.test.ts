import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { User } from '../../../lib/types';

vi.mock('../../../lib/api', async () =>
  (await import('../../../test/apiMock')).stubApi(
    {
      adminGetUsers: vi.fn(async () => []),
      adminGetInvites: vi.fn(async () => []),
      adminGetOrganizations: vi.fn(async () => []),
      adminGetSettings: vi.fn(async () => ({ sharingMode: 'private', instanceName: 'Privat', defaultLanguage: 'en' })),
      getAuthStatus: vi.fn(async () => ({})),
    },
    { setCurrentPeopleSearch: vi.fn() }
  )
);

import { useAdminSettings } from '../admin/useAdminSettings';

const admin = { id: 'u1', email: '', username: 'anna', displayName: 'Anna', role: 'admin', isActive: true } as User;

describe('useAdminSettings', () => {
  // The field showed German whatever the server used, e.g. after the setup wizard chose English
  it('takes the server’s default language', async () => {
    const { result } = renderHook(() => useAdminSettings(admin, true));
    await waitFor(() => expect(result.current.settings.instanceName).toBe('Privat'));
    expect(result.current.settings.defaultLanguage).toBe('en');
  });
});
