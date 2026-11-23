import React from 'react';
import {
  ChevronRight,
  ChevronDown,
  Check,
  SquareCheckBig,
  Trash,
  TriangleAlert,
  CircleX,
  Lock,
  FileOutput,
  FileInput,
  Link2,
  Type,
  Unlink,
  AppWindow,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DocumentBlock } from '../../lib/types';
import { api } from '../../lib/api';
import { isNoteLinkOnly } from '../../lib/wikiLink';
import { UserAvatar } from '../../components/UserAvatar';
import { userColorStyles } from '../../lib/userColor';
import { showError } from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errorMessage';
import { BLOCK_DRAG_TYPE } from './moveBranchEvent';
import { useOutlinerActions, type OutlinerActions } from './OutlinerActionsContext';
import type { BlockLock } from './OutlinerBlock';

// Parts of a bullet's row (OutlinerBlock) that need little of its state: the controls left of the text, the
// action bubble, the lock badge and the bar of a conflict copy. They render with the bullet; the tree's
// handlers come from OutlinerActionsContext, the bullet's own as props. The two in every row are render
// functions, not components: two more components per bullet made a long note open some 5% slower.

// Warning and error icons of a collapsed row with children get the ring of a collapsed bullet
const COLLAPSED_ICON = 'rounded-full bg-accent/15 ring-2 ring-accent/30';

interface BulletControlsProps {
  block: DocumentBlock;
  hasChildren: boolean;
  canEdit: boolean;
  listMarker?: string;
  activeFocus: boolean;
  /** Empty rows show the dot only near the pointer */
  isEmpty: boolean;
  onToggleCollapsed: (e: React.MouseEvent) => void;
  onToggleChecked: () => void;
  actions: OutlinerActions;
  t: TFunction<'workspace'>;
}

/** Collapse arrow, the bullet (drag handle and zoom) and a to-do's checkbox */
export function bulletControls({ block, hasChildren, canEdit, listMarker, activeFocus, isEmpty, onToggleCollapsed, onToggleChecked, actions, t }: BulletControlsProps) {
  const { docId, onZoomBlock, onDragStartBlock } = actions;
  return (
    <div className="flex items-center gap-0.5 pt-1 select-none shrink-0">
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          // Same width as the spacer of rows without children (the padding is taken back), so bullets stay aligned
          className="p-0.5 -m-0.5 text-muted hover:text-accent transition-[color,opacity] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title={block.collapsed ? t('block.expand') : t('block.collapse')}
        >
          {block.collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-accent" />
          )}
        </button>
      ) : (
        <span className="w-3.5" />
      )}

      {/* Bullet handle for dragging and zoom focus */}
      <button
        type="button"
        draggable={canEdit}
        onDragStart={(e) => {
          if (!canEdit) return;
          // Dropped onto another note in the sidebar, the branch moves there (moveBranchEvent.ts)
          e.dataTransfer.setData(BLOCK_DRAG_TYPE, JSON.stringify({ docId: docId || block.documentId || block.docId || '', blockId: block.id }));
          onDragStartBlock?.(block.id, e);
        }}
        onClick={() => onZoomBlock?.(block.id)}
        className={`${
          block.type === 'numbered' && listMarker ? 'w-4 h-4 justify-end overflow-visible' : 'w-4 h-4 justify-center'
        } flex items-center rounded-btn group/bullet transition-transform ${
          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        }`}
        title={
          canEdit
            ? t('block.dragZoom')
            : t('block.clickZoom')
        }
      >
        {block.type === 'numbered' && listMarker ? (
          <span
            className={`text-xs tabular-nums font-medium leading-none whitespace-nowrap transition-colors ${
              block.collapsed && hasChildren
                ? // Like the dot of a collapsed bullet; the margins take the padding back, so the number stays put
                  'text-accent bg-accent/15 ring-1 ring-accent/30 rounded-btn pl-1 pr-0.5 -mr-0.5 py-0.5 -my-0.5'
                : activeFocus
                ? 'text-main'
                : 'text-muted group-hover/bullet:text-accent'
            }`}
          >
            {listMarker}
          </span>
        ) : block.type === 'warning' ? (
          <TriangleAlert
            className={`w-3.5 h-3.5 shrink-0 text-status-warn transition-transform group-hover/bullet:scale-110 ${
              block.collapsed && hasChildren ? COLLAPSED_ICON : ''
            }`}
          />
        ) : block.type === 'error' ? (
          <CircleX
            className={`w-3.5 h-3.5 shrink-0 text-status-err transition-transform group-hover/bullet:scale-110 ${
              block.collapsed && hasChildren ? COLLAPSED_ICON : ''
            }`}
          />
        ) : (
        <span
          className={`w-1.5 h-1.5 rounded-full transition-all duration-150 ${
            block.collapsed && hasChildren
              ? 'bg-accent ring-2 ring-accent/30'
              : activeFocus
              ? 'bg-main scale-125'
              : // Resting dots stay quiet next to the text (a quarter of the faint colour, in every theme)
                'bg-faint/25 group-hover/bullet:bg-accent group-hover/bullet:scale-125'
          } ${
            // Empty rows show the dot only near the pointer (to-dos keep it: the guide lines start there)
            isEmpty
              ? 'opacity-0 group-hover:opacity-100 hover:opacity-100'
              : 'opacity-100'
          }`}
        />
        )}
      </button>

      {/* If To-Do block: checkbox alongside bullet */}
      {block.type === 'todo' && (
        <button
          type="button"
          disabled={!canEdit}
          onClick={onToggleChecked}
          className={`w-4 h-4 checkbox-square flex items-center justify-center transition-colors border ${
            block.checked
              ? 'bg-status-ok border-status-ok text-on-accent'
              : 'border-strong hover:border-accent text-transparent'
          }`}
          title={block.checked ? t('block.markOpen') : t('block.markDone')}
        >
          <Check className="w-3 h-3 stroke-3" />
        </button>
      )}
    </div>
  );
}

