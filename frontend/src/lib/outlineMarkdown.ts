import type { DocumentBlock } from './types';

// Bullets as Markdown, in the format of the server's Markdown export (BlocksToVaultMarkdown): a nested list
// with one tab per level, "- [ ]" for to-dos, headings, dividers, callouts and fenced code at the top
// level as block elements. Used for copying bullets; pasting it back (pasteOutline.ts) gives the same
// structure. Levels count from the shallowest bullet, so a copied branch starts at the left margin.
export function blocksToMarkdown(blocks: DocumentBlock[]): string {
  if (blocks.length === 0) return '';
  const base = Math.min(...blocks.map((b) => Math.max(0, b.level || 0)));
  const out: string[] = [];
  // Children of a top-level heading/callout/code/divider become a list one level up; otherwise their
  // tab indent would turn them into an indented code block
  let lift = 0;
  for (const b of blocks) {
    let lvl = Math.max(0, (b.level || 0) - base);
    if (lvl === 0) lift = 0;
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
