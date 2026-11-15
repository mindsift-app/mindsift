import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TasksFilterSheet } from '../TasksFilterSheet';
import { ActiveFilterBanner } from '../ActiveFilterBanner';
import { Thought } from '../../../lib/types';

const task = (id: string, tags: string[]) => ({ id, tags }) as unknown as Thought;
const tasks = [task('1', ['backup', 'garten']), task('2', ['backup']), task('3', ['einkauf'])];
const noop = () => {};

function sheet(selectedTags: string[], toggleTag = vi.fn(), clearTags = vi.fn()) {
  render(
    <TasksFilterSheet
      allAvailableTags={['backup', 'einkauf', 'garten']}
      defaultGroupBy="none"
      groupBy="none"
      groupOptions={[]}
      safeTasks={tasks}
      selectedTags={selectedTags}
      setGroupBy={noop}
      toggleTag={toggleTag}
      clearTags={clearTags}
      setShowFilterModal={noop}
      setSortBy={noop}
      sortBy="custom"
      viewMode="list"
      showFilterModal
    />
  );
  return { toggleTag, clearTags };
}

describe('phone hashtag filter', () => {
  it('a tap switches one hashtag on or off, several stay chosen, "Alle" clears them', () => {
    const { toggleTag, clearTags } = sheet(['backup', 'garten']);
    expect(screen.getByRole('button', { name: /#backup/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /#garten/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /#einkauf/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Alle (3)' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /#einkauf/ }));
    expect(toggleTag).toHaveBeenCalledWith('einkauf');
    fireEvent.click(screen.getByRole('button', { name: 'Alle (3)' }));
    expect(clearTags).toHaveBeenCalled();
  });

  it('the banner names the chosen hashtags compactly and clears them with one tap', () => {
    const clearTags = vi.fn();
    render(
      <ActiveFilterBanner
        selectedTags={['backup', 'garten', 'einkauf']}
        clearTags={clearTags}
        groupBy="none"
        defaultGroupBy="none"
        setGroupBy={noop}
        sortBy="custom"
        setSortBy={noop}
      />
    );
    expect(screen.getByText('#backup +2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hashtag-Filter aufheben' }));
    expect(clearTags).toHaveBeenCalled();
  });
});
