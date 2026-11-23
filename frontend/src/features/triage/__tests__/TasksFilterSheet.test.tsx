import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TasksFilterSheet } from '../TasksFilterSheet';
import { ActiveFilterBanner } from '../ActiveFilterBanner';
import { makeTask } from '../../../test/fixtures';

const tasks = [makeTask('1', { tags: ['backup', 'garten'] }), makeTask('2', { tags: ['backup'] }), makeTask('3', { tags: ['einkauf'] })];
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

  it('every control in the sheet is at least 44 px tall on the phone', () => {
    render(
      <TasksFilterSheet
        allAvailableTags={['backup', 'einkauf', 'garten']}
        defaultGroupBy="none"
        groupBy="none"
        groupOptions={[
          { id: 'none', label: 'Keine' },
          { id: 'priority', label: 'Priorität' },
        ]}
        safeTasks={tasks}
        selectedTags={[]}
        setGroupBy={noop}
        toggleTag={noop}
        clearTags={noop}
        setShowFilterModal={noop}
        setSortBy={noop}
        sortBy="custom"
        viewMode="list"
        showFilterModal
      />
    );
    const buttons = screen.getAllByRole('button');
    // close, "Alle", 3 hashtags, 2 groupings, 5 sortings, reset, done
    expect(buttons).toHaveLength(14);
    for (const b of buttons) expect(b.className, b.textContent ?? '').toMatch(/(^|\s)(min-)?h-11(\s|$)/);
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy();
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
