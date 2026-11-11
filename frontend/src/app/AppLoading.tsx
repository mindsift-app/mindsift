import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The whole screen while the app connects or loads its views; with `onRetry` the views could not be loaded
export const AppLoading: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation('app');
  if (!onRetry) {
    return (
      <div className="min-h-[100dvh] bg-canvas text-muted flex items-center justify-center text-xs font-sans">
        {t('connecting')}
      </div>
    );
  }
  return (
    <div className="min-h-[100dvh] bg-canvas text-muted flex flex-col items-center justify-center gap-3 px-6 text-center text-xs font-sans">
      <p className="max-w-sm">{t('appLoad.failed')}</p>
      <button type="button" onClick={onRetry} className="btn-primary h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5">
        <RotateCcw className="w-3.5 h-3.5" />
        <span>{t('appLoad.retry')}</span>
      </button>
    </div>
  );
};
