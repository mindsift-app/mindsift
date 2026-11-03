import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease } from 'lucide-react';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import { useTranslation } from 'react-i18next';

// Phones and tablets have no Tab key: while a bullet is being edited, a slim bar sits right above the
// on-screen keyboard (only while it is open) with outdent / indent and move up / down (the bullet takes its children along).
export const isTouchOnly =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches &&
  !window.matchMedia?.('(any-pointer: fine)').matches;

interface MobileOutlineBarProps {
  onOutdent: () => void;
  onIndent: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export const MobileOutlineBar: React.FC<MobileOutlineBarProps> = ({ onOutdent, onIndent, onMoveUp, onMoveDown }) => {
  const { t } = useTranslation('workspace');
  // iOS keeps fixed elements behind the keyboard: lift the bar by the keyboard's height
  const { inset, keyboardOpen } = useKeyboardInset();

  const button = (label: string, icon: React.ReactNode, action: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keep the focus (and the keyboard) in the bullet: no focus change on press, act on click
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
      className="h-10 flex-1 max-w-[4.5rem] flex items-center justify-center rounded-btn border border-border bg-canvas text-main active:bg-panel-elevated touch-manipulation"
    >
      {icon}
    </button>
  );

  // Keyboard closed (e.g. back button) while the bullet keeps its focus: no bar over the bottom navigation
  if (!keyboardOpen) return null;

  return createPortal(
    <div
      className="fixed left-0 right-0 z-[70] flex items-center justify-center gap-2 px-3 py-1.5 bg-panel/95 backdrop-blur-md border-t border-border"
      style={{ bottom: inset }}
      role="toolbar"
      aria-label={t('outlineBar.label')}
    >
      {button(t('outlineBar.outdent'), <IndentDecrease className="w-5 h-5" />, onOutdent)}
      {button(t('outlineBar.indent'), <IndentIncrease className="w-5 h-5" />, onIndent)}
      <span className="w-px h-6 bg-border mx-1" aria-hidden />
      {button(t('outlineBar.up'), <ArrowUp className="w-5 h-5" />, onMoveUp)}
      {button(t('outlineBar.down'), <ArrowDown className="w-5 h-5" />, onMoveDown)}
    </div>,
    document.body
  );
};
