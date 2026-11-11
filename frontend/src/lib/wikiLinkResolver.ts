import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Document } from './types';
import { WikiLink, WikiLinkResolver, WikiLinkTarget } from './wikiLink';

// Resolves links in the notes to what they point at right now (current title, the linked bullet's text).
// The workspace provides it from the notes it has loaded; without it (public page) links show the title
// stored in them. A store rather than the resolver itself: the notes change with every typing pause, and a
// new context value would render every bullet of the open note again.
export interface WikiLinkStore {
  current: WikiLinkResolver;
  subscribe: (onChange: () => void) => () => void;
}

export const WikiLinkResolverContext = createContext<WikiLinkStore | null>(null);

/** The workspace's store; its resolver follows `docs`. */
export function useWikiLinkStore(docs: Document[]): WikiLinkStore {
  const resolver = useMemo(() => makeWikiLinkResolver(docs), [docs]);
  const [store] = useState(() => {
    const listeners = new Set<() => void>();
    return {
      listeners,
      current: resolver,
      subscribe: (onChange: () => void) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    };
  });
  useLayoutEffect(() => {
    if (store.current === resolver) return;
    store.current = resolver;
    store.listeners.forEach((l) => l());
  }, [store, resolver]);
  return store;
}

const noSubscription = () => () => {};

/**
 * The current resolver. With `content`, only while it holds a link: a bullet without one then does not
 * render again when the notes change.
 */
export function useWikiLinkResolver(content?: string): WikiLinkResolver | null {
  const store = useContext(WikiLinkResolverContext);
  const wanted = content === undefined || content.includes('[[');
  return useSyncExternalStore(store ? store.subscribe : noSubscription, () => (store && wanted ? store.current : null));
}

/** The note a link points to among the loaded notes: by id, else by the bullet, else by title. */
export function findLinkedDoc(docs: Document[], link: WikiLink): Document | undefined {
  if (link.docId) return docs.find((d) => d.id === link.docId);
  if (link.blockId) {
    const owner = docs.find((d) => d.blocks?.some((b) => b.id === link.blockId));
    if (owner) return owner;
  }
  const title = link.title.trim().toLowerCase();
  return title ? docs.find((d) => d.title.trim().toLowerCase() === title) : undefined;
}

export function makeWikiLinkResolver(docs: Document[]): WikiLinkResolver {
  const byId = new Map(docs.map((d) => [d.id, d]));
  return (link: WikiLink): WikiLinkTarget | null => {
    const doc = link.docId ? byId.get(link.docId) : findLinkedDoc(docs, link);
    if (!doc) return null;
    const block = link.blockId ? doc.blocks?.find((b) => b.id === link.blockId) : undefined;
    return { title: doc.title, blockContent: block?.content };
  };
}
