import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { findLinkedDoc, makeWikiLinkResolver, useWikiLinkResolver, useWikiLinkStore, WikiLinkResolverContext } from '../wikiLinkResolver';
import { parseWikiLink } from '../wikiLink';
import type { BlockInfo, Document } from '../types';

const note = (title: string) => ({ id: 'doc_target', title, blocks: [] }) as unknown as Document;

const renders: Record<string, number> = {};

// A bullet: shows what its link points at and counts its renders
const Bullet = React.memo(({ name, content }: { name: string; content: string }) => {
  // Counts renders on purpose
  // eslint-disable-next-line react-hooks/immutability
  renders[name] = (renders[name] || 0) + 1;
  const resolve = useWikiLinkResolver(content);
  return <span data-testid={name}>{resolve?.(parseWikiLink('Ziel#doc_target'))?.title ?? '-'}</span>;
});

const Workspace = ({ docs }: { docs: Document[] }) => (
  <WikiLinkResolverContext.Provider value={useWikiLinkStore(docs)}>
    <Bullet name="linked" content="Siehe [[Ziel#doc_target]]" />
    <Bullet name="plain" content="Ohne Link" />
  </WikiLinkResolverContext.Provider>
);

describe('useWikiLinkResolver', () => {
  it('renders a bullet with a link again when the notes change, one without a link not', () => {
    const { getByTestId, rerender } = render(<Workspace docs={[note('Ziel')]} />);
    expect(getByTestId('linked').textContent).toBe('Ziel');
    expect(getByTestId('plain').textContent).toBe('-');
    const before = { ...renders };

    act(() => rerender(<Workspace docs={[note('Neuer Titel')]} />));
    expect(getByTestId('linked').textContent).toBe('Neuer Titel');
    expect(renders.linked).toBeGreaterThan(before.linked);
    expect(renders.plain).toBe(before.plain);
  });

  it('looks up a linked bullet whose note has no bullets here (note list) and shows it once known', () => {
    const known = new Map<string, BlockInfo | null>();
    const request = vi.fn();
    const source = { get: (id: string) => known.get(id), request };
    const listed = { id: 'doc_target', title: 'Ziel', blocks: [] } as unknown as Document;
    const link = parseWikiLink('Ziel#doc_target^blk_1');
    expect(makeWikiLinkResolver([listed], source)(link)).toEqual({ title: 'Ziel', blockContent: undefined });
    expect(request).toHaveBeenCalledWith('blk_1');

    known.set('blk_1', { documentId: 'doc_target', content: 'Die Zeile', type: 'text' });
    request.mockClear();
    expect(makeWikiLinkResolver([listed], source)(link)).toEqual({ title: 'Ziel', blockContent: 'Die Zeile' });
    expect(request).not.toHaveBeenCalled();

    // A note whose bullets are here: its own text, nothing looked up (also not for a bullet that is gone)
    const loaded = { ...listed, blocks: [{ id: 'blk_1', type: 'text', content: 'Getippt' }] } as unknown as Document;
    expect(makeWikiLinkResolver([loaded], source)(link)?.blockContent).toBe('Getippt');
    expect(makeWikiLinkResolver([loaded], source)(parseWikiLink('Ziel#doc_target^blk_weg'))?.blockContent).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('finds the note of an older link to a bullet (no note id) by the looked-up bullet', () => {
    const known = new Map<string, BlockInfo | null>([['blk_2', { documentId: 'doc_b', content: 'Zeile in B', type: 'todo' }]]);
    const source = { get: (id: string) => known.get(id), request: vi.fn() };
    const docs = [
      { id: 'doc_a', title: 'Alter Titel', blocks: [] },
      { id: 'doc_b', title: 'B', blocks: [] },
    ] as unknown as Document[];
    const link = parseWikiLink('Alter Titel#^blk_2');
    expect(findLinkedDoc(docs, link, source)?.id).toBe('doc_b');
    expect(makeWikiLinkResolver(docs, source)(link)).toEqual({ title: 'B', blockContent: 'Zeile in B' });
    // Not known yet: by title, and the bullet is asked for
    const unknown = parseWikiLink('Alter Titel#^blk_3');
    expect(findLinkedDoc(docs, unknown, source)?.id).toBe('doc_a');
    makeWikiLinkResolver(docs, source)(unknown);
    expect(source.request).toHaveBeenCalledWith('blk_3');
  });

  it('gives no resolver outside the workspace', () => {
    const { getByTestId } = render(<Bullet name="public" content="[[Ziel#doc_target]]" />);
    expect(getByTestId('public').textContent).toBe('-');
  });
});
