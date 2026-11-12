import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, ShieldCheck } from 'lucide-react';
import { OidcAdminStatus } from '../../../lib/types';

// Admin: the sign-in through an OpenID Connect provider. Set up by environment only (OIDC_*), so this card just
// shows the state: provider, whether it answers, who may create accounts and whether passwords still sign in.
export const OidcStatusCard: React.FC<{ status?: OidcAdminStatus }> = ({ status }) => {
  const { t } = useTranslation('settings');
  if (!status) return null;
  const rows: [string, React.ReactNode][] = status.configured
    ? [
        [t('server.oidc.provider'), status.name],
        [t('server.oidc.issuer'), <span className="font-mono break-all">{status.issuer}</span>],
        [t('server.oidc.clientId'), <span className="font-mono break-all">{status.clientId}</span>],
        ...(status.redirectUrl
          ? ([[t('server.oidc.redirectUrl'), <span className="font-mono break-all">{status.redirectUrl}</span>]] as [string, React.ReactNode][])
          : []),
        [t('server.oidc.scopes'), <span className="font-mono">{status.scopes}</span>],
        [t('server.oidc.autoCreate'), status.autoCreate ? t('server.oidc.on') : t('server.oidc.off')],
        [t('server.oidc.passwordLogin'), status.passwordLogin ? t('server.oidc.on') : t('server.oidc.passwordAdminsOnly')],
        [t('server.oidc.adminGroup'), status.adminGroup || t('server.oidc.none')],
        [t('server.oidc.linkedUsers'), String(status.linkedUsers)],
      ]
    : [];
  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3" data-oidc-status>
      <div>
        <p className="font-bold text-main flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-accent" />
          <span>{t('server.oidc.title')}</span>
        </p>
        <p className="text-[11px] text-muted mt-0.5">{status.configured ? t('server.oidc.hint') : t('server.oidc.notConfigured')}</p>
      </div>
      {status.configured && !status.enabled && (
        <div role="alert" className="alert-err flex items-center gap-2 text-xs">
          <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          <span>{status.reason === 'demo' ? t('server.oidc.offDemo') : t('server.oidc.offNoBaseUrl')}</span>
        </div>
      )}
      {status.enabled && (
        <div
          role="status"
          className={`flex items-start gap-2 text-xs ${status.reachable ? 'alert-ok' : 'alert-err'}`}
        >
          {status.reachable ? (
            <Check className="w-4 h-4 text-status-ok flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {status.reachable ? t('server.oidc.reachable') : t('server.oidc.unreachable', { error: status.error || '' })}
          </span>
        </div>
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="text-main min-w-0 max-sm:mb-1">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
};
