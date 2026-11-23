import { createContext, useContext } from 'react';
import type { DocumentBlock } from '../../lib/types';
import type { WikiLinkClickHandler } from '../../lib/wikiLink';
import type { ConflictChoice } from '../../lib/docSync/engine';
import type { BlockLock } from './OutlinerBlock';

/**
 * What every bullet of a tree shares: its handlers and the few values that are the same for the whole tree.
 * OutlinerTree provides it once instead of handing each bullet some 35 props. The value keeps its identity
 * while the tree renders (the handlers are stable, see OutlinerTree), so a bullet renders again only when its
 * own props change; it changes only when the tree's handlers come or go or a tree-wide value changes, and
 * then every bullet renders. Values that change per bullet or while typing stay props of OutlinerBlock.
 * Optional handlers are undefined when the tree has none: a bullet shows its buttons only for the ones it has.
 */
export interface OutlinerActions {
  docId: string;
  levelOffset: number;
  /** The user may edit the note, so Enter in a locked bullet still adds one below */
  canAppendBelow: boolean;
  onZoomBlock?: (blockId: string) => void;
  /** Turns a bullet and its children into a note of its own; at: where the extract button was clicked, to
   *  ask there where the branch should go */
  onExtractBlock?: (blockId: string, at?: { x: number; y: number; align?: 'left' | 'right' }) => void;
  onInlineBlock?: (blockId: string) => void;
  /** /vorlage: the bullet asks for a template, the picker opens at its text field (anchor) */
  onTemplateCommand?: (blockId: string, anchor: HTMLElement | null) => void;
  onUpdateBlock: (updated: DocumentBlock, immediate?: boolean) => void;
  /** Runs a slash command's change (`apply`) so that one undo also takes back the typed "/command" */
  onSlashCommand?: (blockId: string, textBefore: string, apply: () => void) => void;
  onCreateBlockBelow: (afterBlockId: string, newContent?: string) => void;
  /** Enter at the start of a bullet with text: a new empty bullet directly above it */
  onCreateBlockAbove?: (beforeBlockId: string) => void;
  onDeleteBlock: (blockId: string, deleteSubtree?: boolean) => void;
  onMergeWithPrevious?: (blockId: string, content: string) => boolean;
  onIndentBlock: (blockId: string, delta: 1 | -1) => void;
  /** Ctrl/Cmd + click on the arrow: this bullet (as given) and all bullets below it fold the same way */
  onToggleBranch?: (updated: DocumentBlock) => void;
  onNavigateFocus: (blockId: string, direction: 'up' | 'down') => void;
  onFocusBlock?: (blockId: string) => void;
  onBlurBlock?: (blockId: string) => void;
  /** Work in a block that does not change its text yet (drawing editor open), keeps its lease */
  onBlockActivity?: (blockId: string) => void;
  /** The focused field took over the block's text from elsewhere: the next edit builds on it */
  onFieldShows?: (blockId: string, content: string) => void;
  onOpenTask?: (taskId: string) => void;
  onTagClick?: (tag: string) => void;
  onWikiLinkClick?: WikiLinkClickHandler;
  /** Copies a link to a bullet ([[Notiz#^id|…]]) */
  onCopyBlockLink?: (blockId: string) => void;
  // A bullet names itself by its ID (its index changes with every bullet added above it)
  onDragStartBlock?: (blockId: string, e: React.DragEvent) => void;
  onDragOverBlock?: (e: React.DragEvent, blockId: string) => void;
  /** e: the drop, for text dragged onto a bullet without a text field (OutlinerTree, dropTextOnto) */
  onDropBlock?: (blockId: string, e?: React.DragEvent) => void;
  registerTextareaRef: (blockId: string, el: HTMLTextAreaElement | null) => void;
  /** Returns the bullet the cursor ends up in (the last pasted line) */
  onPasteMultiLines?: (blockId: string, textBefore: string, textAfter: string, rawLines: string[]) => string | void;
  /** Uploaded pasted images become image bullets at this bullet (OutlinerTree.handlePasteImages) */
  onPasteImages?: (anchorId: string, contents: string[], anchor?: DocumentBlock, focus?: boolean) => void;
  /** A double-click on a drawing someone else is editing: tell the user why it does not open */
  onLockedDrawing?: (lock: BlockLock) => void;
  onResolveConflict?: (blockId: string, choice: ConflictChoice) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const OutlinerActionsContext = createContext<OutlinerActions | null>(null);

/** The actions of the tree a bullet is in (OutlinerTree provides them) */
export function useOutlinerActions(): OutlinerActions {
  const actions = useContext(OutlinerActionsContext);
  if (!actions) throw new Error('OutlinerBlock outside of an OutlinerActionsContext');
  return actions;
}
