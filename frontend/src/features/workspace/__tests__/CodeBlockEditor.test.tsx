import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { CodeBlockEditor, loadPrismLanguage } from '../CodeBlockEditor';
import { OutlinerBlock } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';

function makeCodeBlock(overrides: Partial<DocumentBlock> = {}): DocumentBlock {
  return {
    id: 'code-1',
    type: 'code',
    content: 'name: mindsift\nport: 8080',
    level: 0,
    position: 1000,
    ...overrides,
  };
}

function renderOutlinerCodeBlock(
  initialBlock: DocumentBlock,
  props: Partial<React.ComponentProps<typeof OutlinerBlock>> = {}
) {
  const updates: DocumentBlock[] = [];
  const indentCalls: Array<[string, 1 | -1]> = [];

  const Wrapper: React.FC = () => {
    const [blk, setBlk] = useState<DocumentBlock>(initialBlock);
    return (
      <OutlinerBlock
        docId="doc-1"
        block={blk}
        index={0}
        isLast
        maxAllowedLevel={1}
        hasChildren={false}
        isFocused={false}
        canEdit={props.canEdit ?? true}
        onUpdateBlock={(updated, immediate) => {
          updates.push(updated);
          setBlk(updated);
          props.onUpdateBlock?.(updated, immediate);
        }}
        onCreateBlockBelow={props.onCreateBlockBelow || (() => {})}
        onDeleteBlock={props.onDeleteBlock || (() => {})}
        onIndentBlock={(id, delta) => {
          indentCalls.push([id, delta]);
          props.onIndentBlock?.(id, delta);
        }}
        onNavigateFocus={props.onNavigateFocus || (() => {})}
        registerTextareaRef={props.registerTextareaRef || (() => {})}
      />
    );
  };

  const utils = render(<Wrapper />);
  return { ...utils, updates, indentCalls };
}

