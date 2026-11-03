import React from 'react';
import { safeHref } from './safeUrl';
import { parseWikiLink, wikiLinkText } from './wikiLink';
import i18n from '../i18n';

/**
 * Parses inline markdown:
 * - **bold** or __bold__
 * - *italic* or _italic_
 * - ~~strikethrough~~
 * - `code`
 * - [label](url)
 * - #hashtag (only when `options.onTagClick` is given), rendered inline as a clickable chip
 * - [[wiki link]] shown by its label (clickable with `options.onWikiLinkClick`)
 */
export interface InlineMarkdownOptions {
  onTagClick?: (tag: string) => void;
  onWikiLinkClick?: (title: string, blockId?: string) => void;
}

function renderInlineTokens(text: string, options?: InlineMarkdownOptions): React.ReactNode[] {
  if (!text) return [];

  const tagAlt = options?.onTagClick ? '|#[\\p{L}\\p{N}_-]+' : '';
  const regex = new RegExp(
    '(\\[\\[[^\\]]+\\]\\]|https?:\\/\\/[^\\s<>()\\[\\]]+[^\\s<>()\\[\\].,;:!?"\']|`[^`]+`|\\*\\*[^*]+\\*\\*|__[^_]+__|~~[^~]+~~|\\*[^*]+\\*|_[^_]+_|\\[([^\\]]+)\\]\\(([^)]+)\\)' + tagAlt + ')',
    'gu'
  );

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token}`;

    if (/^https?:\/\//.test(token)) {
      const href = safeHref(token);
      elements.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 decoration-accent/40 hover:decoration-accent break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {token}
          </a>
        ) : (
          token
        )
      );
    } else if (token.startsWith('[[') && token.endsWith(']]')) {
      const link = parseWikiLink(token.slice(2, -2));
      const onClick = options?.onWikiLinkClick;
      elements.push(
        onClick ? (
          <span
            key={key}
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onClick(link.title, link.blockId);
            }}
            className="text-status-info underline decoration-status-info/40 underline-offset-2 hover:decoration-status-info cursor-pointer"
            title={link.blockId ? i18n.t('common:wikiLink.toBlock', { title: link.title }) : i18n.t('common:wikiLink.openNote', { title: link.title })}
          >
            {wikiLinkText(link)}
          </span>
        ) : (
          <span key={key} className="text-status-info">
            {wikiLinkText(link)}
          </span>
        )
      );
    } else if (token.startsWith('#')) {
      const prevChar = match.index > 0 ? text[match.index - 1] : '';
      if (prevChar && !/[\s(]/.test(prevChar)) {
        // e.g. an URL fragment like https://x/#anchor: keep as plain text
        elements.push(token);
      } else {
        const tag = token.slice(1);
        elements.push(
          <span
            key={key}
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              options?.onTagClick?.(tag);
            }}
            className="text-accent bg-accent-dim hover:bg-accent/20 rounded-btn px-0.5 cursor-pointer transition-colors"
            title={i18n.t('common:filterTag', { tag })}
          >
            {token}
          </span>
        );
      }
    } else if (token.startsWith('`') && token.endsWith('`')) {
      elements.push(
        <code key={key} className="px-1.5 py-0.5 rounded bg-main/[0.12] text-main font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      elements.push(
        <strong key={key} className="font-semibold text-main">
          {renderInlineTokens(token.slice(2, -2), options)}
        </strong>
      );
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      elements.push(
        <em key={key} className="italic text-main/90">
          {renderInlineTokens(token.slice(1, -1), options)}
        </em>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      elements.push(
        <del key={key} className="line-through text-muted/80">
          {renderInlineTokens(token.slice(2, -2), options)}
        </del>
      );
    } else if (token.startsWith('[') && match[2] && match[3] && safeHref(match[3])) {
      const label = match[2];
      const url = safeHref(match[3]) as string;
      elements.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline hover:opacity-80 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </a>
      );
    } else {
      elements.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

/**
 * Parses inline markdown and fenced code blocks:
 * - ```lang\ncode\n```
 * - **bold** or __bold__
 * - *italic* or _italic_
 * - ~~strikethrough~~
 * - `code`
 * - [label](url)
 */
export function renderInlineMarkdown(text: string, options?: InlineMarkdownOptions): React.ReactNode[] {
  if (!text) return [];

  if (text.includes('```')) {
    const codeBlockRegex = /(```[a-zA-Z0-9_-]*\r?\n[\s\S]*?```|```[\s\S]*?```)/g;
    const parts = text.split(codeBlockRegex);
    const nodes: React.ReactNode[] = [];

    parts.forEach((part, partIdx) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.split(/\r?\n/);
        const firstLine = lines[0].slice(3).trim();
        const codeLines = lines.slice(1, lines.length - 1);
        const code = codeLines.join('\n');
        nodes.push(
          <div
            key={`fenced-${partIdx}`}
            className="p-2.5 my-2 rounded bg-code text-accent font-mono text-xs overflow-x-auto border border-border/60 select-text"
          >
            {firstLine && (
              <div className="text-[10px] text-faint uppercase font-sans pb-1 select-none">
                {firstLine}
              </div>
            )}
            <pre className="whitespace-pre overflow-x-auto font-mono text-status-ok leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        );
      } else if (part) {
        nodes.push(...renderInlineTokens(part, options));
      }
    });

    return nodes;
  }

  return renderInlineTokens(text, options);
}

