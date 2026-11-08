import { createContext, useContext } from 'react';
import { Document } from './types';
import { WikiLink, WikiLinkResolver, WikiLinkTarget } from './wikiLink';

// Resolves links in the notes to what they point at right now (current title, the linked bullet's text).
// The workspace provides it from the notes it has loaded; without it (public page) links show the title
// stored in them.
export const WikiLinkResolverContext = createContext<WikiLinkResolver | null>(null);

export const useWikiLinkResolver = () => useContext(WikiLinkResolverContext);

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
