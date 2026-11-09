import i18n from '../../i18n';
import { DocumentBlock } from '../../lib/types';

// Zooming into a bullet: the path from the note down to it (breadcrumbs) and the bullets shown inside it.
// Used by the editor and the public page of a note.

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
        title: blocks[i].content?.trim() || i18n.t('workspace:editor.untitledBullet'),
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
    title: zoomedBlock.content?.trim() || i18n.t('workspace:editor.untitledBullet'),
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