/** Bar of a conflict copy: text that lost against someone else's change */
export const ConflictNotice: React.FC<{ block: DocumentBlock; lockedBy?: BlockLock; originalLockedBy?: BlockLock }> = ({
  block,
  lockedBy,
  originalLockedBy,
}) => {
  const { t } = useTranslation('workspace');
  const { onResolveConflict } = useOutlinerActions();
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-status-warn select-none">
        <TriangleAlert className="w-3 h-3 shrink-0" />
        <span>
          {block.conflictOf === 'title' ? t('block.titleConflict') : t('block.conflict')}
          {block.conflictAuthor ? ` ${t('block.conflictBy', { name: block.conflictAuthor })}` : ''}
        </span>
        {onResolveConflict && (
          <>
            {/* Replacing waits while someone edits the original, replacing and discarding while someone edits
                the copy; keeping both only takes the marking off and always works */}
            <button
              type="button"
              disabled={!!lockedBy || !!originalLockedBy}
              onClick={() => onResolveConflict(block.id, 'take')}
              className="px-1.5 py-0.5 rounded-btn border border-status-warn/40 hover:bg-status-warn/15 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={
                lockedBy
                  ? (lockedBy.own ? t('lock.drawingOwn') : t('lock.copy', { name: lockedBy.name }))
                  : originalLockedBy
                    ? t('block.originalLocked', { name: originalLockedBy.name })
                    : block.conflictOf === 'title'
                      ? t('block.takeTitle')
                      : t('block.takeText')
              }
            >
              {t('block.take')}
            </button>
            <button
              type="button"
              onClick={() => onResolveConflict(block.id, 'keep')}
              className="px-1.5 py-0.5 rounded-btn border border-border text-main hover:bg-panel cursor-pointer"
              title={t('block.keepBothTitle')}
            >
              {t('block.keepBoth')}
            </button>
            <button
              type="button"
              disabled={!!lockedBy}
              onClick={() => onResolveConflict(block.id, 'drop')}
              className="px-1.5 py-0.5 rounded-btn border border-border text-muted hover:text-main hover:bg-panel cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={lockedBy ? (lockedBy.own ? t('lock.drawingOwn') : t('lock.copy', { name: lockedBy.name })) : t('block.dropVersion')}
            >
              {t('common:discard')}
            </button>
          </>
        )}
      </div>
      {onResolveConflict && !lockedBy && originalLockedBy && (
        <p className="mt-0.5 text-[11px] text-status-err select-none">{t('block.originalLocked', { name: originalLockedBy.name })}</p>
      )}
    </>
  );
};

