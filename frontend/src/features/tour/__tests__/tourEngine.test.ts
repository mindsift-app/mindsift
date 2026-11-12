import { describe, expect, it } from 'vitest';
import { pickTarget, startTour, tourReducer, tourReturnTab, TourAction, TourState } from '../tourEngine';
import { dockCard, placeCard } from '../tourLayout';
import { TOUR_STEPS } from '../tourSteps';

const TOTAL = 7;
const run = (state: TourState, ...actions: TourAction['type'][]) =>
  actions.reduce((s, type) => tourReducer(s, { type } as TourAction, TOTAL), state);

describe('tour steps', () => {
  it('has the seven steps in the chosen order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['triage', 'notes', 'linked', 'focus', 'tasks', 'search', 'end']);
  });

  it('finds every control by a data attribute, never by text or class', () => {
    for (const step of TOUR_STEPS) {
      for (const selector of [...step.targets, ...(step.also ?? [])]) {
        for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\[data-[a-z-]+(="[a-z-]+")?\]$/);
      }
    }
  });
});

describe('tourReducer', () => {
  it('goes forward step by step and ends after the last one', () => {
    let s = run(startTour('help'), 'shown');
    for (let i = 1; i < TOTAL; i++) {
      s = run(s, 'next', 'shown');
      expect(s.index).toBe(i);
    }
    s = run(s, 'next');
    expect(s.done).toBe(true);
    expect(tourReturnTab(s)).toBe('help');
  });

  it('skips a step without a target in the direction of travel', () => {
    // Step 3 (index 3) has nothing to show: forward it goes on to 4
    let s = run(startTour('help'), 'shown', 'next', 'shown', 'next', 'shown', 'next');
    expect(s.index).toBe(3);
    s = run(s, 'skip');
    expect(s.index).toBe(4);
    s = run(s, 'shown');
    // Back from 4: 3 is skipped again, now backwards, to 2
    s = run(s, 'back');
    expect(s).toMatchObject({ index: 3, dir: -1 });
    s = run(s, 'skip');
    expect(s.index).toBe(2);
  });

  it('stays at the step shown last when nothing before it can be shown', () => {
    let s: TourState = { index: 1, dir: 1, shown: 1, origin: 'tasks', done: false };
    s = run(s, 'back', 'skip');
    expect(s).toMatchObject({ index: 1, dir: 1, done: false });
  });

  it('does not go back from the first step', () => {
    const s = run(startTour('help'), 'shown', 'back');
    expect(s.index).toBe(0);
  });

  it('ends when the last step is skipped', () => {
    const s = run({ index: TOTAL - 1, dir: 1, shown: TOTAL - 2, origin: 'workspace', done: false }, 'skip');
    expect(s.done).toBe(true);
    expect(tourReturnTab(s)).toBe('workspace');
  });

  it('closes from any step and returns to where it started', () => {
    const s = run(startTour('triage'), 'shown', 'next', 'next', 'close');
    expect(s.done).toBe(true);
    expect(tourReturnTab(s)).toBe('triage');
    // Nothing moves once it is over
    expect(run(s, 'next', 'back')).toBe(s);
  });
});

describe('pickTarget', () => {
  const items: Record<string, { id: string; shown: boolean }[]> = {
    a: [{ id: 'a1', shown: false }],
    b: [
      { id: 'b1', shown: false },
      { id: 'b2', shown: true },
    ],
  };
  const query = (sel: string) => items[sel] ?? [];
  it('takes the first visible element of the first candidate that has one', () => {
    expect(pickTarget(['a', 'b'], query, (e) => e.shown)?.id).toBe('b2');
    expect(pickTarget(['a', 'missing'], query, (e) => e.shown)).toBeNull();
  });
});

describe('card placement', () => {
  it('puts the card below a small control at the top, pointing at it', () => {
    const p = placeCard({ left: 600, top: 10, width: 32, height: 32 }, { width: 360, height: 200 }, 1280, 900);
    expect(p.side).toBe('below');
    expect(p.top).toBe(56);
    expect(p.arrow).toBe(616 - p.left);
  });

  it('puts the card beside a tall target and inside one that fills the window', () => {
    expect(placeCard({ left: 20, top: 100, width: 300, height: 700 }, { width: 360, height: 300 }, 1280, 900).side).toBe('right');
    expect(placeCard({ left: 0, top: 0, width: 1280, height: 900 }, { width: 360, height: 300 }, 1280, 900).side).toBe('inside');
    expect(placeCard(null, { width: 360, height: 300 }, 1280, 900).side).toBe('center');
  });

  it('puts the card at the window edge when a big target leaves room on one side but not enough', () => {
    // The triage deck: centred, most of the height, about 300 px free on either side
    const p = placeCard({ left: 304, top: 97, width: 672, height: 720 }, { width: 360, height: 440 }, 1280, 860);
    expect(p).toMatchObject({ side: 'right', left: 1280 - 360 - 12, arrow: null });
    expect(p.top + 440).toBeLessThanOrEqual(97 + 720);
  });

  it('docks on phones where it covers less of the target, above the lit + at the bottom', () => {
    const plus = { left: 170, top: 800, width: 60, height: 52 };
    const deck = { left: 12, top: 70, width: 376, height: 460 };
    const p = dockCard(deck, [deck, plus], 300, 860);
    expect(p.side).toBe('dock-bottom');
    expect(p.top + 300).toBeLessThanOrEqual(plus.top);
    // A target low on the screen: the card goes to the top
    expect(dockCard({ left: 12, top: 600, width: 376, height: 150 }, [], 300, 860).side).toBe('dock-top');
  });
});
