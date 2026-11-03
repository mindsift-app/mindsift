import { Document, DocumentBlock, SharedFolder, TagDetails, TagSummary } from '../../lib/types';
import { RollupTodo } from './TodoRollupView';
import { TagMeta } from './HashtagOverview';
import { FolderTreeNode } from './workspaceTypes';
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

// Every to-do with text of all notes ("Hauptebene" for notes outside folders), optionally of one folder only
export function collectRollupTodos(docs: Document[], todoFolderDrilldown: string | null): RollupTodo[] {
  const list: RollupTodo[] = [];
  for (const d of docs) {
    const fName = d.folderPath || 'Hauptebene';
    if (todoFolderDrilldown && fName !== todoFolderDrilldown) continue;
    for (const b of d.blocks || []) {
      if (b.type === 'todo' && b.content.trim() !== '') {
        list.push({ doc: d, blockId: b.id, content: b.content, checked: Boolean(b.checked) });
      }
    }
  }
  return list;
}

export function groupRollupTodosByFolder(allRollupTodos: RollupTodo[]): Map<string, RollupTodo[]> {
  const map = new Map<string, RollupTodo[]>();
  for (const item of allRollupTodos) {
    const fName = item.doc.folderPath || 'Hauptebene';
    const arr = map.get(fName) || [];
    arr.push(item);
    map.set(fName, arr);
  }
  return map;
}

export function countOpenTodos(docs: Document[]): number {
  let count = 0;
  for (const d of docs) {
    for (const b of d.blocks || []) {
      if (b.type === 'todo' && !b.checked && b.content.trim() !== '') {
        count++;
      }
    }
  }
  return count;
}

// Notes with blocks carrying the hashtag, from the notes in memory; notes only the server knows of (not
// loaded here) come from its tag details at the end
export function tagGroups(docs: Document[], selectedTag: string | null, tagDetails: TagDetails | null): TagGroup[] {
  if (!selectedTag) return [];
  const cleanTag = selectedTag.toLowerCase();

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
      const regex = new RegExp(`(?:^|[\\s(])#(${cleanTag})(?=[\\s.,!?:;)#\\]}]|$)`, 'i');
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
    const cleanTag = t.tag.toLowerCase();
    const matchingDocs: { id: string; title: string; icon?: string; folderPath?: string }[] = [];
    let openTodos = 0;

    for (const d of docs) {
      let hasInDoc = false;
      const blocks = d.blocks || [];
      for (const b of blocks) {
        const content = b.content || '';
        const regex = new RegExp(`(?:^|[\\s(])#(${cleanTag})(?=[\\s.,!?:;)#\\]}]|$)`, 'i');
        if (regex.test(content)) {
          hasInDoc = true;
          if (b.type === 'todo' && !b.checked) openTodos++;
        }
      }
      if (hasInDoc) {
        matchingDocs.push({
          id: d.id,
          title: d.title || i18n.t('workspace:editor.untitled'),
          icon: d.icon,
          folderPath: d.folderPath,
        });
      }
    }

    map.set(cleanTag, {
      tag: t.tag,
      count: t.count,
      docs: matchingDocs,
      openTodosCount: openTodos,
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
