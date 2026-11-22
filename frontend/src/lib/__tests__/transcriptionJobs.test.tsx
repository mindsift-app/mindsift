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

import { startBlockTranscription, useBlockTranscription, waitForTranscription } from '../transcriptionJobs';
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
});
