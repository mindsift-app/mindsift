import type { ActiveTab } from '../../app/appTabs';

// Step logic of the guided tour, without the DOM: which step comes next, what happens when a step has
// nothing to point at, and where the tour ends. GuidedTour.tsx drives it.

export interface TourState {
  // The step shown or being looked for
  index: number;
  // Direction of travel: a step without a target is skipped in this direction
  dir: 1 | -1;
  // The last step that was shown (where "back" past the first available step stays)
  shown: number;
  // The page the tour was started on; it goes back there when it ends
  origin: ActiveTab;
  done: boolean;
}

export type TourAction =
  | { type: 'next' }
  | { type: 'back' }
  // The step at `index` has nothing visible to point at
  | { type: 'skip' }
  // The step at `index` was found and is shown
  | { type: 'shown' }
  | { type: 'close' };

export function startTour(origin: ActiveTab): TourState {
  return { index: 0, dir: 1, shown: -1, origin, done: false };
}

export function tourReducer(state: TourState, action: TourAction, total: number): TourState {
  if (state.done) return state;
  switch (action.type) {
    case 'next':
      return state.index + 1 >= total ? { ...state, done: true } : { ...state, index: state.index + 1, dir: 1 };
    case 'back':
      return state.index <= 0 ? state : { ...state, index: state.index - 1, dir: -1 };
    case 'shown':
      return { ...state, shown: state.index };
    case 'skip': {
      const index = state.index + state.dir;
      if (index >= total) return { ...state, done: true };
      // Nothing earlier to show: back to the step that was shown last (or onwards from the start)
      if (index < 0) return state.shown >= 0 ? { ...state, index: state.shown, dir: 1 } : { ...state, index: 0, dir: 1 };
      return { ...state, index };
    }
    case 'close':
      return { ...state, done: true };
  }
}

// The page to return to once the tour is over
export const tourReturnTab = (state: TourState): ActiveTab => state.origin;

// The first element of the candidates (CSS selectors, in order of preference) that `isVisible` accepts
export function pickTarget<T>(
  candidates: string[],
  query: (selector: string) => T[],
  isVisible: (el: T) => boolean
): T | null {
  for (const selector of candidates) {
    const el = query(selector).find(isVisible);
    if (el) return el;
  }
  return null;
}
