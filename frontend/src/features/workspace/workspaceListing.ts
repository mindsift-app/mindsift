import { Document, DocumentBlock, SharedFolder, TagDetails, TagSummary } from '../../lib/types';
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

// What the hashtag and to-do views need of one note's bullets, worked out once per version of them. After a
// pause in typing only the note typed in has new bullets (the others keep their array), so only that note is
// read again, not every bullet of every note.
type BlockStats = {
  // Every hashtag (extractHashtags) with the number of times it occurs
  tagCounts: Map<string, number>;
  // The hashtags as tagsMetadata matches them (followed by a space, punctuation or the end), each with the
  // number of open to-dos among the bullets carrying it
  tagOpenTodos: Map<string, number>;
  openTodos: number;
};
const blockStatsCache = new WeakMap<DocumentBlock[], BlockStats>();
const NO_BLOCKS: DocumentBlock[] = [];
// A hashtag that ends at a space, punctuation or the end of the text (as in tagGroups)
const ENDED_HASHTAG = /(?:^|[\s(])#([\p{L}\p{N}_-]+)(?=[\s.,!?:;)#\]}]|$)/gu;

function blockStats(blocks: DocumentBlock[] | undefined): BlockStats {
  const blks = blocks || NO_BLOCKS;
  let stats = blockStatsCache.get(blks);
  if (stats) return stats;
  stats = { tagCounts: new Map(), tagOpenTodos: new Map(), openTodos: 0 };
  for (const b of blks) {
    const openTodo = b.type === 'todo' && !b.checked;
    if (openTodo && b.content.trim() !== '') stats.openTodos++;
    const content = b.content || '';
    if (!content.includes('#')) continue;
    for (const tag of extractHashtags(content)) {
      stats.tagCounts.set(tag, (stats.tagCounts.get(tag) || 0) + 1);
    }
    // A bullet counts once per hashtag, however often it carries it
    const tags = new Set(Array.from(content.matchAll(ENDED_HASHTAG), (m) => m[1].toLowerCase()));
    for (const tag of tags) {
      stats.tagOpenTodos.set(tag, (stats.tagOpenTodos.get(tag) || 0) + (openTodo ? 1 : 0));
    }
  }
  blockStatsCache.set(blks, stats);
  return stats;
}

// Every hashtag of the notes with the number of times it occurs, most frequent first
export function countHashtags(docs: Document[]): TagSummary[] {
  const tagMap = new Map<string, number>();
  for (const d of docs) {
    blockStats(d.blocks).tagCounts.forEach((count, tag) => {
      tagMap.set(tag, (tagMap.get(tag) || 0) + count);
    });
  }
  const list: TagSummary[] = [];
  tagMap.forEach((count, tag) => {
    list.push({ tag, count });
  });
  return list.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// The to-dos with text of one note, kept per version of the note (a changed note is a new object)
const noteTodosCache = new WeakMap<Document, RollupTodo[]>();
function noteTodos(d: Document): RollupTodo[] {
  let list = noteTodosCache.get(d);
  if (!list) {
    list = [];
    for (const b of d.blocks || []) {
      if (b.type === 'todo' && b.content.trim() !== '') {
        list.push({ doc: d, blockId: b.id, content: b.content, checked: Boolean(b.checked) });
      }
    }
    noteTodosCache.set(d, list);
  }
  return list;
}

// Every to-do with text of all notes (ROOT_FOLDER_KEY for notes outside folders), optionally of one folder only
// and optionally only the open ones
export function collectRollupTodos(docs: Document[], todoFolderDrilldown: string | null, openOnly = false): RollupTodo[] {
  const list: RollupTodo[] = [];
  for (const d of docs) {
    const fName = d.folderPath || ROOT_FOLDER_KEY;
    if (todoFolderDrilldown && fName !== todoFolderDrilldown) continue;
    for (const item of noteTodos(d)) {
      if (!(openOnly && item.checked)) list.push(item);
    }
  }
  return list;
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
  for (const d of docs) count += blockStats(d.blocks).openTodos;
  return count;
}

// Notes with blocks carrying the hashtag, from the notes in memory; notes only the server knows of (not
// loaded here) come from its tag details at the end
export function tagGroups(docs: Document[], selectedTag: string | null, tagDetails: TagDetails | null): TagGroup[] {
  if (!selectedTag) return [];
  const cleanTag = selectedTag.toLowerCase();
  const regex = new RegExp(`(?:^|[\\s(])#(${cleanTag})(?=[\\s.,!?:;)#\\]}]|$)`, 'i');

  const map = new Map<string, TagGroup>();

  for (const d of docs) {
    const blks = d.blocks || [];
    if (blks.length === 0) continue;

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

    if (matched.length > 0) {
      map.set(d.id, {
        docId: d.id,
        title: d.title || i18n.t('workspace:editor.untitled'),
        icon: d.icon || '',
        folderPath: d.folderPath || '',
        matchedBlocks: matched,
      });
    }
  }

  if (tagDetails?.documents) {
    for (const dg of tagDetails.documents) {
      if (!map.has(dg.docId)) {
        map.set(dg.docId, {
          docId: dg.docId,
          title: dg.title || i18n.t('workspace:editor.untitled'),
          icon: dg.icon || '',
          folderPath: dg.folderPath || '',
          matchedBlocks: dg.matchedBlocks || [],
        });
      }
    }
  }

  return Array.from(map.values());
}

// For every hashtag: the notes it occurs in and its open to-dos
export function tagsMetadata(tagsSummary: TagSummary[], docs: Document[]): Map<string, TagMeta> {
  const map = new Map<string, TagMeta>();

  for (const t of tagsSummary) {
    map.set(t.tag.toLowerCase(), { tag: t.tag, count: t.count, docs: [], openTodosCount: 0 });
  }

  // Per note only its own hashtags (blockStats), not every hashtag against every bullet
  for (const d of docs) {
    blockStats(d.blocks).tagOpenTodos.forEach((openTodos, tag) => {
      const meta = map.get(tag);
      if (!meta) return;
      meta.openTodosCount += openTodos;
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
