import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Clock, FileText, Hash, Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { PresenceAvatars } from './PresenceAvatars';
import { CountBadge } from '../../components/CountBadge';
import { SharedPill } from '../../components/SharedPill';
import { Document, TagSummary, User } from '../../lib/types';
import { DocHeaderStatus, DocSaveStatus } from './DocumentEditor';
import { WorkspaceSubView } from './workspaceTypes';

interface WorkspaceTabBarProps {
  subView: WorkspaceSubView;
  setSubView: (view: WorkspaceSubView) => void;
  setMobileShowDetail: (show: boolean) => void;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  totalOpenTodos: number;
  tagsSummary: TagSummary[];
  selectedDocId: string | null;
  selectedDocObj: Document | null;
  currentUser: User | null | undefined;
  docSaveStatus: DocSaveStatus;
  docSaveError: string | null;
  docHeaderStatus: DocHeaderStatus | null;
  openDocShareModal: (doc: Document) => void;
  // The open note lies in a folder that is shared with someone
  inSharedFolder: boolean;
  setDocActionsTarget: (el: HTMLDivElement | null) => void;
}

// Desktop row above the workspace: sidebar toggle and the views (notes, to-dos, hashtags); for the open
// note (in the journal: the day marked in the calendar) people online, live connection, sharing and save status, then its actions (rendered into the
// element set via setDocActionsTarget)
export function WorkspaceTabBar({
  subView,
  setSubView,
  setMobileShowDetail,
  isSidebarCollapsed,
  toggleSidebar,
  totalOpenTodos,
  tagsSummary,
  selectedDocId,
  selectedDocObj,
  currentUser,
  docSaveStatus,
  docSaveError,
  docHeaderStatus,
  openDocShareModal,
  inSharedFolder,
  setDocActionsTarget,
}: WorkspaceTabBarProps) {
  const { t } = useTranslation('workspace');
  return (
    <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
      {/* Workspace selector tabs & left sidebar toggle */}
      <div className="grid grid-cols-3 w-full gap-1 sm:flex sm:flex-wrap sm:items-center sm:w-auto">
        <button
          type="button"
          disabled={subView !== 'editor'}
          onClick={subView === 'editor' ? toggleSidebar : undefined}
          className={`chip-btn hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-btn border transition-colors ${
            subView !== 'editor'
              ? 'opacity-35 bg-canvas border-border text-faint cursor-not-allowed pointer-events-none'
              : isSidebarCollapsed
              ? 'bg-canvas border-border text-accent hover:bg-panel cursor-pointer'
              : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel cursor-pointer'
          }`}
          title={
            subView !== 'editor'
              ? t('tabbar.sidebarNotesOnly')
              : isSidebarCollapsed
              ? t('tabbar.sidebarShow')
              : t('tabbar.sidebarHide')
          }
          aria-label={
            subView !== 'editor'
              ? t('tabbar.sidebarNotesOnly')
              : isSidebarCollapsed
              ? t('tabbar.sidebarShow')
              : t('tabbar.sidebarHide')
          }
        >
          {isSidebarCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubView('editor')}
          className={`chip-btn h-8 px-2 sm:px-3 text-xs font-medium border rounded-btn transition-colors flex items-center justify-center gap-1.5 cursor-pointer min-w-0 ${
            subView === 'editor'
              ? 'bg-panel border-accent text-main'
              : 'bg-canvas border-border text-muted hover:text-main'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-accent" />
          <span>{t('tabbar.notes')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSubView('todos');
            setMobileShowDetail(true);
          }}
          className={`chip-btn h-8 px-2 sm:px-3 text-xs font-medium border rounded-btn transition-colors flex items-center justify-center gap-1.5 cursor-pointer min-w-0 ${
            subView === 'todos'
              ? 'bg-panel border-accent text-main'
              : 'bg-canvas border-border text-muted hover:text-main'
          }`}
        >
          <Check className="w-3.5 h-3.5 text-status-ok" />
          <span className="inline-flex items-center">
            {t('tabbar.todos')}
            <CountBadge count={totalOpenTodos} position="text" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSubView('tags');
            setMobileShowDetail(true);
          }}
          className={`chip-btn h-8 px-2 sm:px-3 text-xs font-medium border rounded-btn transition-colors flex items-center justify-center gap-1.5 cursor-pointer min-w-0 ${
            subView === 'tags' || subView === 'tag_detail'
              ? 'bg-panel border-accent text-main'
              : 'bg-canvas border-border text-muted hover:text-main'
          }`}
        >
          <Hash className="w-3.5 h-3.5 text-accent" />
          <span className="inline-flex items-center">
            Hashtags
            <CountBadge count={tagsSummary.length} position="text" />
          </span>
        </button>
      </div>

      {/* Right Header Section: Live/Share Status, Avatars & Save Status (on phones it sits compactly in the note's own header) */}
      <div className="hidden sm:flex items-center gap-2">
        {(subView === 'editor' || subView === 'journal') && selectedDocId ? (
          <>
            {/* Fixed order: people first (they come and go without moving the buttons), status, actions */}
            {docHeaderStatus && (
              <PresenceAvatars
                people={docHeaderStatus.otherPeople}
                avatars={docHeaderStatus.avatarsById}
              />
            )}

            {/* Live connection pill */}
            {docHeaderStatus?.showLive && (
              <span
                className="inline-flex items-center gap-1 h-7 px-2 rounded-btn text-[11px] bg-panel text-muted"
                title={
                  docHeaderStatus.channel === 'ws'
                    ? t('tabbar.ws')
                    : docHeaderStatus.channel === 'sse'
                    ? t('tabbar.sse')
                    : docHeaderStatus.channel === 'longpoll'
                    ? t('tabbar.poll')
                    : t('tabbar.none')
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    docHeaderStatus.channel === 'interval' ? 'bg-status-warn' : 'bg-status-ok'
                  }`}
                />
                {docHeaderStatus.channel === 'longpoll'
                  ? t('tabbar.liveLongPoll')
                  : docHeaderStatus.channel === 'interval'
                  ? t('tabbar.interval')
                  : t('tabbar.live')}
              </span>
            )}

            {/* Share pill */}
            {selectedDocObj &&
              !selectedDocObj.isArchived &&
              (() => {
                const isOwner =
                  selectedDocObj.isOwner !== false &&
                  (selectedDocObj.userId === currentUser?.id ||
                    !selectedDocObj.userId ||
                    currentUser?.role === 'admin');
                const sharesCount = selectedDocObj.sharedWith?.length || 0;
                const isShared =
                  sharesCount > 0 || !isOwner || inSharedFolder;
                const ownerDisplayName = selectedDocObj.ownerName || t('tasks:tabs.owner');
                if (!isShared) return null;
                return (
                  <SharedPill
                    isOwner={isOwner}
                    count={sharesCount}
                    ownerName={ownerDisplayName}
                    onClick={() => openDocShareModal(selectedDocObj)}
                    title={isOwner ? t('tabbar.shareMenu') : t('tabbar.shareOpen')}
                  />
                );
              })()}

            {/* Save status: icon only, the text is the tooltip */}
            <div
              role="img"
              aria-label={
                docSaveStatus === 'saved'
                  ? t('tabbar.saved')
                  : docSaveStatus === 'saving'
                  ? t('editor.saving')
                  : docSaveStatus === 'unsaved'
                  ? t('tabbar.unsaved')
                  : t('editor.saveFailed')
              }
              className={`inline-flex items-center justify-center h-7 w-7 rounded-btn transition-colors ${
                docSaveStatus === 'saved'
                  ? 'bg-panel'
                  : docSaveStatus === 'saving'
                  ? 'bg-panel animate-pulse'
                  : docSaveStatus === 'unsaved'
                  ? 'bg-status-warn/10'
                  : 'bg-status-err/10'
              }`}
              title={
                docSaveStatus === 'saved'
                  ? t('tabbar.savedTitle')
                  : docSaveStatus === 'saving'
                  ? t('tabbar.savingTitle')
                  : docSaveStatus === 'unsaved'
                  ? t('tabbar.unsavedTitle')
                  : docSaveError || t('editor.saveFailed')
              }
            >
              {docSaveStatus === 'saved' && (
                <>
                  <Check className="w-3.5 h-3.5 text-status-ok" />
                </>
              )}
              {docSaveStatus === 'saving' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                </>
              )}
              {docSaveStatus === 'unsaved' && (
                <>
                  <Clock className="w-3.5 h-3.5 text-status-warn" />
                </>
              )}
              {docSaveStatus === 'error' && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-status-err" />
                </>
              )}
            </div>
          </>
        ) : null}
        {/* The open note renders undo/redo, share and its menu here on large screens */}
        {(subView === 'editor' || subView === 'journal') && selectedDocId && (
          <span className="hidden lg:block w-px h-5 bg-border mx-0.5" aria-hidden />
        )}
        <div ref={setDocActionsTarget} className="hidden lg:flex items-center" />
      </div>
    </div>
  );
}
