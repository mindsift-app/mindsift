import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmPopover } from '../ConfirmPopover';

describe('ConfirmPopover', () => {
  it('confirms with its button, which has the focus (Enter)', () => {
    const onConfirm = vi.fn();
    render(<ConfirmPopover x={100} y={100} message="Ordner löschen?" confirmLabel="In den Papierkorb" onConfirm={onConfirm} onCancel={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'In den Papierkorb' });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes without confirming on Abbrechen, Escape or a click outside', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmPopover x={100} y={100} message="Ordner löschen?" confirmLabel="Löschen" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
