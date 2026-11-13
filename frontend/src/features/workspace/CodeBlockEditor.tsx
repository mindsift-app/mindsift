import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import Prism from 'prismjs';
import { Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { DocumentBlock } from '../../lib/types';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { enterWithIndent, indentUnit } from './codeIndent';
import { SelectMenu } from '../../components/SelectMenu';

Prism.manual = true;
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).Prism = Prism;
}

export interface CodeLanguageOption {
  id: string;
  label: string;
}

export interface CodeLanguageGroup {
  readonly label: string;
  options: CodeLanguageOption[];
}

export const CODE_LANGUAGE_GROUPS: CodeLanguageGroup[] = [
  {
    get label() {
      return i18n.t('workspace:code.group.config');
    },
    options: [
      { id: 'yaml', label: 'YAML' },
      { id: 'json', label: 'JSON' },
      { id: 'toml', label: 'TOML' },
      { id: 'ini', label: 'INI' },
      { id: 'docker', label: 'Dockerfile' },
      { id: 'nginx', label: 'Nginx' },
      { id: 'hcl', label: 'HCL / Terraform' },
      { id: 'xml', label: 'XML' },
      { id: 'csv', label: 'CSV' },
      { id: 'graphql', label: 'GraphQL' },
      { id: 'protobuf', label: 'Protocol Buffers' },
    ],
  },
  {
    get label() {
      return i18n.t('workspace:code.group.shell');
    },
    options: [
      { id: 'bash', label: 'Bash / Shell' },
      { id: 'powershell', label: 'PowerShell' },
      { id: 'makefile', label: 'Makefile' },
      { id: 'systemd', label: 'Systemd' },
      { id: 'vim', label: 'Vim' },
      { id: 'diff', label: 'Diff' },
      { id: 'git', label: 'Git' },
      { id: 'log', label: 'Log' },
    ],
  },
  {
    get label() {
      return i18n.t('workspace:code.group.web');
    },
    options: [
      { id: 'javascript', label: 'JavaScript' },
      { id: 'typescript', label: 'TypeScript' },
      { id: 'jsx', label: 'JSX' },
      { id: 'tsx', label: 'TSX' },
      { id: 'markup', label: 'HTML / Markup' },
      { id: 'html', label: 'HTML' },
      { id: 'css', label: 'CSS' },
      { id: 'scss', label: 'SCSS' },
    ],
  },
  {
    get label() {
      return i18n.t('workspace:code.group.scripting');
    },
    options: [
      { id: 'python', label: 'Python' },
      { id: 'php', label: 'PHP' },
      { id: 'ruby', label: 'Ruby' },
      { id: 'lua', label: 'Lua' },
      { id: 'perl', label: 'Perl' },
    ],
  },
  {
    get label() {
      return i18n.t('workspace:code.group.system');
    },
    options: [
      { id: 'go', label: 'Go' },
      { id: 'rust', label: 'Rust' },
      { id: 'sql', label: 'SQL' },
      { id: 'c', label: 'C' },
      { id: 'cpp', label: 'C++' },
      { id: 'csharp', label: 'C#' },
      { id: 'java', label: 'Java' },
      { id: 'kotlin', label: 'Kotlin' },
      { id: 'swift', label: 'Swift' },
      { id: 'dart', label: 'Dart' },
      { id: 'zig', label: 'Zig' },
      { id: 'elixir', label: 'Elixir' },
      { id: 'scala', label: 'Scala' },
      { id: 'haskell', label: 'Haskell' },
    ],
  },
  {
    get label() {
      return i18n.t('workspace:code.group.docs');
    },
    options: [
      { id: 'markdown', label: 'Markdown' },
      { id: 'latex', label: 'LaTeX' },
      { id: 'regex', label: 'Regex' },
      { id: 'text', label: 'Plain Text' },
    ],
  },
];

export const CODE_LANGUAGES: CodeLanguageOption[] = CODE_LANGUAGE_GROUPS.flatMap((g) => g.options);

const KNOWN_OPTION_IDS = new Set<string>(CODE_LANGUAGES.map((l) => l.id));

const LANGUAGE_ALIASES: Record<string, string> = {
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  cs: 'csharp',
  'c#': 'csharp',
  dotnet: 'csharp',
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'c',
  kt: 'kotlin',
  kts: 'kotlin',
  hs: 'haskell',
  md: 'markdown',
  tex: 'latex',
  dockerfile: 'docker',
  containerfile: 'docker',
  htm: 'html',
  svg: 'xml',
  proto: 'protobuf',
  ps1: 'powershell',
  pwsh: 'powershell',
  make: 'makefile',
  gql: 'graphql',
  tf: 'hcl',
  terraform: 'hcl',
  ex: 'elixir',
  exs: 'elixir',
  pl: 'perl',
  conf: 'ini',
  golang: 'go',
  plaintext: 'text',
  plain: 'text',
  txt: 'text',
};

