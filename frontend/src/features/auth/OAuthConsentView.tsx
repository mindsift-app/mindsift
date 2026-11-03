import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Brain, Bot, AlertCircle, ExternalLink } from 'lucide-react';
import { ApiKeyScope, OAuthAuthorizeInfo, User } from '../../lib/types';
import { SCOPES, scopeGroups } from '../../lib/apiScopes';
import { api, triggerHaptic } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';

interface OAuthConsentViewProps {
  user: User;
  instanceName: string;
  onLogout: () => void;
}

// Consent page of the OAuth flow (/oauth/authorize): an AI client such as claude.ai wants to use
// MindSift over MCP. The person picks the rights; the server answers with the URL to return to the
// client (with a code or access_denied). Shown instead of the app while the address is /oauth/authorize.
export const OAuthConsentView: React.FC<OAuthConsentViewProps> = ({ user, instanceName, onLogout }) => {
  const { t } = useTranslation('auth');
  const query = window.location.search;
  const [info, setInfo] = useState<OAuthAuthorizeInfo | null>(null);
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getOAuthAuthorizeInfo(query)
      .then((res) => {
        // Invalid request the client must hear about: straight back
        if (res.redirect) {
          window.location.replace(res.redirect);
          return;
        }
        setInfo(res);
        setScopes(res.scopes || []);
      })
      .catch((err) => setError(err?.message || i18n.t('auth:consent.invalid')));
  }, [query]);

  const toggle = (id: ApiKeyScope) =>
    setScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const answer = async (approve: boolean) => {
    triggerHaptic(15);
    setBusy(true);
    setError(null);
    try {
      const res = await api.answerOAuthAuthorize(query, approve, scopes);
      window.location.replace(res.redirect);
    } catch (err: any) {
      setError(err?.message || t('consent.failed'));
      setBusy(false);
    }
  };

  const offered = info?.offeredScopes || [];
  const groups = scopeGroups().filter(([group]) => SCOPES.some((sc) => sc.group === group && offered.includes(sc.id)));

  return (
    <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md panel-surface shadow-panel overflow-hidden">
        <div className="p-4 bg-canvas border-b border-border flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent text-on-accent rounded-btn flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <h1 className="text-sm font-bold text-main tracking-tight leading-none">{instanceName}</h1>
        </div>

        <div className="p-4 space-y-4">
          {!info && !error && <p className="text-xs text-muted">{t('consent.checking')}</p>}

          {error && (
            <div className="flex items-start gap-2 text-xs text-status-err">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-accent/15 text-accent rounded-btn flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-main">{t('consent.title', { client: info.clientName })}</h2>
                  <p className="text-xs text-muted mt-0.5">
                    <Trans
                      t={t}
                      i18nKey="consent.signedInAs"
                      values={{ name: user.displayName || user.email }}
                      components={{ b: <span className="text-main" /> }}
                    />
                  </p>
                </div>
              </div>

              <div className="space-y-2" role="group" aria-label={t('consent.rights')}>
                {groups.map(([group, heading]) => (
                  <div key={group} className="border border-border rounded-card bg-panel px-3 py-1.5">
                    <p className="text-[11px] text-muted pt-1 pb-0.5 font-semibold">{heading}</p>
                    {SCOPES.filter((sc) => sc.group === group && offered.includes(sc.id)).map((sc) => (
                      <div key={sc.id} className="flex items-center justify-between gap-3 min-h-[44px] sm:min-h-[36px]">
                        <div className="min-w-0">
                          <span className="block text-xs text-main">{sc.label}</span>
                          <span className="block text-[11px] text-muted">{sc.hint}</span>
                        </div>
                        <ToggleSwitch checked={scopes.includes(sc.id)} onChange={() => toggle(sc.id)} title={sc.chip} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-faint flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  <Trans
                    t={t}
                    i18nKey="consent.returnTo"
                    values={{ host: info.redirectHost }}
                    components={{ b: <span className="font-medium text-main" /> }}
                  />
                </span>
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => answer(false)}
                  className="btn-action h-11 sm:h-9 px-4 text-sm flex-1 disabled:opacity-40"
                >
                  {t('consent.deny')}
                </button>
                <button
                  type="button"
                  disabled={busy || scopes.length === 0}
                  onClick={() => answer(true)}
                  className="btn-primary h-11 sm:h-9 px-4 text-sm flex-1 disabled:opacity-40"
                >
                  {t('consent.allow')}
                </button>
              </div>
            </>
          )}

          <button type="button" onClick={onLogout} className="text-[11px] text-muted hover:text-main underline h-11 sm:h-auto">
            {t('consent.otherAccount')}
          </button>
        </div>
      </div>
    </div>
  );
};
