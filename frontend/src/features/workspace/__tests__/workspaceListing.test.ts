import { describe, it, expect } from 'vitest';
import { Document, DocumentBlock, SharedFolder, TagDetails } from '../../../lib/types';
import {
  buildFolderTree,
  collectFolderPaths,
  collectRollupTodos,
  countOpenTodos,
  filterTags,
  groupRollupTodosByFolder,
  tagGroups,
  tagsMetadata,
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
    const all = collectRollupTodos(docs, null);
    expect(all.map((t) => t.blockId)).toEqual(['a1', 'a2', 'b1']);
    expect(collectRollupTodos(docs, 'Privat').map((t) => t.blockId)).toEqual(['b1']);
    expect(collectRollupTodos(docs, 'Hauptebene').map((t) => t.blockId)).toEqual(['a1', 'a2']);
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
});
