import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import { DocumentBlock } from '../../../lib/types';
import { useCloseOnEscape } from '../../../lib/useDismiss';

// The slash menu is a layer of the dismiss stack: Escape and a press beside it close only the menu, not a
// dialog the note lies in, and the press still reaches its target

const Harness: React.FC<{ initial: DocumentBlock[]; onCloseDialog: () => void }> = ({ initial, onCloseDialog }) => {
  const [blocks, setBlocks] = useState(initial);
  useCloseOnEscape(onCloseDialog);
  return (
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      canEdit
      onUpdateBlock={(b) => setBlocks((p) => p.map((x) => (x.id === b.id ? b : x)))}
      onCreateBlock={(nb) => setBlocks((p) => [...p, nb])}
      onDeleteBlock={(id) => setBlocks((p) => p.filter((x) => x.id !== id))}
      onMoveBlock={() => {}}
    />
  );
};

const mk = (id: string, content: string): DocumentBlock => ({ id, type: 'bullet', content, level: 0, position: 1 });

const openSlash = async () => {
  const ta = screen.getByDisplayValue('Erster') as HTMLTextAreaElement;
  ta.focus();
  await act(async () => {
    fireEvent.change(ta, { target: { value: 'Erster /', selectionStart: 8, selectionEnd: 8 } });
  });
  expect(screen.getByText('Befehl auswählen')).toBeTruthy();
  return ta;
};

describe('slash menu as a layer', () => {
  it('Escape closes only the menu, not the dialog below', async () => {
    const onClose = vi.fn();
    render(<Harness initial={[mk('a', 'Erster'), mk('b', 'Zweiter')]} onCloseDialog={onClose} />);
    const ta = await openSlash();
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(screen.queryByText('Befehl auswählen')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // The next Escape reaches the dialog
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a press in another bullet closes the menu and still reaches that bullet', async () => {
    const onClose = vi.fn();
    render(<Harness initial={[mk('a', 'Erster'), mk('b', 'Zweiter')]} onCloseDialog={onClose} />);
    await openSlash();
    const other = screen.getByDisplayValue('Zweiter');
    const reached = vi.fn();
    other.addEventListener('mousedown', reached);
    await act(async () => {
      fireEvent.mouseDown(other);
    });
    expect(screen.queryByText('Befehl auswählen')).toBeNull();
    expect(reached).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a press inside the menu keeps it open', async () => {
    render(<Harness initial={[mk('a', 'Erster')]} onCloseDialog={() => {}} />);
    await openSlash();
    await act(async () => {
      fireEvent.mouseDown(screen.getByText('Befehl auswählen'));
    });
    expect(screen.getByText('Befehl auswählen')).toBeTruthy();
  });

  it('Escape ends a selection over several bullets, not the dialog below', async () => {
    const onClose = vi.fn();
    render(<Harness initial={[mk('a', 'Erster'), mk('b', 'Zweiter')]} onCloseDialog={onClose} />);
    const ta = screen.getByDisplayValue('Erster') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    // Ctrl+A with the bullet's text selected already: the whole note
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'a', ctrlKey: true });
    });
    const escape = () => fireEvent.keyDown(document.activeElement ?? ta, { key: 'Escape' });
    await act(async () => {
      escape();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      escape();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('Erster')).toBeTruthy();
    expect(screen.getByDisplayValue('Zweiter')).toBeTruthy();
  });
});