export function MarkdownViewer({ content, className = '' }: { content: string; className?: string }) {
  if (!content) return null;

  const lines = content.split('\n');
  const renderedNodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        renderedNodes.push(
          <pre key={`code-${i}`} className="p-2.5 my-2 rounded bg-panel-elevated text-accent font-mono text-xs overflow-x-auto border border-border/60">
            <code>{codeBlockLines.join('\n')}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed.startsWith('### ')) {
      renderedNodes.push(
        <h3 key={i} className="text-sm font-bold text-main mt-2 mb-1">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
    } else if (trimmed.startsWith('## ')) {
      renderedNodes.push(
        <h2 key={i} className="text-base font-bold text-main mt-3 mb-1">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
    } else if (trimmed.startsWith('# ')) {
      renderedNodes.push(
        <h1 key={i} className="text-lg font-bold text-main mt-3 mb-1.5">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
    } else if (trimmed.startsWith('> ')) {
      renderedNodes.push(
        <blockquote key={i} className="border-l-2 border-accent pl-2.5 my-1 text-muted italic">
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      renderedNodes.push(
        <div key={i} className="flex items-start gap-1.5 my-0.5">
          <span className="text-accent mt-0.5">•</span>
          <span className="flex-1 text-main">{renderInlineMarkdown(trimmed.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      const matchNum = trimmed.match(/^(\d+)\.\s(.*)$/);
      renderedNodes.push(
        <div key={i} className="flex items-start gap-1.5 my-0.5">
          <span className="text-muted text-[11px] font-mono mt-0.5">{matchNum ? matchNum[1] + '.' : '•'}</span>
          <span className="flex-1 text-main">{renderInlineMarkdown(matchNum ? matchNum[2] : trimmed)}</span>
        </div>
      );
    } else if (trimmed === '') {
      renderedNodes.push(<div key={i} className="h-2" />);
    } else {
      renderedNodes.push(
        <div key={i} className="my-0.5 text-main leading-relaxed">
          {renderInlineMarkdown(line)}
        </div>
      );
    }
  }

  if (inCodeBlock && codeBlockLines.length > 0) {
    renderedNodes.push(
      <pre key="code-end" className="p-2.5 my-2 rounded bg-panel-elevated text-accent font-mono text-xs overflow-x-auto border border-border/60">
        <code>{codeBlockLines.join('\n')}</code>
      </pre>
    );
  }

  return <div className={`markdown-body text-xs ${className}`}>{renderedNodes}</div>;
}
