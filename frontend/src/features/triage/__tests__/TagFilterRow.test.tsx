import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagFilterRow } from '../TagFilterRow';
import { Thought } from '../../../lib/types';

const task = (id: string, tags: string[]) => ({ id, tags }) as unknown as Thought;
const tasks = [task('1', ['backup', 'garten']), task('2', ['backup']), task('3', ['einkauf'])];
const tags = ['backup', 'garten', 'einkauf'];

// jsdom lays nothing out: every chip 100 px wide, the row 280 px (room for "Alle" and about one more chip)
let rowWidth = 2000;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'BUTTON' || this.tagName === 'SPAN' || this.tagName === 'DIV' ? 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'group' ? rowWidth : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rowWidth = 2000;
});

describe('TagFilterRow', () => {
  it('shows every hashtag with its count and filters by a click', () => {
    const onSelect = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected={null} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Alle 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '#backup 2' }).getAttribute('aria-pressed')).toBe('false');
    // Everything fits: no "+ n weitere"
    expect(screen.queryByRole('button', { name: /weitere/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '#garten 1' }));
    expect(onSelect).toHaveBeenCalledWith('garten');
  });

  it('a second click on the chosen hashtag clears the filter', () => {
    const onSelect = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected="backup" onSelect={onSelect} />);
    const chip = screen.getByRole('button', { name: '#backup 2' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('puts what does not fit behind "+ n weitere", keeps the chosen chip and picks from the search', () => {
    rowWidth = 420;
    const onSelect = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected="einkauf" onSelect={onSelect} />);
    // The chosen hashtag keeps its chip even though it comes last
    expect(screen.getByRole('button', { name: '#einkauf 1' })).toBeTruthy();
    const more = screen.getByRole('button', { name: '+2 weitere' });
    fireEvent.click(more);
    const search = screen.getByPlaceholderText('Hashtag suchen …');
    fireEvent.change(search, { target: { value: 'gar' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('garten');
    expect(screen.queryByPlaceholderText('Hashtag suchen …')).toBeNull();
  });

  it('marks the first hit again after a new search', () => {
    rowWidth = 420;
    const onSelect = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /weitere/ }));
    const search = screen.getByPlaceholderText('Hashtag suchen …');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.change(search, { target: { value: 'e' } }); // garten, einkauf
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('garten');
  });

  it('says so when the search finds nothing', () => {
    rowWidth = 420;
    render(<TagFilterRow tags={tags} tasks={tasks} selected={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /weitere/ }));
    fireEvent.change(screen.getByPlaceholderText('Hashtag suchen …'), { target: { value: 'xyz' } });
    expect(screen.getByText('Kein Hashtag gefunden')).toBeTruthy();
  });
});
