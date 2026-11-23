import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  docTranscriptions: vi.fn(),
  voiceJobs: vi.fn(),
  transcribeBlock: vi.fn(),
  captureVoice: vi.fn(),
  retryVoiceJob: vi.fn(),
  deleteVoiceJob: vi.fn(),
}));
vi.mock('../api', () => ({ api, getCurrentUserId: () => 'u1' }));

import {
  retryTranscription,
  startBlockTranscription,
  startInboxTranscription,
  transcriptionNextTry,
  useBlockTranscription,
  useInboxTranscriptions,
  waitForTranscription,
} from '../transcriptionJobs';
import type { TranscriptionJob } from '../types';

const job = (over: Partial<TranscriptionJob>): TranscriptionJob => ({
  id: 'trs_1',
  userId: 'u1',
  kind: 'note',
  docId: 'doc_1',
  blockId: 'blk_1',
  status: 'queued',
  attempts: 0,
  createdAt: '2026-11-22T10:00:00Z',
  updatedAt: '2026-11-22T10:00:00Z',
  ...over,
});

const ws = (event: string, payload: unknown) =>
  act(() => {
    window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: { event, payload, timestamp: '' } }));
  });

const Bullet = ({ blockId }: { blockId: string }) => {
  const j = useBlockTranscription('doc_1', blockId);
  return <span data-testid={blockId}>{j ? j.status : 'none'}</span>;
};

