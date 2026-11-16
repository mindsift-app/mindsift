import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableBlock } from '../TableBlock';

const renderTable = (props: { canEdit: boolean; locked?: boolean }) =>
  render(
    <TableBlock
      blockId="t1"
      content={'| Zutat | Menge |\n| --- | --- |\n| Mehl | 500 g |'}
      canFocus
      rootRef={{ current: null }}
      textareaRef={{ current: null }}
      registerTextareaRef={() => {}}
      inline={{}}
      onChange={() => {}}
      onChangeLines={() => {}}
      onFocusIn={() => {}}
      onFocusOut={() => {}}
      onLeave={() => {}}
      onDelete={() => {}}
      onHistory={() => {}}
      {...props}
    />
  );

describe('Tabelle, die jemand anderes bearbeitet', () => {
  it('+ und ⋯ bleiben ausgegraut an ihrem Platz, damit die Tabelle nicht breiter wird', () => {
    renderTable({ canEdit: false, locked: true });
    expect((screen.getByRole('button', { name: 'Spalte hinzufügen' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Tabelle: Linien und Spalten' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('nur lesbar ohne Sperre: keine Knöpfe', () => {
    renderTable({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'Spalte hinzufügen' })).toBeNull();
  });

  it('bearbeitbar: Knöpfe aktiv', () => {
    renderTable({ canEdit: true });
    expect((screen.getByRole('button', { name: 'Spalte hinzufügen' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
