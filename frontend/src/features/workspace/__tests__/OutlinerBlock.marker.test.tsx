import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OutlinerBlock } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';

function renderBlock(block: DocumentBlock, hasChildren: boolean, listMarker?: string) {
  return render(
    <OutlinerBlock
      docId="d"
      block={block}
      isLast
      maxAllowedLevel={1}
      hasChildren={hasChildren}
      isFocused={false}
      canEdit
      listMarker={listMarker}
      onUpdateBlock={() => {}}
      onCreateBlockBelow={() => {}}
      onDeleteBlock={() => {}}
      onIndentBlock={() => {}}
      onNavigateFocus={() => {}}
      registerTextareaRef={() => {}}
    />
  );
}

const numbered = (collapsed: boolean) =>
  ({ id: 'n1', type: 'numbered', content: 'Erster Schritt', level: 0, position: 1, collapsed }) as DocumentBlock;

describe('marker of a collapsed row with children', () => {
  it('highlights the number like the dot of a bullet', () => {
    const { getByText } = renderBlock(numbered(true), true, '1.');
    const marker = getByText('1.');
    expect(marker.className).toContain('text-accent');
    expect(marker.className).toContain('bg-accent/15');
    expect(marker.className).toContain('ring-accent/30');
    expect(marker.className).toContain('rounded-btn');
    expect(marker.className).not.toContain('text-muted');
  });

  it('keeps the number plain when expanded or without children', () => {
    for (const [collapsed, hasChildren] of [
      [false, true],
      [true, false],
    ]) {
      const { getByText, unmount } = renderBlock(numbered(collapsed), hasChildren, '2.');
      const marker = getByText('2.');
      expect(marker.className).toContain('text-muted');
      expect(marker.className).not.toContain('bg-accent/15');
      unmount();
    }
  });

  it('rings the icons of warnings and errors', () => {
    for (const type of ['warning', 'error'] as const) {
      const block = { id: type, type, content: 'Achtung', level: 0, position: 1, collapsed: true } as DocumentBlock;
      const { container, unmount } = renderBlock(block, true);
      const icon = container.querySelector('button[draggable] svg') as SVGElement;
      expect(icon.getAttribute('class')).toContain('ring-accent/30');
      unmount();
      const open = renderBlock({ ...block, collapsed: false }, true);
      expect((open.container.querySelector('button[draggable] svg') as SVGElement).getAttribute('class')).not.toContain('ring-accent/30');
      open.unmount();
    }
  });
});
