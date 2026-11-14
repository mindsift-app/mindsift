import { describe, it, expect } from 'vitest';
import { Document, DocumentBlock, SharedFolder, TagDetails } from '../../../lib/types';
import {
  buildFolderTree,
  collectFolderPaths,
  collectRollupTodos,
  countHashtags,
  countOpenTodos,
  filterTags,
  folderAncestors,
  groupRollupTodosByFolder,
  mergeDocList,
  isFolderShared,
  tagGroups,
  tagsMetadata,
  withTodoToggled,
} from '../workspaceListing';

const block = (id: string, content: string, b: Partial<DocumentBlock> = {}) =>
  ({ id, type: 'text', content, level: 0, position: 0, ...b }) as DocumentBlock;
const todo = (id: string, content: string, checked = false, b: Partial<DocumentBlock> = {}) =>
  block(id, content, { type: 'todo', checked, ...b });
const doc = (id: string, blocks: DocumentBlock[], d: Partial<Document> = {}) =>
  ({ id, title: id, blocks, ...d }) as Document;

describe('workspace listing', () => {
  const docs = [
    doc('a', [todo('a1', 'Kaufen #einkauf'), todo('a2', 'Erledigt', true), todo('a3', '  ')]),
    doc('b', [todo('b1', 'Streichen #haus'), block('b2', 'Text')], { folderPath: 'Privat' }),
  ];

  it('collects the to-dos with text, per folder and counts the open ones', () => {
    const all = collectRollupTodos(docs, null, null);
    expect(all.map((t) => t.blockId)).toEqual(['a1', 'a2', 'b1']);
    expect(collectRollupTodos(docs, null, 'Privat').map((t) => t.blockId)).toEqual(['b1']);
    expect(collectRollupTodos(docs, null, 'Hauptebene').map((t) => t.blockId)).toEqual(['a1', 'a2']);
    expect(collectRollupTodos(docs, null, null, true).map((t) => t.blockId)).toEqual(['a1', 'b1']);
    const byFolder = groupRollupTodosByFolder(all);
    expect([...byFolder.keys()]).toEqual(['Hauptebene', 'Privat']);
    expect(byFolder.get('Privat')?.[0].checked).toBe(false);
    expect(countOpenTodos(docs)).toBe(2);
  });

  it('finds the blocks with a hashtag together with the blocks nested below', () => {
    const d = doc('n', [
      block('r', 'Plan #Homelab'),
      block('c1', 'Kind', { level: 1 }),
      block('c2', 'Enkel #homelab', { level: 2 }),
      block('x', 'Danach'),
      block('y', 'kein#homelab und #homelabs'),
    ]);
    const groups = tagGroups([d], 'homelab', null);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchedBlocks.map((m) => [m.rootBlock.id, m.children.map((c) => c.id)])).toEqual([['r', ['c1', 'c2']]]);
    expect(tagGroups([d], null, null)).toEqual([]);
  });

  it('adds notes only the server knows of at the end', () => {
    const details = {
      documents: [
        { docId: 'n', title: 'doppelt', matchedBlocks: [] },
        { docId: 'srv', title: '', icon: '📁', folderPath: 'X', matchedBlocks: [] },
      ],
    } as unknown as TagDetails;
    const groups = tagGroups([doc('n', [block('r', '#tag')])], 'tag', details);
    expect(groups.map((g) => [g.docId, g.title])).toEqual([
      ['n', 'n'],
      ['srv', 'Unbenannte Notiz'],
    ]);
  });

  it('collects notes and open to-dos per hashtag', () => {
    const meta = tagsMetadata([{ tag: 'einkauf', count: 1 }, { tag: 'haus', count: 1 }], docs);
    expect(meta.get('einkauf')).toEqual({ tag: 'einkauf', count: 1, docs: [{ id: 'a', title: 'a', icon: undefined, folderPath: undefined }], openTodosCount: 1 });
    expect(meta.get('haus')?.docs.map((d) => d.folderPath)).toEqual(['Privat']);
  });

  it('counts the bullets per hashtag over all notes, most frequent first', () => {
    const notes = [
      doc('x', [block('x1', '#Haus und #garten'), block('x2', 'kein#tag, #haus #haus'), block('x3', 'noch #haus')]),
      doc('y', [block('y1', '(#garten) #Auto')]),
    ];
    // A bullet counts once per hashtag, as the server's block_tags
    expect(countHashtags(notes)).toEqual([
      { tag: 'haus', count: 3 },
      { tag: 'garten', count: 2 },
      { tag: 'auto', count: 1 },
    ]);
  });

  describe('notes of the note list (no bullets, counts per note)', () => {
    const listed = (id: string, d: Partial<Document> = {}) => doc(id, [], d);
    const a = listed('a', { openTodos: 2, tagCounts: { einkauf: 3, haus: 1 }, tagOpenTodos: { einkauf: 2 } });
    const b = listed('b', { folderPath: 'Privat', tagCounts: { haus: 2 } });

    it('counts hashtags and open to-dos from the counts of the list', () => {
      expect(countHashtags([a, b])).toEqual([
        { tag: 'einkauf', count: 3 },
        { tag: 'haus', count: 3 },
      ]);
      expect(countOpenTodos([a, b])).toBe(2);
      const meta = tagsMetadata(countHashtags([a, b]), [a, b]);
      expect(meta.get('einkauf')).toMatchObject({ count: 3, openTodosCount: 2 });
      expect(meta.get('haus')?.docs.map((d) => d.id)).toEqual(['a', 'b']);
      expect(meta.get('haus')?.openTodosCount).toBe(0);
    });

    it('counts a note whose bullets are here from its bullets, over the counts of the list', () => {
      // The open note: its bullets arrived (typed in), the list's counts of it are outdated
      const open = { ...a, blocks: [todo('a1', 'Neu #einkauf'), todo('a2', 'fertig #einkauf', true)] };
      expect(countOpenTodos([open, b])).toBe(1);
      expect(countHashtags([open, b])).toEqual([
        { tag: 'einkauf', count: 2 },
        { tag: 'haus', count: 2 },
      ]);
      expect(tagsMetadata(countHashtags([open, b]), [open, b]).get('einkauf')?.openTodosCount).toBe(1);
    });

    it('takes the to-dos of the server for notes of the list and the bullets of loaded notes', () => {
      const todos = [
        { docId: 'a', blockId: 'a1', content: 'Kaufen', checked: false },
        { docId: 'gone', blockId: 'g1', content: 'Nicht in der Liste', checked: false },
        { docId: 'b', blockId: 'b1', content: 'Streichen', checked: true },
        { docId: 'a', blockId: 'a2', content: 'Bezahlen', checked: true },
      ];
      expect(collectRollupTodos([a, b], todos, null).map((t) => [t.doc.id, t.blockId, t.checked])).toEqual([
        ['a', 'a1', false],
        ['a', 'a2', true],
        ['b', 'b1', true],
      ]);
      expect(collectRollupTodos([a, b], todos, null, true).map((t) => t.blockId)).toEqual(['a1']);
      expect(collectRollupTodos([a, b], todos, 'Privat').map((t) => t.blockId)).toEqual(['b1']);
      // Not fetched yet: only notes whose bullets are here
      expect(collectRollupTodos([a, b], null, null)).toEqual([]);
      // The open note gives its own to-dos (they follow typing), not the server's
      const open = { ...a, blocks: [todo('a1', 'Kaufen und mehr')] };
      expect(collectRollupTodos([open, b], todos, null).map((t) => [t.blockId, t.content])).toEqual([
        ['a1', 'Kaufen und mehr'],
        ['b1', 'Streichen'],
      ]);
    });

    it('ticks a to-do in the counts of a note of the list, or in its bullets when they are here', () => {
      const done = withTodoToggled(a, 'a1', 'Kaufen #einkauf #Haus', true);
      expect(done.openTodos).toBe(1);
      expect(done.tagOpenTodos).toEqual({ einkauf: 1, haus: 0 });
      expect(a.openTodos).toBe(2);
      const again = withTodoToggled(done, 'a1', 'Kaufen #einkauf #Haus', false);
      expect(again.openTodos).toBe(2);
      expect(again.tagOpenTodos).toEqual({ einkauf: 2, haus: 1 });
      const loaded = doc('l', [todo('l1', 'x'), todo('l2', 'y')]);
      expect(withTodoToggled(loaded, 'l2', 'y', true).blocks.map((bl) => bl.checked)).toEqual([false, true]);
    });

    it('lists notes of the list carrying the hashtag in list order, with the server\'s matches', () => {
      const details = {
        documents: [
          { docId: 'b', title: 'b', matchedBlocks: [{ rootBlock: block('b1', '#haus'), children: [] }] },
          { docId: 'srv', title: 'Nur Server', matchedBlocks: [] },
        ],
      } as unknown as TagDetails;
      const loaded = doc('c', [block('c1', 'Dach #haus'), block('c2', 'Ziegel', { level: 1 })]);
      const groups = tagGroups([a, loaded, b], 'Haus', details);
      expect(groups.map((g) => g.docId)).toEqual(['a', 'c', 'b', 'srv']);
      expect(groups[1].matchedBlocks.map((m) => [m.rootBlock.id, m.children.map((c) => c.id)])).toEqual([['c1', ['c2']]]);
      expect(groups[2].matchedBlocks.map((m) => m.rootBlock.id)).toEqual(['b1']);
      // Before the tag details arrive: the notes by their counts
      expect(tagGroups([a, loaded, b], 'haus', null).map((g) => g.docId)).toEqual(['a', 'c', 'b']);
    });

    it('keeps the bullets of open notes when the list is fetched again', () => {
      const openA = { ...a, blocks: [todo('a1', 'offen')] };
      const closedB = { ...b, blocks: [block('b1', 'alt')] };
      const freshA = listed('a', { title: 'A neu', openTodos: 5 });
      const freshB = listed('b', { openTodos: 1 });
      const merged = mergeDocList([openA, closedB], [freshB, freshA], (id) => id === 'a' || id === 'b2');
      expect(merged.map((d) => [d.id, d.title, d.blocks.length])).toEqual([
        ['b', 'b', 0],
        ['a', 'A neu', 1],
      ]);
      expect(countOpenTodos(merged)).toBe(2);
      const fresh = [freshA];
      expect(mergeDocList([closedB], fresh, () => false)).toBe(fresh);
    });
  });

  it('matches hashtags for the tiles like the tag page: whole tags only, each bullet once', () => {
    const notes = [
      doc('x', [todo('x1', '#haus #haus offen'), todo('x2', '#haus erledigt', true), block('x3', 'example.com/#haus #hausbau')]),
      doc('y', [block('y1', 'Link #haus/plan'), todo('y2', 'Am Ende #HAUS')]),
      doc('z', [block('z1', 'nichts')]),
    ];
    const meta = tagsMetadata(countHashtags(notes), notes);
    expect(meta.get('haus')?.docs.map((d) => d.id)).toEqual(['x', 'y']);
    expect(meta.get('haus')?.openTodosCount).toBe(2);
    expect(meta.get('hausbau')?.docs.map((d) => d.id)).toEqual(['x']);
  });

  it('follows a changed note and keeps the others', () => {
    const a = doc('a', [todo('a1', 'Kaufen #einkauf')]);
    const b = doc('b', [todo('b1', 'Streichen #haus')]);
    expect(countHashtags([a, b]).map((t) => t.tag)).toEqual(['einkauf', 'haus']);
    expect(countOpenTodos([a, b])).toBe(2);
    // Typing and ticking off in a: a new note object with new bullets, b stays as it was
    const a2 = { ...a, blocks: [todo('a1', 'Kaufen #einkauf #heute', true)] };
    expect(countHashtags([a2, b]).map((t) => t.tag)).toEqual(['einkauf', 'haus', 'heute']);
    expect(countOpenTodos([a2, b])).toBe(1);
    expect(collectRollupTodos([a2, b], null, null).map((t) => [t.doc, t.checked])).toEqual([[a2, true], [b, false]]);
    expect(collectRollupTodos([a2, b], null, null, true).map((t) => t.blockId)).toEqual(['b1']);
    expect(tagsMetadata(countHashtags([a2, b]), [a2, b]).get('einkauf')?.openTodosCount).toBe(0);
  });

  it('filters hashtags with or without # and sorts by count or name', () => {
    const tags = [
      { tag: 'b', count: 1 },
      { tag: 'ab', count: 3 },
      { tag: 'c', count: 3 },
    ];
    expect(filterTags(tags, '', 'count').map((t) => t.tag)).toEqual(['ab', 'c', 'b']);
    expect(filterTags(tags, '', 'name').map((t) => t.tag)).toEqual(['ab', 'b', 'c']);
    expect(filterTags(tags, '#B', 'name').map((t) => t.tag)).toEqual(['ab', 'b']);
  });

  it('collects folder paths from folders, notes and shared folders', () => {
    const notes = [doc('a', [], { folderPath: 'Privat/Reisen' }), doc('b', [])];
    const shared = [{ id: 's', name: 'Team', mountPath: 'Team' }] as SharedFolder[];
    expect(collectFolderPaths(['Projekte', 'Privat/Reisen'], notes, shared)).toEqual(['Privat/Reisen', 'Projekte', 'Team']);
  });

  it('builds the folder tree with missing parents filled in and the notes per folder', () => {
    const notes = [doc('a', [], { folderPath: 'Privat/Reisen' }), doc('b', [], { folderPath: 'Projekte' })];
    const shared = [{ id: 's', name: 'Team', mountPath: 'Team' }] as SharedFolder[];
    const tree = buildFolderTree(['Privat/Reisen', 'Projekte', 'Team'], notes, shared);
    expect(tree.map((n) => n.fullPath)).toEqual(['Privat', 'Projekte', 'Team']);
    expect(tree[0].subfolders.map((n) => [n.name, n.docs.map((d) => d.id)])).toEqual([['Reisen', ['a']]]);
    expect(tree[1].docs.map((d) => d.id)).toEqual(['b']);
    expect(tree[2].sharedFolderObj?.id).toBe('s');
  });

  it('counts an own shared folder as shared only once it has a share', () => {
    const own = { id: 's', name: 'Team', mountPath: 'Team', isOwner: true, shares: [] } as unknown as SharedFolder;
    expect(isFolderShared(own)).toBe(false);
    expect(isFolderShared({ ...own, shares: undefined })).toBe(false);
    expect(isFolderShared({ ...own, shares: [{ id: 'x' }] } as unknown as SharedFolder)).toBe(true);
    expect(isFolderShared({ ...own, isOwner: false })).toBe(true);
    expect(isFolderShared(undefined)).toBe(false);
  });

  it('opens a note\'s folder and every folder above it', () => {
    expect(folderAncestors('Projekte/Homelab/Alt')).toEqual({ Projekte: true, 'Projekte/Homelab': true, 'Projekte/Homelab/Alt': true });
    expect(folderAncestors('')).toEqual({});
  });
});
