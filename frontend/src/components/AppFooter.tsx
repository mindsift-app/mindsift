import React from 'react';
import { useTranslation } from 'react-i18next';
import { AuthStatus } from '../lib/types';
import { APP_VERSION } from '../version';
import { LegalLinks } from './LegalLinks';

interface AppFooterProps {
  legal?: AuthStatus['legal'];
  onOpenAbout: () => void;
}

export const AppFooter: React.FC<AppFooterProps> = ({ legal, onOpenAbout }) => {
  const { t } = useTranslation();
  // One small, even line: same font, size and weight for every part (mixed mono/bold looked crooked)
  const item = 'leading-none hover:text-muted transition-colors cursor-pointer';
  return (
    <footer className="hidden sm:flex shrink-0 w-full px-6 py-1.5 items-center justify-between text-[10px] leading-none text-faint select-none">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onOpenAbout} className={item} title={t('aboutTitle')}>
          MindSift {APP_VERSION}
        </button>
      </div>

      <LegalLinks legal={legal} className="!text-[10px] !text-faint !gap-x-3 leading-none" />
    </footer>
  );
};
