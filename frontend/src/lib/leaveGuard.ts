import { useEffect, useRef } from 'react';
import i18n from '../i18n';
import { askChoice } from '../components/askConfirm';
import { isDesktopApp } from './api/client';
import { desktopShellStart } from './useDesktopShellStart';

// Work that leaving the current view would lose and that the server does not finish by itself: dictation
// into a text field or a /diktat bullet while it is recorded or transcribed (lib/useVoiceInput.ts), an
// audio recording in a note (AudioRecorderPicker). While any holds, switching the tab or the note, the
// browser's back and forward (lib/navHistory.ts) and closing a dialog with the dictation in it ask first
// ("Trotzdem wechseln" / "Bleiben"). Transcriptions of recordings in notes and dictations into the inbox
// run on the server (lib/transcriptionJobs.ts) and hold nothing here.
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

export interface LeaveOptions {
  /** Closing a dialog or sheet ("Trotzdem schließen") instead of switching the view. */
  close?: boolean;
  /** Something of the caller's own would be lost (e.g. the app shell's capture sheet); default: leaveHeld(). */
  held?: boolean;
}

/** Asks whether to leave while something holds it; true at once when nothing does. */
export async function confirmLeave({ close = false, held = leaveHeld() }: LeaveOptions = {}): Promise<boolean> {
  if (!held) return true;
  const answer = await askChoice({
    message: i18n.t(close ? 'common:leaveGuard.closeMessage' : 'common:leaveGuard.message'),
    confirmLabel: i18n.t(close ? 'common:leaveGuard.close' : 'common:leaveGuard.leave'),
    altLabel: i18n.t('common:leaveGuard.stay'),
  });
  return answer === 'confirm';
}

/** Runs `go` (a switch of view or note, closing a dialog) right away, or after the person chose to leave anyway. */
export function guardLeave(go: () => void, options: LeaveOptions = {}): void {
  const held = options.held ?? leaveHeld();
  if (!held) {
    go();
    return;
  }
  void confirmLeave({ ...options, held }).then((ok) => {
    if (ok) go();
  });
}

// A recording still running or not saved yet: reloading the page, closing the tab or going to another site
// would lose it. The browser asks first then (its own beforeunload question, the only way to hold these;
// allowed as an exception to "no browser dialogs"). Only while such a recording exists: the listener comes
// and goes with it, so the page otherwise stays in the back/forward cache. Not in the desktop app: it has no
// reload or tab of its own, and its web views would hold the window's close or the switch of instance.
const unloadHolders = new Set<object>();

const inDesktopApp = () => isDesktopApp() || desktopShellStart() !== null;

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (unloadHolders.size === 0 || inDesktopApp()) return;
  e.preventDefault();
  // Older browsers ask only with a returnValue
  e.returnValue = '';
}

let listening = false;
function syncUnloadListener() {
  const want = unloadHolders.size > 0 && !inDesktopApp();
  if (want === listening || typeof window === 'undefined') return;
  listening = want;
  if (want) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

/** Marks (or clears) a recording a reload of the page would lose; `holder` is any object standing for it. */
export function holdUnload(holder: object, active: boolean): void {
  if (active) unloadHolders.add(holder);
  else unloadHolders.delete(holder);
  syncUnloadListener();
}

/** Whether reloading or closing the page would lose a recording right now. */
export const unloadHeld = () => unloadHolders.size > 0;

/** Lets the browser ask before the page is left while `active` (and the component is mounted). */
export function useUnloadGuard(active: boolean): void {
  const holder = useRef({});
  useEffect(() => {
    if (!active) return;
    const h = holder.current;
    holdUnload(h, true);
    return () => holdUnload(h, false);
  }, [active]);
}
