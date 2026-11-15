import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TableBlock } from '../TableBlock';
import { OUTLINE_CLIPBOARD_TYPE } from '../../../lib/outlineMarkdown';

function renderTable(content: string) {
  const changes: string[] = [];
  const utils = render(
    <TableBlock
      blockId="t1"
      content={content}
      canEdit
      canFocus
      rootRef={{ current: null }}
      textareaRef={{ current: null }}
      registerTextareaRef={() => {}}
      inline={{}}
      onChange={(next) => changes.push(next)}
      onChangeLines={() => {}}
      onFocusIn={() => {}}
      onFocusOut={() => {}}
      onLeave={() => {}}
      onDelete={() => {}}
      onHistory={() => {}}
    />
  );
  const cells = Array.from(utils.container.querySelectorAll('textarea[data-table-cell]')) as HTMLTextAreaElement[];
  return { ...utils, changes, cells };
}

const clipboard = (data: Record<string, string>) => ({
  getData: (type: string) => data[type === 'text' ? 'text/plain' : type] || '',
});

describe('TableBlock paste', () => {
  const table = '| Name | Wert |\n| --- | --- |\n| a | b |';

  it('pastes copied bullets with their hidden values as references, like a bullet', () => {
    const { cells, changes } = renderTable(table);
    const cell = cells[2]; // row 1, column 1
    cell.focus();
    fireEvent.paste(cell, {
      clipboardData: clipboard({ 'text/plain': '- PIN ••••\n- Port 22', [OUTLINE_CLIPBOARD_TYPE]: '- PIN {{secret:abc}}\n- Port 22' }),
    });
    const last = changes[changes.length - 1];
    expect(last).toContain('{{secret:abc}}');
    expect(last).not.toContain('••••');
  });

  it('pastes one copied bullet with a hidden value into the cell at the cursor', () => {
    const { cells, changes } = renderTable(table);
    const cell = cells[3];
    cell.focus();
    cell.setSelectionRange(1, 1);
    fireEvent.paste(cell, { clipboardData: clipboard({ 'text/plain': 'PIN ••••', [OUTLINE_CLIPBOARD_TYPE]: 'PIN {{secret:abc}}' }) });
    expect(changes[changes.length - 1]).toContain('| a | bPIN {{secret:abc}} |');
  });
});