const SHORT_PREFIX_CANDIDATES = new Set<string>([
  'c',
  'go',
  'js',
  'ts',
  'sh',
  'py',
  'rb',
  'rs',
  'cs',
  'kt',
  'hs',
  'md',
  'ex',
  'pl',
  'tf',
  'tex',
  'htm',
  'yml',
  'doc',
  'docker',
  'make',
  'proto',
  'plain',
]);

export function resolveLanguageId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (KNOWN_OPTION_IDS.has(key)) return key;
  return LANGUAGE_ALIASES[key];
}

// True when a language token in `/code <lang>` or ````<lang>` cannot be a prefix of another language user is still typing
export function isUnambiguousLanguageShortcut(raw?: string): boolean {
  if (!raw) return false;
  const key = raw.trim().toLowerCase();
  if (SHORT_PREFIX_CANDIDATES.has(key)) return false;
  return Boolean(resolveLanguageId(key));
}

// On-demand loaders for Prism grammars (Vite code-splits each into its own chunk)
const PRISM_LOADERS: Record<string, () => Promise<unknown>> = {
  yaml: () => import('prismjs/components/prism-yaml'),
  json: () => import('prismjs/components/prism-json'),
  toml: () => import('prismjs/components/prism-toml'),
  ini: () => import('prismjs/components/prism-ini'),
  docker: () => import('prismjs/components/prism-docker'),
  nginx: () => import('prismjs/components/prism-nginx'),
  hcl: () => import('prismjs/components/prism-hcl'),
  csv: () => import('prismjs/components/prism-csv'),
  graphql: () => import('prismjs/components/prism-graphql'),
  protobuf: () => import('prismjs/components/prism-protobuf'),
  bash: () => import('prismjs/components/prism-bash'),
  powershell: () => import('prismjs/components/prism-powershell'),
  makefile: () => import('prismjs/components/prism-makefile'),
  systemd: () => import('prismjs/components/prism-systemd'),
  vim: () => import('prismjs/components/prism-vim'),
  diff: () => import('prismjs/components/prism-diff'),
  git: () => import('prismjs/components/prism-git'),
  log: () => import('prismjs/components/prism-log'),
  typescript: () => import('prismjs/components/prism-typescript'),
  jsx: () => import('prismjs/components/prism-jsx'),
  tsx: () => import('prismjs/components/prism-tsx'),
  scss: () => import('prismjs/components/prism-scss'),
  python: () => import('prismjs/components/prism-python'),
  'markup-templating': () => import('prismjs/components/prism-markup-templating'),
  php: () => import('prismjs/components/prism-php'),
  ruby: () => import('prismjs/components/prism-ruby'),
  lua: () => import('prismjs/components/prism-lua'),
  perl: () => import('prismjs/components/prism-perl'),
  go: () => import('prismjs/components/prism-go'),
  rust: () => import('prismjs/components/prism-rust'),
  sql: () => import('prismjs/components/prism-sql'),
  c: () => import('prismjs/components/prism-c'),
  cpp: () => import('prismjs/components/prism-cpp'),
  csharp: () => import('prismjs/components/prism-csharp'),
  java: () => import('prismjs/components/prism-java'),
  kotlin: () => import('prismjs/components/prism-kotlin'),
  swift: () => import('prismjs/components/prism-swift'),
  dart: () => import('prismjs/components/prism-dart'),
  zig: () => import('prismjs/components/prism-zig'),
  elixir: () => import('prismjs/components/prism-elixir'),
  scala: () => import('prismjs/components/prism-scala'),
  haskell: () => import('prismjs/components/prism-haskell'),
  markdown: () => import('prismjs/components/prism-markdown'),
  latex: () => import('prismjs/components/prism-latex'),
  regex: () => import('prismjs/components/prism-regex'),
};

// Prerequisite grammars that must be loaded in order before the target grammar
const PRISM_DEPENDENCIES: Record<string, string[]> = {
  tsx: ['jsx', 'typescript'],
  cpp: ['c'],
  php: ['markup-templating'],
  scala: ['java'],
};

const inFlightGrammarLoads = new Map<string, Promise<boolean>>();

