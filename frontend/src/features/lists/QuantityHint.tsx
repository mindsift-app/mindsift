import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { ItemQuantity, parseItemQuantity } from './itemQuantity';
import { useTypedRecognition } from '../../lib/typedRecognition';

// Quantities typed into a new list item (itemQuantity.ts): the item field marks the part and the quantity
// field shows it, with a small bubble pointing at it; its × or emptying the field keeps the text as typed.
// Applied on saving.

/**
 * The quantity recognised in text, unless off (a quantity typed into its own field wins) or dismissed (the
 * bubble's × or emptying the quantity field). Dismissing holds for that part of the text; another one is
 * shown again. Nothing is recognised while the person switched the recognition off (lib/typedRecognition.ts).
 */
export function useItemQuantity(text: string, wanted: boolean) {
  const { i18n } = useTranslation();
  const enabled = useTypedRecognition() && wanted;
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

// The accent tint on an opaque panel (like .count-badge-accent): the bubble stays readable over what it covers
const BUBBLE_BACKGROUND = { background: 'linear-gradient(var(--accent-dim), var(--accent-dim)), var(--bg-panel)' };

interface QuantityBubbleProps {
  quantity: string;
  onDismiss: () => void;
  /** Where the bubble sits: above the quantity field (desktop add row) or right of it (phone sheet) */
  side: 'above' | 'right';
}

/**
 * "2x ×": a small bubble pointing at the quantity field while it shows a recognised quantity. It shows only
 * the quantity; × keeps the text as typed. Screen readers get a sentence from a live region by the field.
 */
export function QuantityBubble({ quantity, onDismiss, side }: QuantityBubbleProps) {
  const { t } = useTranslation('lists');
  const above = side === 'above';
  return (
    <span
      data-testid="quantity-bubble"
      className={`${
        above ? 'absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 h-5 text-[11px]' : 'relative h-8 text-sm'
      } z-40 inline-flex items-center gap-0.5 pl-2.5 pr-0.5 rounded-full border border-accent-border text-accent font-medium whitespace-nowrap shrink-0 shadow-sm animate-in fade-in duration-150`}
      style={BUBBLE_BACKGROUND}
    >
      {/* The tail: a turned square on the edge facing the field, with only its two outer borders */}
      <span
        aria-hidden="true"
        style={BUBBLE_BACKGROUND}
        className={`absolute w-2.5 h-2.5 rotate-45 border-accent-border ${
          above ? 'left-1/2 -bottom-[5px] -ml-[5px] border-r border-b' : 'top-1/2 -left-[5px] -mt-[5px] border-l border-b'
        }`}
      />
      <span aria-hidden="true" className="relative">
        {quantity}
      </span>
      {/* Keeps the focus in the item field; on phones the hit area grows to 44 px without a bigger bubble */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
        aria-label={t('quantityHint.ignore')}
        title={t('quantityHint.ignore')}
        className={`relative ${
          above ? 'w-4.5 h-4.5' : 'w-7 h-7 after:absolute after:-inset-2'
        } rounded-full flex items-center justify-center hover:bg-accent/15 cursor-pointer`}
      >
        <X className={above ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      </button>
    </span>
  );
}
