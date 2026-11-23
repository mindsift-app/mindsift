import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { BottomSheet } from './BottomSheet';

interface FormSheetProps {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode; // the fields
  submitLabel?: string; // default: "Erstellen" in the person's language
  danger?: boolean; // red submit button for destructive actions
  busy?: boolean;
  // Desktop only: open next to the click instead of centred
  anchor?: { x: number; y: number } | null;
  // Next to the click 20rem wide instead of 16.5rem (fields with long entries, e.g. template names)
  wide?: boolean;
}

// Small create/rename dialogs on BottomSheet. Phone: sheet directly above the keyboard, full width, large
// fields. Desktop: centred dialog (or next to the click). Escape and the backdrop close it.
export const FormSheet: React.FC<FormSheetProps> = ({
  title,
  icon,
  onClose,
  onSubmit,
  children,
  submitLabel,
  anchor,
  wide = false,
  danger = false,
  busy = false,
}) => {
  const { t } = useTranslation();
  const { inset } = useKeyboardInset();

  const desktopAnchor = anchor
    ? ({
        '--sheet-left': `${anchor.x}px`,
        '--sheet-top': `${anchor.y}px`,
        '--sheet-x': wide
          ? `clamp(12px, calc(${anchor.x}px - 10rem), calc(100vw - 20rem - 12px))`
          : `clamp(12px, calc(${anchor.x}px - 8.25rem), calc(100vw - 16.5rem - 12px))`,
        '--sheet-y': `calc(${anchor.y}px + 8px)`,
      } as React.CSSProperties)
    : undefined;

  return (
    <BottomSheet
      onClose={onClose}
      onSubmit={onSubmit}
      label={title}
      dockToKeyboard
      style={desktopAnchor}
      className="px-4 pt-6 pb-4 space-y-3"
      desktopClassName={`sm:pt-4 sm:inset-x-auto sm:bottom-auto sm:max-h-[85vh] sm:w-full sm:rounded-card sm:border ${
        anchor
          ? `${wide ? 'sm:max-w-80' : 'sm:max-w-66'} sm:left-(--sheet-x) sm:top-(--sheet-y)`
          : 'sm:max-w-sm sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2'
      }`}
    >
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
          {submitLabel ?? t('common:create')}
        </button>
      </div>
      {/* keeps the buttons clear of the home indicator when no keyboard is open */}
      <div className="sm:hidden" style={{ height: inset ? 0 : 'env(safe-area-inset-bottom, 0px)' }} />
    </BottomSheet>
  );
};
