import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StatusToast } from '../StatusToast';

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
