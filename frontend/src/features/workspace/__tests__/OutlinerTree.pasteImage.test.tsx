import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import { DocumentBlock } from '../../../lib/types';
import { clipboard, png } from '../../../test/clipboard';

const media = vi.hoisted(() => ({
  uploads: [] as Blob[],
  fetched: [] as string[],
  fail: null as string | null,
  release: null as (() => void) | null,
  hold: false,
}));

vi.mock('../../../lib/media', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/media')>();
  const done = async () => {
    if (media.hold) await new Promise<void>((r) => (media.release = r));
    if (media.fail) throw new Error(media.fail);
  };
  return {
    ...real,
    prepareImage: async (file: Blob) => ({ blob: file, name: 'bild' }),
    uploadMedia: async (_doc: string, blob: Blob) => {
      media.uploads.push(blob);
      const n = media.uploads.length;
      await done();
      return { id: `med_${n.toString(16).padStart(4, '0')}`, kind: 'image', mime: 'image/png', size: 1, url: '' };
    },
    copyExternalImage: async (_doc: string, url: string) => {
      media.fetched.push(url);
      await done();
      return { id: 'med_fe7c', kind: 'image', mime: 'image/png', size: 1, url: '' };
    },
    mediaObjectURL: () => new Promise<string>(() => {}),
  };
});

const errors: string[] = [];
vi.mock('../../../components/ErrorNotice', () => ({ showError: (m: string) => errors.push(m) }));

let live: DocumentBlock[] = [];
let inserts = 0;

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
      onMoveBlock={() => {}}
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

const field = (content: string) => screen.getAllByDisplayValue(content)[0] as HTMLTextAreaElement;

const paste = async (el: HTMLElement, data: DataTransfer) => {
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent.paste(el, { clipboardData: data });
  });
  return !notPrevented;
};

const summary = () => live.map((b) => `${b.type}:${b.content}`);
// The text field of a bullet (an image bullet's caption field is empty, too)
const textOf = (id: string) => document.querySelector(`[data-outline-block="${id}"] textarea`);

beforeEach(() => {
  media.uploads = [];
  media.fetched = [];
  media.fail = null;
  media.hold = false;
  media.release = null;
  errors.length = 0;
  inserts = 0;
});

