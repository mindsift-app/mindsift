import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scale, X } from 'lucide-react';
import { ItemQuantity, parseItemQuantity } from './itemQuantity';

// Quantities typed into a new list item (itemQuantity.ts), shown like the due dates of the capture bar
// (components/NaturalDateHint.tsx): the field marks the part, a chip shows the quantity with an × to keep
// the text as typed. Only what the chip shows is applied on saving.

/**
 * The quantity recognised in text, unless off (a quantity typed into its own field wins) or dismissed with
 * the ×. Dismissing holds for that part of the text; another one shows a chip again.
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

interface QuantityChipProps {
  quantity: string;
  onDismiss: () => void;
  className?: string;
}

/** "2x ×": the recognised quantity; × keeps the text as typed and sets no quantity. */
export function QuantityChip({ quantity, onDismiss, className = '' }: QuantityChipProps) {
  const { t } = useTranslation('lists');
  return (
    <span
      data-testid="quantity-chip"
      title={t('quantityHint.recognized', { quantity })}
      className={`inline-flex items-center gap-1 h-6 pl-2 pr-0.5 rounded-full bg-accent-dim text-accent border border-accent-border text-[11px] font-medium whitespace-nowrap shrink-0 animate-in fade-in duration-150 ${className}`}
    >
      <Scale className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span aria-label={t('quantityHint.recognized', { quantity })}>{quantity}</span>
      {/* The hit area grows to 44 px on phones without making the chip bigger */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
        aria-label={t('quantityHint.ignore')}
        title={t('quantityHint.ignore')}
        className="relative w-5 h-5 rounded-full flex items-center justify-center hover:bg-accent/15 cursor-pointer after:absolute after:-inset-3 sm:after:inset-0"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
