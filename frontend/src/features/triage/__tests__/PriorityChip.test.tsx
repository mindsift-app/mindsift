import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PriorityChip } from '../PriorityChip';
import type { Thought } from '../../../lib/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const task = (priority: string) => ({ id: 't1', priority }) as unknown as Thought;
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });

describe('PriorityChip', () => {
  const original = window.innerWidth;
  afterEach(() => setWidth(original));

  it('wechselt am Desktop die Priorität per Klick', () => {
    setWidth(1280);
    const onCycle = vi.fn();
    render(<PriorityChip task={task('urgent')} onCycle={onCycle} size="sm" />);
    fireEvent.click(screen.getByRole('button'));
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it('ist am Handy nur Anzeige: kein Button, Tipp ändert nichts', () => {
    setWidth(400);
    const onCycle = vi.fn();
    render(<PriorityChip task={task('high')} onCycle={onCycle} size="xs" />);
    expect(screen.queryByRole('button')).toBeNull();
    const chip = screen.getByText('tasks:listing.high');
    fireEvent.click(chip);
    expect(onCycle).not.toHaveBeenCalled();
    expect(chip.getAttribute('title')).toBeNull();
  });

  it('zeigt bei normaler Priorität nichts', () => {
    setWidth(1280);
    const { container } = render(<PriorityChip task={task('normal')} onCycle={vi.fn()} size="sm" />);
    expect(container.firstChild).toBeNull();
  });
});
