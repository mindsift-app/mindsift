import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface IndentArrowsProps {
  onIndent?: () => void;
  onOutdent?: () => void;
  canIndent?: boolean;
  canOutdent?: boolean;
  /** Someone else holds the bullet: both arrows stay in place, greyed out, so nothing next to them moves */
  locked?: boolean;
  /** Look of each button; the disabled state (greyed, no hover) is added here */
  buttonClassName: string;
  iconClassName?: string;
}

/**
 * Outdent / indent arrows for bullets the cursor cannot get into to press Tab (code block, image, drawing).
 * Pressing them keeps the focus where it is; clicks do not reach the bullet or the block below them.
 */
export const IndentArrows: React.FC<IndentArrowsProps> = ({
  onIndent,
  onOutdent,
  canIndent = false,
  canOutdent = false,
  locked = false,
  buttonClassName,
  iconClassName = 'w-3.5 h-3.5',
}) => {
  const { t } = useTranslation('workspace');
  const button = (label: string, icon: React.ReactNode, onClick: (() => void) | undefined, possible: boolean) => {
    const enabled = possible && !locked && !!onClick;
    return (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (enabled) onClick?.();
        }}
        disabled={!enabled}
        title={label}
        aria-label={label}
        className={`${buttonClassName} cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:text-faint disabled:hover:border-transparent`}
      >
        {icon}
      </button>
    );
  };
  return (
    <>
      {button(t('outlineBar.outdent'), <ChevronLeft className={iconClassName} />, onOutdent, canOutdent)}
      {button(t('outlineBar.indent'), <ChevronRight className={iconClassName} />, onIndent, canIndent)}
    </>
  );
};

/**
 * Class of the arrows' box over an image or a drawing, at the top left. Discreet like the code block's: no
 * box of its own, each arrow a small half-transparent outlined button that still shows on light and dark
 * pictures. Hidden until the pointer is over the block (only on devices that can hover) or the block is
 * active (tapped, caption in focus); hidden it takes no taps.
 */
export const overlayArrowsClass = (shown: boolean, group: 'image' | 'drawing', belowBadge = false) =>
  `absolute ${belowBadge ? 'top-9' : 'top-1.5'} left-1.5 z-10 flex items-center gap-0.5 transition-opacity ${
    shown
      ? 'opacity-100'
      : `opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto ${
          group === 'image'
            ? '[@media(hover:hover)]:group-hover/image:opacity-100 [@media(hover:hover)]:group-hover/image:pointer-events-auto'
            : '[@media(hover:hover)]:group-hover/drawing:opacity-100 [@media(hover:hover)]:group-hover/drawing:pointer-events-auto'
        }`
  }`;

/** Buttons in that box: below 44 px on phones too (an image can be a thin banner); from sm as small as the code block's */
export const OVERLAY_ARROW_BUTTON =
  'w-7 h-7 sm:w-5 sm:h-5 flex items-center justify-center rounded-btn border border-border/70 bg-panel/40 backdrop-blur-xs text-muted opacity-70 hover:opacity-100 hover:text-main hover:bg-panel/80 transition';
