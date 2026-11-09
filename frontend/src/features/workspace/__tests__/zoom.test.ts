import { describe, expect, it } from 'vitest';
import { DocumentBlock } from '../../../lib/types';
import { ShapeElement, serializeDrawing } from '../../../lib/drawing/model';
import { mediaContent } from '../../../lib/media';
import { blockTitle, computeBreadcrumbs } from '../zoom';

const block = (id: string, type: DocumentBlock['type'], content: string, level = 0): DocumentBlock => ({
  id,
  documentId: 'doc',
  type,
  content,
  level,
  position: 0,
});

const box = (id: string, txt?: string): ShapeElement => ({ id, ver: 1, t: 'rect', x: 0, y: 0, w: 100, h: 50, s: 'main', f: 'none', sw: 2, txt });

describe('blockTitle', () => {
  it('names a drawing by the words in it, never by its model', () => {
    const content = serializeDrawing({ v: 1, els: [box('a', 'Start'), box('b'), box('c', 'Ende')] });
    expect(blockTitle(block('d', 'drawing', content))).toBe('Zeichnung: Start, Ende');
    expect(blockTitle(block('d', 'drawing', serializeDrawing({ v: 1, els: [box('a')] })))).toBe('Zeichnung');
  });

  it('uses the caption of images and audio files', () => {
    expect(blockTitle(block('i', 'image', mediaContent('image', 'med_1', 'Urlaub')))).toBe('Bild: Urlaub');
    expect(blockTitle(block('a', 'audio', mediaContent('audio', 'med_2')))).toBe('Audio');
    expect(blockTitle(block('l', 'divider', ''))).toBe('Trennlinie');
    expect(blockTitle(block('t', 'text', '  Einkauf '))).toBe('Einkauf');
  });

  it('shows the kind in the breadcrumbs of a branch below a drawing', () => {
    const content = serializeDrawing({ v: 1, els: [box('a', 'Ablauf')] });
    const blocks = [block('d', 'drawing', content), block('c', 'text', 'Erklärung', 1)];
    expect(computeBreadcrumbs('Notiz', blocks, 'c').map((c) => c.title)).toEqual(['Notiz', 'Zeichnung: Ablauf', 'Erklärung']);
  });
});
