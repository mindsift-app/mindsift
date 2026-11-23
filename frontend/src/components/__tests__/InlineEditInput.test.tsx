import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditInput } from '../InlineEditInput';

function setup(value = '2 kg') {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<InlineEditInput aria-label="Menge" value={value} onSave={onSave} onCancel={onCancel} />);
  return { input: screen.getByLabelText('Menge') as HTMLInputElement, onSave, onCancel };
}

describe('InlineEditInput', () => {
  it('saves the typed text once on Enter, not again on the blur after it', () => {
    const { input, onSave, onCancel } = setup();
    fireEvent.change(input, { target: { value: '3 kg' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('3 kg');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('saves when the field is left', () => {
    const { input, onSave } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('');
  });

  it('cancels on Escape and takes the key from the dialog around it', () => {
    const { input, onSave, onCancel } = setup();
    fireEvent.change(input, { target: { value: '5 kg' } });
    // fireEvent answers false when the event's default was prevented
    const notTaken = fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(notTaken).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe('2 kg');
  });

  it('counts Enter without typing as cancelled, and a new focus starts a new edit', () => {
    const { input, onSave, onCancel } = setup();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1 Stück' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('1 Stück');
  });
});
