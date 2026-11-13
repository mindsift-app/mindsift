import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, Trash, LoaderCircle } from 'lucide-react';
import type { Categories, EmojiClickData, EmojiStyle, SuggestionMode, Theme } from 'emoji-picker-react';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import { isPhoneWidth } from '../../lib/breakpoints';

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
  const { inset, visibleHeight } = useKeyboardInset();
  const isPhone = isPhoneWidth();
  // On phones the picker shrinks with the keyboard so search field and results stay visible
  const pickerHeight = isPhone ? Math.max(200, Math.min(350, visibleHeight - 110)) : 300;
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

  // Close on Escape or click outside (desktop popover)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // only the picker closes, not the dialog it was opened from
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handlePick = (emoji: string) => {
    onSelectEmoji(emoji);
  };

  const handlePickerEmojiClick = (emojiData: EmojiClickData) => {
    handlePick(emojiData.emoji);
  };

  const anchorStyle = anchor
    ? ({
        '--pick-left': `${Math.max(12, Math.min(anchor.left, window.innerWidth - 312))}px`,
        '--pick-top': `${Math.min(anchor.bottom + 4, window.innerHeight - 360)}px`,
      } as React.CSSProperties)
    : undefined;

  const picker = (
    <>
      {/* Mobile Backdrop (below sm) */}
      <div
        className={`fixed inset-0 bg-black/60 sm:hidden backdrop-blur-xs ${anchor ? 'z-[60]' : 'z-40'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Main Container: Mobile Bottom-Sheet (below sm) & Desktop Popover (from sm) */}
      <div
        ref={containerRef}
        className={`
          fixed inset-x-0 bottom-[var(--kb-inset)] rounded-t-2xl max-h-[var(--vv-max)] bg-panel border-t border-border shadow-2xl flex flex-col p-3 space-y-3
          sm:inset-auto sm:w-[300px] sm:max-h-[360px] sm:p-1 sm:space-y-0 sm:bg-panel-elevated sm:rounded-card sm:border sm:border-border sm:shadow-xl ${
            anchor
              ? 'z-[61] sm:fixed sm:left-[var(--pick-left)] sm:top-[max(12px,var(--pick-top))]'
              : 'z-50 sm:absolute sm:left-0 sm:top-full sm:mt-1 sm:z-40'
          }
        `}
        style={
          {
            ...anchorStyle,
            // Theme colours for the picker (index.css); desktop: its own raised surface, so it stands apart
            // from the dialog it opens from
            '--pick-surface': isPhone ? 'var(--bg-panel)' : 'var(--bg-panel-elevated)',
            '--pick-hover': isPhone ? 'var(--bg-panel-elevated)' : 'var(--bg-panel-hover)',
            '--kb-inset': `${inset}px`,
            '--vv-max': `${Math.round(visibleHeight * 0.9)}px`,
          } as React.CSSProperties
        }
      >
        {/* Mobile handle indicator */}
        <div className="w-10 h-1 bg-border rounded-full mx-auto sm:hidden shrink-0" />

        {/* Top Header: Title, Actions & Close (phone only; on desktop a click outside closes it) */}
        <div className="flex sm:hidden items-center justify-between gap-2 shrink-0 border-b border-border pb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-main">
            <span>{t('emojiPicker.title')}</span>
            {currentIcon && (
              <span className="text-base leading-none ml-1">{currentIcon}</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {currentIcon && (
              <button
                type="button"
                onClick={() => onSelectEmoji('')}
                className="h-11 sm:h-7 px-3 sm:px-2 rounded text-xs font-medium text-status-err hover:bg-status-err/10 flex items-center gap-1 transition-colors cursor-pointer"
                title={t('emojiPicker.remove')}
              >
                <Trash className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('emojiPicker.removeShort')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 sm:w-7 sm:h-7 rounded flex items-center justify-center text-muted hover:text-main hover:bg-panel-elevated transition-colors cursor-pointer"
              title={t('close')}
              aria-label={t('close')}
            >
              <X className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        </div>

        {/* Full Emoji Catalog via emoji-picker-react */}
        <div className="flex-1 min-h-0 overflow-hidden rounded mindsift-emoji-picker">
          <Suspense
            fallback={
              // As high as the picker, so nothing moves when it arrives
              <div
                className="flex flex-col items-center justify-center gap-2 text-xs text-muted"
                style={{ height: pickerHeight }}
              >
                <LoaderCircle className="w-5 h-5 animate-spin text-accent" />
                <span>{t('emojiPicker.loading')}</span>
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

        {/* Desktop: removing the icon (none at all) as a quiet last row, like an entry of a context menu */}
        {currentIcon && (
          <button
            type="button"
            onClick={() => onSelectEmoji('')}
            className="hidden sm:flex items-center gap-1.5 w-full h-7 px-2 mt-1 rounded-btn text-xs text-muted hover:text-status-err hover:bg-panel-hover transition-colors cursor-pointer"
          >
            <Trash className="w-3.5 h-3.5" />
            {t('emojiPicker.remove')}
          </button>
        )}
      </div>
    </>
  );
  return anchor ? createPortal(picker, document.body) : picker;
};
