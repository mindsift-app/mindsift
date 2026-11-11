import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const finishSetup = vi.fn(async (_payload: unknown) => {});
vi.mock('../../../lib/api', () => ({
  api: { finishSetup: (payload: unknown) => finishSetup(payload) },
  triggerHaptic: vi.fn(),
}));

import { FinishSetupView } from '../FinishSetupView';

const admin = { id: 'u', email: '', username: 'chef', displayName: 'Chef', role: 'admin', isActive: true } as never;
const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift' };

describe('FinishSetupView', () => {
  beforeEach(() => finishSetup.mockClear());

  it('asks only the instance settings and sends them', async () => {
    const onDone = vi.fn();
    render(<FinishSetupView user={admin} authStatus={status} onDone={onDone} onLogout={() => {}} />);
    expect(screen.getByText('chef')).toBeTruthy();
    // No account fields: the admin exists already
    expect(screen.queryByText('Administrator-Passwort *')).toBeNull();
    expect(screen.queryByText('E-Mail-Adresse (Login) *')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('MindSift'), { target: { value: ' Zuhause ' } });
    fireEvent.click(screen.getByRole('button', { name: /Privat/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
    });
    expect(finishSetup).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: 'Zuhause', sharingMode: 'private', allowRegistration: false, createSampleData: false })
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('shows the error and stays when saving fails', async () => {
    finishSetup.mockRejectedValueOnce(new Error('Ersteinrichtung wurde bereits abgeschlossen'));
    const onDone = vi.fn();
    render(<FinishSetupView user={admin} authStatus={status} onDone={onDone} onLogout={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
    });
    expect(screen.getByText('Ersteinrichtung wurde bereits abgeschlossen')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
