import type React from 'react';
import i18n from '../../i18n';
import { DocumentBlock } from '../../lib/types';

const MAX_ROWS = 8;
// Transparent margin around the card, so its shadow is part of the drag image and not cut off
const PAD = 16;

// Plain text of a row: the markdown marks and link syntax would only be noise in the small preview
function plainText(block: DocumentBlock): string {
  const firstLine = (block.content || '').split('\n')[0];
  return firstLine
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, '$1')
    .replace(/(\*\*|__|~~|`|==)/g, '')
    .trim();
}

function marker(block: DocumentBlock): HTMLElement {
  const el = document.createElement('span');
  if (block.type === 'todo') {
    el.className = `w-3 h-3 shrink-0 rounded-checkbox border ${block.checked ? 'bg-accent border-accent' : 'border-muted'}`;
  } else {
    el.className = 'w-1.5 h-1.5 mx-[3px] shrink-0 rounded-full bg-muted';
  }
  return el;
}

// The browser's own drag image is just the small bullet under the pointer, easy to miss. Instead the
// dragged branch is shown as a card with its first rows, indented like in the note. The shadow takes the
// text colour, so it glows light on dark themes and falls dark on light ones.
export function setBranchDragImage(e: React.DragEvent, branch: DocumentBlock[]) {
  if (!branch.length || typeof e.dataTransfer.setDragImage !== 'function') return;
  const base = Math.max(0, branch[0].level || 0);

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;top:-10000px;left:-10000px;padding:${PAD}px;pointer-events:none;z-index:-1`;
  const card = document.createElement('div');
  card.className = 'bg-panel text-main border border-border rounded-card px-3 py-2 text-sm';
  card.style.cssText =
    'width:max-content;max-width:360px;box-shadow:0 6px 22px color-mix(in srgb, var(--text-main) 30%, transparent),0 0 0 1px color-mix(in srgb, var(--text-main) 12%, transparent)';
  wrap.appendChild(card);

  branch.slice(0, MAX_ROWS).forEach((block, i) => {
    const row = document.createElement('div');
    row.className = `flex items-center gap-2 leading-6 ${i === 0 ? 'font-medium' : 'text-muted'}`;
    row.style.paddingLeft = `${Math.max(0, (block.level || 0) - base) * 18}px`;
    row.appendChild(marker(block));
    const text = document.createElement('span');
    text.className = `truncate${block.type === 'todo' && block.checked ? ' line-through' : ''}`;
    text.textContent = plainText(block) || '…';
    row.appendChild(text);
    card.appendChild(row);
  });
  if (branch.length > MAX_ROWS) {
    const more = document.createElement('div');
    more.className = 'text-xs text-faint leading-5 pt-0.5';
    more.textContent = i18n.t('workspace:block.dragMore', { count: branch.length - MAX_ROWS });
    card.appendChild(more);
  }

  document.body.appendChild(wrap);
  // Pointer sits on the bullet of the first row, as before
  e.dataTransfer.setDragImage(wrap, PAD + 18, PAD + 20);
  // The browser takes its snapshot synchronously; the element is not needed afterwards
  window.setTimeout(() => wrap.remove(), 0);
}
