import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { guardLeave } from '../lib/leaveGuard';
import { isPhoneWidth } from '../lib/breakpoints';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { useScrollLock } from '../lib/useScrollLock';
import { useCloseOnEscape } from '../lib/useDismiss';

// Padding of a sheet's panel: room for the home indicator below the last row
const SHEET_PADDING = 'px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]';
// The same docked to an open keyboard, which already covers the home indicator
const SHEET_PADDING_ON_KEYBOARD = 'px-4 pt-6 pb-4';

interface BottomSheetProps {
  /** Closes the sheet: the backdrop, Escape and the X of the header (when `title` is given). */
  onClose: () => void;
  /**
   * Closing asks first while a dictation or recording would be lost (lib/leaveGuard.ts): true for any that
   * holds leaving, `{ held }` for the sheet's own. Children get the guarded close as their argument, for
   * their own "Abbrechen".
   */
  guard?: boolean | { held: boolean };
  /** Standard header: icon in an accent box, title and an X (44 px); without it the children bring their own. */
  title?: React.ReactNode;
  icon?: React.ReactNode;
  /** Name for screen readers when there is no `title` text. */
  label?: string;
  /** Only on phones: the sheet is hidden from sm on (and does not lock the page or take Escape there). */
  phoneOnly?: boolean;
  /** From sm on a dialog instead (classes for its look and place, e.g. centred with a width). */
  desktopClassName?: string;
  /** Sits right above the on-screen keyboard (lib/useKeyboardInset.ts), for sheets with text fields. */
  dockToKeyboard?: boolean;
  /**
   * Padding and layout of the panel; default: 1 rem, more on top for the grip and at the bottom for the home
   * indicator (not while docked to an open keyboard).
   */
  className?: string;
  /** Extra classes and style of the backdrop (e.g. a higher z-index). */
  overlayClassName?: string;
  style?: React.CSSProperties;
  /** The panel element (e.g. to measure it) */
  panelRef?: React.Ref<HTMLElement>;
  /** The panel as a form (FormSheet). */
  onSubmit?: (e: React.FormEvent) => void;
  /** An open menu inside takes Escape first by preventing its default; set false where Escape must not close. */
  closeOnEscape?: boolean;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}

/**
 * Sheet from the bottom of the screen (Doku/ui-patterns.md, "Bottom Sheet"): the page behind is dimmed with
 * the theme's overlay and does not scroll, a grip on top, the panel slides in. The backdrop and Escape close
 * it, through the leave guard if one is set. Square at the bottom with only a top border, so it docks to the
 * keyboard or the screen edge even with a rounded theme.
 */
export function BottomSheet({
  onClose,
  guard,
  title,
  icon,
  label,
  phoneOnly = false,
  desktopClassName,
  dockToKeyboard = false,
  className,
  overlayClassName = '',
  style,
  panelRef,
  onSubmit,
  closeOnEscape = true,
  children,
}: BottomSheetProps) {
  const { t } = useTranslation();
  const { inset, visibleHeight } = useKeyboardInset();
  const close = () => {
    if (guard === undefined || guard === false) onClose();
    else guardLeave(onClose, guard === true ? { close: true } : { close: true, held: guard.held });
  };
  // A phone-only sheet left open while the window is wide is not visible: it must not hold the page or Escape
  const active = !phoneOnly || isPhoneWidth();
  useScrollLock(active);
  // The top layer of lib/useDismiss.ts: a menu or popover opened inside closes first, a field that takes
  // Escape (prevents its default) keeps the sheet open
  useCloseOnEscape(close, { active: closeOnEscape && active, when: () => !phoneOnly || isPhoneWidth() });

  const padding = className ?? (dockToKeyboard && inset > 0 ? SHEET_PADDING_ON_KEYBOARD : SHEET_PADDING);
  const Panel = onSubmit ? 'form' : 'div';
  const docked = dockToKeyboard
    ? ({ '--kb-inset': `${inset}px`, '--vv-max': visibleHeight ? `${visibleHeight - 16}px` : '85vh' } as React.CSSProperties)
    : undefined;

  return (
    <div className={`${phoneOnly ? 'sm:hidden ' : ''}fixed inset-0 m-0! z-50 modal-overlay animate-in fade-in duration-150 ${overlayClassName}`} onClick={close}>
      <Panel
        ref={panelRef as React.Ref<HTMLFormElement & HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        onSubmit={onSubmit}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{ ...style, ...docked }}
        className={`fixed inset-x-0 ${dockToKeyboard ? 'bottom-(--kb-inset) max-h-(--vv-max)' : 'bottom-0 max-h-[85vh]'} overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel animate-in slide-in-from-bottom duration-200 ${padding} ${desktopClassName ? `sm:slide-in-from-bottom-2 ${desktopClassName}` : ''}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-border mb-3">
            <h3 className="text-sm font-semibold text-main flex items-center gap-2 min-w-0">
              {icon && <span className="w-7 h-7 rounded-btn bg-accent/15 text-accent flex items-center justify-center shrink-0">{icon}</span>}
              <span className="truncate">{title}</span>
            </h3>
            <button
              type="button"
              onClick={close}
              aria-label={t('close')}
              title={t('close')}
              className="-mr-2 w-11 h-11 sm:w-8 sm:h-8 sm:mr-0 flex items-center justify-center text-faint hover:text-main rounded-btn transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        {typeof children === 'function' ? children(close) : children}
        {/* Last and out of the flow, so the panel's own spacing (space-y-*) still starts with the first row */}
        <div className={`absolute m-0! top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-border rounded-full ${desktopClassName ? 'sm:hidden' : ''}`} aria-hidden="true" />
      </Panel>
    </div>
  );
}