describe('transcriptionJobs', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.voiceJobs.mockResolvedValue([]);
    api.docTranscriptions.mockResolvedValue([]);
  });

  it('shows a bullet as being transcribed after a reload, follows the server events and forgets it at its end', async () => {
    api.docTranscriptions.mockResolvedValue([job({ status: 'running' })]);
    render(
      <>
        <Bullet blockId="blk_1" />
        <Bullet blockId="blk_2" />
      </>
    );
    await act(async () => {});
    // One request for the note, however many recordings it shows
    expect(api.docTranscriptions).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('blk_1').textContent).toBe('running');
    expect(screen.getByTestId('blk_2').textContent).toBe('none');

    ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_2', blockId: 'blk_2', status: 'failed', error: 'timeout' }));
    expect(screen.getByTestId('blk_2').textContent).toBe('failed');

    ws('TRANSCRIPTION_DONE', { id: 'trs_1', kind: 'note', userId: 'u1', text: 'Hallo', docId: 'doc_1', blockId: 'blk_1' });
    expect(screen.getByTestId('blk_1').textContent).toBe('none');
  });

  it('waits for the end of a job and rejects once it failed for good', async () => {
    api.transcribeBlock.mockResolvedValue(job({ id: 'trs_3', blockId: 'blk_3' }));
    const started = await startBlockTranscription('doc_1', 'blk_3');
    const done = waitForTranscription(started.id);
    ws('TRANSCRIPTION_DONE', { id: 'trs_3', kind: 'note', userId: 'u1', text: 'Fertig' });
    await expect(done).resolves.toMatchObject({ text: 'Fertig' });

    const failing = waitForTranscription('trs_4');
    ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_4', status: 'queued', error: 'failed' }));
    ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_4', status: 'failed', error: 'timeout' }));
    await expect(failing).rejects.toThrow('Spracherkennung hat zu lange gedauert');
  });
  // The answer to a request is older than an event about its job that came while it was under way
  // (the server sends the event first); it must not overwrite it, in either order
  describe('answers and events in either order', () => {
    const deferred = <T,>() => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };
    const Inbox = () => (
      <span data-testid="inbox">
        {useInboxTranscriptions()
          .map((j) => `${j.id}:${j.status}:${j.error ?? ''}`)
          .join(',')}
      </span>
    );
    const blob = new Blob(['x']);

    it('keeps a failure the server sent before the answer to the upload', async () => {
      render(<Inbox />);
      await act(async () => {});
      const answer = deferred<TranscriptionJob>();
      api.captureVoice.mockReturnValue(answer.promise);
      const started = startInboxTranscription([{ blob, text: null }]);
      ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_10', kind: 'inbox', status: 'queued', error: 'failed', attempts: 1 }));
      await act(async () => {
        answer.resolve(job({ id: 'trs_10', kind: 'inbox', status: 'queued' }));
        await started;
      });
      expect(screen.getByTestId('inbox').textContent).toBe('trs_10:queued:failed');
    });

    it('takes the answer to the upload when the failure comes after it', async () => {
      render(<Inbox />);
      await act(async () => {});
      api.captureVoice.mockResolvedValue(job({ id: 'trs_11', kind: 'inbox', status: 'queued' }));
      await act(async () => {
        await startInboxTranscription([{ blob, text: null }]);
      });
      expect(screen.getByTestId('inbox').textContent).toBe('trs_11:queued:');
      ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_11', kind: 'inbox', status: 'queued', error: 'failed', attempts: 1 }));
      expect(screen.getByTestId('inbox').textContent).toBe('trs_11:queued:failed');
    });

    it('does not bring back a job that ended before the answer to its start, and still hands over its text', async () => {
      render(<Bullet blockId="blk_20" />);
      await act(async () => {});
      const answer = deferred<TranscriptionJob>();
      api.transcribeBlock.mockReturnValue(answer.promise);
      const started = startBlockTranscription('doc_1', 'blk_20');
      ws('TRANSCRIPTION_DONE', { id: 'trs_20', kind: 'note', userId: 'u1', text: 'Schnell', docId: 'doc_1', blockId: 'blk_20' });
      let id = '';
      await act(async () => {
        answer.resolve(job({ id: 'trs_20', blockId: 'blk_20' }));
        id = (await started).id;
      });
      expect(screen.getByTestId('blk_20').textContent).toBe('none');
      await expect(waitForTranscription(id)).resolves.toMatchObject({ text: 'Schnell' });
    });

    it('takes the answer to a retry unless the job moved on meanwhile', async () => {
      render(<Bullet blockId="blk_30" />);
      await act(async () => {});
      ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_30', blockId: 'blk_30', status: 'failed', error: 'failed', attempts: 3 }));
      api.retryVoiceJob.mockResolvedValue(job({ id: 'trs_30', blockId: 'blk_30', status: 'queued' }));
      await act(async () => {
        await retryTranscription('trs_30');
      });
      expect(screen.getByTestId('blk_30').textContent).toBe('queued');

      const answer = deferred<TranscriptionJob>();
      api.retryVoiceJob.mockReturnValue(answer.promise);
      ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_30', blockId: 'blk_30', status: 'failed', error: 'failed', attempts: 3 }));
      const retried = retryTranscription('trs_30');
      ws('TRANSCRIPTION_UPDATED', job({ id: 'trs_30', blockId: 'blk_30', status: 'running', attempts: 1 }));
      await act(async () => {
        answer.resolve(job({ id: 'trs_30', blockId: 'blk_30', status: 'queued' }));
        await retried;
      });
      expect(screen.getByTestId('blk_30').textContent).toBe('running');
    });
  });
});

describe('transcriptionNextTry', () => {
  // Local times, so the test reads the same in every time zone
  const now = new Date(2026, 10, 23, 13, 0);
  const at = (d: Date) => d.toISOString();

  it('names the time of a later attempt today, and the day as well for another day', () => {
    expect(transcriptionNextTry(job({ status: 'failed', nextAt: at(new Date(2026, 10, 23, 14, 35)) }), now)).toBe('Neuer Versuch um 14:35');
    expect(transcriptionNextTry(job({ status: 'failed', nextAt: at(new Date(2026, 10, 24, 9, 5)) }), now)).toMatch(/^Neuer Versuch am Di\.? um 09:05$/); // ICU versions differ on the dot
  });

  it('says nothing without a planned attempt, once its time passed or while the job waits anyway', () => {
    expect(transcriptionNextTry(job({ status: 'failed' }), now)).toBeNull();
    expect(transcriptionNextTry(job({ status: 'failed', nextAt: at(new Date(2026, 10, 23, 12, 59)) }), now)).toBeNull();
    expect(transcriptionNextTry(job({ status: 'queued', nextAt: at(new Date(2026, 10, 23, 14, 0)) }), now)).toBeNull();
  });
});
