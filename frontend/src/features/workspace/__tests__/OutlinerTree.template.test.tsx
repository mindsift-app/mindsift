import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react';
import { OutlinerTree, TemplateSource } from '../OutlinerTree';
import { DocumentBlock } from '../../../lib/types';
import { formatDate } from '../../../lib/format';

let live: DocumentBlock[] = [];

// Inserts like useBlockEditing.handleInsertBlocks: the bullet changes, new bullets on its level follow its
// branch, deeper ones come right after it
const Harness: React.FC<{ initial: DocumentBlock[]; source?: TemplateSource }> = ({ initial, source }) => {
  const [blocks, setBlocks] = useState(initial);
  // eslint-disable-next-line react-hooks/globals
  live = blocks;
  return (
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      canEdit
      templateSource={source}
      onUpdateBlock={(b) => setBlocks((p) => p.map((x) => (x.id === b.id ? b : x)))}
      onInsertBlocks={(afterId, current, added) =>
        setBlocks((p) => {
          const next = p.map((x) => (x.id === afterId ? current : x));
          const i = next.findIndex((x) => x.id === afterId);
          let at = i + 1;
          if (added.length > 0 && (added[0].level || 0) <= (current.level || 0)) {
            while (at < next.length && (next[at].level || 0) > (current.level || 0)) at++;
          }
          next.splice(at, 0, ...added);
          return next;
        })
      }
      onCreateBlock={(nb) => setBlocks((p) => [...p, nb])}
      onDeleteBlock={(id) => setBlocks((p) => p.filter((x) => x.id !== id))}
      onMoveBlock={() => {}}
    />
  );
};

const mk = (id: string, content: string, level = 0, type: DocumentBlock['type'] = 'bullet'): DocumentBlock => ({
  id,
  type,
  content,
  level,
  position: 1,
});

const templateBullets: DocumentBlock[] = [
  { id: 't1', type: 'h2', content: 'Woche {{datum}}', level: 0 },
  { id: 't2', type: 'todo', content: 'Einkaufen', level: 1, checked: true, taskId: 'task_9' },
  { id: 't3', type: 'code', content: 'make {{datum}}', lang: 'bash', level: 1 },
];

const source = (load = vi.fn(async () => templateBullets)): TemplateSource => ({
  templates: [
    { id: 'tpl1', title: 'Wochenplan', icon: '📅', folderPath: 'Vorlagen' },
    { id: 'tpl2', title: 'Besprechung', icon: '🗣️' },
  ],
  load,
  noteTitle: 'Projekt',
});

const typeSlash = async (text: string, value: string) => {
  const ta = screen.getAllByDisplayValue(text)[0] as HTMLTextAreaElement;
  ta.focus();
  await act(async () => {
    fireEvent.change(ta, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
  });
  return ta;
};

describe('/vorlage in the outliner', () => {
  it('offers the command in German and English only when the tree has templates', async () => {
    const { unmount } = render(<Harness initial={[mk('a', '')]} />);
    await typeSlash('', '/vorl');
    expect(screen.queryByText('/vorlage')).toBeNull();
    unmount();

    render(<Harness initial={[mk('a', '')]} source={source()} />);
    await typeSlash('', '/templ');
    expect(screen.getByText('/vorlage')).toBeTruthy();
  });

  it('replaces an empty bullet with the template, to-dos open, date filled in, code kept', async () => {
    const load = vi.fn(async () => templateBullets);
    render(<Harness initial={[mk('a', 'Vorher'), mk('b', '', 0)]} source={source(load)} />);
    const ta = await typeSlash('', '/vorlage');
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });

    // The picker lists the templates and searches them
    const search = await screen.findByPlaceholderText('Vorlage suchen …');
    expect(screen.getByText('Besprechung')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'woche' } });
    expect(screen.queryByText('Besprechung')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText('Wochenplan'));
    });

    await waitFor(() => expect(live).toHaveLength(4));
    expect(load).toHaveBeenCalledWith('tpl1');
    const today = formatDate(new Date());
    expect(live.map((b) => [b.type, b.content, b.level])).toEqual([
      ['bullet', 'Vorher', 0],
      ['h2', `Woche ${today}`, 0],
      ['todo', 'Einkaufen', 1],
      ['code', 'make {{datum}}', 1],
    ]);
    // The empty bullet became the first one (same id), the rest are new
    expect(live[1].id).toBe('b');
    expect(live[2]).toMatchObject({ checked: false });
    expect(live[2].taskId).toBeUndefined();
    expect(live[3].lang).toBe('bash');
  });

  it('puts the template after a bullet with text and its branch, on its level', async () => {
    render(<Harness initial={[mk('a', 'Thema'), mk('c', 'Kind', 1), mk('z', 'Ende')]} source={source()} />);
    const ta = await typeSlash('Thema', 'Thema /vorlage');
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
    await screen.findByPlaceholderText('Vorlage suchen …');
    await act(async () => {
      fireEvent.click(screen.getByText('Wochenplan'));
    });
    await waitFor(() => expect(live).toHaveLength(6));
    expect(live.map((b) => [b.content.split(' ')[0], b.level])).toEqual([
      ['Thema', 0],
      ['Kind', 1],
      ['Woche', 0],
      ['Einkaufen', 1],
      ['make', 1],
      ['Ende', 0],
    ]);
  });

  it('closes the picker with Escape without changing the note', async () => {
    const load = vi.fn(async () => templateBullets);
    render(<Harness initial={[mk('a', '')]} source={source(load)} />);
    const ta = await typeSlash('', '/vorlage');
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
    const search = await screen.findByPlaceholderText('Vorlage suchen …');
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Escape' });
    });
    expect(screen.queryByPlaceholderText('Vorlage suchen …')).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(live.map((b) => b.content)).toEqual(['']);
  });
});
