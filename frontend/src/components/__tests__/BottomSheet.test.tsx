import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BottomSheet } from '../BottomSheet';
import { holdLeave } from '../../lib/leaveGuard';

const askChoice = vi.hoisted(() => vi.fn());
vi.mock('../askConfirm', () => ({ askChoice }));

const width = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });

describe('BottomSheet', () => {
  beforeEach(() => {
    askChoice.mockReset();
    width(390);
  });
  afterEach(() => width(1024));

  it('the backdrop, Escape and the X close it; a click inside does not', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet onClose={onClose} title="Filter">
        <p>Inhalt</p>
      </BottomSheet>
    );
    fireEvent.click(screen.getByText('Inhalt'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('leaves Escape to an open menu inside (default prevented)', () => {
    const onClose = vi.fn();
    render(<BottomSheet onClose={onClose}>x</BottomSheet>);
    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a phone-only sheet does not take Escape in a wide window', () => {
    width(1280);
    const onClose = vi.fn();
    render(
      <BottomSheet phoneOnly onClose={onClose}>
        x
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('with a guard, closing asks first while a dictation runs; children get the guarded close', async () => {
    const onClose = vi.fn();
    const holder = {};
    holdLeave(holder, true);
    render(
      <BottomSheet guard onClose={onClose}>
        {(close) => (
          <button type="button" onClick={close}>
            Abbrechen
          </button>
        )}
      </BottomSheet>
    );
    askChoice.mockResolvedValueOnce('alt');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    });
    expect(askChoice).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    askChoice.mockResolvedValueOnce('confirm');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    holdLeave(holder, false);
  });
});