export function toPrismGrammarKey(lang?: string): string {
  if (!lang) return '';
  const resolved = resolveLanguageId(lang) || lang.trim().toLowerCase();
  if (!resolved || resolved === 'text' || resolved === 'plaintext') return '';
  if (resolved === 'html') return 'markup';
  return resolved;
}

export async function loadPrismLanguage(lang?: string): Promise<boolean> {
  const key = toPrismGrammarKey(lang);
  if (!key) return false;
  if (Prism.languages[key]) return true;

  const existing = inFlightGrammarLoads.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const deps = PRISM_DEPENDENCIES[key];
      if (deps) {
        for (const dep of deps) {
          if (!Prism.languages[dep]) {
            await loadPrismLanguage(dep);
          }
        }
      }
      const loader = PRISM_LOADERS[key];
      if (loader) {
        await loader();
      }
      return Boolean(Prism.languages[key]);
    } catch {
      return false;
    } finally {
      inFlightGrammarLoads.delete(key);
    }
  })();

  inFlightGrammarLoads.set(key, task);
  return task;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface CodeBlockEditorProps {
  block: DocumentBlock;
  content?: string;
  canEdit?: boolean;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  registerTextareaRef?: (blockId: string, el: HTMLTextAreaElement | null) => void;
  onChangeContent?: (content: string) => void;
  onChangeLang?: (lang: string) => void;
  /** Kept for callers; converting back to text lives in the bullet's action bubble now */
  onConvertToText?: () => void;
  handleFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  handleBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  handleContentChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Tab inside the code indents the code, so the bullet moves with these arrows next to the language */
  onIndent?: () => void;
  onOutdent?: () => void;
  canIndent?: boolean;
  canOutdent?: boolean;
}

