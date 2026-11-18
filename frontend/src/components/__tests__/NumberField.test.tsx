import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberField } from '../NumberField';

const field = () => screen.getByRole('spinbutton', { name: 'Längste Aufnahme' }) as HTMLInputElement;

describe('NumberField', () => {
  it('shows the number with its unit, without the browser number input', () => {
    render(<NumberField value={600} min={5} max={3600} unit="Sekunden" label="Längste Aufnahme" onCommit={() => {}} />);
    expect(field().type).toBe('text');
    expect(field().inputMode).toBe('numeric');
    expect(field().value).toBe('600');
    expect(screen.getByText('Sekunden')).toBeTruthy();
    expect(field().getAttribute('aria-valuetext')).toBe('600 Sekunden');
  });

  it('takes the number when left or on Enter, not while typing', () => {
    const onCommit = vi.fn();
    render(<NumberField value={600} min={5} max={3600} label="Längste Aufnahme" onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '120' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledWith(120);
    field().focus();
    fireEvent.change(field(), { target: { value: '90' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onCommit).toHaveBeenLastCalledWith(90);
  });

  it('keeps to min and max, drops letters and goes back when empty', () => {
    const onCommit = vi.fn();
    render(<NumberField value={600} min={5} max={3600} label="Längste Aufnahme" onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '9999' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(3600);
    expect(field().value).toBe('3600');
    fireEvent.change(field(), { target: { value: '1' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(5);
    fireEvent.change(field(), { target: { value: '1a2' } });
    expect(field().value).toBe('12');
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(field().value).toBe('600');
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('steps with the arrow keys, Escape goes back', () => {
    const onCommit = vi.fn();
    render(<NumberField value={8} min={2} max={30} label="Längste Aufnahme" onCommit={onCommit} />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().value).toBe('6');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field().value).toBe('8');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledWith(9);
  });

  it('takes a new value from outside, and is locked when disabled', () => {
    const { rerender } = render(<NumberField value={8} min={2} max={30} label="Längste Aufnahme" onCommit={() => {}} />);
    rerender(<NumberField value={4} min={2} max={30} label="Längste Aufnahme" onCommit={() => {}} disabled />);
    expect(field().value).toBe('4');
    expect(field().disabled).toBe(true);
  });
});
