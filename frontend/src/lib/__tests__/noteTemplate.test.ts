import { describe, it, expect } from 'vitest';
import { fillTemplatePlaceholders, templateBlocks } from '../noteTemplate';
import { formatDate } from '../format';
import type { DocumentBlock } from '../types';

const now = new Date(2026, 10, 15, 9, 30);
const today = formatDate(now);

describe('fillTemplatePlaceholders', () => {
  it('fills date and title in German and English spelling, any case and spacing', () => {
    expect(fillTemplatePlaceholders('Treffen am {{datum}} – {{ Titel }}', { title: 'Projekt', now })).toBe(
      `Treffen am ${today} – Projekt`
    );
    expect(fillTemplatePlaceholders('{{DATE}} / {{title}}', { title: 'Plan', now })).toBe(`${today} / Plan`);
  });

  it('leaves hidden values and unknown placeholders alone', () => {
    const text = 'PIN {{secret:abc123}} und {{unbekannt}}';
    expect(fillTemplatePlaceholders(text, { title: 'X', now })).toBe(text);
  });
});

describe('templateBlocks', () => {
  const source: DocumentBlock[] = [
    { id: 'a', type: 'h2', content: 'Besprechung {{datum}}', level: 1, collapsed: true },
    { id: 'b', type: 'todo', content: 'Protokoll für {{titel}}', level: 2, checked: true, taskId: 'task_1', subtaskOf: 'task_0' },
    { id: 'c', type: 'code', content: 'echo "{{date}}"', lang: 'bash', level: 2 },
    { id: 'd', type: 'drawing', content: '{"elements":[{"text":"{{datum}}"}]}', level: 1 },
    { id: 'e', type: 'image', content: '![Plan {{datum}}](media:img1)', level: 1 },
    { id: 'f', type: 'bullet', content: 'Zugang {{secret:s1}}', level: 1 },
    { id: 'g', type: 'bullet', content: 'Konfliktkopie', level: 1, conflictOf: 'f' },
  ];

  it('copies types with new ids, levels from the base level and to-dos open without task', () => {
    const out = templateBlocks(source, { docId: 'ziel', baseLevel: 3, title: 'Montag', now });
    expect(out.map((b) => b.type)).toEqual(['h2', 'todo', 'code', 'drawing', 'image', 'bullet']);
    expect(out.map((b) => b.level)).toEqual([3, 4, 4, 3, 3, 3]);
    expect(new Set(out.map((b) => b.id)).size).toBe(out.length);
    expect(out.some((b) => source.some((s) => s.id === b.id))).toBe(false);
    for (const b of out) {
      expect(b.documentId).toBe('ziel');
      expect(b.checked).toBe(false);
      expect(b.collapsed).toBe(false);
      expect(b.taskId).toBeUndefined();
      expect(b.subtaskOf).toBeUndefined();
    }
    expect(out[0].content).toBe(`Besprechung ${today}`);
    expect(out[1].content).toBe('Protokoll für Montag');
    expect(out[4].content).toBe(`![Plan ${today}](media:img1)`);
    // A hidden value keeps its reference: the server gives the note a copy of its own (secretGate)
    expect(out[5].content).toBe('Zugang {{secret:s1}}');
  });

  it('keeps code and drawings as they are, with the code language', () => {
    const out = templateBlocks(source, { docId: 'ziel', title: 'X', now });
    expect(out[2]).toMatchObject({ content: 'echo "{{date}}"', lang: 'bash' });
    expect(out[3].content).toBe(source[3].content);
  });

  it('gives nothing for an empty template', () => {
    expect(templateBlocks([], { docId: 'ziel', title: 'X' })).toEqual([]);
  });
});
