import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, createEvent, screen, act, waitFor } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import { DocumentBlock } from '../../../lib/types';
import { clipboard, png } from '../../../test/clipboard';
import { BLOCK_DRAG_TYPE } from '../moveBranchEvent';

// Image files dragged onto a note (OutlinerTree, lib/pasteImages.ts): the same image bullets as a paste

const media = vi.hoisted(() => ({ uploads: [] as Blob[], fetched: [] as string[], hold: false, release: null as (() => void) | null }));

vi.mock('../../../lib/media', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/media')>();
  return {
    ...real,
    prepareImage: async (file: Blob) => ({ blob: file, name: 'bild' }),
    uploadMedia: async (_doc: string, blob: Blob) => {
      media.uploads.push(blob);
      if (media.hold) await new Promise<void>((r) => (media.release = r));
      return { id: `med_${media.uploads.length.toString(16).padStart(4, '0')}`, kind: 'image', mime: 'image/png', size: 1, url: '' };
    },
    copyExternalImage: async (_doc: string, url: string) => {
      media.fetched.push(url);
      return { id: 'med_fe7c', kind: 'image', mime: 'image/png', size: 1, url: '' };
    },
    mediaObjectURL: () => new Promise<string>(() => {}),
  };
});

// (The ghost of a dragged branch animates, which jsdom cannot)
vi.mock('../branchDragImage', () => ({ startBranchDragGhost: () => {} }));

const errors: string[] = [];
vi.mock('../../../components/ErrorNotice', () => ({ showError: (m: string) => errors.push(m) }));

let live: DocumentBlock[] = [];
let inserts = 0;
const moves: Array<[string, number]> = [];

const Harness: React.FC<{ initial: DocumentBlock[]; canEdit?: boolean }> = ({ initial, canEdit = true }) => {
  const [blocks, setBlocks] = useState(initial);
  // eslint-disable-next-line react-hooks/globals
  live = blocks;
  return (
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      canEdit={canEdit}
      onUpdateBlock={(b) => setBlocks((p) => p.map((x) => (x.id === b.id ? b : x)))}
      onInsertBlocks={(afterId, current, added) => {
        inserts++;
        setBlocks((p) => {
          const next = p.map((x) => (x.id === afterId ? current : x));
          next.splice(next.findIndex((x) => x.id === afterId) + 1, 0, ...added);
          return next;
        });
      }}
      onCreateBlock={(nb) => setBlocks((p) => [...p, nb])}
      onDeleteBlock={(id) => setBlocks((p) => p.filter((x) => x.id !== id))}
      onMoveBlock={(id, index) => moves.push([id, index])}
    />
  );
};

const mk = (id: string, content: string, type: DocumentBlock['type'] = 'text', level = 0): DocumentBlock => ({
  id,
  type,
  content,
  level,
  position: 1,
});

const rowOf = (id: string) => document.querySelector(`[data-outline-block="${id}"]`) as HTMLElement;
const summary = () => live.map((b) => `${b.type}:${b.content}`);

// A drag event with this dataTransfer at the pointer's height (jsdom has no DragEvent with clientY)
const drag = async (type: 'dragEnter' | 'dragOver' | 'dragLeave' | 'drop', el: Element, data: DataTransfer, clientY = 0) => {
  const ev = createEvent[type](el, { dataTransfer: data });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent(el, ev);
  });
  return !notPrevented;
};

// Drags the files in over el and drops them there, as a browser does
const dropOn = async (el: Element, data: DataTransfer, clientY = 0) => {
  await drag('dragEnter', el, data, clientY);
  await drag('dragOver', el, data, clientY);
  return drag('drop', el, data, clientY);
};

beforeEach(() => {
  media.uploads = [];
  media.fetched = [];
  media.hold = false;
  media.release = null;
  errors.length = 0;
  inserts = 0;
  moves.length = 0;
});

