import { describe, it, expect, vi, beforeEach } from 'vitest';

const transcribe = vi.fn();
vi.mock('../api', () => ({ api: { transcribe: (...a: unknown[]) => transcribe(...a) } }));

import { SegmentedTranscription } from '../voiceTranscription';

const blob = (name: string) => new Blob([name], { type: 'audio/webm' });
const audio = (name: string) => Promise.resolve(blob(name));
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  transcribe.mockReset();
});

describe('SegmentedTranscription', () => {
  it('joins the pieces in recording order, whichever answer comes first', async () => {
    const answers: Array<(t: string) => void> = [];
    transcribe.mockImplementation(() => new Promise<string>((res) => answers.push(res)));
    const progress = vi.fn();
    const tr = new SegmentedTranscription(progress);
    tr.add(audio('a'));
    tr.add(audio('b'));
    await flush();
    expect(answers).toHaveLength(2);

    answers[1]('morgen früh');
    answers[0]('Bäcker anrufen');
    await expect(tr.result()).resolves.toBe('Bäcker anrufen morgen früh');
    expect(progress).toHaveBeenLastCalledWith('Bäcker anrufen morgen früh');
  });

  it('keeps the audio of a failed piece and sends only that one again', async () => {
    transcribe.mockResolvedValueOnce('Erster Teil').mockRejectedValueOnce(new Error('Spracherkennung fehlgeschlagen'));
    const tr = new SegmentedTranscription();
    const second = blob('b');
    tr.add(audio('a'));
    tr.add(Promise.resolve(second));
    await expect(tr.result()).rejects.toThrow('Spracherkennung fehlgeschlagen');

    transcribe.mockResolvedValueOnce('zweiter Teil');
    await expect(tr.retry()).resolves.toBe('Erster Teil zweiter Teil');
    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(transcribe.mock.calls[2][0]).toBe(second);
  });

  it('skips empty pieces without asking the server', async () => {
    transcribe.mockResolvedValue('Nur das');
    const tr = new SegmentedTranscription();
    tr.add(Promise.resolve(null));
    tr.add(audio('a'));
    await expect(tr.result()).resolves.toBe('Nur das');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});
