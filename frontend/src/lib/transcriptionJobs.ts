// Transcriptions the server does in the background (internal/api/transcription_jobs.go): "Transkribieren"
// on a recording in a note and recordings dictated into the inbox with the own Whisper server. The
// recording is on the server before it is transcribed, and the server writes the result itself (the
// caption through the note's sync, or a new inbox entry), so leaving the page loses nothing. This module
// keeps the jobs the app knows of, from the server's lists and its events (TRANSCRIPTION_UPDATED while one
// waits, runs or failed, TRANSCRIPTION_DONE at its end), so a bullet or the inbox can show it, also after
// a reload and on another device.
import { useEffect, useSyncExternalStore } from 'react';
import i18n from '../i18n';
import { api, getCurrentUserId } from './api';
import type { TranscriptionDone, TranscriptionJob, WSMessage } from './types';

const jobs = new Map<string, TranscriptionJob>();
const listeners = new Set<() => void>();
const doneListeners = new Set<(done: TranscriptionDone) => void>();
// Notes with a bullet that shows its job (count of them), loaded again after a reconnect
const watchedDocs = new Map<string, number>();
let watchedInbox = 0;
let version = 0;
let installed = false;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

function put(job: TranscriptionJob) {
  jobs.set(job.id, job);
  changed();
}

function finish(done: TranscriptionDone) {
  if (jobs.delete(done.id)) changed();
  doneListeners.forEach((l) => l(done));
}

// Replaces the known jobs that match with the server's list
function replace(list: TranscriptionJob[], matches: (j: TranscriptionJob) => boolean) {
  for (const [id, j] of jobs) if (matches(j)) jobs.delete(id);
  for (const j of list) jobs.set(j.id, j);
  changed();
}

function loadDoc(docId: string) {
  api
    .docTranscriptions(docId)
    .then((list) => replace(list, (j) => j.docId === docId))
    .catch(() => {});
}

function loadInbox() {
  const me = getCurrentUserId();
  api
    .voiceJobs()
    .then((list) => replace(list.filter((j) => j.kind === 'inbox'), (j) => j.kind === 'inbox' && j.userId === me))
    .catch(() => {});
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('mindsift:ws', (e) => {
    const msg = (e as CustomEvent<WSMessage | undefined>).detail;
    if (msg?.event === 'TRANSCRIPTION_UPDATED' && msg.payload) put(msg.payload as TranscriptionJob);
    else if (msg?.event === 'TRANSCRIPTION_DONE' && msg.payload) finish(msg.payload as TranscriptionDone);
  });
  // Events of the time without a connection are lost: load what is on screen again
  window.addEventListener('mindsift:ws:status', (e) => {
    if (!(e as CustomEvent<{ connected?: boolean }>).detail?.connected) return;
    watchedDocs.forEach((_, docId) => loadDoc(docId));
    if (watchedInbox > 0) loadInbox();
  });
}

function subscribe(l: () => void) {
  install();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getVersion = () => version;

/** The job for a recording in a note, while there is one (enabled: only where it can be shown). */
export function useBlockTranscription(docId: string | undefined, blockId: string | undefined, enabled = true): TranscriptionJob | undefined {
  useSyncExternalStore(subscribe, getVersion);
  const active = enabled && !!docId && !!blockId;
  useEffect(() => {
    if (!active || !docId) return;
    install();
    const n = watchedDocs.get(docId) ?? 0;
    watchedDocs.set(docId, n + 1);
    // The first bullet of a note to ask loads the note's jobs once
    if (n === 0) loadDoc(docId);
    return () => {
      const left = (watchedDocs.get(docId) ?? 1) - 1;
      if (left > 0) watchedDocs.set(docId, left);
      else watchedDocs.delete(docId);
    };
  }, [active, docId]);
  if (!active) return undefined;
  for (const j of jobs.values()) if (j.docId === docId && j.blockId === blockId) return j;
  return undefined;
}

/** The person's recordings for the inbox still waiting for their text (or failed), oldest first. */
export function useInboxTranscriptions(): TranscriptionJob[] {
  useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    install();
    watchedInbox++;
    loadInbox();
    return () => {
      watchedInbox--;
    };
  }, []);
  const me = getCurrentUserId();
  return [...jobs.values()].filter((j) => j.kind === 'inbox' && j.userId === me).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Asks the server to transcribe a recording in a note; its text comes into the caption by itself. */
export async function startBlockTranscription(docId: string, blockId: string): Promise<TranscriptionJob> {
  install();
  const job = await api.transcribeBlock(docId, blockId);
  put(job);
  return job;
}

/** Stores a recording for the inbox on the server, which makes the entry once it is transcribed. */
export async function startInboxTranscription(parts: { blob: Blob; text: string | null }[]): Promise<TranscriptionJob> {
  install();
  const job = await api.captureVoice(parts);
  put(job);
  return job;
}

export async function retryTranscription(id: string): Promise<void> {
  put(await api.retryVoiceJob(id));
}

export async function discardTranscription(id: string): Promise<void> {
  await api.deleteVoiceJob(id);
  if (jobs.delete(id)) changed();
}

/** The text for a failed job's error code. */
export function transcriptionError(job: Pick<TranscriptionJob, 'error'>): string {
  return job.error === 'timeout' ? i18n.t('common:voiceJobs.timeout') : i18n.t('common:voiceJobs.failed');
}

// How often waitForTranscription asks the server, in case an event did not arrive
const POLL_MS = 20_000;

/**
 * Waits for the end of a job: its result, or null when it ended without one this tab saw (nothing heard,
 * discarded, or done while the event did not arrive). Rejects once the job has failed for good (the
 * server tried again by itself before); retryTranscription and waiting again go on from there.
 */
export function waitForTranscription(id: string): Promise<TranscriptionDone | null> {
  install();
  return new Promise((resolve, reject) => {
    let timer = 0;
    const stop = () => {
      doneListeners.delete(onDone);
      listeners.delete(onChange);
      window.clearInterval(timer);
    };
    const onDone = (done: TranscriptionDone) => {
      if (done.id !== id) return;
      stop();
      resolve(done.text || done.thoughtId ? done : null);
    };
    const onChange = () => {
      const job = jobs.get(id);
      if (job?.status !== 'failed') return;
      stop();
      reject(new Error(transcriptionError(job)));
    };
    doneListeners.add(onDone);
    listeners.add(onChange);
    onChange();
    timer = window.setInterval(() => {
      api
        .voiceJobs()
        .then((list) => {
          const job = list.find((j) => j.id === id);
          if (!job) {
            stop();
            resolve(null);
          } else {
            put(job);
          }
        })
        .catch(() => {});
    }, POLL_MS);
  });
}
