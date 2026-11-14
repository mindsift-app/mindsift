import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BlockInfo, Document } from './types';
import { WikiLink, WikiLinkResolver, WikiLinkTarget } from './wikiLink';
import { blocksVersion, cachedBlock, requestBlock, subscribeBlocks } from './blockLookup';

// Resolves links in the notes to what they point at right now (current title, the linked bullet's text).
// The workspace provides it from the notes it has loaded; without it (public page) links show the title
// stored in them. A store rather than the resolver itself: the notes change with every typing pause, and a
// new context value would render every bullet of the open note again.
export interface WikiLinkStore {
  current: WikiLinkResolver;
  subscribe: (onChange: () => void) => () => void;
  // The workspace's notes as of the last render (e.g. for the link dialog, which then fetches no list)
  docs?: Document[];
}

export const WikiLinkResolverContext = createContext<WikiLinkStore | null>(null);

// Bullets of notes whose bullets are not loaded here (the note list has none): looked up one by one
// (lib/blockLookup.ts); get = as far as known (undefined = not yet), request = look it up in the background
export interface BlockSource {
  get: (blockId: string) => BlockInfo | null | undefined;
  request: (blockId: string) => void;
}
const lookedUpBlocks: BlockSource = { get: cachedBlock, request: requestBlock };

/** The workspace's store; its resolver follows `docs` and the bullets looked up for links. */
export function useWikiLinkStore(docs: Document[]): WikiLinkStore {
  const blocksSeen = useSyncExternalStore(subscribeBlocks, blocksVersion);
  const resolver = useMemo(() => makeWikiLinkResolver(docs, lookedUpBlocks, blocksSeen), [docs, blocksSeen]);
  const [store] = useState(() => {
    const listeners = new Set<() => void>();
    return {
      listeners,
      current: resolver,
      docs,
      subscribe: (onChange: () => void) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    };
  });
  useLayoutEffect(() => {
    // Read when needed (no listener follows it), so no one is told
    // eslint-disable-next-line react-hooks/immutability
    store.docs = docs;
  }, [store, docs]);
  useLayoutEffect(() => {
    if (store.current === resolver) return;
    // The store lives outside React's state; its listeners are told after the change
    // eslint-disable-next-line react-hooks/immutability
    store.current = resolver;
    store.listeners.forEach((l) => l());
  }, [store, resolver]);
  return store;
}

const noSubscription = () => () => {};

/** The workspace's notes, read once (not followed); undefined outside the workspace. */
export function useWorkspaceDocsSnapshot(): () => Document[] | undefined {
  const store = useContext(WikiLinkResolverContext);
  return useCallback(() => store?.docs, [store]);
}

/**
 * The current resolver. With `content`, only while it holds a link: a bullet without one then does not
 * render again when the notes change.
 */
export function useWikiLinkResolver(content?: string): WikiLinkResolver | null {
  const store = useContext(WikiLinkResolverContext);
  const wanted = content === undefined || content.includes('[[');
  return useSyncExternalStore(store ? store.subscribe : noSubscription, () => (store && wanted ? store.current : null));
}

/**
 * The note a link points to among the loaded notes: by id, else by the bullet (in a note whose bullets are
 * here, or as looked up), else by title.
 */
export function findLinkedDoc(docs: Document[], link: WikiLink, blocks: BlockSource = lookedUpBlocks): Document | undefined {
  if (link.docId) return docs.find((d) => d.id === link.docId);
  if (link.blockId) {
    const owner = docs.find((d) => d.blocks?.some((b) => b.id === link.blockId));
    if (owner) return owner;
    const info = blocks.get(link.blockId);
    const found = info ? docs.find((d) => d.id === info.documentId) : undefined;
    if (found) return found;
  }
  const title = link.title.trim().toLowerCase();
  return title ? docs.find((d) => d.title.trim().toLowerCase() === title) : undefined;
}

/**
 * Resolver over the loaded notes. A linked bullet comes from its note when the note's bullets are here, else
 * it is looked up (`blocks`); `_version` only marks a new resolver once a lookup arrived.
 */
export function makeWikiLinkResolver(docs: Document[], blocks: BlockSource = lookedUpBlocks, _version = 0): WikiLinkResolver {
  void _version;
  const byId = new Map(docs.map((d) => [d.id, d]));
  return (link: WikiLink): WikiLinkTarget | null => {
    const doc = link.docId ? byId.get(link.docId) : findLinkedDoc(docs, link, blocks);
    let blockContent: string | undefined;
    if (link.blockId) {
      const local = doc?.blocks?.find((b) => b.id === link.blockId);
      if (local) {
        blockContent = local.content;
      } else if (!doc?.blocks?.length) {
        // The note's bullets are not here (or the note is not known by id): the bullet is looked up
        const info = blocks.get(link.blockId);
        if (info === undefined) blocks.request(link.blockId);
        else if (info && (!doc || info.documentId === doc.id)) blockContent = info.content;
      }
    }
    if (!doc) return null;
    return { title: doc.title, blockContent };
  };
}
