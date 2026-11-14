import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Brain, ExternalLink } from 'lucide-react';
import { APP_VERSION } from '../version';
import { authHeaders } from '../lib/api';
import { ReadingModal } from './ReadingModal';

// Project facts shown in "About MindSift"; change here when the repository or license changes
export const PROJECT_REPO_URL = 'https://github.com/mindsift-app/mindsift';
// What changed in each version, as released on main
export const CHANGELOG_URL = `${PROJECT_REPO_URL}/blob/main/CHANGELOG.md`;
// The licenses of the third-party software in this build, served by MindSift itself to signed-in people
// only (internal/api/licenses.go): loaded with the session and shown here, not opened as a page
export const THIRD_PARTY_LICENSES_URL = '/api/v1/third-party-licenses';
// The license text is in the locale files (common:about.license)

type Licenses = { state: 'loading' } | { state: 'error' } | { state: 'done'; text: string };

export const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [licenses, setLicenses] = useState<Licenses | null>(null);

  const showLicenses = async () => {
    setLicenses({ state: 'loading' });
    try {
      const res = await fetch(THIRD_PARTY_LICENSES_URL, { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setLicenses({ state: 'done', text: await res.text() });
    } catch {
      setLicenses({ state: 'error' });
    }
  };

  if (licenses) {
    // Closing the list goes back to About
    return (
      <ReadingModal title={t('about.thirdParty')} onClose={() => setLicenses(null)}>
        {licenses.state === 'loading' && <p className="text-xs text-muted">{t('about.thirdPartyLoading')}</p>}
        {licenses.state === 'error' && <p className="text-xs text-muted">{t('about.thirdPartyError')}</p>}
        {licenses.state === 'done' && (
          <pre className="text-[11px] leading-snug text-muted whitespace-pre-wrap break-words font-mono">{licenses.text}</pre>
        )}
      </ReadingModal>
    );
  }

  return (
  <ReadingModal title={t('aboutMindSift')} onClose={onClose}>
    <div className="space-y-4 text-xs text-muted leading-relaxed">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-accent text-on-accent rounded-btn flex items-center justify-center shrink-0">
          <Brain className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-main">MindSift</p>
          <p>{t('about.tagline')}</p>
        </div>
      </div>

      <p>
        <Trans t={t} i18nKey="about.intro" components={{ b: <strong className="text-main" /> }} />
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="font-semibold text-main">{t('about.version')}</dt>
        <dd>
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t('about.changelog')}
            className="font-mono text-accent hover:underline inline-flex items-center gap-1"
          >
            {APP_VERSION}
            <ExternalLink className="w-3 h-3" />
          </a>
        </dd>
        <dt className="font-semibold text-main">{t('about.licenseLabel')}</dt>
        <dd>{t('about.license')}</dd>
        <dt className="font-semibold text-main">{t('about.source')}</dt>
        <dd>
          <a href={PROJECT_REPO_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
            {PROJECT_REPO_URL.replace(/^https:\/\//, '')}
            <ExternalLink className="w-3 h-3" />
          </a>
        </dd>
        <dt className="font-semibold text-main">{t('about.thirdPartyLabel')}</dt>
        <dd>
          <button
            type="button"
            onClick={() => void showLicenses()}
            className="text-accent hover:underline text-left"
            data-third-party-licenses
          >
            {t('about.thirdParty')}
          </button>
        </dd>
      </dl>

      <p className="text-[11px] text-faint">
        {t('about.operator')}
      </p>
    </div>
  </ReadingModal>
  );
};