// One's own other tab or device holds the bullet: an icon in place of the avatar, same size (UserAvatar xxs)
const OwnLockIcon: React.FC<{ on?: BlockLock['ownOn'] }> = ({ on }) => {
  const Icon = on === 'tab' ? AppWindow : on === 'phone' ? Smartphone : Monitor;
  return (
    <span aria-hidden="true" className="w-4 h-4 shrink-0 rounded-full inline-flex items-center justify-center bg-panel-elevated border border-current">
      <Icon className="w-2.5 h-2.5" />
    </span>
  );
};

/** Someone else is editing this block: floats where the action bubble is (hidden then), so the text or
 *  drawing keeps its width while they type and nothing moves */
export const LockBadge: React.FC<{ lockedBy: BlockLock; color: ReturnType<typeof userColorStyles> }> = ({ lockedBy, color }) => {
  const { t } = useTranslation('workspace');
  return (
    <span
      className="absolute right-1 sm:right-2 top-0.5 sm:top-1 z-20 h-5 inline-flex items-center gap-1 pl-0.5 pr-1.5 rounded-pill text-[10px] font-semibold bg-panel select-none max-w-[45%]"
      style={{ color: color.text, border: `1px solid ${color.border}` }}
      title={lockedBy.own ? t('lock.drawingOwn') : t('lock.title', { name: lockedBy.name })}
    >
      {lockedBy.own ? (
        <OwnLockIcon on={lockedBy.ownOn} />
      ) : (
        <UserAvatar
          userId={lockedBy.userId}
          name={lockedBy.name}
          avatarUrl={lockedBy.avatarUrl || ''}
          size="xxs"
          colorRing
          showTitle={false}
        />
      )}
      <span className="truncate">{lockedBy.own ? t('lock.you') : lockedBy.name}</span>
      <Lock className="w-2.5 h-2.5 shrink-0 opacity-80" />
    </span>
  );
};

interface ActionBubbleProps {
  block: DocumentBlock;
  canEdit: boolean;
  hasChildren: boolean;
  /** The bullet's text as its field shows it */
  content: string;
  /** An inline picker (image, audio, dictation) stands in the bullet's place */
  picking: boolean;
  lockedBy?: BlockLock;
  show: boolean;
  bubbleRef: React.RefObject<HTMLDivElement | null>;
  /** Where a drawing puts its own buttons */
  onDrawingActionsEl: (el: HTMLSpanElement | null) => void;
  onToText: () => void;
  /** The to-do was linked to the task with this id, or unlinked ('') */
  onTaskLink: (taskId: string) => void;
  actions: OutlinerActions;
  t: TFunction<'workspace'>;
}

/**
 * Floating actions of a bullet (back to text, enhanced task, link, extract, delete). Next to a table that
 * fills the width it stays left of the table's + and ⋯, so a tap on them never hits it.
 */
