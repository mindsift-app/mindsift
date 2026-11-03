import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useKeyboardInset } from '../lib/useKeyboardInset';

interface FormSheetProps {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode; // the fields
  submitLabel?: string;
  danger?: boolean; // red submit button for destructive actions
  busy?: boolean;
  // Desktop only: open next to the click instead of centred
  anchor?: { x: number; y: number } | null;
}

// Small create/rename dialogs. Phone: bottom sheet directly above the keyboard, full width, large
// fields, square at the bottom with only a top border (like the other sheets: it docks to the keyboard
// even with a rounded theme, whose panel-surface would round all corners). Desktop: centred dialog (or next to the click). Escape and the backdrop close it.
export const FormSheet: React.FC<FormSheetProps> = ({
  title,
  icon,
  onClose,
  onSubmit,
  children,
  submitLabel = 'Erstellen',
  anchor,
  danger = false,
  busy = false,
}) => {
  const { t } = useTranslation();
  const { inset, visibleHeight } = useKeyboardInset();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const desktopAnchor = anchor
    ? ({
        '--sheet-left': `${anchor.x}px`,
        '--sheet-top': `${anchor.y}px`,
        '--sheet-x': `clamp(12px, calc(${anchor.x}px - 8.25rem), calc(100vw - 16.5rem - 12px))`,
        '--sheet-y': `calc(${anchor.y}px + 8px)`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="fixed inset-0 !m-0 z-50 modal-overlay" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        style={
          {
            ...desktopAnchor,
            '--kb-inset': `${inset}px`,
            '--vv-max': visibleHeight ? `${visibleHeight - 16}px` : '85vh',
          } as React.CSSProperties
        }
        className={`fixed inset-x-0 bottom-[var(--kb-inset)] max-h-[var(--vv-max)] panel-surface rounded-t-2xl rounded-b-none border-x-0 border-b-0 border-t border-border shadow-panel p-4 space-y-3 overflow-y-auto
          sm:inset-x-auto sm:bottom-auto sm:max-h-[85vh] sm:w-full sm:rounded-card sm:border ${
            anchor
              ? 'sm:max-w-[16.5rem] sm:left-[var(--sheet-x)] sm:top-[var(--sheet-y)]'
              : 'sm:max-w-sm sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2'
          }`}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-main flex items-center gap-1.5 min-w-0">
            {icon}
            <span className="truncate">{title}</span>
          </h3>
          <button type="button" onClick={onClose} className="w-11 h-11 sm:w-7 sm:h-7 -mr-2 sm:mr-0 flex items-center justify-center text-muted hover:text-main" title={t('close')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
        <div className="flex gap-2 pt-1 sm:justify-end">
          <button type="button" onClick={onClose} className="btn-action flex-1 sm:flex-none h-11 sm:h-8 px-3 text-sm sm:text-xs">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`${danger ? 'btn-danger' : 'btn-primary'} flex-1 sm:flex-none h-11 sm:h-8 px-4 text-sm sm:text-xs font-semibold disabled:opacity-50`}
          >
            {submitLabel}
          </button>
        </div>
        {/* keeps the buttons clear of the home indicator when no keyboard is open */}
        <div className="sm:hidden" style={{ height: inset ? 0 : 'env(safe-area-inset-bottom, 0px)' }} />
      </form>
    </div>
  );
};
