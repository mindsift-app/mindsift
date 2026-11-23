import React from 'react';
import { RegistrationMode } from '../../../lib/types';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { OidcStatusCard } from './OidcStatusCard';
import { AdminPage } from './AdminPage';
import { useAdminSettings } from './useAdminSettings';
import { Trans, useTranslation } from 'react-i18next';
import { NO_AUTOFILL } from '../../../lib/noAutofill';
import { SelectMenu } from '../../../components/SelectMenu';
import { SettingRow, SettingsCard } from '../../../components/SettingsCard';

// Administration → Sign-in & registration: who may register, the second factor and single sign-on
// (state in useAdminSettings)
export function SignInSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings, setSettings } = admin;
  const mode = settings.registrationMode || 'closed';
  const locked = Boolean(settings.registrationConfiguredViaEnv);
  const needsDomains = mode === 'domain' || mode === 'domain+approval';
  return (
    <AdminPage title={t('admin.nav.signin')} intro={t('admin.pages.signinIntro')} demoMode={demoMode}>
      {/* Who may register without an invite */}
      <SettingsCard
        data-admin-registration
        title={t('server.registration')}
        hint={t('server.registrationHint')}
      >
        <SelectMenu<RegistrationMode>
          ariaLabel={t('server.registration')}
          value={mode}
          disabled={locked}
          onChange={(registrationMode) => handleSaveSystemSettings({ registrationMode })}
          options={[
            { value: 'closed', label: t('server.mode.closed') },
            { value: 'approval', label: t('server.mode.approval') },
            { value: 'domain', label: t('server.mode.domain') },
            { value: 'domain+approval', label: t('server.mode.domainApproval') },
            { value: 'open', label: t('server.mode.open') },
          ]}
        />
        {needsDomains && (
          <label className="block text-[11px] text-muted">
            <Trans t={t} i18nKey="server.domains" components={{ c: <code className="font-mono" /> }} />
            <input
              {...NO_AUTOFILL}
              type="text"
              disabled={locked}
              value={settings.registrationDomains || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, registrationDomains: e.target.value }))}
              onBlur={() => handleSaveSystemSettings()}
              placeholder={t('server.domainsPlaceholder')}
              className="block w-full mt-1 h-11 sm:h-8 px-2.5 input-field font-mono text-base sm:text-xs disabled:opacity-60"
            />
          </label>
        )}
        {locked && (
          <p className="text-[11px] text-status-warn">
            <Trans t={t} i18nKey="server.registrationFixed" components={{ c: <code className="font-mono" /> }} />
          </p>
        )}
        {mode !== 'closed' && (
          <div className="pt-3 border-t border-border flex items-start justify-between gap-4">
            <div className="pr-2">
              <p className="font-semibold text-main">{t('server.verify')}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {t('server.verifyHint')}
              </p>
              {!settings.emailLinksAvailable && (
                <p className="text-[11px] text-status-warn mt-1">
                  <Trans t={t} i18nKey="server.verifyNeedsMail" components={{ c: <code className="font-mono" /> }} />
                </p>
              )}
              {settings.registrationVerifyConfiguredViaEnv && (
                <p className="text-[11px] text-status-warn mt-1">
                  <Trans t={t} i18nKey="server.verifyFixed" components={{ c: <code className="font-mono" /> }} />
                </p>
              )}
            </div>
            <ToggleSwitch
              checked={Boolean(settings.registrationVerifyEmail)}
              disabled={Boolean(settings.registrationVerifyConfiguredViaEnv)}
              onChange={(registrationVerifyEmail) => handleSaveSystemSettings({ registrationVerifyEmail })}
              title={t('server.verifyTitle')}
            />
          </div>
        )}
      </SettingsCard>

      {/* Who must sign in with a second factor; without one the next request leads to its setup */}
      <SettingRow
        data-admin-mfa-required
        title={t('server.mfaRequired')}
        hint={t('server.mfaRequiredHint')}
      >
        <SelectMenu
          size="sm"
          ariaLabel={t('server.mfaRequired')}
          value={settings.mfaRequired || ''}
          disabled={demoMode}
          onChange={(v) => handleSaveSystemSettings({ mfaRequired: v as '' | 'admins' | 'all' })}
          options={[
            { value: '', label: t('server.mfaRequiredNobody') },
            { value: 'admins', label: t('server.mfaRequiredAdmins') },
            { value: 'all', label: t('server.mfaRequiredAll') },
          ]}
        />
      </SettingRow>

      {/* Single sign-on over OIDC: set up in the .env, shown here read only */}
      <OidcStatusCard status={settings.oidc} />
    </AdminPage>
  );
}