export const CodeBlockEditor: React.FC<CodeBlockEditorProps> = ({
  block,
  content,
  canEdit = true,
  textareaRef,
  registerTextareaRef,
  onChangeContent,
  onChangeLang,
  handleFocus,
  handleBlur,
  handleContentChange,
  handleKeyDown,
  onIndent,
  onOutdent,
  canIndent = false,
  canOutdent = false,
}) => {
  const { t } = useTranslation('workspace');
  const isControlled = content !== undefined;
  const [uncontrolledContent, setUncontrolledContent] = useState<string>(block.content || '');
  const currentContent = isControlled ? content : uncontrolledContent;

  useEffect(() => {
    if (!isControlled) {
      // Uncontrolled: the text follows the block when it changes from outside
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUncontrolledContent(block.content || '');
    }
  }, [block.content, isControlled]);

  const [copied, setCopied] = useState(false);
  const [loadedGrammar, setLoadedGrammar] = useState<string>('');
  const copyTimerRef = useRef<number | null>(null);
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const prismLang = toPrismGrammarKey(block.lang);

  useEffect(() => {
    if (!prismLang) return;
    if (Prism.languages[prismLang]) {
      // A grammar already loaded is used at once, others after loading
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadedGrammar(prismLang);
      return;
    }
    let cancelled = false;
    loadPrismLanguage(prismLang).then((loaded) => {
      if (!cancelled && loaded) {
        setLoadedGrammar(prismLang);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [prismLang]);

  const highlightedHtml = useMemo(() => {
    if (!currentContent) return '';
    const activeLang = prismLang && (Prism.languages[prismLang] || loadedGrammar === prismLang) ? prismLang : '';
    if (!activeLang) return escapeHtml(currentContent);
    const grammar = Prism.languages[activeLang];
    if (!grammar) return escapeHtml(currentContent);
    try {
      return Prism.highlight(currentContent, grammar, activeLang);
    } catch {
      return escapeHtml(currentContent);
    }
  }, [currentContent, prismLang, loadedGrammar]);

  const adjustHeight = useCallback(() => {
    const el = localTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // A horizontal scrollbar takes its height from the field (then a vertical one appeared too)
    const bar = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.max(22, el.scrollHeight + bar)}px`;
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [currentContent, adjustHeight]);

  // Whether the horizontal scrollbar shows depends on the width too (fonts loading, window resized)
  useEffect(() => {
    const el = localTextareaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === lastWidth) return;
      lastWidth = el.offsetWidth;
      adjustHeight();
    });
    observer.observe(el);
    document.fonts?.ready.then(adjustHeight).catch(() => {});
    return () => observer.disconnect();
  }, [adjustHeight]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const p = navigator.clipboard?.writeText(currentContent);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch {
      // ignore clipboard errors
    }
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopied(false);
    }, 1500);
  };

  const applyContentUpdate = (newVal: string, target: HTMLTextAreaElement) => {
    if (!isControlled) {
      setUncontrolledContent(newVal);
    }
    if (onChangeContent) {
      onChangeContent(newVal);
    } else if (handleContentChange) {
      target.value = newVal;
      handleContentChange({
        target,
        currentTarget: target,
      } as React.ChangeEvent<HTMLTextAreaElement>);
    }
  };

  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!canEdit) return;
    if (!isControlled) {
      setUncontrolledContent(e.target.value);
    }
    if (handleContentChange) {
      handleContentChange(e);
    } else if (onChangeContent) {
      onChangeContent(e.target.value);
    }
  };

  // The caret after Enter/Tab: set right away and again once React has rendered the new text (before the
  // next key, which would otherwise land at the end of the field)
  const pendingSelectionRef = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const sel = pendingSelectionRef.current;
    if (!sel || !localTextareaRef.current) return;
    pendingSelectionRef.current = null;
    localTextareaRef.current.setSelectionRange(sel[0], sel[1]);
  }, [currentContent]);
  const setSelectionAfterUpdate = (ta: HTMLTextAreaElement, newStart: number, newEnd: number) => {
    ta.setSelectionRange(newStart, newEnd);
    pendingSelectionRef.current = [newStart, newEnd];
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter keeps the line's indentation (one step deeper after ":" or an opening bracket)
    if (canEdit && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      const ta = e.currentTarget;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? start;
      const { value, caret } = enterWithIndent(currentContent, start, end, block.lang);
      applyContentUpdate(value, ta);
      ta.value = value;
      setSelectionAfterUpdate(ta, caret, caret);
      return;
    }

    if (canEdit && e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const ta = e.currentTarget;
      const val = currentContent;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? start;

      const lineStart = start === 0 ? 0 : val.lastIndexOf('\n', start - 1) + 1;
      const effectiveEnd = end > start && val[end - 1] === '\n' ? end - 1 : end;
      const lineEndIdx = val.indexOf('\n', effectiveEnd);
      const blockEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
      const lines = val.slice(lineStart, blockEnd).split('\n');

      const unit = indentUnit(val, block.lang);
      if (!e.shiftKey) {
        const updatedLines = lines.map((line) => unit + line);
        const newVal = val.slice(0, lineStart) + updatedLines.join('\n') + val.slice(blockEnd);
        const newStart = start + unit.length;
        const newEnd = end + updatedLines.length * unit.length;
        applyContentUpdate(newVal, ta);
        ta.value = newVal;
        setSelectionAfterUpdate(ta, newStart, newEnd);
      } else {
        let removedFirst = 0;
        let removedTotal = 0;
        const updatedLines = lines.map((line, idx) => {
          let removeCount = 0;
          if (line.startsWith('\t')) removeCount = 1;
          else removeCount = Math.min(unit.length, line.length - line.replace(/^ +/, '').length);
          if (idx === 0) removedFirst = removeCount;
          removedTotal += removeCount;
          return line.slice(removeCount);
        });
        if (removedTotal > 0) {
          const newVal = val.slice(0, lineStart) + updatedLines.join('\n') + val.slice(blockEnd);
          const newStart = Math.max(lineStart, start - removedFirst);
          const newEnd = Math.max(newStart, end - removedTotal);
          applyContentUpdate(newVal, ta);
          ta.value = newVal;
          setSelectionAfterUpdate(ta, newStart, newEnd);
        }
      }
      return;
    }

    handleKeyDown?.(e);
  };

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    if (preRef.current) {
      preRef.current.scrollTop = target.scrollTop;
      preRef.current.scrollLeft = target.scrollLeft;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = target.scrollTop;
    }
  };

  const handleLineNumbersScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (localTextareaRef.current) {
      localTextareaRef.current.scrollTop = target.scrollTop;
    }
    if (preRef.current) {
      preRef.current.scrollTop = target.scrollTop;
    }
  };

  const handleLineNumbersWheel = (e: React.WheelEvent) => {
    if (localTextareaRef.current) {
      localTextareaRef.current.scrollTop += e.deltaY;
    }
  };

  const lineCount = useMemo(() => {
    return currentContent.split('\n').length;
  }, [currentContent]);

  const rawLang = block.lang || '';
  const selectValue = rawLang ? resolveLanguageId(rawLang) || rawLang : '';
  const hasCustomUnknownLang = Boolean(selectValue && !KNOWN_OPTION_IDS.has(selectValue));
  // Header controls take the code block's own text colour: light themes with dark code blocks (Classic)
  // would otherwise turn them page-dark on hover
  const headerControl =
    'min-h-[44px] sm:min-h-0 bg-transparent text-faint hover:text-code-fg focus:text-code-fg font-mono text-[11px] font-medium border border-transparent hover:border-code-fg/20 focus:border-accent rounded-btn py-0.5 outline-none';
  const indentButton = (label: string, icon: React.ReactNode, onClick: (() => void) | undefined, enabled: boolean) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (enabled) onClick?.();
      }}
      disabled={!enabled}
      title={label}
      aria-label={label}
      className={`${headerControl} min-w-[44px] sm:min-w-0 px-0.5 flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:text-faint disabled:hover:border-transparent`}
    >
      {icon}
    </button>
  );

  return (
    <div className="group/code relative bg-code rounded-2xl my-0.5 max-w-full overflow-hidden">
      {/* Language at the top left; no header bar */}
      <div className="flex items-center gap-0.5 px-1.5 pt-1 text-[11px] font-mono text-faint">
        {canEdit && (onIndent || onOutdent) && (
          <>
            {indentButton(t('outlineBar.outdent'), <ChevronLeft className="w-3.5 h-3.5" />, onOutdent, canOutdent)}
            {indentButton(t('outlineBar.indent'), <ChevronRight className="w-3.5 h-3.5" />, onIndent, canIndent)}
          </>
        )}
        {canEdit ? (
          <SelectMenu
            ariaLabel={t('code.chooseLanguage')}
            title={t('code.chooseLanguage')}
            value={selectValue}
            onChange={(lang) => onChangeLang?.(lang)}
            buttonClassName={`${headerControl} px-1 gap-1`}
            options={[
              { value: '', label: t('workspace:code.plain') },
              ...(hasCustomUnknownLang ? [{ value: selectValue, label: selectValue }] : []),
              ...CODE_LANGUAGE_GROUPS.flatMap((group) => group.options.map((opt) => ({ value: opt.id, label: opt.label }))),
            ]}
          />
        ) : (
          <span className="font-mono text-[11px] text-faint px-1">{block.lang || 'Text'}</span>
        )}
      </div>

      {/* Copy: round icon button at the bottom right, shown on hover (always on touch screens) */}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute bottom-2 right-2 z-10 h-9 w-9 sm:h-8 sm:w-8 rounded-full bg-panel border border-border shadow-panel flex items-center justify-center text-muted hover:text-main opacity-100 sm:opacity-0 sm:group-hover/code:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
        title={copied ? t('code.copied') : t('code.copyTitle')}
        aria-label={copied ? t('code.copied') : t('code.copy')}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-status-ok" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {/* Live Highlighted Overlay + Textarea with Line Numbers */}
      <div className="flex relative w-full overflow-hidden">
        {/* Line Numbers Column */}
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          onScroll={handleLineNumbersScroll}
          onWheel={handleLineNumbersWheel}
          data-testid="code-line-numbers"
          className="select-none py-2 pl-2.5 pr-2 font-mono text-xs text-faint leading-relaxed text-right shrink-0 overflow-hidden"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i + 1} data-line-number={i + 1}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code Content (Overlay + Textarea) */}
        <div className="relative flex-1 min-w-0 overflow-hidden">
          <pre
            ref={preRef}
            aria-hidden="true"
            className="absolute inset-0 m-0 p-2 font-mono text-xs text-code-fg leading-relaxed whitespace-pre pointer-events-none select-none overflow-hidden"
          >
            <code
              className={prismLang ? `language-${prismLang}` : 'language-none'}
              dangerouslySetInnerHTML={{
                __html: highlightedHtml + (currentContent.endsWith('\n') ? '\n' : ''),
              }}
            />
          </pre>
          <textarea
            ref={(el) => {
              localTextareaRef.current = el;
              if (textareaRef) textareaRef.current = el;
              registerTextareaRef?.(block.id, el);
            }}
            rows={1}
            data-own-height="true"
            value={currentContent}
            readOnly={!canEdit}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={onTextareaChange}
            onKeyDown={onTextareaKeyDown}
            onScroll={handleScroll}
            style={{ caretColor: 'var(--text-code)' }}
            className="relative block w-full m-0 p-2 font-mono text-xs leading-relaxed whitespace-pre bg-transparent text-transparent caret-code-fg selection:bg-accent/25 selection:text-transparent border-0 focus:outline-none focus:ring-0 resize-none overflow-x-auto overflow-y-hidden code-scroll"
          />
        </div>
      </div>
    </div>
  );
};
