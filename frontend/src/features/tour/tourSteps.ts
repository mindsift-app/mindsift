import type { ActiveTab } from '../../app/appTabs';

// The steps of the guided tour, in the order the user chose (no more, or nobody watches it to the end).
// Each step names the page it shows and the controls it points at, found by stable attributes
// (data-tour="…" on the controls), never by texts or classes. Texts live in locales/<code>/tour.json and in
// TourContent.tsx.
export type TourStepId = 'triage' | 'notes' | 'linked' | 'focus' | 'tasks' | 'search' | 'end';

export interface TourStep {
  id: TourStepId;
  // The page to open for this step; null keeps the one that is open
  tab: ActiveTab | null;
  // Where the card points: the first of these that is visible on the screen (desktop and phone have
  // different controls, an empty account has fewer). A step none of them is visible for is skipped.
  targets: string[];
  // Shown at the same time, without the card pointing at them (only those that are visible)
  also?: string[];
  // Without a visible target the card stands in the middle instead of the step being skipped
  centeredFallback?: boolean;
}

const tour = (name: string) => `[data-tour="${name}"]`;

export const TOUR_STEPS: TourStep[] = [
  // Quick Dump (header field / + on phones) and the deck of cards it fills
  { id: 'triage', tab: 'triage', targets: [tour('triage-deck')], also: [tour('capture')] },
  // The open note; with none (an empty account) the "new note" button, on phones the list of notes
  { id: 'notes', tab: 'workspace', targets: [tour('note-editor'), tour('new-note'), tour('note-list')] },
  // A to-do of the note that is linked to a task, else the note as a whole
  {
    id: 'linked',
    tab: 'workspace',
    targets: [tour('linked-task'), tour('note-editor'), tour('new-note'), tour('note-list')],
  },
  // Focus mode: its own button on large screens, else the note's ⋯ menu; without an open note: skipped
  { id: 'focus', tab: 'workspace', targets: [tour('focus-mode'), tour('note-more')] },
  // View switch (list / Kanban / calendar; on phones in the menu behind the logo), a task
  {
    id: 'tasks',
    tab: 'tasks',
    targets: [tour('task-views'), tour('view-menu')],
    also: [`${tour('task')}, [data-kanban-task]`],
  },
  { id: 'search', tab: null, targets: [tour('search')] },
  // Back on the help page: where to read up and start the tour again
  { id: 'end', tab: 'help', targets: [tour('tour-start')], also: [tour('help-entry')], centeredFallback: true },
];
