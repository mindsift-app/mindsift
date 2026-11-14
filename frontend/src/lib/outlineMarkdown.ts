import type { DocumentBlock } from './types';
import { maskSecrets } from './secretRef';
import { DRAWING_FENCE } from './drawing/model';
import { parseMarkdownTable, serializeMarkdownTable } from './markdownTable';

// Warnings and errors as Obsidian callouts, like the Markdown export of the server
const CALLOUT_KIND = { warning: 'warning', error: 'failure' } as const;

// Bullets as Markdown for copying: the top level reads like a document (plain bullets become paragraphs,
// headings, dividers, callouts, tables and fenced code (drawings too) are block elements), everything indented below is a list
// with one tab per level ("-", "1." for numbered, "- [ ]" for to-dos). To-dos and numbered items stay list
// items on the top level too. Pasting it back (pasteOutline.ts: a list right after a paragraph nests
// under it) gives the same structure. Levels count from the shallowest bullet, so a copied branch starts
// at the left margin. Hidden values are masked unless keepSecretRefs (the app's own clipboard format below).
export function blocksToMarkdown(blocks: DocumentBlock[], { keepSecretRefs = false } = {}): string {
  if (blocks.length === 0) return '';
  const base = Math.min(...blocks.map((b) => Math.max(0, b.level || 0)));
  const out: string[] = [];
  // Children of a top-level heading/callout/code/table/divider become a list one level up; otherwise their
  // tab indent would turn them into an indented code block
  let lift = 0;
  let afterParagraph = false; // a top-level list item right below a paragraph would nest under it
  for (const raw of blocks) {
    // A drawing travels as a fenced block with its model; pasting it into a note makes it a drawing again
    const b: DocumentBlock = raw.type === 'drawing' ? { ...raw, type: 'code', lang: DRAWING_FENCE } : raw;
    let lvl = Math.max(0, (b.level || 0) - base);
    if (lvl === 0) {
      lift = 0;
      if (afterParagraph && (b.type === 'todo' || b.type === 'numbered')) out.push('');
      afterParagraph = false;
    }
    else lvl = Math.max(0, lvl - lift);
    const indent = '\t'.repeat(lvl);
    // Hidden values stay hidden on the clipboard
    const text = (b.content || '').replace(/\r\n/g, '\n');
    const content = keepSecretRefs ? text : maskSecrets(text);
    const oneLine = content.replace(/\n/g, ' ');
    // Soft line breaks continue the list item, aligned under its text
    const cont = (prefix: string) => content.replace(/\n/g, `\n${indent}${prefix}`);
    const hashes = b.type === 'h1' ? '#' : b.type === 'h2' ? '##' : b.type === 'h3' ? '###' : '';

    if ((b.level || 0) - base <= 0) {
      if (hashes) {
        out.push('', `${hashes} ${oneLine}`, '');
        lift = 1;
        continue;
      }
      if (b.type === 'divider') {
        out.push('', '---', '');
        lift = 1;
        continue;
      }
      if (b.type === 'callout') {
        out.push('', `> ${content.replace(/\n/g, '\n> ')}`, '');
        lift = 1;
        continue;
      }
      if (b.type === 'warning' || b.type === 'error') {
        out.push('', `> [!${CALLOUT_KIND[b.type]}]`, `> ${content.replace(/\n/g, '\n> ')}`, '');
        lift = 1;
        continue;
      }
      if (b.type === 'code') {
        out.push('', `\`\`\`${b.lang || ''}`, content, '```', '');
        lift = 1;
        continue;
      }
      if (b.type === 'table') {
        out.push('', serializeMarkdownTable(parseMarkdownTable(content)), '');
        lift = 1;
        continue;
      }
      if (b.type !== 'todo' && b.type !== 'numbered') {
        // A plain bullet on the top level is a paragraph; its children follow right below as a list (no
        // blank line, so pasting it back nests them under the paragraph again)
        out.push('', content);
        lift = 1;
        afterParagraph = true;
        continue;
      }
    }
    switch (b.type) {
      case 'code':
        out.push(`${indent}\`\`\`${b.lang || ''}`, `${indent}${content.replace(/\n/g, `\n${indent}`)}`, `${indent}\`\`\``);
        break;
      case 'table':
        // Indented below the list item it belongs to; Markdown needs the blank lines around a table
        out.push('', ...serializeMarkdownTable(parseMarkdownTable(content)).split('\n').map((l) => indent + l), '');
        break;
      case 'todo':
        out.push(`${indent}- [${b.checked ? 'x' : ' '}] ${cont('  ')}`);
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        out.push(`${indent}- ${hashes} ${oneLine}`);
        break;
      case 'divider':
        out.push(`${indent}- ---`);
        break;
      case 'callout':
        out.push(`${indent}- > ${cont('  > ')}`);
        break;
      case 'warning':
      case 'error':
        out.push(`${indent}- > [!${CALLOUT_KIND[b.type]}] ${cont('  > ')}`);
        break;
      case 'numbered':
        out.push(`${indent}1. ${cont('   ')}`);
        break;
      default:
        out.push(content.trim() === '' ? `${indent}-` : `${indent}- ${cont('  ')}`);
    }
  }
  // No blank lines at the start and end, at most one in a row
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

// The app's own clipboard format for bullets copied from a note: the same Markdown, but a hidden value keeps
// its reference {{secret:<id>}} (never the value itself). Pasted into another note, the reference goes to the
// server, which gives that note a copy of the value if the writer may read it (internal/storage/secret_gate.go).
// Other apps only read text/plain, where hidden values stay masked and no reference ids leak out.
export const OUTLINE_CLIPBOARD_TYPE = 'application/x-mindsift-outline';

export interface OutlineClipboard {
  /** Markdown for every app, hidden values masked */
  text: string;
  /** Markdown with the references, only when the bullets hold hidden values */
  own: string | null;
}

export function blocksToClipboard(blocks: DocumentBlock[]): OutlineClipboard {
  const text = blocksToMarkdown(blocks);
  const own = blocksToMarkdown(blocks, { keepSecretRefs: true });
  return { text, own: own !== text ? own : null };
}

// The last bullets with hidden values copied in this tab. Some clipboards keep only the plain text (Firefox
// without a display, the clipboard API fallback of OutlinerTree): pasting exactly that text here takes the
// own format from this copy. Only references are kept, never a value.
let lastCopied: OutlineClipboard | null = null;

export function rememberCopied(clip: OutlineClipboard) {
  lastCopied = clip.own ? clip : null;
}

export function putOnClipboard(data: DataTransfer, clip: OutlineClipboard) {
  data.setData('text/plain', clip.text);
  if (clip.own) data.setData(OUTLINE_CLIPBOARD_TYPE, clip.own);
  rememberCopied(clip);
}

/** The own format of pasted bullets ('' when the clipboard holds no bullets with hidden values from a note) */
export function ownClipboardText(data: DataTransfer): string {
  const own = data.getData(OUTLINE_CLIPBOARD_TYPE);
  if (own) return own;
  if (!lastCopied) return '';
  return data.getData('text').replace(/\r\n/g, '\n') === lastCopied.text ? lastCopied.own || '' : '';
}
