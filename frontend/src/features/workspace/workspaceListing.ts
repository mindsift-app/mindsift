import { DocTodo, Document, DocumentBlock, SharedFolder, TagDetails, TagSummary } from '../../lib/types';
import { RollupTodo } from './TodoRollupView';
import { TagMeta } from './HashtagOverview';
import { FolderTreeNode } from './workspaceTypes';
import { extractHashtags } from '../../lib/hashtags';
import i18n from '../../i18n';

// What the folder tree, the to-do collection and the hashtag views of WorkspaceView show. Pure functions.

// A note with the blocks that carry the hashtag, each with the blocks nested below it
export type TagGroup = {
  docId: string;
  title: string;
  icon: string;
  folderPath: string;
  matchedBlocks: { rootBlock: DocumentBlock; children: DocumentBlock[] }[];
};

// Group key of notes outside folders (shown as rollup.root in the person's language)
export const ROOT_FOLDER_KEY = 'Hauptebene';

// What the hashtag and to-do views need of one note's bullets. The note list (GET /documents) brings no
// bullets but these counts per note; a note whose bullets are here (the open note, one fetched) counts its own,
// so the counts follow typing at once.
export type NoteStats = {
  // Every hashtag (extractHashtags, as the server's block_tags) with the number of bullets carrying it
  tagCounts: Map<string, number>;
  // The same hashtags, each with the number of open to-dos among the bullets carrying it
  tagOpenTodos: Map<string, number>;
  openTodos: number;
};

/** Whether the note's bullets are here; a note of the list has none (a note always keeps one bullet). */
export function hasBlocks(d: Document): boolean {
  return (d.blocks?.length ?? 0) > 0;
}

// Worked out once per version of the bullets: after a pause in typing only the note typed in has new bullets
// (the others keep their array), so only that note is read again
const blockStatsCache = new WeakMap<DocumentBlock[], NoteStats>();

function blockStats(blocks: DocumentBlock[]): NoteStats {
  let stats = blockStatsCache.get(blocks);
  if (stats) return stats;
  stats = { tagCounts: new Map(), tagOpenTodos: new Map(), openTodos: 0 };
  for (const b of blocks) {
    const content = b.content || '';
    const openTodo = b.type === 'todo' && !b.checked && content.trim() !== '';
    if (openTodo) stats.openTodos++;
    // A bullet counts once per hashtag, however often it carries it
    for (const tag of new Set(extractHashtags(content))) {
      stats.tagCounts.set(tag, (stats.tagCounts.get(tag) || 0) + 1);
      stats.tagOpenTodos.set(tag, (stats.tagOpenTodos.get(tag) || 0) + (openTodo ? 1 : 0));
    }
  }
  blockStatsCache.set(blocks, stats);
  return stats;
}

// The server's counts of a note of the list, kept per version of the note (a changed note is a new object)
const listStatsCache = new WeakMap<Document, NoteStats>();

/** The counts of one note: from its bullets when they are here, else as the note list reported them. */
export function noteStats(d: Document): NoteStats {
  if (hasBlocks(d)) return blockStats(d.blocks);
  let stats = listStatsCache.get(d);
  if (!stats) {
    stats = {
      tagCounts: new Map(Object.entries(d.tagCounts || {})),
      tagOpenTodos: new Map(Object.entries(d.tagOpenTodos || {})),
      openTodos: d.openTodos || 0,
    };
    listStatsCache.set(d, stats);
  }
  return stats;
}

