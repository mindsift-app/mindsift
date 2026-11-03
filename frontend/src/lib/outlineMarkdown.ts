import type { DocumentBlock } from './types';

// Bullets as Markdown for copying: the top level reads like a document (plain bullets become paragraphs,
// headings, dividers, callouts and fenced code are block elements), everything indented below is a list
// with one tab per level ("-", "1." for numbered, "- [ ]" for to-dos). To-dos and numbered items stay list
// items on the top level too. Pasting it back (pasteOutline.ts: a list right after a paragraph nests
// under it) gives the same structure. Levels count from the shallowest bullet, so a copied branch starts
// at the left margin.
export function blocksToMarkdown(blocks: DocumentBlock[]): string {
  if (blocks.length === 0) return '';
  const base = Math.min(...blocks.map((b) => Math.max(0, b.level || 0)));
  const out: string[] = [];
  // Children of a top-level heading/callout/code/divider become a list one level up; otherwise their
  // tab indent would turn them into an indented code block
  let lift = 0;
  let afterParagraph = false; // a top-level list item right below a paragraph would nest under it
  for (const b of blocks) {
    let lvl = Math.max(0, (b.level || 0) - base);
    if (lvl === 0) {
      lift = 0;
      if (afterParagraph && (b.type === 'todo' || b.type === 'numbered')) out.push('');
      afterParagraph = false;
    }
    else lvl = Math.max(0, lvl - lift);
    const indent = '\t'.repeat(lvl);
    const content = (b.content || '').replace(/\r\n/g, '\n');
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
      if (b.type === 'code') {
        out.push('', `\`\`\`${b.lang || ''}`, content, '```', '');
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
