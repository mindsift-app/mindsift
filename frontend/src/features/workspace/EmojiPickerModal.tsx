import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { FaceSlightlySmilingPlus, Trash } from 'lucide-react';
import type { Categories, EmojiClickData, EmojiStyle, SuggestionMode, Theme } from 'emoji-picker-react';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import { isPhoneWidth } from '../../lib/breakpoints';
import { placeInViewport } from '../../lib/placeInViewport';
import { useDismiss } from '../../lib/useDismiss';
import { BottomSheet } from '../../components/BottomSheet';
import { LoadingState } from '../../components/Spinner';

// Size of the desktop popover (its classes use the same values through --pick-w / --pick-h)
const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 360;

// emoji-picker-react is a chunk of its own, loaded when the picker first opens. Only types may be imported
// from it statically: importing a value (such as its enums) would put the whole library into the app chunk.
const EmojiPicker = React.lazy(() => import('emoji-picker-react'));

// The value of one of the library's enums, written as its string: `${E}` is the union of the enum's values,
// so tsc fails here when an update of the library changes one
const pick = <E extends string>(value: `${E}`) => value as unknown as E;

// The library's own "recently used" category (stored by it) is the only recent list; a second bar
// would cost height on phones. Category names come from workspace:emoji.<key>.
const CATEGORIES = [
  { category: pick<Categories>('suggested'), key: 'suggested' },
  { category: pick<Categories>('smileys_people'), key: 'smileys' },
  { category: pick<Categories>('animals_nature'), key: 'animals' },
  { category: pick<Categories>('food_drink'), key: 'food' },
  { category: pick<Categories>('travel_places'), key: 'travel' },
  { category: pick<Categories>('activities'), key: 'activities' },
  { category: pick<Categories>('objects'), key: 'objects' },
  { category: pick<Categories>('symbols'), key: 'symbols' },
  { category: pick<Categories>('flags'), key: 'flags' },
];

interface EmojiPickerModalProps {
  currentIcon?: string;
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
  // Inside a dialog (which clips and transforms its content): the picker is put on the page instead and
  // opens below this button on desktop
  anchor?: DOMRect | null;
}

export const EmojiPickerModal: React.FC<EmojiPickerModalProps> = ({
  currentIcon,
  onSelectEmoji,
  onClose,
  anchor,
}) => {
  const { t } = useTranslation('workspace');
  const { visibleHeight } = useKeyboardInset();
  const isPhone = isPhoneWidth();
  // On phones the picker shrinks with the keyboard so search field and results stay visible (room for the
  // sheet's header and the row that removes the icon)
  const pickerHeight = isPhone ? Math.max(200, Math.min(350, visibleHeight - (currentIcon ? 170 : 120))) : 300;
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  );

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Desktop: a popover; a click beside it or Escape closes only the picker, not a dialog it was opened from
  // (lib/useDismiss.ts). Phones: a BottomSheet, which closes the same way.
  useDismiss(containerRef, onClose, { active: !isPhone });

  const handlePickerEmojiClick = (emojiData: EmojiClickData) => {
    onSelectEmoji(emojiData.emoji);
  };

  const catalog = (
    // The library takes every Escape inside it (it only empties its search): there Escape closes the picker
    // before the library sees it, as it does elsewhere
    <div
      className="flex-1 min-h-0 overflow-hidden rounded-sm mindsift-emoji-picker"
      onKeyDownCapture={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <Suspense
        fallback={
          // As high as the picker, so nothing moves when it arrives
          <div className="flex items-center justify-center" style={{ height: pickerHeight }}>
            <LoadingState label={t('emojiPicker.loading')} />
          </div>
        }
      >
        <EmojiPicker
          onEmojiClick={handlePickerEmojiClick}
          autoFocusSearch={true}
          theme={pick<Theme>(isDark ? 'dark' : 'light')}
          emojiStyle={pick<EmojiStyle>('native')}
          suggestedEmojisMode={pick<SuggestionMode>('recent')}
          searchPlaceholder={t('emojiPicker.search')}
          searchPlaceHolder={t('emojiPicker.search')}
          width="100%"
          height={`${pickerHeight}px`}
          categories={CATEGORIES.map((c) => ({ category: c.category, name: t(`emoji.${c.key}`) }))}
          previewConfig={{
            showPreview: false,
          }}
          skinTonesDisabled={false}
          lazyLoadEmojis={true}
        />
      </Suspense>
    </div>
  );

  // Removing the icon (none at all): a quiet last row, like an entry of a context menu
  const removeRow = currentIcon && (
    <button
      type="button"
      onClick={() => onSelectEmoji('')}
      className="flex items-center gap-1.5 w-full h-11 sm:h-7 px-2 mt-1 rounded-btn text-sm sm:text-xs text-muted hover:text-status-err hover:bg-panel-hover transition-colors cursor-pointer"
    >
      <Trash className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
      {t('emojiPicker.remove')}
    </button>
  );

  // Theme colours for the picker (index.css); desktop: its own raised surface, so it stands apart from the
  // dialog it opens from
  const surface = {
    '--pick-surface': isPhone ? 'var(--bg-panel)' : 'var(--bg-panel-elevated)',
    '--pick-hover': isPhone ? 'var(--bg-panel-elevated)' : 'var(--bg-panel-hover)',
  } as React.CSSProperties;

  if (isPhone) {
    // On the page, not in the header or dialog it opens from (a transformed parent would carry the fixed
    // sheet along); above a dialog it opens from
    return createPortal(
      <BottomSheet
        onClose={onClose}
        title={t('emojiPicker.title')}
        icon={currentIcon ? <span className="text-base leading-none">{currentIcon}</span> : <FaceSlightlySmilingPlus className="w-4 h-4" />}
        dockToKeyboard
        overlayClassName={anchor ? 'z-60!' : ''}
        className="px-3 pt-6 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col"
        style={surface}
      >
        {catalog}
        {removeRow}
      </BottomSheet>,
      document.body
    );
  }

  const placed = anchor ? placeInViewport(anchor, { width: PICKER_WIDTH, height: PICKER_HEIGHT }, { gap: 4 }) : null;
  const anchorStyle = placed
    ? ({ '--pick-left': `${placed.left}px`, '--pick-top': `${placed.top}px` } as React.CSSProperties)
    : undefined;

  const popover = (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={t('emojiPicker.title')}
      className={`w-(--pick-w) max-h-(--pick-h) p-1 flex flex-col bg-panel-elevated rounded-card border border-border shadow-xl ${
        anchor ? 'fixed z-61 left-(--pick-left) top-(--pick-top)' : 'absolute left-0 top-full mt-1 z-40'
      }`}
      style={{ ...anchorStyle, ...surface, '--pick-w': `${PICKER_WIDTH}px`, '--pick-h': `${PICKER_HEIGHT}px` } as React.CSSProperties}
    >
      {catalog}
      {removeRow}
    </div>
  );
  // Inside a dialog (which clips and transforms its content) it is put on the page instead
  return anchor ? createPortal(popover, document.body) : popover;
};
