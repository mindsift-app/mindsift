import { useTranslation } from 'react-i18next';
import { requestTourStart } from './tourEvents';

// Help page: one sentence on the guided tour and the button that starts it (besides the one-time offer, TourOfferCard)
export function TourStartCard() {
  const { t } = useTranslation('tour');
  return (
    <div className="panel-surface p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <p className="text-xs text-muted">{t('start.intro')}</p>
      <button
        type="button"
        data-tour="tour-start"
        onClick={requestTourStart}
        className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold shrink-0"
      >
        {t('start.button')}
      </button>
    </div>
  );
}
