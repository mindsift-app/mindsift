import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { OutlinerBlock } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';
import { setServerLinkPreviews } from '../../../lib/linkPreview';

function renderBlock(content: string) {
  const block = { id: 'b1', type: 'bullet', content, level: 0, position: 1 } as DocumentBlock;
  return render(
    <OutlinerBlock
      docId="d"
      block={block}
      isLast
      maxAllowedLevel={1}
      hasChildren={false}
      isFocused={false}
      canEdit
      onUpdateBlock={() => {}}
      onCreateBlockBelow={() => {}}
      onDeleteBlock={() => {}}
      onIndentBlock={() => {}}
      onNavigateFocus={() => {}}
      registerTextareaRef={() => {}}
    />
  );
}

function previewAnswer(url: string, title: string) {
  return new Response(
    JSON.stringify({ key: 'k-' + title, url, title, description: 'Schwäbisch', siteName: 'koch.de', hasImage: false, hasIcon: false, ok: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('preview card of a web address when the server switched link previews off', () => {
  afterEach(() => {
    setServerLinkPreviews(true);
    vi.unstubAllGlobals();
  });

  it('shows the card while previews are on and drops it when the server turns them off', async () => {
    const url = 'https://koch.de/kaesespaetzle';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(previewAnswer(url, 'Käsespätzle')));
    const view = renderBlock(url);
    await view.findByText('Käsespätzle');
    act(() => setServerLinkPreviews(false));
    await waitFor(() => expect(view.queryByText('Käsespätzle')).toBeNull());
  });

  it('asks the server for nothing while previews are off', async () => {
    setServerLinkPreviews(false);
    const fetchMock = vi.fn().mockResolvedValue(previewAnswer('https://koch.de/maultaschen', 'Maultaschen'));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderBlock('https://koch.de/maultaschen');
    await new Promise((r) => setTimeout(r, 20));
    expect(view.queryByText('Maultaschen')).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/link-preview'))).toBe(false);
  });
});
