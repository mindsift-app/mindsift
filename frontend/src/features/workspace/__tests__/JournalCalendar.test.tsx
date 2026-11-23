import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n, { addTexts } from '../../../i18n';
import en from '../../../locales/en';
import { JournalCalendar } from '../JournalCalendar';

// The days of the grid in order ('' for an empty cell of a neighbouring month)
const cells = (container: HTMLElement) =>
  [...container.querySelectorAll('.grid-cols-7')[1].children].map((c) => c.textContent || '');
const weekdays = (container: HTMLElement) =>
  [...container.querySelectorAll('.grid-cols-7')[0].children].map((c) => c.textContent);

describe('JournalCalendar', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('de');
    });
  });

  it('starts the week on Monday in German', () => {
    // Oktober 2026 beginnt an einem Donnerstag
    const { container } = render(<JournalCalendar activeDate="2026-10-15" entryDates={new Set()} onSelect={() => {}} />);
    expect(weekdays(container)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(cells(container).slice(0, 4)).toEqual(['', '', '', '1']);
    expect(cells(container).filter(Boolean)).toHaveLength(31);
    expect(cells(container).length % 7).toBe(0);
  });

  it('starts the week on Sunday in US English, like the date field', async () => {
    addTexts('en', en);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const { container } = render(<JournalCalendar activeDate="2026-10-15" entryDates={new Set()} onSelect={() => {}} />);
    expect(weekdays(container)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    expect(cells(container).slice(0, 5)).toEqual(['', '', '', '', '1']);
    expect(screen.getByTitle('Thursday, October 1, 2026')).toBeTruthy();
  });
});