describe('CodeBlockEditor', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls update with lang when selecting a language and hides the picker for readers', () => {
    const { container, updates, unmount } = renderOutlinerCodeBlock(makeCodeBlock({ lang: undefined }));

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('');

    fireEvent.change(select, { target: { value: 'yaml' } });
    expect(updates).toHaveLength(1);
    expect(updates[0].lang).toBe('yaml');
    expect(select.value).toBe('yaml');

    unmount();

    // Reader view (!canEdit): shows plain text instead of <select> 
    const readerView = render(
      <CodeBlockEditor block={makeCodeBlock({ lang: 'yaml' })} canEdit={false} />
    );
    expect(readerView.container.querySelector('select')).toBeNull();
    expect(readerView.getByText('yaml')).toBeTruthy();
  });

  it('copies the code content to the clipboard and shows "Kopiert!" for 1.5s', () => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    const block = makeCodeBlock({ content: 'echo "hello world"' });
    render(<CodeBlockEditor block={block} content={block.content} canEdit />);

    const copyBtn = screen.getByRole('button', { name: /Kopieren/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('echo "hello world"');
    expect(screen.getByRole('button', { name: 'Kopiert!' })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.queryByRole('button', { name: 'Kopiert!' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kopieren' })).toBeTruthy();
  });

  it('indents by 2 spaces on Tab and outdents on Shift+Tab without indenting the bullet', () => {
    const { container, updates, indentCalls } = renderOutlinerCodeBlock(
      makeCodeBlock({ content: 'key: value', lang: 'yaml' })
    );
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('  key: value');
    expect(updates[updates.length - 1]?.content).toBe('  key: value');
    expect(indentCalls).toHaveLength(0);

    fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true });
    expect(textarea.value).toBe('key: value');
    expect(updates[updates.length - 1]?.content).toBe('key: value');
    expect(indentCalls).toHaveLength(0);
  });

  it('indents and outdents multiple selected lines on Tab and Shift+Tab', () => {
    const { container } = renderOutlinerCodeBlock(
      makeCodeBlock({ content: 'first: 1\nsecond: 2', lang: 'yaml' })
    );
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);

    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('  first: 1\n  second: 2');

    fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true });
    expect(textarea.value).toBe('first: 1\nsecond: 2');
  });

  it('renders Prism .token spans for yaml and escapes HTML tags like <script>', async () => {
    const code = 'title: "<script>alert(1)</script>"\nenabled: true\ncount: 42';
    const block = makeCodeBlock({ content: code, lang: 'yaml' });
    const { container } = render(<CodeBlockEditor block={block} content={code} canEdit />);

    await waitFor(() => {
      expect(container.querySelectorAll('.token').length).toBeGreaterThan(0);
    });

    const pre = container.querySelector('pre') as HTMLPreElement;
    const codeEl = pre.querySelector('code') as HTMLElement;
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(codeEl.querySelectorAll('.token').length).toBeGreaterThan(0);

    // Ensure no real <script> element was injected into the DOM and raw HTML is escaped
    expect(pre.querySelector('script')).toBeNull();
    expect(codeEl.innerHTML).toContain('&lt;script&gt;');
    expect(pre.textContent).toContain('<script>alert(1)</script>');
  });

  it('loads dependent grammars in the right order (tsx, cpp, php, scala)', async () => {
    expect(await loadPrismLanguage('tsx')).toBe(true);
    expect(await loadPrismLanguage('cpp')).toBe(true);
    expect(await loadPrismLanguage('php')).toBe(true);
    expect(await loadPrismLanguage('scala')).toBe(true);
  });

  it('sets lang directly when typing /code yaml or ```yaml in an empty bullet block', () => {
    const bulletBlock: DocumentBlock = {
      id: 'b-1',
      type: 'bullet',
      content: '',
      level: 0,
      position: 1000,
    };
    const { container, updates } = renderOutlinerCodeBlock(bulletBlock);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: '/code yaml' } });
    expect(updates[updates.length - 1]?.type).toBe('code');
    expect(updates[updates.length - 1]?.lang).toBe('yaml');
    expect(updates[updates.length - 1]?.content).toBe('');

    // Also test ```json shortcut
    const bulletBlock2: DocumentBlock = {
      id: 'b-2',
      type: 'bullet',
      content: '',
      level: 0,
      position: 2000,
    };
    const res2 = renderOutlinerCodeBlock(bulletBlock2);
    const ta2 = res2.container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta2, { target: { value: '```json' } });
    expect(res2.updates[res2.updates.length - 1]?.type).toBe('code');
    expect(res2.updates[res2.updates.length - 1]?.lang).toBe('json');
  });

  it('renders line numbers column with aria-hidden, user-select: none, and correct line count including trailing empty lines and 100+ lines', () => {
    // 1. Single empty line
    const { container, rerender } = render(
      <CodeBlockEditor block={makeCodeBlock({ id: 'code-empty', content: '' })} content="" canEdit />
    );
    const getLineContainer = () => container.querySelector('[data-testid="code-line-numbers"]') as HTMLElement;
    expect(getLineContainer()).toBeTruthy();
    expect(getLineContainer().getAttribute('aria-hidden')).toBe('true');
    expect(getLineContainer().className).toContain('select-none');

    let lineEls = container.querySelectorAll('[data-line-number]');
    expect(lineEls).toHaveLength(1);
    expect(lineEls[0].textContent?.trim()).toBe('1');

    // 2. Trailing empty line gives an extra line number (e.g. line 1 + empty line 2)
    rerender(
      <CodeBlockEditor
        block={makeCodeBlock({ id: 'code-trailing', content: `first line
` })}
        content={`first line
`}
        canEdit
      />
    );
    lineEls = container.querySelectorAll('[data-line-number]');
    expect(lineEls).toHaveLength(2);
    expect(lineEls[0].textContent?.trim()).toBe('1');
    expect(lineEls[1].textContent?.trim()).toBe('2');

    // 3. 120 lines (100+ lines test)
    const longCode = Array.from({ length: 120 }, (_, i) => `const x_${i + 1} = ${i + 1};`).join('\n');
    rerender(
      <CodeBlockEditor
        block={makeCodeBlock({ id: 'code-long', content: longCode })}
        content={longCode}
        canEdit
      />
    );
    lineEls = container.querySelectorAll('[data-line-number]');
    expect(lineEls).toHaveLength(120);
    expect(lineEls[0].textContent?.trim()).toBe('1');
    expect(lineEls[99].textContent?.trim()).toBe('100');
    expect(lineEls[119].textContent?.trim()).toBe('120');

    // Textarea has whitespace-pre and overlay has whitespace-pre
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const pre = container.querySelector('pre') as HTMLPreElement;
    expect(textarea.className).toContain('whitespace-pre');
    expect(pre.className).toContain('whitespace-pre');
  });
});
