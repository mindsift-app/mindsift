import { describe, it, expect, vi, beforeEach } from 'vitest';

const jobs = vi.hoisted(() => ({
  startInboxTranscription: vi.fn(),
  waitForTranscription: vi.fn(),
}));
vi.mock('../../../lib/transcriptionJobs', () => jobs);

const dictation = vi.hoisted(() => ({ dateFromDictation: vi.fn(), undoDictationDate: vi.fn() }));
vi.mock('../captureDictation', () => dictation);

import { serverDictation } from '../serverDictation';
import { HandedOverError } from '../dictationQueue';
import type { SegmentedTranscription } from '../../../lib/voiceTranscription';

const parts = [
  { blob: new Blob(['a'], { type: 'audio/webm' }), text: 'Zahnarzt anrufen' },
  { blob: new Blob(['b'], { type: 'audio/webm' }), text: null },
];
const recording = (handOver = vi.fn().mockResolvedValue(parts)) => ({ handOver }) as unknown as SegmentedTranscription;

describe('serverDictation (hold the + with the own Whisper server)', () => {
  beforeEach(() => {
    Object.values(jobs).forEach((f) => f.mockReset());
    Object.values(dictation).forEach((f) => f.mockReset());
  });

  it('stores the recording on the server with the text known so far and waits for the entry it makes', async () => {
    jobs.startInboxTranscription.mockResolvedValue({ id: 'trs_1' });
    jobs.waitForTranscription.mockResolvedValue({ id: 'trs_1', text: 'Zahnarzt anrufen morgen um 14 Uhr', thoughtId: 'th_1' });
    dictation.dateFromDictation.mockResolvedValue({ thought: { id: 'th_1' }, dictated: 'Zahnarzt anrufen morgen um 14 Uhr', due: '2026-11-23T14:00' });
    const source = serverDictation(recording());

    await expect(source.text()).resolves.toBe('Zahnarzt anrufen morgen um 14 Uhr');
    expect(jobs.startInboxTranscription).toHaveBeenCalledWith(parts);
    expect(jobs.waitForTranscription).toHaveBeenCalledWith('trs_1');

    // The entry exists: saving only reads a date from it, never makes a second one
    const outcome = await source.save!('Zahnarzt anrufen morgen um 14 Uhr');
    expect(dictation.dateFromDictation).toHaveBeenCalledWith('th_1', 'Zahnarzt anrufen morgen um 14 Uhr', expect.any(Date));
    expect(outcome).toMatchObject({ due: '2026-11-23T14:00' });
  });

  it('keeps the parts while the upload fails, and lets a recording the server failed on go to the Quick Dump', async () => {
    jobs.startInboxTranscription.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'trs_2' });
    jobs.waitForTranscription.mockRejectedValueOnce(new Error('Spracherkennung fehlgeschlagen'));
    const source = serverDictation(recording());
    const uploaded = vi.fn();
    void source.uploaded!.then(uploaded);

    const offline = await source.text().catch((e: Error) => e);
    expect(offline).not.toBeInstanceOf(HandedOverError);
    expect((offline as Error).message).toBe('offline');
    // Not on the server yet: leaving the page would lose it (dictationQueue.ts)
    expect(uploaded).not.toHaveBeenCalled();

    const failed = await source.text().catch((e: Error) => e);
    expect(uploaded).toHaveBeenCalled();
    expect(jobs.startInboxTranscription).toHaveBeenCalledTimes(2);
    expect(failed).toBeInstanceOf(HandedOverError);
    expect((failed as Error).message).toBe('Spracherkennung fehlgeschlagen – die Aufnahme wartet im Quick Dump.');
  });

  it('counts a recording without anything in it as nothing heard, without asking the server', async () => {
    const source = serverDictation(recording(vi.fn().mockResolvedValue([])));
    await expect(source.text()).resolves.toBe('');
    expect(jobs.startInboxTranscription).not.toHaveBeenCalled();
  });
});
