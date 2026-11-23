import React, { useRef } from 'react';

type EditField = HTMLInputElement | HTMLTextAreaElement;

interface InlineEditOptions {
  /** Enter, and leaving the field unless `saveOnBlur` is false */
  onSave: () => void;
  /** Escape */
  onCancel: () => void;
  /** Leaving the field saves (default); false where the field has its own save and cancel buttons */
  saveOnBlur?: boolean;
}

/**
 * Editing right in place (Doku/ui-patterns.md, "Editing in Place"): Enter saves (in a text area Shift+Enter
 * makes a new line), Escape cancels, leaving the field saves. Escape is taken (preventDefault), so the
 * dialog or sheet around the field stays open (lib/useDismiss.ts). Each edit ends once: the blur that follows
 * Enter or Escape does not save again. The caller keeps the text; the handlers go on the field.
 */
export function useInlineEdit<T extends EditField = HTMLInputElement>({ onSave, onCancel, saveOnBlur = true }: InlineEditOptions) {
  const ended = useRef(false);
  const end = (save: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (save) onSave();
    else onCancel();
  };
  return {
    // A new edit starts when the field gets the focus (again)
    onFocus: () => {
      ended.current = false;
    },
    onKeyDown: (e: React.KeyboardEvent<T>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter' && !(e.shiftKey && e.currentTarget instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        end(true);
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        end(false);
        e.currentTarget.blur();
      }
    },
    onBlur: () => {
      if (saveOnBlur) end(true);
    },
  };
}
