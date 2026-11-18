import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';
import { StatusMessage, StatusToast, useStatusMessage } from '../StatusToast';

afterEach(() => {
  vi.useRealTimers();
});

describe('StatusToast (answer to a save in the settings)', () => {
  it('announces a confirmation politely and closes it after a few seconds', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<StatusToast msg={{ type: 'ok', text: 'Gespeichert' }} onClose={onClose} />);
    expect(screen.getByRole('status').textContent).toContain('Gespeichert');
    expect(screen.getByRole('alert').textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an error until it is closed', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<StatusToast msg={{ type: 'err', text: 'Speichern fehlgeschlagen' }} onClose={onClose} />);
    expect(screen.getByRole('alert').textContent).toContain('Speichern fehlgeschlagen');
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('floats above the page instead of taking room in it', () => {
    const { container } = render(<StatusToast msg={{ type: 'ok', text: 'Gespeichert' }} onClose={() => {}} />);
    expect((container.firstElementChild as HTMLElement).className).toContain('fixed');
  });

  it('ends a confirmation when it leaves the page (the section is left), but keeps an error', () => {
    const onClose = vi.fn();
    const ok = render(<StatusToast msg={{ type: 'ok', text: 'Gespeichert' }} onClose={onClose} />);
    ok.unmount();
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    const err = render(<StatusToast msg={{ type: 'err', text: 'Speichern fehlgeschlagen' }} onClose={onClose} />);
    err.unmount();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts the time again for a new message', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(<StatusToast msg={{ type: 'ok', text: 'Gespeichert' }} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<StatusToast msg={{ type: 'ok', text: 'Gespeichert' }} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useStatusMessage (state of the notice in the view)', () => {
  it('lets a confirmation expire in the state, also while no notice shows it; an error stays', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStatusMessage<StatusMessage>());
    act(() => result.current[1]({ type: 'ok', text: 'Gespeichert' }));
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(result.current[0]?.text).toBe('Gespeichert');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBeNull();

    act(() => result.current[1]({ type: 'err', text: 'Speichern fehlgeschlagen' }));
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(result.current[0]?.text).toBe('Speichern fehlgeschlagen');
  });

  it('gives a newer confirmation its own few seconds', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStatusMessage<StatusMessage>());
    act(() => result.current[1]({ type: 'ok', text: 'Gespeichert' }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => result.current[1]({ type: 'ok', text: 'Testnachricht gesendet' }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current[0]?.text).toBe('Testnachricht gesendet');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBeNull();
  });
});
