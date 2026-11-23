import React, { useState } from 'react';
import { useInlineEdit } from '../lib/useInlineEdit';

interface InlineEditInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onKeyDown' | 'onBlur' | 'onFocus'> {
  /** The saved text; the field shows it until something is typed */
  value: string;
  /** Enter or leaving the field after typing, with the typed text */
  onSave: (value: string) => void;
  /** Escape, or Enter and leaving without having typed anything */
  onCancel?: () => void;
}

/**
 * A text field edited in place (Doku/ui-patterns.md, "Editing in Place"): Enter or leaving it saves, Escape
 * goes back to the saved text. For fields that keep their own text or have buttons, `useInlineEdit` alone.
 */
export function InlineEditInput({ value, onSave, onCancel, ...props }: InlineEditInputProps) {
  // null: nothing typed since the last save or cancel, the field shows `value`
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useInlineEdit({
    onSave: () => {
      setDraft(null);
      if (draft === null) onCancel?.();
      else onSave(draft);
    },
    onCancel: () => {
      setDraft(null);
      onCancel?.();
    },
  });
  return <input type="text" {...props} value={draft ?? value} onChange={(e) => setDraft(e.target.value)} {...edit} />;
}
