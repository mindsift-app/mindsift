import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OutlinerBlock, mapRenderedOffsetToRaw } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';

describe('mapRenderedOffsetToRaw', () => {
  it('is the identity for plain text', () => {
    expect(mapRenderedOffsetToRaw('Hallo Welt', 'Hallo Welt', 4)).toBe(4);
  });
  it('skips bold markers', () => {
    expect(mapRenderedOffsetToRaw('Hallo **Welt** du', 'Hallo Welt du', 8)).toBe(10);
  });
  it('maps behind closing markers', () => {
    expect(mapRenderedOffsetToRaw('a **b** c', 'a b c', 4)).toBe(8);
  });
  it('maps into a link label', () => {
    expect(mapRenderedOffsetToRaw('x [Seite](https://a.de) y', 'x Seite y', 4)).toBe(5);
  });
  it('handles the empty placeholder', () => {
    expect(mapRenderedOffsetToRaw('', '​', 1)).toBe(0);
  });
});

describe('clicking into an unfocused bullet', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
  });

  it('places the caret at the click position instead of the end', () => {
    const block = { id: 'b1', type: 'bullet', content: 'Hallo **Welt** du', level: 0, position: 1 } as DocumentBlock;
    const { container } = render(
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
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    const strong = container.querySelector('strong') as HTMLElement; // rendered "Welt"
    // jsdom has no layout: pretend the click hit between "We" and "lt"
    document.caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(strong.firstChild!, 2);
      return r;
    };

    fireEvent.click(strong);

    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(10); // "Hallo **We|lt** du"
  });
});

function renderBlock(block: DocumentBlock, extra: Record<string, unknown> = {}) {
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
      {...extra}
    />
  );
}

describe('undo shortcut', () => {
  it('saves pending typing first, then undoes', () => {
    const calls: string[] = [];
    const block = { id: 'b1', type: 'bullet', content: 'Alt', level: 0 } as DocumentBlock;
    const { container } = renderBlock(block, {
      onUpdateBlock: (b: DocumentBlock) => calls.push(`update:${b.content}`),
      onUndo: () => calls.push('undo'),
      onRedo: () => calls.push('redo'),
    });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();
    fireEvent.change(ta, { target: { value: 'Alt neu' } });
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(ta, { key: 'y', metaKey: true });
    expect(calls).toEqual(['update:Alt neu', 'undo', 'redo', 'redo']);
  });
});

describe('a bullet someone else is editing', () => {
  const lock = { name: 'Ben', userId: 'u2' };
  const element = (content: string, props: Record<string, unknown>) => (
    <OutlinerBlock
      docId="d"
      block={{ id: 'b1', type: 'bullet', content, level: 0 } as DocumentBlock}
      isLast
      maxAllowedLevel={1}
      hasChildren={false}
      isFocused={false}
      onCreateBlockBelow={() => {}}
      onDeleteBlock={() => {}}
      onIndentBlock={() => {}}
      onNavigateFocus={() => {}}
      registerTextareaRef={() => {}}
      canEdit={false}
      onUpdateBlock={() => {}}
      {...props}
    />
  );

  it('shows the other text with the cursor inside and sends nothing on leaving', () => {
    const onUpdate = vi.fn();
    const props = { lockedBy: lock, canAppendBelow: true, onUpdateBlock: onUpdate };
    const { container, rerender } = render(element('Start', props));
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();
    fireEvent.focus(ta);
    rerender(element('Ben tippt', props));
    expect(ta.value).toBe('Ben tippt');
    fireEvent.blur(ta);
    ta.blur();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps and sends text the user typed before the bullet got locked', () => {
    const onUpdate = vi.fn();
    const { container, rerender } = render(element('Start', { canEdit: true, onUpdateBlock: onUpdate }));
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();
    fireEvent.focus(ta);
    fireEvent.change(ta, { target: { value: 'Start + eigener Text' } });
    // Ben's text and lock arrive
    rerender(element('Ben tippt', { canEdit: false, lockedBy: lock, canAppendBelow: true, onUpdateBlock: onUpdate }));
    expect(ta.value).toBe('Start + eigener Text');
    fireEvent.blur(ta);
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Start + eigener Text' }), true);
  });
});