describe('pasting images into a note', () => {
  it('turns an empty bullet into the pasted screenshot', async () => {
    render(<Harness initial={[mk('a', '')]} />);
    expect(await paste(field(''), clipboard({ files: [png()] }))).toBe(true);
    await waitFor(() => expect(summary()).toEqual(['image:![](media:med_0001)', 'text:']));
    expect(inserts).toBe(1);
  });

  it('puts the image below a bullet with text and shows the upload meanwhile', async () => {
    media.hold = true;
    render(<Harness initial={[mk('a', 'Notiz'), mk('b', 'Danach')]} />);
    await paste(field('Notiz'), clipboard({ files: [png()] }));
    expect(screen.getByTestId('pasting-images').textContent).toContain('Bild wird hochgeladen');
    expect(summary()).toEqual(['text:Notiz', 'text:Danach']);
    await act(async () => media.release?.());
    await waitFor(() => expect(summary()).toEqual(['text:Notiz', 'image:![](media:med_0001)', 'text:Danach']));
    expect(screen.queryByTestId('pasting-images')).toBeNull();
  });

  it('makes one bullet per image, in order, in one change', async () => {
    render(<Harness initial={[mk('a', '')]} />);
    await paste(field(''), clipboard({ files: [png('1.png'), png('2.png'), png('3.png')] }));
    await waitFor(() =>
      expect(summary()).toEqual(['image:![](media:med_0001)', 'image:![](media:med_0002)', 'image:![](media:med_0003)', 'text:'])
    );
    expect(inserts).toBe(1);
  });

  it('lets the server copy an image only known from the HTML', async () => {
    render(<Harness initial={[mk('a', 'Quelle')]} />);
    await paste(field('Quelle'), clipboard({ html: '<img src="https://example.com/a.png">' }));
    await waitFor(() => expect(summary()).toEqual(['text:Quelle', 'image:![](media:med_fe7c)']));
    expect(media.fetched).toEqual(['https://example.com/a.png']);
  });

  it('pastes the text as before and the image after its last line', async () => {
    render(<Harness initial={[mk('a', '')]} />);
    const data = clipboard({
      files: [png()],
      text: 'Erste Zeile\n\nZweite Zeile',
      html: '<p>Erste Zeile</p><p>Zweite Zeile</p><img src="https://example.com/a.png">',
    });
    await paste(field(''), data);
    await waitFor(() => expect(summary()).toEqual(['text:Erste Zeile', 'text:Zweite Zeile', 'image:![](media:med_0001)']));
  });

  it('leaves one line of text to the browser and adds the image below', async () => {
    render(<Harness initial={[mk('a', 'Hallo')]} />);
    const data = clipboard({ files: [png()], text: 'Welt', html: '<span>Welt</span><img src="https://example.com/a.png">' });
    expect(await paste(field('Hallo'), data)).toBe(false);
    await waitFor(() => expect(summary()).toEqual(['text:Hallo', 'image:![](media:med_0001)']));
  });

  it('pastes no image into a code block or a table cell', async () => {
    render(<Harness initial={[mk('c', 'let a = 1;', 'code'), mk('t', '| A | B |\n| --- | --- |\n| 1 | 2 |', 'table')]} />);
    const cell = document.querySelector('textarea[data-table-cell]') as HTMLTextAreaElement;
    await paste(cell, clipboard({ files: [png()] }));
    const code = document.querySelector('[data-outline-block="c"] textarea, [data-outline-block="c"] [contenteditable]') as HTMLElement | null;
    if (code) await paste(code, clipboard({ files: [png()] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(media.uploads).toHaveLength(0);
    expect(live.map((b) => b.type)).toEqual(['code', 'table']);
  });

  it('does nothing in a read-only note', async () => {
    render(<Harness initial={[mk('a', 'Nur lesen')]} canEdit={false} />);
    expect(await paste(field('Nur lesen'), clipboard({ files: [png()] }))).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(media.uploads).toHaveLength(0);
  });

  it('reports a refused image and keeps the bullet as it was', async () => {
    media.fail = 'Bild zu groß (höchstens 10 MB)';
    render(<Harness initial={[mk('a', '')]} />);
    await paste(field(''), clipboard({ files: [png()] }));
    await waitFor(() => expect(errors).toEqual(['Bild nicht eingefügt: Bild zu groß (höchstens 10 MB)']));
    expect(summary()).toEqual(['text:']);
  });

  it('says that images need a connection when offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      render(<Harness initial={[mk('a', '')]} />);
      expect(await paste(field(''), clipboard({ files: [png()] }))).toBe(true);
      expect(errors[0]).toContain('nur mit Verbindung');
      expect(media.uploads).toHaveLength(0);
    } finally {
      online.mockRestore();
    }
  });

  it('puts the cursor into a new empty bullet below the image, in the same change', async () => {
    render(<Harness initial={[mk('a', 'Vorher'), mk('b', '', 'text', 1)]} />);
    const empty = field('');
    empty.focus();
    await paste(empty, clipboard({ files: [png()] }));
    await waitFor(() => expect(summary()).toEqual(['text:Vorher', 'image:![](media:med_0001)', 'text:']));
    expect(inserts).toBe(1);
    expect(live[2].level).toBe(1);
    await waitFor(() => expect(document.activeElement).toBe(textOf(live[live.length - 1].id)));
  });

  it('goes to the start of the bullet that follows instead of adding one', async () => {
    render(<Harness initial={[mk('a', ''), mk('b', 'Danach')]} />);
    const empty = field('');
    empty.focus();
    await paste(empty, clipboard({ files: [png()] }));
    await waitFor(() => expect(summary()).toEqual(['image:![](media:med_0001)', 'text:Danach']));
    const next = field('Danach');
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(next.selectionStart).toBe(0);
  });

  it('adds the bullet on the image level when the branch ends below it', async () => {
    render(<Harness initial={[mk('a', 'Oben'), mk('b', '', 'text', 1), mk('c', 'Nächster Abschnitt')]} />);
    const empty = field('');
    empty.focus();
    await paste(empty, clipboard({ files: [png()] }));
    await waitFor(() => expect(summary()).toEqual(['text:Oben', 'image:![](media:med_0001)', 'text:', 'text:Nächster Abschnitt']));
    expect(live[2].level).toBe(1);
  });

  it('leaves the cursor where it went during a slow upload', async () => {
    media.hold = true;
    render(<Harness initial={[mk('a', ''), mk('b', 'Woanders', 'text', 1)]} />);
    const empty = field('');
    empty.focus();
    await paste(empty, clipboard({ files: [png()] }));
    const other = field('Woanders');
    other.focus();
    await act(async () => media.release?.());
    await waitFor(() => expect(summary()).toEqual(['image:![](media:med_0001)', 'text:Woanders']));
    expect(document.activeElement).toBe(other);
  });

  it('does the same after /image', async () => {
    render(<Harness initial={[mk('a', 'Vorher'), mk('b', '')]} />);
    const empty = field('');
    empty.focus();
    fireEvent.change(empty, { target: { value: '/image' } });
    fireEvent.keyDown(empty, { key: 'Enter' });
    const input = await waitFor(() => {
      const el = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [png()] } });
    });
    await waitFor(() => expect(summary()).toEqual(['text:Vorher', 'image:![](media:med_0001)', 'text:']));
    expect(inserts).toBe(1); // one change, one step for Ctrl+Z
    await waitFor(() => expect(document.activeElement).toBe(textOf(live[live.length - 1].id)));
  });

  it('keeps pasting bullets copied in MindSift as their own text', async () => {
    render(<Harness initial={[mk('a', '')]} />);
    const own = '- Eins\n- ![](media:med_00aa)';
    await paste(field(''), clipboard({ files: [png()], own, text: own }));
    await new Promise((r) => setTimeout(r, 20));
    expect(media.uploads).toHaveLength(0);
    expect(live.some((b) => b.content.includes('med_00aa'))).toBe(true);
  });
});
