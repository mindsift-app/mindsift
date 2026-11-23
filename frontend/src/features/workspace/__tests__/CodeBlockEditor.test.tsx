import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { CodeBlockEditor, loadPrismLanguage, contentWithoutEmptyLastLine } from '../CodeBlockEditor';
import { TestOutlinerBlock } from './TestOutlinerBlock';
import { DocumentBlock } from '../../../lib/types';
import { OUTLINE_CLIPBOARD_TYPE } from '../../../lib/outlineMarkdown';

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
  props: Partial<React.ComponentProps<typeof TestOutlinerBlock>> = {}
) {
  const updates: DocumentBlock[] = [];
  const indentCalls: Array<[string, 1 | -1]> = [];

  const Wrapper: React.FC = () => {
    const [blk, setBlk] = useState<DocumentBlock>(initialBlock);
    return (
      <TestOutlinerBlock
        docId="doc-1"
        block={blk}
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
    const { updates, unmount } = renderOutlinerCodeBlock(makeCodeBlock({ lang: undefined }));

    const picker = screen.getByRole('button', { name: 'Sprache auswählen' });
    expect(picker.textContent).toContain('Text');

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('option', { name: 'YAML' }));
    expect(updates).toHaveLength(1);
    expect(updates[0].lang).toBe('yaml');
    expect(picker.textContent).toContain('YAML');

    unmount();

    // Reader view (!canEdit): shows plain text instead of the picker
    const readerView = render(
      <CodeBlockEditor block={makeCodeBlock({ lang: 'yaml' })} canEdit={false} />
    );
    expect(readerView.queryByRole('button', { name: 'Sprache auswählen' })).toBeNull();
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

  it('pastes copied bullets with hidden values with the placeholder, neither reference nor mask', () => {
    const { container, updates } = renderOutlinerCodeBlock(makeCodeBlock({ content: 'a\nb' }));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(2, 2);
    const data: Record<string, string> = {
      'text/plain': '- Server\n\t- PIN ••••',
      [OUTLINE_CLIPBOARD_TYPE]: '- Server\n\t- PIN {{secret:abc}}',
    };
    fireEvent.paste(textarea, { clipboardData: { getData: (type: string) => data[type === 'text' ? 'text/plain' : type] || '' } });
    expect(updates[updates.length - 1]?.content).toBe('a\n- Server\n\t- PIN (versteckter Wert nicht übernommen)b');
  });

  it('leaves a plain paste to the browser', () => {
    const { container, updates } = renderOutlinerCodeBlock(makeCodeBlock({ content: 'a' }));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    const ok = fireEvent.paste(textarea, { clipboardData: { getData: (type: string) => (type === 'text' || type === 'text/plain' ? 'x = 1' : '') } });
    expect(ok).toBe(true);
    expect(updates).toHaveLength(0);
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

  it('takes a language name typed into the search as it is when nothing in the list matches', () => {
    const { updates } = renderOutlinerCodeBlock(makeCodeBlock({ lang: undefined, content: 'pass in on $ext_if proto tcp to port 22' }));
    const picker = screen.getByRole('button', { name: 'Sprache auswählen' });
    fireEvent.click(picker);
    const search = screen.getByRole('textbox', { name: 'Suchen …' });

    // Nothing matches: the typed name is the only option, Enter takes it as written
    fireEvent.change(search, { target: { value: 'OpenBSD-pf' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toBe('„OpenBSD-pf“ als Sprache (ohne Hervorhebung)');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(updates[updates.length - 1].lang).toBe('OpenBSD-pf');
    expect(picker.textContent).toContain('OpenBSD-pf');

    // A short name of a listed language picks that language, not a free label
    fireEvent.click(picker);
    fireEvent.change(screen.getByRole('textbox', { name: 'Suchen …' }), { target: { value: 'yml' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['YAML']);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Suchen …' }), { key: 'Enter' });
    expect(updates[updates.length - 1].lang).toBe('yaml');

    // Partial matches come first; the typed name is offered below them
    fireEvent.click(picker);
    fireEvent.change(screen.getByRole('textbox', { name: 'Suchen …' }), { target: { value: 'type' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['TypeScript', '„type“ als Sprache (ohne Hervorhebung)']);

    // A name with spaces or other characters cannot be a language
    fireEvent.change(screen.getByRole('textbox', { name: 'Suchen …' }), { target: { value: 'pf conf' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nichts gefunden')).toBeTruthy();
  });

  it('shows a free language name in the header as written and the code without highlighting', async () => {
    const code = 'table inet filter {\n  chain input { type filter hook input priority 0; }\n}';
    const { container } = render(<CodeBlockEditor block={makeCodeBlock({ content: code, lang: 'PF.conf' })} content={code} canEdit />);
    expect(screen.getByRole('button', { name: 'Sprache auswählen' }).textContent).toContain('PF.conf');
    const codeEl = container.querySelector('pre code') as HTMLElement;
    expect(codeEl.className).toBe('language-none');
    expect(codeEl.querySelectorAll('.token')).toHaveLength(0);
    expect(codeEl.textContent).toBe(code);

    // Readers see the name, too
    render(<CodeBlockEditor block={makeCodeBlock({ content: code, lang: 'PF.conf' })} content={code} canEdit={false} />);
    expect(screen.getAllByText('PF.conf')).toHaveLength(2);

    // A free name that happens to be a key of Prism's own (not a language) is no grammar either
    expect(await loadPrismLanguage('extend')).toBe(false);
    expect(await loadPrismLanguage('markup-templating')).toBe(true);
  });

  it('highlights iptables and nftables rules with the shell grammar and keeps their names', async () => {
    const code = '# SSH erlauben\n-A INPUT -p tcp --dport 22 -j ACCEPT';
    const { container } = render(<CodeBlockEditor block={makeCodeBlock({ content: code, lang: 'iptables' })} content={code} canEdit />);
    expect(screen.getByRole('button', { name: 'Sprache auswählen' }).textContent).toContain('iptables');
    await waitFor(() => expect(container.querySelector('pre code')?.className).toBe('language-bash'));
    await waitFor(() => expect(container.querySelector('pre code .token.comment')?.textContent).toBe('# SSH erlauben'));
  });

  it('moves the bullet with the arrows next to the language and greys out the impossible direction', () => {
    const { indentCalls } = renderOutlinerCodeBlock(makeCodeBlock({ level: 0 }));
    const outdent = screen.getByRole('button', { name: 'Ausrücken' }) as HTMLButtonElement;
    const indent = screen.getByRole('button', { name: 'Einrücken' }) as HTMLButtonElement;
    expect(outdent.disabled).toBe(true);
    expect(indent.disabled).toBe(false);
    fireEvent.click(indent);
    fireEvent.click(outdent);
    expect(indentCalls).toEqual([['code-1', 1]]);
  });

  it('cannot indent deeper than one level below the bullet above', () => {
    const { indentCalls } = renderOutlinerCodeBlock(makeCodeBlock({ level: 1 }));
    expect((screen.getByRole('button', { name: 'Einrücken' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ausrücken' }));
    expect(indentCalls).toEqual([['code-1', -1]]);
  });

  it('leaves the block with a second Enter on the empty last line', () => {
    const below = vi.fn();
    const { container, updates } = renderOutlinerCodeBlock(makeCodeBlock({ content: 'echo hallo' }), { onCreateBlockBelow: below });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(10, 10);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(below).not.toHaveBeenCalled();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(below).toHaveBeenCalledWith('code-1', '');
    expect(updates[updates.length - 1]).toMatchObject({ type: 'code', content: 'echo hallo' });
  });

  it('only an empty or indented last line with the caret at its end counts', () => {
    expect(contentWithoutEmptyLastLine('a\n', 2, 2)).toBe('a');
    expect(contentWithoutEmptyLastLine('if x:\n    ', 10, 10)).toBe('if x:');
    expect(contentWithoutEmptyLastLine('a\nb', 3, 3)).toBeNull();
    expect(contentWithoutEmptyLastLine('a\n\nb', 2, 2)).toBeNull();
    expect(contentWithoutEmptyLastLine('abc', 3, 3)).toBeNull();
    expect(contentWithoutEmptyLastLine('a\n', 0, 2)).toBeNull();
  });

  it('turns a bullet with text into code with /code at the end of the line', () => {
    const { container, updates } = renderOutlinerCodeBlock({
      id: 'b-3',
      type: 'bullet',
      content: '',
      level: 0,
      position: 3000,
    });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'ls  -la /code' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(updates[updates.length - 1]).toMatchObject({ type: 'code', content: 'ls  -la' });
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

    // A name outside the list stays as typed (case included): the block shows it as its label
    const res3 = renderOutlinerCodeBlock({ id: 'b-3', type: 'bullet', content: '', level: 0, position: 3000 });
    const ta3 = res3.container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta3, { target: { value: '```OpenBSD-pf pass in' } });
    expect(res3.updates[res3.updates.length - 1]?.type).toBe('code');
    expect(res3.updates[res3.updates.length - 1]?.lang).toBe('OpenBSD-pf');
    expect(res3.updates[res3.updates.length - 1]?.content).toBe('pass in');
  });

  it('takes a typed language name of up to 40 characters, a longer one is no shortcut (like the language menu)', () => {
    const name40 = 'a'.repeat(40);
    const ok = renderOutlinerCodeBlock({ id: 'b-40', type: 'bullet', content: '', level: 0, position: 1000 });
    fireEvent.change(ok.container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '```' + name40 + ' x' } });
    expect(ok.updates[ok.updates.length - 1]).toMatchObject({ type: 'code', lang: name40, content: 'x' });

    for (const value of ['```' + name40 + 'b x', '/code ' + name40 + 'b x']) {
      const long = renderOutlinerCodeBlock({ id: 'b-41', type: 'bullet', content: '', level: 0, position: 1000 });
      const ta = long.container.querySelector('textarea') as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value } });
      expect(long.updates.some((u) => u.type === 'code')).toBe(false);
      expect(ta.value).toBe(value);
      // Enter on ```name: no code block either, the bullet goes on as text
      fireEvent.change(ta, { target: { value: '```' + name40 + 'b' } });
      fireEvent.keyDown(ta, { key: 'Enter' });
      expect(long.updates.some((u) => u.type === 'code')).toBe(false);
      long.unmount();
    }
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
