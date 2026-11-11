import i18n from '../../i18n';
import { DocumentBlock } from '../../lib/types';
import { drawingTexts, parseDrawing } from '../../lib/drawing/model';
import { parseMediaContent } from '../../lib/media';
import { tableSummary } from '../../lib/markdownTable';

// Zooming into a bullet: the path from the note down to it (breadcrumbs) and the bullets shown inside it.
// Used by the editor and the public page of a note.

// Bullets whose content is not text (a drawing's model, a file reference, a table): their title is made
// from the kind and what they say, and cannot be edited in the zoom
export const isTitleFromKind = (block: DocumentBlock) =>
  block.type === 'drawing' || block.type === 'image' || block.type === 'audio' || block.type === 'divider' || block.type === 'table';

// The title of a bullet in the zoom and the breadcrumbs: its text, or for a drawing "Zeichnung: Start,
// Ende" (the words in it), for an image or audio file the kind and its caption, for a table its header
export function blockTitle(block: DocumentBlock): string {
  const kind = (key: string, detail: string) =>
    detail ? i18n.t('workspace:editor.kindTitle', { kind: i18n.t(`workspace:editor.kind.${key}`), detail }) : i18n.t(`workspace:editor.kind.${key}`);
  switch (block.type) {
    case 'drawing': {
      const drawing = parseDrawing(block.content || '');
      const text = drawing ? drawingTexts(drawing).map((s) => s.replace(/\s+/g, ' ').trim()).join(', ') : '';
      return kind('drawing', text.length > 80 ? `${text.slice(0, 79)}…` : text);
    }
    case 'image':
    case 'audio':
      return kind(block.type, parseMediaContent(block.content || '')?.caption.trim() || '');
    case 'divider':
      return kind('divider', '');
    case 'table': {
      const header = tableSummary(block.content || '');
      return kind('table', header.length > 80 ? `${header.slice(0, 79)}…` : header);
    }
  }
  return block.content?.trim() || i18n.t('workspace:editor.untitledBullet');
}

export interface BreadcrumbNode {
  id: string | null;
  title: string;
}

export function computeBreadcrumbs(
  docTitle: string,
  blocks: DocumentBlock[],
  zoomedBlockId: string | null
): BreadcrumbNode[] {
  if (!zoomedBlockId) return [];

  const zoomedIdx = blocks.findIndex((b) => b.id === zoomedBlockId);
  if (zoomedIdx === -1) return [];

  const trail: BreadcrumbNode[] = [];
  const zoomedBlock = blocks[zoomedIdx];

  let currentLevel = zoomedBlock.level;
  for (let i = zoomedIdx - 1; i >= 0; i--) {
    if (blocks[i].level < currentLevel) {
      trail.unshift({
        id: blocks[i].id,
        title: blockTitle(blocks[i]),
      });
      currentLevel = blocks[i].level;
      if (currentLevel === 0) break;
    }
  }

  trail.unshift({
    id: null,
    title: docTitle || i18n.t('workspace:editor.untitled'),
  });

  trail.push({
    id: zoomedBlock.id,
    title: blockTitle(zoomedBlock),
  });

  return trail;
}

export function getZoomedSubtree(
  blocks: DocumentBlock[],
  zoomedBlockId: string | null
): {
  zoomedBlock: DocumentBlock | null;
  childBlocks: DocumentBlock[];
  levelOffset: number;
} {
  if (!zoomedBlockId) {
    return { zoomedBlock: null, childBlocks: blocks, levelOffset: 0 };
  }

  const idx = blocks.findIndex((b) => b.id === zoomedBlockId);
  if (idx === -1) {
    return { zoomedBlock: null, childBlocks: blocks, levelOffset: 0 };
  }

  const zoomedBlock = blocks[idx];
  const zLevel = zoomedBlock.level;
  const childBlocks: DocumentBlock[] = [];

  for (let i = idx + 1; i < blocks.length; i++) {
    if (blocks[i].level > zLevel) {
      childBlocks.push(blocks[i]);
    } else {
      break;
    }
  }

  return {
    zoomedBlock,
    childBlocks,
    levelOffset: zLevel + 1,
  };
}