// Every hashtag of the notes with the number of bullets carrying it and the notes it is in, most frequent first
export function countHashtags(docs: Document[]): TagSummary[] {
  const tagMap = new Map<string, TagSummary>();
  for (const d of docs) {
    noteStats(d).tagCounts.forEach((count, tag) => {
      if (count <= 0) return;
      const entry = tagMap.get(tag);
      if (entry) {
        entry.count += count;
        entry.docIds!.push(d.id);
      } else {
        tagMap.set(tag, { tag, count, docIds: [d.id] });
      }
    });
  }
  return Array.from(tagMap.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The notes carrying every one of the hashtags (the sidebar's filter of the folder tree); null without
 * hashtags, i.e. no filter.
 */
export function docsWithAllTags(tagsSummary: TagSummary[], tags: readonly string[]): Set<string> | null {
  if (tags.length === 0) return null;
  let ids: Set<string> | null = null;
  for (const tag of tags) {
    const docIds = tagsSummary.find((s) => s.tag === tag)?.docIds || [];
    ids = new Set(ids ? docIds.filter((id) => ids!.has(id)) : docIds);
  }
  return ids;
}

/**
 * The folder tree cut to the notes of the filter: only those notes, only folders holding one of them
 * somewhere below (the paths of these folders in `paths`, to show them open).
 */
export function filterFolderTree(nodes: FolderTreeNode[], ids: Set<string>, paths: string[] = []): FolderTreeNode[] {
  const out: FolderTreeNode[] = [];
  for (const node of nodes) {
    const subfolders = filterFolderTree(node.subfolders, ids, paths);
    const docs = node.docs.filter((d) => ids.has(d.id));
    if (subfolders.length === 0 && docs.length === 0) continue;
    paths.push(node.fullPath);
    out.push({ ...node, subfolders, docs });
  }
  return out;
}

/**
 * A fresh note list over the one in memory: notes open in an editor keep the bullets they have here (the list
 * brings none, and the open note's counts follow its bullets); every other note is taken as listed.
 */
export function mergeDocList(prev: Document[], fresh: Document[], isOpen: (docId: string) => boolean): Document[] {
  const kept = new Map<string, DocumentBlock[]>();
  for (const d of prev) {
    if (hasBlocks(d) && isOpen(d.id)) kept.set(d.id, d.blocks);
  }
  if (kept.size === 0) return fresh;
  return fresh.map((d) => {
    const blocks = kept.get(d.id);
    return blocks && !hasBlocks(d) ? { ...d, blocks } : d;
  });
}

/**
 * A note of the list after a realtime event brought it as the list has it (DOC_UPDATED, without bullets):
 * taken as sent (shares, counts and place may be gone, not only changed); a note open in an editor keeps
 * its bullets, the bullets of a closed one (the counts would follow those) are dropped for the new counts.
 */
export function withListedNote(prev: Document, listed: Document, isOpen: boolean): Document {
  if (hasBlocks(listed)) return { ...prev, ...listed };
  return { ...listed, blocks: isOpen && hasBlocks(prev) ? prev.blocks : [] };
}

/**
 * A note of the list after its editor closed: without bullets (they would go stale and the counts would
 * follow them), with the counts of its last bullets in the list's fields until the server sends newer ones.
 */
export function withoutBullets(d: Document): Document {
  if (!hasBlocks(d)) return d;
  const stats = blockStats(d.blocks);
  return {
    ...d,
    blocks: [],
    openTodos: stats.openTodos,
    tagCounts: Object.fromEntries(stats.tagCounts),
    tagOpenTodos: Object.fromEntries(stats.tagOpenTodos),
  };
}

/** A note of the list with the counts of a DOC_COUNTS event (the same for everyone who sees the note). */
export function withCounts(d: Document, counts: NoteCounts): Document {
  return { ...d, openTodos: counts.openTodos, tagCounts: counts.tagCounts || {}, tagOpenTodos: counts.tagOpenTodos || {} };
}

// DOC_COUNTS (server: doc_counts.go)
export type NoteCounts = {
  id: string;
  openTodos: number;
  tagCounts?: Record<string, number>;
  tagOpenTodos?: Record<string, number>;
};

// The to-dos with text of one note from its bullets, kept per version of the note (a changed note is a new object)
const noteTodosCache = new WeakMap<Document, RollupTodo[]>();
function noteTodos(d: Document): RollupTodo[] {
  let list = noteTodosCache.get(d);
  if (!list) {
    list = [];
    for (const b of d.blocks) {
      if (b.type === 'todo' && (b.content || '').trim() !== '') {
        list.push({ doc: d, blockId: b.id, content: b.content, checked: Boolean(b.checked) });
      }
    }
    noteTodosCache.set(d, list);
  }
  return list;
}

// The server's to-dos (GET /documents/todos) by note, worked out once per answer
const todosByDocCache = new WeakMap<DocTodo[], Map<string, DocTodo[]>>();
function todosByDoc(todos: DocTodo[]): Map<string, DocTodo[]> {
  let map = todosByDocCache.get(todos);
  if (!map) {
    map = new Map();
    for (const item of todos) {
      const arr = map.get(item.docId);
      if (arr) arr.push(item);
      else map.set(item.docId, [item]);
    }
    todosByDocCache.set(todos, map);
  }
  return map;
}

// Every to-do with text of all notes (ROOT_FOLDER_KEY for notes outside folders), optionally of one folder only
// and optionally only the open ones. A note whose bullets are here gives its own to-dos (they follow typing),
// the others those of the server's list (`todos`, null while not loaded).
export function collectRollupTodos(
  docs: Document[],
  todos: DocTodo[] | null,
  todoFolderDrilldown: string | null,
  openOnly = false
): RollupTodo[] {
  const fromServer = todos ? todosByDoc(todos) : null;
  const list: RollupTodo[] = [];
  for (const d of docs) {
    const fName = d.folderPath || ROOT_FOLDER_KEY;
    if (todoFolderDrilldown && fName !== todoFolderDrilldown) continue;
    if (hasBlocks(d)) {
      for (const item of noteTodos(d)) {
        if (!(openOnly && item.checked)) list.push(item);
      }
      continue;
    }
    for (const item of fromServer?.get(d.id) || []) {
      if (!(openOnly && item.checked)) list.push({ doc: d, blockId: item.blockId, content: item.content, checked: item.checked });
    }
  }
  return list;
}

/**
 * The note after ticking one of its to-dos (checked = the new state): its bullets when they are here, else the
 * counts of the note list, so the open to-dos in the sidebar and on the hashtags follow at once.
 */
export function withTodoToggled(d: Document, blockId: string, content: string, checked: boolean): Document {
  if (hasBlocks(d)) {
    return { ...d, blocks: d.blocks.map((b) => (b.id === blockId ? { ...b, checked } : b)) };
  }
  if (content.trim() === '') return d;
  const delta = checked ? -1 : 1;
  const tagOpenTodos = { ...(d.tagOpenTodos || {}) };
  for (const tag of new Set(extractHashtags(content))) {
    tagOpenTodos[tag] = Math.max(0, (tagOpenTodos[tag] || 0) + delta);
  }
  return { ...d, openTodos: Math.max(0, (d.openTodos || 0) + delta), tagOpenTodos };
}

export function groupRollupTodosByFolder(allRollupTodos: RollupTodo[]): Map<string, RollupTodo[]> {
  const map = new Map<string, RollupTodo[]>();
  for (const item of allRollupTodos) {
    const fName = item.doc.folderPath || ROOT_FOLDER_KEY;
    const arr = map.get(fName) || [];
    arr.push(item);
    map.set(fName, arr);
  }
  return map;
}

export function countOpenTodos(docs: Document[]): number {
  let count = 0;
  for (const d of docs) count += noteStats(d).openTodos;
  return count;
}

// Notes with bullets carrying the hashtag, in the order of the note list: a note whose bullets are here with
// its matching bullets (each with the bullets nested below), a note of the list by its counts (the hashtag page
// loads its bullets itself), then the notes only the server's tag details know of
export function tagGroups(docs: Document[], selectedTag: string | null, tagDetails: TagDetails | null): TagGroup[] {
  if (!selectedTag) return [];
  const cleanTag = selectedTag.toLowerCase();
  const regex = new RegExp(`(?:^|[\\s(])#(${cleanTag})(?=[\\s.,!?:;)#\\]}]|$)`, 'i');
  const fromServer = new Map((tagDetails?.documents || []).map((dg) => [dg.docId, dg]));

  const map = new Map<string, TagGroup>();
  const group = (
    docId: string,
    d: { title?: string; icon?: string; folderPath?: string },
    matchedBlocks: TagGroup['matchedBlocks']
  ): TagGroup => ({
    docId,
    title: d.title || i18n.t('workspace:editor.untitled'),
    icon: d.icon || '',
    folderPath: d.folderPath || '',
    matchedBlocks,
  });

  for (const d of docs) {
    if (!hasBlocks(d)) {
      if (noteStats(d).tagCounts.has(cleanTag)) {
        map.set(d.id, group(d.id, d, fromServer.get(d.id)?.matchedBlocks || []));
      }
      continue;
    }
    const blks = d.blocks;
    const matched: { rootBlock: DocumentBlock; children: DocumentBlock[] }[] = [];
    const processedChildIds = new Set<string>();

    for (let i = 0; i < blks.length; i++) {
      const b = blks[i];
      if (processedChildIds.has(b.id)) continue;

      const content = b.content || '';
      if (regex.test(content)) {
        const children: DocumentBlock[] = [];
        const rootLevel = b.level || 0;
        for (let j = i + 1; j < blks.length; j++) {
          const nextB = blks[j];
          if ((nextB.level || 0) > rootLevel) {
            children.push(nextB);
            processedChildIds.add(nextB.id);
          } else {
            break;
          }
        }
        matched.push({ rootBlock: b, children });
      }
    }

    if (matched.length > 0) map.set(d.id, group(d.id, d, matched));
  }

  for (const dg of fromServer.values()) {
    if (!map.has(dg.docId)) map.set(dg.docId, group(dg.docId, dg, dg.matchedBlocks || []));
  }

  return Array.from(map.values());
}

// For every hashtag: the notes it occurs in and its open to-dos
export function tagsMetadata(tagsSummary: TagSummary[], docs: Document[]): Map<string, TagMeta> {
  const map = new Map<string, TagMeta>();

  for (const t of tagsSummary) {
    map.set(t.tag.toLowerCase(), { tag: t.tag, count: t.count, docs: [], openTodosCount: 0 });
  }

  // Per note only its own hashtags (noteStats), not every hashtag against every bullet
  for (const d of docs) {
    const stats = noteStats(d);
    stats.tagCounts.forEach((_, tag) => {
      const meta = map.get(tag);
      if (!meta) return;
      meta.openTodosCount += stats.tagOpenTodos.get(tag) || 0;
      meta.docs.push({
        id: d.id,
        title: d.title || i18n.t('workspace:editor.untitled'),
        icon: d.icon,
        folderPath: d.folderPath,
      });
    });
  }

  return map;
}

// Hashtags of the tile view: matching the search (with or without #), by count or by name
export function filterTags(tagsSummary: TagSummary[], tagSearchQuery: string, tagSortBy: 'count' | 'name'): TagSummary[] {
  const q = tagSearchQuery.trim().toLowerCase().replace(/^#/, '');
  let list = [...tagsSummary];
  if (q) {
    list = list.filter((t) => t.tag.toLowerCase().includes(q));
  }
  if (tagSortBy === 'count') {
    list.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  } else {
    list.sort((a, b) => a.tag.localeCompare(b.tag));
  }
  return list;
}

// Whether a shared folder is really shared: one shared with me, or my own with at least one share. Opening the
// sharing dialog already creates the shared folder, so without shares it is still private.
export function isFolderShared(sf: SharedFolder | undefined): boolean {
  return Boolean(sf && (!sf.isOwner || (sf.shares?.length ?? 0) > 0));
}

// Every folder path: the folders themselves, the folders of notes and the places of shared folders
export function collectFolderPaths(folders: string[], docs: Document[], sharedFolders: SharedFolder[]): string[] {
  const set = new Set<string>(folders);
  for (const d of docs) {
    if (d.folderPath) set.add(d.folderPath);
  }
  for (const sf of sharedFolders) {
    if (sf.mountPath) set.add(sf.mountPath);
  }
  return Array.from(set).sort();
}

// The folder tree: parents before children (missing parents are filled in), each folder with its notes and
// its shared folder; a folder whose parent cannot be found goes to the top level
// The folder and every folder above it, as keys of the expanded folders ("A/B" → A, A/B)
export function folderAncestors(path: string): Record<string, boolean> {
  const parts = path ? path.split('/') : [];
  return Object.fromEntries(parts.map((_, i) => [parts.slice(0, i + 1).join('/'), true]));
}

export function buildFolderTree(allFolderPaths: string[], treeDocs: Document[], sharedFolders: SharedFolder[]): FolderTreeNode[] {
  const rootNodes: FolderTreeNode[] = [];
  const nodeMap = new Map<string, FolderTreeNode>();

  const allPathsSet = new Set<string>();
  for (const p of allFolderPaths) {
    const parts = p.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      allPathsSet.add(current);
    }
  }

  const sortedPaths = Array.from(allPathsSet).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  for (const p of sortedPaths) {
    const parts = p.split('/');
    const leafName = parts[parts.length - 1];
    const sharedFolderObj = sharedFolders.find(
      (sf) => sf.mountPath === p || sf.name === p
    );
    const folderDocs = treeDocs.filter((d) => d.folderPath === p);

    const node: FolderTreeNode = {
      name: leafName,
      fullPath: p,
      subfolders: [],
      docs: folderDocs,
      sharedFolderObj,
    };
    nodeMap.set(p, node);

    if (parts.length === 1) {
      rootNodes.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parentNode = nodeMap.get(parentPath);
      if (parentNode) {
        parentNode.subfolders.push(node);
      } else {
        rootNodes.push(node);
      }
    }
  }

  return rootNodes;
}
