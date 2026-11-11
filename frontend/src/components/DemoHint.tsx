import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import type { TFunction } from 'i18next';

const DISMISSED_KEY = 'mindsift:demo-hint-closed';

// The sentence of the public demo: everyone shares its accounts, and it resets every few minutes (minutes
// from DEMO_RESET_MINUTES; none when it does not reset)
export function demoHintText(t: TFunction, minutes?: number) {
  return minutes ? t('app:demo.publicHint', { count: minutes }) : t('app:demo.publicHintNoReset');
}

// One line under the header of the demo until it is closed; this browser remembers that
export const DemoHint: React.FC<{ minutes?: number }> = ({ minutes }) => {
  const { t } = useTranslation('app');
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (closed) return null;
  return (
    <div role="note" className="flex items-center gap-2 px-4 sm:px-6 border-b border-accent/30 bg-accent/10 text-[11px] text-main">
      <Info className="w-3.5 h-3.5 text-accent shrink-0" />
      <p className="flex-1 py-1.5 leading-snug">{demoHintText(t, minutes)}</p>
      <button
        type="button"
        onClick={() => {
          setClosed(true);
          try {
            localStorage.setItem(DISMISSED_KEY, '1');
          } catch {
            // only for this visit then
          }
        }}
        title={t('demo.closeHint')}
        aria-label={t('demo.closeHint')}
        className="h-11 w-11 sm:h-7 sm:w-7 -mr-2 flex items-center justify-center rounded-btn text-muted hover:text-main hover:bg-panel shrink-0"
      >
        <X className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
      </button>
    </div>
  );
};
