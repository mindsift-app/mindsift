import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { useWikiLinkResolver, useWikiLinkStore, WikiLinkResolverContext } from '../wikiLinkResolver';
import { parseWikiLink } from '../wikiLink';
import type { Document } from '../types';

const note = (title: string) => ({ id: 'doc_target', title, blocks: [] }) as unknown as Document;

const renders: Record<string, number> = {};

// A bullet: shows what its link points at and counts its renders
const Bullet = React.memo(({ name, content }: { name: string; content: string }) => {
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

  it('gives no resolver outside the workspace', () => {
    const { getByTestId } = render(<Bullet name="public" content="[[Ziel#doc_target]]" />);
    expect(getByTestId('public').textContent).toBe('-');
  });
});