describe('conflict copies', () => {
  it('show who lost and offer to replace, keep both or discard', () => {
    const onResolve = vi.fn();
    const block = { id: 'cf', type: 'bullet', content: 'Meine Version', level: 0, conflictOf: 'b1', conflictAuthor: 'Ben' } as DocumentBlock;
    const { getByText } = renderBlock(block, { onResolveConflict: onResolve });
    expect(getByText(/Version von Ben/)).toBeTruthy();
    fireEvent.click(getByText('Übernehmen'));
    fireEvent.click(getByText('Beide behalten'));
    fireEvent.click(getByText('Verwerfen'));
    expect(onResolve.mock.calls).toEqual([
      ['cf', 'take'],
      ['cf', 'keep'],
      ['cf', 'drop'],
    ]);
  });

  it('say why replacing waits while someone edits the original', () => {
    const onResolve = vi.fn();
    const block = { id: 'cf', type: 'bullet', content: 'Meine Version', level: 0, conflictOf: 'b1', conflictAuthor: 'Ben' } as DocumentBlock;
    const { getByText } = renderBlock(block, { onResolveConflict: onResolve, originalLockedBy: { userId: 'u2', name: 'Anna' } });
    const take = getByText('Übernehmen').closest('button')!;
    expect(take.disabled).toBe(true);
    expect(take.title).toMatch(/Anna bearbeitet gerade den ursprünglichen Punkt/);
    expect(getByText(/Anna bearbeitet gerade den ursprünglichen Punkt/, { selector: 'p' })).toBeTruthy();
    fireEvent.click(take);
    fireEvent.click(getByText('Beide behalten'));
    expect(onResolve.mock.calls).toEqual([['cf', 'keep']]);
  });
});

