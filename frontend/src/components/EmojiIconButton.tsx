import React, { useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { EmojiPickerModal } from '../features/workspace/EmojiPickerModal';

interface EmojiIconButtonProps {
  value: string;
  // "" = no icon (removed in the picker)
  onChange: (emoji: string) => void;
}

// Icon field of the create dialogs (note, task list, list): the emoji as a button that opens the same
// picker as the icon of an open note, removing included (Doku/ui-patterns.md).
export const EmojiIconButton: React.FC<EmojiIconButtonProps> = ({ value, onChange }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setAnchor((cur) => (cur ? null : buttonRef.current?.getBoundingClientRect() ?? null))}
        title={value ? 'Icon ändern' : 'Icon wählen'}
        aria-label={value ? 'Icon ändern' : 'Icon wählen'}
        className="w-12 sm:w-10 h-11 sm:h-8 flex-shrink-0 flex items-center justify-center input-field text-lg sm:text-base leading-none cursor-pointer hover:border-strong"
      >
        {value || <SmilePlus className="w-4 h-4 text-faint" strokeWidth={1.75} />}
      </button>
      {anchor && (
        <EmojiPickerModal
          currentIcon={value}
          anchor={anchor}
          onSelectEmoji={(emoji) => {
            onChange(emoji);
            setAnchor(null);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
};