export function actionBubble({ block, canEdit, hasChildren, content, picking, lockedBy, show, bubbleRef, onDrawingActionsEl, onToText, onTaskLink, actions, t }: ActionBubbleProps) {
  const { docId, onCopyBlockLink, onExtractBlock, onInlineBlock, onDeleteBlock, onOpenTask } = actions;
  // A voice note's player fills the row's width on phones, so its bubble floats above the row (over the gap and
  // the lower edge of the bullet above, or of the title for the first bullet) instead of covering the time bar
  // and menu, and the row gets no extra space. Its buttons are 44px to tap on phones while the pill stays slim
  const abovePlayer = block.type === 'audio';
  const btn =
    block.type === 'audio'
      ? 'p-1 sm:p-0.5 min-w-11 min-h-11 -my-2 sm:min-w-0 sm:min-h-0 sm:my-0'
      : 'p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0';
  return (
    <div
      ref={bubbleRef}
      className={`absolute ${
        block.type === 'table' && canEdit ? 'right-12 sm:right-8' : 'right-1 sm:right-2'
      } ${
        abovePlayer ? 'bottom-[calc(100%-6px)]' : 'top-0.5 sm:top-1'
      } z-20 bg-panel/90 border border-border rounded-pill px-1 sm:px-1.5 py-0.5 flex items-center gap-0.5 sm:gap-1 transition-opacity ${
        lockedBy || (!canEdit && !onCopyBlockLink && block.type !== 'drawing')
          ? // Someone else is editing the block: no actions, and the lock badge stays visible. Read only
            // without a link to copy (a public page): nothing to show, not even an empty frame
            'hidden'
          : // Blurred only while shown: a backdrop filter in every bullet made scrolling a long note
            // recompose the page each frame
            show
          ? 'opacity-100 pointer-events-auto backdrop-blur-xs'
          : // Hidden buttons must not take clicks; keyboard focus inside still shows it
            'opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto focus-within:backdrop-blur-xs'
      }`}
    >
      {/* A drawing's own buttons (edit, save view …) come in here */}
      {block.type === 'drawing' && <span ref={onDrawingActionsEl} className="contents" />}

      {/* Convert back to bullet for to-dos, headings, callouts, warnings, dividers, code and numbered items */}
      {canEdit && ['todo', 'callout', 'warning', 'error', 'h1', 'h2', 'h3', 'divider', 'code', 'numbered'].includes(block.type) && (
        <button
          type="button"
          onClick={onToText}
          className={`${btn} flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer`}
          title={t('block.toText')}
        >
          <Type className="w-3.5 h-3.5" />
        </button>
      )}

      {/* To-do: turn it into an enhanced task, or undo the link of one */}
      {block.type === 'todo' && canEdit && !block.taskId && !block.subtaskOf && (
        <button
          type="button"
          onClick={async () => {
            try {
              const targetDocId = docId || block.documentId || block.docId || '';
              const thought = await api.createEnhancedTask(targetDocId, block.id, {
                content: content || 'Aufgabe',
                checked: Boolean(block.checked),
              });
              onTaskLink(thought.id);
              onOpenTask?.(thought.id);
            } catch (err) {
              showError(errorMessage(err, t('block.createTaskFailed')));
            }
          }}
          className={`${btn} flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer`}
          title={t('block.toTask')}
          aria-label={t('block.toTask')}
        >
          <SquareCheckBig className="w-3.5 h-3.5" />
        </button>
      )}
      {block.type === 'todo' && canEdit && block.taskId && (
        <button
          type="button"
          onClick={async () => {
            try {
              await api.unlinkEnhancedTask(block.taskId!).catch(() => {});
              onTaskLink('');
            } catch (err) {
              showError(errorMessage(err, t('block.unlinkFailed')));
            }
          }}
          className={`${btn} flex items-center justify-center text-faint hover:text-status-warn rounded-btn transition-colors cursor-pointer`}
          title={t('block.unlink')}
          aria-label={t('block.unlink')}
        >
          <Unlink className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Link to this bullet */}
      {onCopyBlockLink && content.trim() !== '' && !picking && (
        <button
          type="button"
          onClick={() => onCopyBlockLink(block.id)}
          className={`${btn} flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer`}
          title={t('block.copyLink')}
          aria-label={t('block.copyLink')}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Branch into its own note */}
      {canEdit && onExtractBlock && content.trim() !== '' && !isNoteLinkOnly(content) && !picking && (
        <button
          type="button"
          onClick={(e) => onExtractBlock(block.id, { x: e.clientX, y: e.clientY })}
          className={`${btn} flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer`}
          title={t('block.extract')}
        >
          <FileOutput className="w-3.5 h-3.5" />
        </button>
      )}

      {/* The way back: a bullet that only links to a note gets that note's bullets again */}
      {canEdit && onInlineBlock && isNoteLinkOnly(content) && !picking && (
        <button
          type="button"
          onClick={() => onInlineBlock(block.id)}
          className={`${btn} flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer`}
          title={t('block.pullBackTitle')}
          aria-label={t('block.pullBack')}
        >
          <FileInput className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Delete button: a branch goes with its children and without a question; Ctrl+Z brings it back */}
      {canEdit && (
        <button
          type="button"
          onClick={() => onDeleteBlock(block.id, hasChildren)}
          className={`${btn} flex items-center justify-center text-faint hover:text-status-err rounded-btn transition-colors cursor-pointer`}
          title={t('block.delete')}
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