describe('slash command menu and outliner fixes', () => {
  it('does not open the slash menu for URLs like https://a.de/b/ but opens for Text /co and closes on Escape or Backspace', () => {
    const block = { id: 'b1', type: 'bullet', content: '', level: 0 } as DocumentBlock;
    const { container, queryByText } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    fireEvent.change(ta, { target: { value: 'https://a.de/b/' } });
    expect(queryByText('Befehl auswählen')).toBeNull();

    fireEvent.change(ta, { target: { value: 'Text /ca' } });
    expect(queryByText('Befehl auswählen')).toBeTruthy();
    expect(queryByText('/callout')).toBeTruthy();

    // Removing the slash closes the menu
    fireEvent.change(ta, { target: { value: 'Text ' } });
    expect(queryByText('Befehl auswählen')).toBeNull();

    // Even when no command matches, Escape closes the menu
    fireEvent.change(ta, { target: { value: '/zzzznotfound' } });
    expect(queryByText('Kein Befehl gefunden')).toBeTruthy();
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(queryByText('Befehl auswählen')).toBeNull();
  });

  it('scrolls the active slash command button into view on ArrowDown', () => {
    const scrollSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    const block = { id: 'b1', type: 'bullet', content: '', level: 0 } as DocumentBlock;
    const { container } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    fireEvent.change(ta, { target: { value: '/' } });
    scrollSpy.mockClear();
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('creates a new block on Enter at the last empty top-level bullet, after outdenting if indented', () => {
    const onIndent = vi.fn();
    const onCreateBelow = vi.fn();
    const indented = { id: 'b1', type: 'bullet', content: '', level: 1 } as DocumentBlock;
    const { container, rerender } = render(
      <OutlinerBlock
        docId="d"
        block={indented}
        isLast
        maxAllowedLevel={2}
        hasChildren={false}
        isFocused
        canEdit
        onUpdateBlock={() => {}}
        onCreateBlockBelow={onCreateBelow}
        onDeleteBlock={() => {}}
        onIndentBlock={onIndent}
        onNavigateFocus={() => {}}
        registerTextareaRef={() => {}}
      />
    );
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onIndent).toHaveBeenCalledWith('b1', -1);
    expect(onCreateBelow).not.toHaveBeenCalled();

    rerender(
      <OutlinerBlock
        docId="d"
        block={{ ...indented, level: 0 }}
        isLast
        maxAllowedLevel={1}
        hasChildren={false}
        isFocused
        canEdit
        onUpdateBlock={() => {}}
        onCreateBlockBelow={onCreateBelow}
        onDeleteBlock={() => {}}
        onIndentBlock={onIndent}
        onNavigateFocus={() => {}}
        registerTextareaRef={() => {}}
      />
    );
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onCreateBelow).toHaveBeenCalledWith('b1', '');
  });

  it('lists commands whose name starts with the typed text first (/li → /link before /number)', () => {
    const block = { id: 'b1', type: 'bullet', content: '', level: 0 } as DocumentBlock;
    const { container } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '/li', selectionStart: 3, selectionEnd: 3 } });
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent || '').filter((t) => t.startsWith('/'));
    expect(labels[0]).toMatch(/^\/link/);
    expect(labels.findIndex((l) => l.startsWith('/number'))).toBeGreaterThan(0);
  });

  it('keeps an empty indented bullet on its level when another bullet on that level follows', () => {
    const onIndent = vi.fn();
    const onCreateBelow = vi.fn();
    const { container } = render(
      <OutlinerBlock
        docId="d"
        block={{ id: 'b1', type: 'bullet', content: '', level: 1 } as DocumentBlock}
        isLast={false}
        siblingFollows
        maxAllowedLevel={2}
        hasChildren={false}
        isFocused
        canEdit
        onUpdateBlock={() => {}}
        onCreateBlockBelow={onCreateBelow}
        onDeleteBlock={() => {}}
        onIndentBlock={onIndent}
        onNavigateFocus={() => {}}
        registerTextareaRef={() => {}}
      />
    );
    fireEvent.keyDown(container.querySelector('textarea') as HTMLTextAreaElement, { key: 'Enter' });
    expect(onIndent).not.toHaveBeenCalled();
    expect(onCreateBelow).toHaveBeenCalledWith('b1', '');
  });

  it('inserts a bare URL for /link with a web address in an empty bullet, and [Text](url) otherwise', () => {
    const updates: DocumentBlock[] = [];
    const block = { id: 'b1', type: 'bullet', content: '', level: 0 } as DocumentBlock;
    const { container, getByText, getByRole, getByPlaceholderText, rerender } = renderBlock(block, {
      onUpdateBlock: (u: DocumentBlock) => updates.push(u),
    });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    fireEvent.change(ta, { target: { value: '/link' } });
    fireEvent.keyDown(ta, { key: 'Enter' });

    fireEvent.click(getByText('Web-Link'));
    fireEvent.change(getByPlaceholderText('https://example.com'), { target: { value: 'https://example.com/test' } });
    fireEvent.click(getByRole('button', { name: 'Link einfügen' }));

    expect(updates[updates.length - 1]?.content).toBe('https://example.com/test');

    // Non-empty bullet keeps [Text](url)
    rerender(
      <OutlinerBlock
        docId="d"
        block={{ ...block, content: 'Siehe' }}
        isLast
        maxAllowedLevel={1}
        hasChildren={false}
        isFocused={false}
        canEdit
        onUpdateBlock={(u: DocumentBlock) => updates.push(u)}
        onCreateBlockBelow={() => {}}
        onDeleteBlock={() => {}}
        onIndentBlock={() => {}}
        onNavigateFocus={() => {}}
        registerTextareaRef={() => {}}
      />
    );
    ta.focus();
    fireEvent.change(ta, { target: { value: 'Siehe /link' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    fireEvent.click(getByText('Web-Link'));
    fireEvent.change(getByPlaceholderText('z. B. MindSift Dokumentation'), { target: { value: 'Doku' } });
    fireEvent.change(getByPlaceholderText('https://example.com'), { target: { value: 'https://example.com/doku' } });
    fireEvent.click(getByRole('button', { name: 'Link einfügen' }));

    expect(updates[updates.length - 1]?.content).toBe('Siehe [Doku](https://example.com/doku)');
  });
});

describe('formatting shortcuts (Teil C)', () => {
  it('toggles bold with and without selection (Ctrl+B and Cmd+B)', () => {
    const block = { id: 'b1', type: 'bullet', content: 'hallo welt', level: 0 } as DocumentBlock;
    const { container } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    // 1. With selection: wraps in **
    ta.setSelectionRange(6, 10); // "welt"
    const event1 = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(event1);
    expect(event1.defaultPrevented).toBe(true);
    expect(ta.value).toBe('hallo **welt**');
    expect(ta.selectionStart).toBe(8);
    expect(ta.selectionEnd).toBe(12);

    // 2. With selection where delimiters are directly outside: unwraps **
    const event2 = new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(event2);
    expect(event2.defaultPrevented).toBe(true);
    expect(ta.value).toBe('hallo welt');
    expect(ta.selectionStart).toBe(6);
    expect(ta.selectionEnd).toBe(10);

    // 3. With selection including delimiters: unwraps **
    ta.value = 'hallo **welt**';
    ta.setSelectionRange(6, 14); // "**welt**"
    const event3 = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(event3);
    expect(ta.value).toBe('hallo welt');
    expect(ta.selectionStart).toBe(6);
    expect(ta.selectionEnd).toBe(10);

    // 4. Without selection: inserts **** and places cursor between
    ta.value = 'start';
    ta.setSelectionRange(5, 5);
    const event4 = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(event4);
    expect(ta.value).toBe('start****');
    expect(ta.selectionStart).toBe(7);
    expect(ta.selectionEnd).toBe(7);
  });

  it('toggles italic with and without selection (Ctrl+I)', () => {
    const block = { id: 'b1', type: 'bullet', content: 'hallo welt', level: 0 } as DocumentBlock;
    const { container } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    // 1. With selection: wraps in *
    ta.setSelectionRange(6, 10); // "welt"
    fireEvent.keyDown(ta, { key: 'i', ctrlKey: true });
    expect(ta.value).toBe('hallo *welt*');
    expect(ta.selectionStart).toBe(7);
    expect(ta.selectionEnd).toBe(11);

    // 2. Toggles off when already italic
    fireEvent.keyDown(ta, { key: 'i', ctrlKey: true });
    expect(ta.value).toBe('hallo welt');
    expect(ta.selectionStart).toBe(6);
    expect(ta.selectionEnd).toBe(10);

    // 3. Without selection: inserts ** and places cursor between
    fireEvent.change(ta, { target: { value: 'a' } });
    ta.setSelectionRange(1, 1);
    fireEvent.keyDown(ta, { key: 'i', ctrlKey: true });
    expect(ta.value).toBe('a**');
    expect(ta.selectionStart).toBe(2);
    expect(ta.selectionEnd).toBe(2);
  });

  it('handles Ctrl+L: opens the link dialog, the marked text becomes the link text', () => {
    const block = { id: 'b1', type: 'bullet', content: 'besuche mindsift heute', level: 0 } as DocumentBlock;
    const { container, queryByText, getByDisplayValue } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    // 1. Without selection: opens LinkModal
    ta.setSelectionRange(0, 0);
    expect(queryByText('Link einfügen')).toBeNull();
    fireEvent.keyDown(ta, { key: 'l', ctrlKey: true });
    expect(queryByText('Link einfügen')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByText('Link einfügen')).toBeNull();

    // 2. With selection: the dialog opens, the marked text is the title of a web link
    ta.setSelectionRange(8, 16); // "mindsift"
    // fireEvent returns false when the key was handled (default prevented)
    expect(fireEvent.keyDown(ta, { key: 'l', ctrlKey: true })).toBe(false);
    expect(queryByText('Link einfügen')).toBeTruthy();
    fireEvent.click(queryByText('Web-Link') as HTMLElement);
    expect(getByDisplayValue('mindsift')).toBeTruthy();
  });

  it('does nothing in code blocks or for read-only readers', () => {
    // In code block
    const codeBlock = { id: 'c1', type: 'code', content: 'const x = 1;', level: 0 } as DocumentBlock;
    const codeView = renderBlock(codeBlock);
    const codeTa = codeView.container.querySelector('textarea') as HTMLTextAreaElement;
    codeTa.focus();
    codeTa.setSelectionRange(6, 7); // "x"
    const codeEvent = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    codeTa.dispatchEvent(codeEvent);
    expect(codeEvent.defaultPrevented).toBe(false);
    expect(codeTa.value).toBe('const x = 1;');

    // For readers (!canEdit)
    const bulletBlock = { id: 'b1', type: 'bullet', content: 'text', level: 0 } as DocumentBlock;
    const readerView = renderBlock(bulletBlock, { canEdit: false });
    const readerTa = readerView.container.querySelector('textarea') as HTMLTextAreaElement;
    readerTa.focus();
    readerTa.setSelectionRange(0, 4);
    const readerEvent = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    readerTa.dispatchEvent(readerEvent);
    expect(readerEvent.defaultPrevented).toBe(false);
    expect(readerTa.value).toBe('text');
  });
});

describe('outliner polish (Teil A)', () => {
  it('opens slash menu at cursor position in the middle of text and inserts link at cursor', () => {
    const updates: DocumentBlock[] = [];
    const block = { id: 'b1', type: 'bullet', content: 'Vorher Nachher', level: 0 } as DocumentBlock;
    const { container, queryByText, getByText, getByPlaceholderText, getByRole } = renderBlock(block, {
      onUpdateBlock: (u: DocumentBlock) => updates.push(u),
    });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    // Type "/link" in the middle of the text (selectionStart at 12, right after "/link")
    fireEvent.change(ta, { target: { value: 'Vorher /link Nachher', selectionStart: 12, selectionEnd: 12 } });

    // Menu should be open with /link, but without /divider or /h1
    expect(queryByText('Befehl auswählen')).toBeTruthy();
    expect(queryByText('/link')).toBeTruthy();
    expect(queryByText('/divider')).toBeNull();
    expect(queryByText('/h1')).toBeNull();

    // Select /link by pressing Enter
    fireEvent.keyDown(ta, { key: 'Enter' });

    // Link modal opens
    expect(queryByText('Web-Link')).toBeTruthy();
    fireEvent.click(getByText('Web-Link'));
    fireEvent.change(getByPlaceholderText('z. B. MindSift Dokumentation'), { target: { value: 'Doku' } });
    fireEvent.change(getByPlaceholderText('https://example.com'), { target: { value: 'https://example.com/test' } });
    fireEvent.click(getByRole('button', { name: 'Link einfügen' }));

    // Result has link inserted in the middle
    expect(updates[updates.length - 1]?.content).toBe('Vorher [Doku](https://example.com/test) Nachher');
  });

  it('does not offer /divider at end of text, but offers it in empty block', () => {
    const block = { id: 'b1', type: 'bullet', content: 'Ein Text', level: 0 } as DocumentBlock;
    const { container, queryByText } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    // At end of non-empty text
    fireEvent.change(ta, { target: { value: 'Ein Text /div' } });

    expect(queryByText('Befehl auswählen')).toBeTruthy();
    expect(queryByText('/divider')).toBeNull();

    // In an empty block
    fireEvent.change(ta, { target: { value: '/div' } });

    expect(queryByText('Befehl auswählen')).toBeTruthy();
    expect(queryByText('/divider')).toBeTruthy();
  });

  it('converts H1 block back to bullet via /text slash command', () => {
    const updates: DocumentBlock[] = [];
    const block = { id: 'b1', type: 'h1', content: 'Meine Überschrift', level: 0 } as DocumentBlock;
    const { container, queryByText } = renderBlock(block, {
      onUpdateBlock: (u: DocumentBlock) => updates.push(u),
    });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    fireEvent.change(ta, { target: { value: 'Meine Überschrift /text' } });

    expect(queryByText('Befehl auswählen')).toBeTruthy();
    expect(queryByText('/text')).toBeTruthy();

    fireEvent.keyDown(ta, { key: 'Enter' });

    const last = updates[updates.length - 1];
    expect(last?.type).toBe('bullet');
    expect(last?.content).toBe('Meine Überschrift');
  });

  it('closes slash menu on mousedown outside', () => {
    const block = { id: 'b1', type: 'bullet', content: '', level: 0 } as DocumentBlock;
    const { container, queryByText } = renderBlock(block);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    fireEvent.change(ta, { target: { value: '/' } });
    expect(queryByText('Befehl auswählen')).toBeTruthy();

    // Click outside on document body
    fireEvent.mouseDown(document.body);
    expect(queryByText('Befehl auswählen')).toBeNull();
  });

  it('converts focused divider to empty bullet on Backspace', () => {
    const updates: DocumentBlock[] = [];
    const block = { id: 'd1', type: 'divider', content: '', level: 0 } as DocumentBlock;
    const { container } = renderBlock(block, {
      onUpdateBlock: (u: DocumentBlock) => updates.push(u),
    });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();

    fireEvent.keyDown(ta, { key: 'Backspace' });
    const last = updates[updates.length - 1];
    expect(last?.type).toBe('bullet');
    expect(last?.content).toBe('');
  });
});
