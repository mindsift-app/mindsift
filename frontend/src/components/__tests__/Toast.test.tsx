import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';
import { Toast, ToastHost, useToast, TOAST_MS } from '../Toast';
import { StatusToast } from '../StatusToast';
import { ErrorNoticeHost, showError } from '../ErrorNotice';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast (notices at the bottom)', () => {
  it('shows the text and runs an action after closing itself', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<Toast text="In den Papierkorb verschoben" actions={[{ label: 'Rückgängig', run }]} onClose={onClose} />);
    expect(screen.getByRole('status').textContent).toContain('In den Papierkorb verschoben');
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('has a close button only when asked for one, and errors are alerts', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Toast text="Gespeichert" onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
    rerender(<Toast text="Fehlgeschlagen" tone="err" role="alert" closable onClose={onClose} />);
    expect(screen.getByRole('alert').className).toContain('text-status-err');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts an undo, an error and a status of the settings into one stack instead of on top of each other', () => {
    render(
      <>
        <Toast text="Aufgabe gelöscht" actions={[{ label: 'Rückgängig', run: () => {} }]} />
        <StatusToast msg={{ type: 'ok', text: 'Gespeichert' }} onClose={() => {}} />
        <ErrorNoticeHost />
      </>
    );
    act(() => showError('Keine Verbindung'));
    const undo = screen.getByText('Aufgabe gelöscht').closest('[data-toast]') as HTMLElement;
    const error = screen.getByText('Keine Verbindung').closest('[role="alert"]') as HTMLElement;
    const stack = undo.parentElement as HTMLElement;
    expect(stack.className).toMatch(/fixed/);
    expect(stack.className).toMatch(/flex-col/);
    expect(stack.contains(error)).toBe(true);
    expect(stack.contains(screen.getByText('Gespeichert'))).toBe(true);
  });
});

describe('useToast', () => {
  it('goes after a few seconds, longer with an action, and a new notice replaces the old one', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast('Kopiert'));
    expect(result.current.toast?.text).toBe('Kopiert');
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(result.current.toast).toBeNull();

    act(() => result.current.showToast('Gelöscht', [{ label: 'Rückgängig', run: () => {} }]));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(result.current.toast?.text).toBe('Gelöscht');
    act(() => result.current.showToast('Verschoben'));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1);
    });
    // The newer notice keeps its own time
    expect(result.current.toast?.text).toBe('Verschoben');
    act(() => result.current.hideToast());
    expect(result.current.toast).toBeNull();
  });

  it('ToastHost shows nothing without a notice', () => {
    render(<ToastHost toast={null} onClose={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
