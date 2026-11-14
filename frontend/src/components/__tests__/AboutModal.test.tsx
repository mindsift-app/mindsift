import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AboutModal, THIRD_PARTY_LICENSES_URL } from '../AboutModal';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AboutModal', () => {
  it('loads the licenses of the third-party software with the session and shows them in the window', async () => {
    localStorage.setItem('mindsift_jwt_token', 'tok');
    const fetchMock = vi.fn().mockResolvedValue(new Response('react 19.2.0 (MIT)', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AboutModal onClose={() => {}} />);
    expect(screen.getByText('Fremdsoftware')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Lizenzen der enthaltenen Bibliotheken/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Lizenzen der enthaltenen Bibliotheken/ }));
    expect(await screen.findByText('react 19.2.0 (MIT)')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(THIRD_PARTY_LICENSES_URL, expect.anything());
    expect(THIRD_PARTY_LICENSES_URL).toBe('/api/v1/third-party-licenses');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('says so when the licenses cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    render(<AboutModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Lizenzen der enthaltenen Bibliotheken/ }));
    expect(await screen.findByText('Die Lizenzen konnten nicht geladen werden.')).toBeTruthy();
  });
});