describe('dragging image files onto a note', () => {
  it('puts a dropped image below the bullet it was dropped on, in one change', async () => {
    render(<Harness initial={[mk('a', 'Notiz'), mk('b', 'Danach')]} />);
    expect(await dropOn(rowOf('a'), clipboard({ files: [png('1.png'), png('2.png')] }))).toBe(true);
    await waitFor(() =>
      expect(summary()).toEqual(['text:Notiz', 'image:![](media:med_0001)', 'image:![](media:med_0002)', 'text:Danach'])
    );
    expect(inserts).toBe(1);
  });

  it('turns an empty bullet into the dropped image, also when dropped onto its text field', async () => {
    render(<Harness initial={[mk('a', 'Vorher'), mk('b', ''), mk('c', 'Danach')]} />);
    const field = rowOf('b').querySelector('textarea')!;
    await dropOn(field, clipboard({ files: [png()] }));
    await waitFor(() => expect(summary()).toEqual(['text:Vorher', 'image:![](media:med_0001)', 'text:Danach']));
  });

  it('puts images dropped between two rows below the upper one', async () => {
    render(<Harness initial={[mk('a', 'Oben'), mk('b', 'Unten')]} />);
    const box = (top: number) => ({ top, bottom: top + 30, left: 0, right: 500, width: 500, height: 30, x: 0, y: top }) as DOMRect;
    vi.spyOn(rowOf('a'), 'getBoundingClientRect').mockReturnValue(box(0));
    vi.spyOn(rowOf('b'), 'getBoundingClientRect').mockReturnValue(box(40));
    const root = rowOf('a').parentElement!;
    await dropOn(root, clipboard({ files: [png()] }), 35);
    await waitFor(() => expect(summary()).toEqual(['text:Oben', 'image:![](media:med_0001)', 'text:Unten']));
  });

  it('shows the row the images go to while dragging, and nothing once the drag left', async () => {
    render(<Harness initial={[mk('a', 'Notiz'), mk('b', 'Danach')]} />);
    const data = clipboard({ files: [png()] });
    expect(await drag('dragOver', rowOf('b'), data)).toBe(true);
    expect(rowOf('b').hasAttribute('data-file-drop')).toBe(true);
    expect(rowOf('a').hasAttribute('data-file-drop')).toBe(false);
    await drag('dragOver', rowOf('a'), data);
    expect(rowOf('a').hasAttribute('data-file-drop')).toBe(true);
    expect(rowOf('b').hasAttribute('data-file-drop')).toBe(false);
    await drag('dragLeave', rowOf('a').parentElement!, data);
    expect(document.querySelector('[data-file-drop]')).toBeNull();
  });

  it('only gives a hint for files without an image', async () => {
    render(<Harness initial={[mk('a', 'Notiz')]} />);
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'brief.pdf', { type: 'application/pdf' });
    const data = clipboard({ files: [pdf] });
    await drag('dragOver', rowOf('a'), data);
    expect(document.querySelector('[data-file-drop]')).toBeNull();
    expect(await drag('drop', rowOf('a'), data)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual(['Nur Bilder lassen sich hineinziehen.']);
    expect(media.uploads).toHaveLength(0);
    expect(summary()).toEqual(['text:Notiz']);
  });

  it('uploads the images of a drop with other files and mentions the rest', async () => {
    render(<Harness initial={[mk('a', 'Notiz')]} />);
    const txt = new File(['Hallo'], 'notiz.txt', { type: 'text/plain' });
    await dropOn(rowOf('a'), clipboard({ files: [txt, png()], text: '/tmp/notiz.txt\n/tmp/bild.png' }));
    await waitFor(() => expect(summary()).toEqual(['text:Notiz', 'image:![](media:med_0001)']));
    expect(errors).toEqual(['Nur Bilder lassen sich hineinziehen.']);
  });

  it('lets the server copy an image dragged out of a browser tab', async () => {
    render(<Harness initial={[mk('a', 'Quelle')]} />);
    const field = rowOf('a').querySelector('textarea')!;
    const data = clipboard({
      html: '<img src="https://example.com/a.png">',
      text: 'https://example.com/a.png',
      extra: { 'text/uri-list': 'https://example.com/a.png' },
    });
    expect(await drag('drop', field, data)).toBe(true);
    await waitFor(() => expect(summary()).toEqual(['text:Quelle', 'image:![](media:med_fe7c)']));
    expect(media.fetched).toEqual(['https://example.com/a.png']);
  });

  it('leaves text dragged within a field to the browser', async () => {
    render(<Harness initial={[mk('a', 'Hallo Welt')]} />);
    const field = rowOf('a').querySelector('textarea')!;
    const data = clipboard({ text: 'Welt' });
    await drag('dragOver', field, data);
    expect(document.querySelector('[data-file-drop]')).toBeNull();
    expect(await drag('drop', field, data)).toBe(false);
    expect(media.uploads).toHaveLength(0);
  });

  it('keeps moving bullets by their handle as before', async () => {
    render(<Harness initial={[mk('a', 'Eins'), mk('b', 'Zwei'), mk('c', 'Drei')]} />);
    const set: Record<string, string> = {};
    const data = {
      types: [BLOCK_DRAG_TYPE],
      files: [],
      items: [],
      dropEffect: 'move',
      effectAllowed: 'move',
      setData: (type: string, v: string) => (set[type] = v),
      getData: (type: string) => set[type] || '',
      setDragImage: () => {},
    } as unknown as DataTransfer;
    const handle = rowOf('a').querySelector('button[draggable="true"]')!;
    await act(async () => {
      fireEvent.dragStart(handle, { dataTransfer: data });
    });
    await drag('dragOver', rowOf('c'), data);
    expect(document.querySelector('[data-file-drop]')).toBeNull();
    await drag('drop', rowOf('c'), data);
    expect(moves).toEqual([['a', 2]]);
    expect(media.uploads).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('takes no drop in a read-only note', async () => {
    render(<Harness initial={[mk('a', 'Nur lesen')]} canEdit={false} />);
    const data = clipboard({ files: [png()] });
    await drag('dragOver', rowOf('a'), data);
    expect(document.querySelector('[data-file-drop]')).toBeNull();
    expect(await drag('drop', rowOf('a'), data)).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(media.uploads).toHaveLength(0);
  });

  it('shows the upload below the bullet meanwhile', async () => {
    media.hold = true;
    render(<Harness initial={[mk('a', 'Notiz'), mk('b', 'Danach')]} />);
    await dropOn(rowOf('a'), clipboard({ files: [png()] }));
    const notice = await screen.findByTestId('pasting-images');
    expect(notice.textContent).toContain('Bild wird hochgeladen');
    // Right below the bullet the image goes to
    expect(rowOf('a').nextElementSibling?.contains(notice)).toBe(true);
    await act(async () => media.release?.());
    await waitFor(() => expect(summary()).toEqual(['text:Notiz', 'image:![](media:med_0001)', 'text:Danach']));
    expect(screen.queryByTestId('pasting-images')).toBeNull();
  });
});
