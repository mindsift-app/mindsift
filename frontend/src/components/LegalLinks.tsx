import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthStatus } from '../lib/types';
import { api } from '../lib/api';
import { MarkdownViewer } from '../lib/markdown';
import { ReadingModal } from './ReadingModal';
import { safeHref } from '../lib/safeUrl';

type LegalType = 'imprint' | 'privacy';

interface LegalLinksProps {
  legal?: AuthStatus['legal'];
  className?: string;
  children?: React.ReactNode; // further footer links, e.g. "Über MindSift"
}

// Impressum / Datenschutz links: an external URL opens in a new tab, Markdown in a reading modal.
// Links without URL or text are not shown at all.
export const LegalLinks: React.FC<LegalLinksProps> = ({ legal, className = '', children }) => {
  const { t } = useTranslation();
  const TITLES: Record<LegalType, string> = { imprint: t('legal.imprint'), privacy: t('legal.privacy') };
  const [open, setOpen] = useState<{ type: LegalType; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = (['imprint', 'privacy'] as LegalType[])
    .map((type) => ({
      type,
      url: type === 'imprint' ? legal?.imprintUrl : legal?.privacyUrl,
      hasContent: type === 'imprint' ? legal?.hasImprintContent : legal?.hasPrivacyContent,
    }))
    .filter((e) => e.url || e.hasContent);

  const customHref = legal?.customLinkUrl && safeHref(legal.customLinkUrl);

  if (entries.length === 0 && !children && !customHref) return null;

  const openText = async (type: LegalType) => {
    setError(null);
    try {
      setOpen({ type, content: await api.getLegalText(type) });
    } catch (err: any) {
      setError(err.message || t('legal.loadFailed'));
    }
  };

  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted ${className}`}>
      {entries.map((e) =>
        e.url && safeHref(e.url) ? (
          <a key={e.type} href={safeHref(e.url) as string} target="_blank" rel="noopener noreferrer" className="hover:text-main underline-offset-2 hover:underline">
            {TITLES[e.type]}
          </a>
        ) : (
          <button key={e.type} type="button" onClick={() => openText(e.type)} className="hover:text-main underline-offset-2 hover:underline">
            {TITLES[e.type]}
          </button>
        )
      )}
      {customHref && (
        <a
          href={customHref as string}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-main underline-offset-2 hover:underline"
        >
          {legal?.customLinkLabel || legal?.customLinkUrl}
        </a>
      )}
      {children}
      {error && <span className="text-status-err">{error}</span>}
      {open && (
        <ReadingModal title={TITLES[open.type]} onClose={() => setOpen(null)}>
          <MarkdownViewer content={open.content} />
        </ReadingModal>
      )}
    </div>
  );
};
