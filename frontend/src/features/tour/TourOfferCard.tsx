import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, X } from 'lucide-react';
import type { User } from '../../lib/types';
import { onTourStartRequest, requestTourStart } from './tourEvents';
import { rememberTourOffered, tourOfferPending } from './tourOffer';

// Once after the first sign-in: a small card at the edge (on phones above the navigation) that offers the
// guided tour. Not a dialog in the way: the app stays usable around it. Any answer counts, closing too,
// and so does starting the tour from the help page; it never comes back (tourOffer.ts).
export function TourOfferCard({
  user,
  demoMode,
  suppressed = false,
  onUserUpdated,
}: {
  user: User;
  demoMode: boolean;
  // Something else holds the screen (the install offer on phones): wait until it is gone
  suppressed?: boolean;
  onUserUpdated: (user: User) => void;
}) {
  const { t } = useTranslation('tour');
  const [answered, setAnswered] = useState(false);
  const answeredRef = useRef(false);
  const pending = !answered && tourOfferPending(user, demoMode);

  const answer = useCallback(() => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    setAnswered(true);
    rememberTourOffered(demoMode)
      .then((updated) => updated && onUserUpdated(updated))
      .catch(() => {});
  }, [demoMode, onUserUpdated]);

  useEffect(() => {
    if (!pending) return;
    return onTourStartRequest(answer);
  }, [pending, answer]);

  if (!pending || suppressed) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-offer-title"
      data-tour-offer
      className="fixed z-40 left-3 right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:bottom-4 sm:w-80 panel-elevated shadow-panel p-4 text-main animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <button
        type="button"
        onClick={answer}
        title={t('offer.close')}
        aria-label={t('offer.close')}
        className="absolute top-1 right-1 h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center rounded-btn text-muted hover:text-main hover:bg-canvas"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <Compass className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p id="tour-offer-title" className="text-sm font-semibold">
            {t('offer.title')}
          </p>
          <p className="mt-1 text-xs text-muted leading-relaxed">{t('offer.text')}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={answer} className="btn-action h-11 sm:h-8 px-3 text-xs">
          {t('offer.decline')}
        </button>
        <button
          type="button"
          onClick={() => {
            answer();
            requestTourStart();
          }}
          className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold"
        >
          {t('offer.start')}
        </button>
      </div>
    </div>
  );
}
