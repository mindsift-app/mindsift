import { createHoldSet } from './holdSet';

// Work a reload for a new version would lose and that does not save itself: a recording in progress,
// dictations still waiting for their text or save, typed text in a capture field or an open task draft.
// While any holds, the app does not reload by itself (lib/useUpdateCheck.ts); the user still can.
// Recordings hold it through useRecordingGuard (lib/leaveGuard.ts) together with leaving and unloading.
const reload = createHoldSet();

/** Marks (or clears) a piece of unsaved work; `holder` is any object standing for it. */
export const holdReload = reload.hold;

/** Whether anything holds the automatic reload back right now. */
export const reloadHeld = reload.held;

/** Holds the automatic reload back while `active` (and the component is mounted). */
export const useHoldReload = reload.useHold;
