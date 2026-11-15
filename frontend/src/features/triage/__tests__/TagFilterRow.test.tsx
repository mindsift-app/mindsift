import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  it('shows every hashtag with its count and switches one on by a click', () => {
    const onToggle = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected={[]} onToggle={onToggle} onClear={() => {}} />);
    expect(screen.getByRole('button', { name: 'Alle 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '#backup 2' }).getAttribute('aria-pressed')).toBe('false');
    // Everything fits: no "+ n weitere"
    expect(screen.queryByRole('button', { name: /weitere/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '#garten 1' }));
    expect(onToggle).toHaveBeenCalledWith('garten');
  });

  it('marks several chosen hashtags; a click switches one off, "Alle" clears the filter', () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected={['backup', 'einkauf']} onToggle={onToggle} onClear={onClear} />);
    const alle = screen.getByRole('button', { name: 'Alle 3' });
    expect(alle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '#backup 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '#einkauf 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '#garten 1' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '#backup 2' }));
    expect(onToggle).toHaveBeenCalledWith('backup');
    fireEvent.click(alle);
    expect(onClear).toHaveBeenCalled();
  });

  it('puts what does not fit behind "+ n weitere", keeps the chosen chip and picks from the search', () => {
    rowWidth = 420;
    const onToggle = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected={['einkauf']} onToggle={onToggle} onClear={() => {}} />);
    // The chosen hashtag keeps its chip even though it comes last
    expect(screen.getByRole('button', { name: '#einkauf 1' })).toBeTruthy();
    const more = screen.getByRole('button', { name: '+2 weitere' });
    fireEvent.click(more);
    const search = screen.getByPlaceholderText('Hashtag suchen …');
    fireEvent.change(search, { target: { value: 'gar' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('garten');
    // Stays open for the next pick
    expect(screen.getByPlaceholderText('Hashtag suchen …')).toBeTruthy();
  });

  it('keeps the search open while several hashtags are switched there, shows them chosen, Escape closes it', () => {
    rowWidth = 420;
    const onToggle = vi.fn();
    const props = { tags, tasks, onToggle, onClear: () => {} };
    const { rerender } = render(<TagFilterRow {...props} selected={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /weitere/ }));
    const dialog = screen.getByRole('dialog');
    const search = screen.getByPlaceholderText('Hashtag suchen …');
    // A click on a row switches it and hands the focus back to the search
    fireEvent.click(within(dialog).getByRole('button', { name: /#garten/ }));
    expect(onToggle).toHaveBeenLastCalledWith('garten');
    expect(document.activeElement).toBe(search);
    rerender(<TagFilterRow {...props} selected={['garten']} />);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /#garten/ }).getAttribute('aria-pressed')).toBe('true');
    // Arrows and Enter pick the next one in the same popover
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onToggle).toHaveBeenLastCalledWith('einkauf');
    rerender(<TagFilterRow {...props} selected={['garten', 'einkauf']} />);
    const rows = within(screen.getByRole('dialog')).getAllByRole('button');
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'true']);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the search on a click outside', () => {
    rowWidth = 420;
    render(<TagFilterRow tags={tags} tasks={tasks} selected={[]} onToggle={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /weitere/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /#backup/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps every chosen hashtag in the row, even when they come last', () => {
    rowWidth = 420;
    render(<TagFilterRow tags={tags} tasks={tasks} selected={['garten', 'einkauf']} onToggle={() => {}} onClear={() => {}} />);
    expect(screen.getByRole('button', { name: '#garten 1' }).getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('button', { name: '#einkauf 1' }).getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('button', { name: '+1 weiterer' })).toBeTruthy();
  });

  it('marks the first hit again after a new search', () => {
    rowWidth = 420;
    const onToggle = vi.fn();
    render(<TagFilterRow tags={tags} tasks={tasks} selected={[]} onToggle={onToggle} onClear={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /weitere/ }));
    const search = screen.getByPlaceholderText('Hashtag suchen …');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.change(search, { target: { value: 'e' } }); // garten, einkauf
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('garten');
  });

  it('says so when the search finds nothing', () => {
    rowWidth = 420;
    render(<TagFilterRow tags={tags} tasks={tasks} selected={[]} onToggle={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /weitere/ }));
    fireEvent.change(screen.getByPlaceholderText('Hashtag suchen …'), { target: { value: 'xyz' } });
    expect(screen.getByText('Kein Hashtag gefunden')).toBeTruthy();
  });
});
