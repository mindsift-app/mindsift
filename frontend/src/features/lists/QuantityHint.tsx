import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ItemQuantity, parseItemQuantity } from './itemQuantity';

// Quantities typed into a new list item (itemQuantity.ts): the item field marks the part and the quantity
// field shows it; emptying the quantity field keeps the text as typed. Applied on saving.

/**
 * The quantity recognised in text, unless off (a quantity typed into its own field wins) or dismissed by
 * emptying the quantity field. Dismissing holds for that part of the text; another one is shown again.
 */
export function useItemQuantity(text: string, enabled: boolean) {
  const { i18n } = useTranslation();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const parsed = useMemo(() => (enabled ? parseItemQuantity(text, i18n.language) : null), [text, enabled, i18n.language]);
  const phrase = parsed ? text.slice(parsed.start, parsed.end) : null;
  const active: ItemQuantity | null = parsed && phrase !== dismissed ? parsed : null;
  return {
    parsed: active,
    dismiss: () => setDismissed(phrase),
    // After saving: the next item starts without a dismissed part
    reset: () => setDismissed(null),
  };
}
