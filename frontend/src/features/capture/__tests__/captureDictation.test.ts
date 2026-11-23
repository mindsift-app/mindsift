import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Thought } from '../../../lib/types';

const api = vi.hoisted(() => ({
  captureThought: vi.fn(),
  getThought: vi.fn(),
  updateThought: vi.fn(),
}));
vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi(api));

import { captureDictation, undoDictationDate } from '../captureDictation';
import { setTypedRecognition } from '../../../lib/typedRecognition';

// Monday, 16 November 2026, 10:00 local time
const NOW = new Date(2026, 10, 16, 10, 0);

const thought = (over: Partial<Thought>): Thought =>
  ({ id: 'th_1', userId: 'u1', content: '', tags: ['diktat'], priority: 'normal', source: 'voice', status: 'inbox', isCompleted: false, dueDate: '', createdAt: '', ...over }) as Thought;

describe('captureDictation', () => {
  beforeEach(() => {
    api.captureThought.mockReset();
    api.getThought.mockReset();
    api.updateThought.mockReset();
    api.captureThought.mockImplementation(async (content: string, _p: string, _s: string, dueDate: string) => thought({ content, dueDate }));
  });

  it('saves the text as spoken into the inbox without a due date when it names no date', async () => {
    const saved = await captureDictation('Milch und Kaffee einkaufen', NOW, 'de');
    expect(api.captureThought).toHaveBeenCalledWith('Milch und Kaffee einkaufen', 'normal', 'voice', '', { target: 'inbox' });
    expect(saved.due).toBe('');
    expect(saved.dictated).toBe('Milch und Kaffee einkaufen');
  });

  it('takes a recognised date with "um" out of the text and saves it as the due date', async () => {
    const saved = await captureDictation('Zahnarzt anrufen morgen um 14 Uhr', NOW, 'de');
    expect(api.captureThought).toHaveBeenCalledWith('Zahnarzt anrufen', 'normal', 'voice', '2026-11-17T14:00', { target: 'inbox' });
    expect(saved.due).toBe('2026-11-17T14:00');
    expect(saved.dictated).toBe('Zahnarzt anrufen morgen um 14 Uhr');
    expect(saved.thought.content).toBe('Zahnarzt anrufen');
  });

  it('keeps the text as spoken and sets no date while the recognition is switched off', async () => {
    setTypedRecognition(false);
    try {
      const saved = await captureDictation('Zahnarzt anrufen morgen um 14 Uhr', NOW, 'de');
      expect(api.captureThought).toHaveBeenCalledWith('Zahnarzt anrufen morgen um 14 Uhr', 'normal', 'voice', '', { target: 'inbox' });
      expect(saved.due).toBe('');
    } finally {
      setTypedRecognition(true);
    }
  });

  it('takes "am" with a weekday along', async () => {
    await captureDictation('Am Freitag Reifen wechseln', NOW, 'de');
    expect(api.captureThought).toHaveBeenCalledWith('Reifen wechseln', 'normal', 'voice', '2026-11-20', { target: 'inbox' });
  });

  it('reads the date in the language it is given', async () => {
    await captureDictation('Call Anna next Tuesday at 9', NOW, 'en');
    expect(api.captureThought).toHaveBeenCalledWith('Call Anna', 'normal', 'voice', '2026-11-17T09:00', { target: 'inbox' });
  });

  it('keeps the text and sets no date when nothing but the date would be left', async () => {
    const saved = await captureDictation('morgen um 14 Uhr', NOW, 'de');
    expect(api.captureThought).toHaveBeenCalledWith('morgen um 14 Uhr', 'normal', 'voice', '', { target: 'inbox' });
    expect(saved.due).toBe('');
  });

  it('undo restores the text as dictated, clears the due date and keeps #diktat', async () => {
    const saved = await captureDictation('Zahnarzt anrufen morgen um 14 Uhr #praxis', NOW, 'de');
    api.getThought.mockResolvedValue(thought({ content: saved.thought.content, dueDate: saved.due, tags: ['praxis', 'diktat'] }));
    api.updateThought.mockResolvedValue(thought({ content: saved.dictated }));
    const result = await undoDictationDate(saved);
    expect(api.updateThought).toHaveBeenCalledWith('th_1', {
      content: 'Zahnarzt anrufen morgen um 14 Uhr #praxis',
      dueDate: '',
      tags: ['praxis', 'diktat'],
    });
    expect(result?.content).toBe('Zahnarzt anrufen morgen um 14 Uhr #praxis');
  });

  it('undo does nothing when the entry was sorted meanwhile', async () => {
    const saved = await captureDictation('Zahnarzt morgen', NOW, 'de');
    api.getThought.mockResolvedValue(thought({ content: 'Zahnarzt', status: 'kept' }));
    expect(await undoDictationDate(saved)).toBeNull();
    expect(api.updateThought).not.toHaveBeenCalled();
  });

  it('undo does nothing when the text was edited meanwhile or the entry is gone', async () => {
    const saved = await captureDictation('Zahnarzt morgen', NOW, 'de');
    api.getThought.mockResolvedValueOnce(thought({ content: 'Zahnarzt Dr. Weber' }));
    expect(await undoDictationDate(saved)).toBeNull();
    api.getThought.mockRejectedValueOnce(new Error('404'));
    expect(await undoDictationDate(saved)).toBeNull();
    expect(api.updateThought).not.toHaveBeenCalled();
  });
});
