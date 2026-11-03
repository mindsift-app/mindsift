import { describe, it, expect } from 'vitest';
import { columnDotClass } from '../ManageColumnsModal';

describe('columnDotClass', () => {
  it('uses the chosen colour, also the names of the server defaults', () => {
    expect(columnDotClass({ id: 'x', name: 'Review', color: 'purple' })).toBe('bg-tone-purple');
    expect(columnDotClass({ id: 'x', name: 'Blockiert', color: 'red' })).toBe('bg-status-err');
    expect(columnDotClass({ id: 'waiting', name: 'Wartet', color: 'amber' })).toBe('bg-status-warn');
    expect(columnDotClass({ id: 'done', name: 'Erledigt', color: 'emerald', isDone: true })).toBe('bg-status-ok');
  });

  it('keeps the colour of the role for columns without one', () => {
    expect(columnDotClass({ id: 'in_progress', name: 'In Arbeit' })).toBe('bg-accent');
    expect(columnDotClass({ id: 'x', name: 'Fertig', isDone: true })).toBe('bg-status-ok');
    expect(columnDotClass({ id: 'x', name: 'Neu' })).toBe('bg-faint');
    expect(columnDotClass(undefined)).toBe('bg-faint');
  });
});
