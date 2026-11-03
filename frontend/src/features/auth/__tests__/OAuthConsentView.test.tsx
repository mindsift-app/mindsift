import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const getOAuthAuthorizeInfo = vi.fn();
const answerOAuthAuthorize = vi.fn(async () => ({ redirect: 'https://claude.ai/cb?code=c' }));
vi.mock('../../../lib/api', () => ({
  api: {
    getOAuthAuthorizeInfo: (...args: unknown[]) => getOAuthAuthorizeInfo(...(args as [])),
    answerOAuthAuthorize: (...args: unknown[]) => answerOAuthAuthorize(...(args as [])),
  },
  triggerHaptic: vi.fn(),
}));

import { OAuthConsentView } from '../OAuthConsentView';

const user = { id: 'u', email: 'a@b.de', displayName: 'Anna', role: 'member', isActive: true } as never;
const replace = vi.fn();

describe('OAuthConsentView', () => {
  beforeEach(() => {
    replace.mockClear();
    answerOAuthAuthorize.mockClear();
    getOAuthAuthorizeInfo.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { search: '?client_id=mcl_1&state=s', replace },
    });
  });

  it('preselects the requested rights and sends the chosen ones', async () => {
    getOAuthAuthorizeInfo.mockResolvedValue({
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      scopes: ['tasks:read', 'tasks:write', 'lists:read', 'lists:write'],
      offeredScopes: ['tasks:read', 'tasks:write', 'lists:read', 'lists:write', 'webhook:triage'],
    });
    render(<OAuthConsentView user={user} instanceName="MindSift" onLogout={() => {}} />);
    expect(await screen.findByText('Claude möchte auf dein MindSift zugreifen')).toBeTruthy();
    expect(screen.getByText('claude.ai')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Inbox' }).getAttribute('aria-checked')).toBe('false');
    // Narrow "create only" rights are not offered here
    expect(screen.queryByRole('switch', { name: 'Aufgaben anlegen' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Listen ändern' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Erlauben' }));
    });
    expect(answerOAuthAuthorize).toHaveBeenCalledWith('?client_id=mcl_1&state=s', true, ['tasks:read', 'tasks:write', 'lists:read']);
    expect(replace).toHaveBeenCalledWith('https://claude.ai/cb?code=c');
  });

  it('refuses, and cannot allow without any right', async () => {
    getOAuthAuthorizeInfo.mockResolvedValue({ clientName: 'X', redirectHost: 'x.example', scopes: ['tasks:read'], offeredScopes: ['tasks:read'] });
    render(<OAuthConsentView user={user} instanceName="MindSift" onLogout={() => {}} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Aufgaben lesen' }));
    expect((screen.getByRole('button', { name: 'Erlauben' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    });
    expect(answerOAuthAuthorize).toHaveBeenCalledWith('?client_id=mcl_1&state=s', false, []);
  });

  it('goes straight back when the server says the request is invalid for the client', async () => {
    getOAuthAuthorizeInfo.mockResolvedValue({ redirect: 'https://claude.ai/cb?error=invalid_request' });
    render(<OAuthConsentView user={user} instanceName="MindSift" onLogout={() => {}} />);
    await act(async () => {});
    expect(replace).toHaveBeenCalledWith('https://claude.ai/cb?error=invalid_request');
  });

  it('shows the error when there is nowhere safe to return to', async () => {
    getOAuthAuthorizeInfo.mockRejectedValue(new Error('Die Anwendung ist MindSift nicht bekannt.'));
    render(<OAuthConsentView user={user} instanceName="MindSift" onLogout={() => {}} />);
    expect(await screen.findByText('Die Anwendung ist MindSift nicht bekannt.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Erlauben' })).toBeNull();
  });
});
