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
    expect(screen.queryByPlaceholderText('Hashtag suchen …')).toBeNull();
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
