import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TableBlock } from '../TableBlock';

function renderTable(content: string, onExitBelow: () => void) {
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
      onExitBelow={onExitBelow}
      onHistory={() => {}}
    />
  );
  const cells = Array.from(utils.container.querySelectorAll('textarea[data-table-cell]')) as HTMLTextAreaElement[];
  return { ...utils, changes, cells };
}

describe('TableBlock Enter', () => {
  it('adds a row below a row with text', () => {
    const exit = vi.fn();
    const { cells, changes } = renderTable('| Name | Wert |\n| --- | --- |\n| a | b |', exit);
    fireEvent.keyDown(cells[3], { key: 'Enter' });
    expect(exit).not.toHaveBeenCalled();
    expect(changes[changes.length - 1].trim().split('\n')).toHaveLength(4);
  });

  it('leaves the table from an empty last row, which goes', () => {
    const exit = vi.fn();
    const { cells, changes } = renderTable('| Name | Wert |\n| --- | --- |\n| a | b |\n|  |  |', exit);
    fireEvent.keyDown(cells[4], { key: 'Enter' });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(changes[changes.length - 1].trim()).toBe('| Name | Wert |\n| --- | --- |\n| a | b |');
  });

  it('keeps the header row even when it is empty', () => {
    const exit = vi.fn();
    const { cells } = renderTable('|  |  |\n| --- | --- |', exit);
    fireEvent.keyDown(cells[0], { key: 'Enter' });
    expect(exit).not.toHaveBeenCalled();
  });
});
