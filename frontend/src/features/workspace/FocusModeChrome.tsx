import React from 'react';
import { FolderOpen, Minimize2, Pin, PinOff } from 'lucide-react';
import { Document } from '../../lib/types';
import { useTranslation } from 'react-i18next';

type ZenSidebar = 'closed' | 'click' | 'hover';

interface FocusModeChromeProps {
  selectedDocObj: Document | null | undefined;
  zenSidebar: ZenSidebar;
  setZenSidebar: React.Dispatch<React.SetStateAction<ZenSidebar>>;
  zenSideOpen: boolean;
  zenPinTop: boolean;
  setZenPinTop: React.Dispatch<React.SetStateAction<boolean>>;
  zenPinSide: boolean;
  setZenPinSide: (pinned: boolean) => void;
  setZenActionsTarget: (el: HTMLDivElement | null) => void;
  setFocusMode: (on: boolean) => void;
}

// What focus mode adds around the note: the header that slides in at the top edge (note title, its actions,
// pin, leave), the left edge that opens the sidebar, the backdrop of the opened sidebar and the phone's
// leave button
export function FocusModeChrome({
  selectedDocObj,
  zenSidebar,
  setZenSidebar,
  zenSideOpen,
  zenPinTop,
  setZenPinTop,
  zenPinSide,
  setZenPinSide,
  setZenActionsTarget,
  setFocusMode,
}: FocusModeChromeProps) {
  const { t } = useTranslation('workspace');
  return (
    <>
      {/* Header slides in when the mouse touches the top edge (large screens); pinned, it stays */}
      {/* A pinned sidebar takes the full height unless the header is pinned too: the header starts beside it */}
      <div
        className={`hidden lg:block fixed top-0 right-0 h-3 z-[46] group ${
          zenPinSide && !zenPinTop ? 'left-80' : 'left-0'
        }`}
      >
        <div
          className={`absolute top-0 inset-x-0 flex items-center gap-2 px-6 py-2 bg-panel/95 backdrop-blur-sm border-b border-border shadow-sm transition-transform duration-200 ${
            zenPinTop ? 'translate-y-0' : '-translate-y-full group-hover:translate-y-0 group-focus-within:translate-y-0'
          }`}
        >
          <button
            type="button"
            onClick={() =>
              zenPinSide ? setZenPinSide(false) : setZenSidebar((v) => (v === 'closed' ? 'click' : 'closed'))
            }
            className="btn-icon h-7 w-7 shrink-0"
            title={zenSideOpen ? t('focus.hideSide') : t('focus.showSide')}
            aria-label={zenSideOpen ? t('focus.hideSide') : t('focus.showSide')}
            aria-expanded={zenSideOpen}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZenSidebar((v) => (v === 'closed' ? 'click' : 'closed'))}
            className="flex-1 min-w-0 truncate text-left text-xs font-medium text-main hover:text-accent cursor-pointer"
            title={t('focus.otherNote')}
          >
            {[selectedDocObj?.icon, selectedDocObj?.title].filter(Boolean).join(' ')}
          </button>
          <div ref={setZenActionsTarget} className="flex items-center" />
          <button
            type="button"
            onClick={(e) => {
              // Unpinned, the header slides away once the mouse leaves (focus would keep it open)
              if (zenPinTop) e.currentTarget.blur();
              setZenPinTop((v) => !v);
            }}
            className={`btn-icon h-7 w-7 shrink-0 ${zenPinTop ? 'text-accent' : ''}`}
            title={zenPinTop ? t('focus.unpinBar') : t('focus.pinBar')}
            aria-label={zenPinTop ? t('focus.unpinBar') : t('focus.pinBar')}
            aria-pressed={zenPinTop}
          >
            {zenPinTop ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setFocusMode(false)}
            className="btn-action h-7 px-2.5 text-xs inline-flex items-center gap-1.5"
            title={t('focus.exitEsc')}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            {t('workspace:focus.exit')}
          </button>
        </div>
      </div>
      {/* Wide screens: touching the left edge opens the sidebar (the note sits far from it) */}
      <div
        className={`${zenPinSide ? 'hidden' : 'hidden xl:block'} fixed left-0 inset-y-0 w-2 z-[46]`}
        onMouseEnter={() => setZenSidebar((v) => (v === 'closed' ? 'hover' : v))}
        aria-hidden
      />
      {zenSidebar === 'click' && !zenPinSide && (
        <div className="fixed inset-0 z-[46] bg-overlay/30" onClick={() => setZenSidebar('closed')} aria-hidden />
      )}
      <button
        type="button"
        onClick={() => setFocusMode(false)}
        className="lg:hidden fixed bottom-4 right-4 z-[46] h-12 w-12 rounded-full bg-panel border border-border shadow-panel flex items-center justify-center text-main"
        title={t('editor.exitFocusTitle')}
        aria-label={t('editor.exitFocusTitle')}
      >
        <Minimize2 className="w-4 h-4" />
      </button>
    </>
  );
}
