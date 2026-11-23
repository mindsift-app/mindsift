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
import type { TranscriptionDone, TranscriptionJob } from './types';
import { formatDate, formatDateTime } from './format';
import { onRealtimeMessage, onRealtimeReconnect } from './realtimeBus';

const jobs = new Map<string, TranscriptionJob>();
const listeners = new Set<() => void>();
const doneListeners = new Set<(done: TranscriptionDone) => void>();
// Notes with a bullet that shows its job (count of them), loaded again after a reconnect
const watchedDocs = new Map<string, number>();
let watchedInbox = 0;
let version = 0;
let installed = false;
// Server events seen so far (a count), and the count at the last event for each job: an answer to a
// request is older than an event for its job that came after the request was sent (the server sends the
// event before the answer, and every change of a job as an event), so it must not overwrite it
let eventSeq = 0;
const lastEvent = new Map<string, number>();

// The last ends seen, so waiting for a job that ended before the answer to its start came still gets it
const ended = new Map<string, TranscriptionDone>();
const ENDED_KEEP = 50;

const newerEventSince = (id: string, since: number) => (lastEvent.get(id) ?? 0) > since;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

function put(job: TranscriptionJob) {
  jobs.set(job.id, job);
  changed();
}

function finish(done: TranscriptionDone) {
  ended.set(done.id, done);
  if (ended.size > ENDED_KEEP) ended.delete(ended.keys().next().value as string);
  if (jobs.delete(done.id)) changed();
  doneListeners.forEach((l) => l(done));
}

// Takes a job from the answer to a request sent at event count since, unless an event about it came
// meanwhile (its state then, or its end, is newer than the answer)
function putAnswer(job: TranscriptionJob, since: number) {
  if (!newerEventSince(job.id, since)) put(job);
}

// Replaces the known jobs that match with the server's list (requested at event count since); jobs with
// an event since then keep what the event said
function replace(list: TranscriptionJob[], matches: (j: TranscriptionJob) => boolean, since: number) {
  for (const [id, j] of jobs) if (matches(j) && !newerEventSince(id, since)) jobs.delete(id);
  for (const j of list) if (!newerEventSince(j.id, since)) jobs.set(j.id, j);
  changed();
}

function loadDoc(docId: string) {
  const since = eventSeq;
  api
    .docTranscriptions(docId)
    .then((list) => replace(list, (j) => j.docId === docId, since))
    .catch(() => {});
}

function loadInbox() {
  const me = getCurrentUserId();
  const since = eventSeq;
  api
    .voiceJobs()
    .then((list) => replace(list.filter((j) => j.kind === 'inbox'), (j) => j.kind === 'inbox' && j.userId === me, since))
    .catch(() => {});
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  onRealtimeMessage((msg) => {
    if (msg.event !== 'TRANSCRIPTION_UPDATED' && msg.event !== 'TRANSCRIPTION_DONE') return;
    const payload = msg.payload as TranscriptionJob | TranscriptionDone | undefined;
    if (!payload?.id) return;
    lastEvent.set(payload.id, ++eventSeq);
    if (msg.event === 'TRANSCRIPTION_UPDATED') put(payload as TranscriptionJob);
    else finish(payload as TranscriptionDone);
  });
  // Events of the time without a connection are lost: load what is on screen again
  onRealtimeReconnect(() => {
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
  const since = eventSeq;
  const job = await api.transcribeBlock(docId, blockId);
  putAnswer(job, since);
  return job;
}

/** Stores a recording for the inbox on the server, which makes the entry once it is transcribed. */
export async function startInboxTranscription(parts: { blob: Blob; text: string | null }[]): Promise<TranscriptionJob> {
  install();
  const since = eventSeq;
  const job = await api.captureVoice(parts);
  putAnswer(job, since);
  return job;
}

export async function retryTranscription(id: string): Promise<void> {
  const since = eventSeq;
  putAnswer(await api.retryVoiceJob(id), since);
}

export async function discardTranscription(id: string): Promise<void> {
  await api.deleteVoiceJob(id);
  if (jobs.delete(id)) changed();
}

/** The text for a failed job's error code. */
export function transcriptionError(job: Pick<TranscriptionJob, 'error'>): string {
  return job.error === 'timeout' ? i18n.t('common:voiceJobs.timeout') : i18n.t('common:voiceJobs.failed');
}

/**
 * When the server tries a failed job again by itself ("Neuer Versuch um 14:35", another day with the day),
 * or null when no later attempt is planned or its time has passed.
 */
export function transcriptionNextTry(job: Pick<TranscriptionJob, 'status' | 'nextAt'>, now: Date = new Date()): string | null {
  if (job.status !== 'failed' || !job.nextAt) return null;
  const at = new Date(job.nextAt);
  if (Number.isNaN(at.getTime()) || at <= now) return null;
  const time = formatDateTime(at, { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === now.toDateString()) return i18n.t('common:voiceJobs.nextTry', { time });
  return i18n.t('common:voiceJobs.nextTryDay', { day: formatDate(at, { weekday: 'short' }), time });
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
    const early = ended.get(id);
    if (early) {
      resolve(early.text || early.thoughtId ? early : null);
      return;
    }
    doneListeners.add(onDone);
    listeners.add(onChange);
    onChange();
    timer = window.setInterval(() => {
      const since = eventSeq;
      api
        .voiceJobs()
        .then((list) => {
          if (newerEventSince(id, since)) return; // the events are ahead of this list
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
