import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ApiError } from '../../../lib/api/client';

vi.mock('../../../lib/api', async () => {
  const client = await vi.importActual<typeof import('../../../lib/api/client')>('../../../lib/api/client');
  return {
    ApiError: client.ApiError,
    api: {
      getMfaStatus: vi.fn(async () => ({ available: true, enabled: true, totp: { enabled: true }, passkeys: [], recoveryCodesLeft: 10, trustedDevices: [] })),
      passkeyChallenge: vi.fn(),
    },
  };
});

import { SecondFactorHost, withSecondFactor } from '../user/askSecondFactor';

const needed = () => new ApiError('Bitte gib zur Bestätigung einen Code deiner Authenticator-App ein', 403, 'mfa_required');
const wrong = () => new ApiError('Der Code ist falsch oder abgelaufen', 403, 'mfa_invalid');

describe('withSecondFactor', () => {
  beforeEach(() => render(<SecondFactorHost />));

  it('runs the change once when no second factor is asked', async () => {
    const run = vi.fn(async () => 'ok');
    await expect(withSecondFactor(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Mit zweitem Faktor bestätigen')).toBeNull();
  });

  it('asks for the code, asks again after a wrong one and runs the change with it', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(needed())
      .mockRejectedValueOnce(wrong())
      .mockResolvedValueOnce('ok');
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = withSecondFactor(run);
    });
    const field = await screen.findByLabelText('Code der App oder Wiederherstellungscode');
    fireEvent.change(field, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await screen.findByText('Der Code ist falsch oder abgelaufen');
    fireEvent.change(screen.getByLabelText('Code der App oder Wiederherstellungscode'), { target: { value: '222222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await expect(result).resolves.toBe('ok');
    expect(run).toHaveBeenNthCalledWith(2, { code: '111111' });
    expect(run).toHaveBeenNthCalledWith(3, { code: '222222' });
  });

  it('changes nothing when cancelled', async () => {
    const run = vi.fn().mockRejectedValueOnce(needed());
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = withSecondFactor(run);
      result.catch(() => {});
    });
    await screen.findByLabelText('Code der App oder Wiederherstellungscode');
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(result).rejects.toMatchObject({ code: 'mfa_cancelled' });
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Mit zweitem Faktor bestätigen')).toBeNull());
  });
});
