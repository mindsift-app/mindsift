import { useEffect, useRef } from 'react';
import i18n from '../i18n';
import { askChoice } from '../components/askConfirm';

// Work that leaving the current view would lose and that the server does not finish by itself: dictation
// into a text field while it is recorded or transcribed (lib/useVoiceInput.ts). While any holds, switching
// the tab or the note asks first ("Trotzdem wechseln" / "Bleiben"). Transcriptions of recordings in notes
// and dictations into the inbox run on the server (lib/transcriptionJobs.ts) and hold nothing here.
const holders = new Set<object>();

/** Marks (or clears) work that leaving would lose; `holder` is any object standing for it. */
export function holdLeave(holder: object, active: boolean): void {
  if (active) holders.add(holder);
  else holders.delete(holder);
}

/** Whether leaving the view would lose something right now. */
export const leaveHeld = () => holders.size > 0;

/** Holds leaving back while `active` (and the component is mounted). */
export function useLeaveGuard(active: boolean): void {
  const holder = useRef({});
  useEffect(() => {
    if (!active) return;
    const h = holder.current;
    holdLeave(h, true);
    return () => holdLeave(h, false);
  }, [active]);
}

/** Asks whether to leave while something holds it; true at once when nothing does. */
export async function confirmLeave(): Promise<boolean> {
  if (!leaveHeld()) return true;
  const answer = await askChoice({
    message: i18n.t('common:leaveGuard.message'),
    confirmLabel: i18n.t('common:leaveGuard.leave'),
    altLabel: i18n.t('common:leaveGuard.stay'),
  });
  return answer === 'confirm';
}

/** Runs `go` (a switch of view or note) right away, or after the person chose to leave anyway. */
export function guardLeave(go: () => void): void {
  if (!leaveHeld()) {
    go();
    return;
  }
  void confirmLeave().then((ok) => {
    if (ok) go();
  });
}
