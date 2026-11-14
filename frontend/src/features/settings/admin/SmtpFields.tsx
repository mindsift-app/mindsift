import React from 'react';
import { useTranslation } from 'react-i18next';
import { SmtpForm } from '../../../lib/types';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { MASKED, NO_AUTOFILL } from '../../../lib/noAutofill';

// The mail server's fields: host, port, user, password, sender, encryption. Used by the administration
// (SmtpSection) and the setup wizard (SetupMailSection); each keeps the values itself.
export function SmtpFields({
  value,
  onChange,
  passwordSet = false,
  passwordViaEnv = false,
  inputClassName = 'h-11 sm:h-9 px-3',
}: {
  value: SmtpForm;
  onChange: (patch: Partial<SmtpForm>) => void;
  // A password is stored: the empty field keeps it
  passwordSet?: boolean;
  // The password comes from SMTP_PASS and is not stored
  passwordViaEnv?: boolean;
  // Height, padding and text size of the inputs
  inputClassName?: string;
}) {
  const { t } = useTranslation('settings');
  const field = `w-full input-field ${inputClassName}`;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="block">
        <span className="block text-muted font-medium mb-1">{t('smtp.host')}</span>
        <input
          {...NO_AUTOFILL}
          type="text"
          value={value.smtpHost || ''}
          onChange={(e) => onChange({ smtpHost: e.target.value })}
          placeholder={t('smtp.hostPlaceholder')}
          className={`${field} font-mono`}
        />
      </label>

      <label className="block">
        <span className="block text-muted font-medium mb-1">{t('smtp.port')}</span>
        <input
          {...NO_AUTOFILL}
          type="text"
          inputMode="numeric"
          value={value.smtpPort ?? ''}
          // Digits only; an empty field stays empty while typing (saved as 587)
          onChange={(e) => onChange({ smtpPort: e.target.value.replace(/\D/g, '').slice(0, 5) })}
          placeholder="587"
          className={`${field} font-mono`}
        />
      </label>

      <label className="block">
        <span className="block text-muted font-medium mb-1">{t('smtp.user')}</span>
        <input
          {...NO_AUTOFILL}
          type="text"
          value={value.smtpUser || ''}
          onChange={(e) => onChange({ smtpUser: e.target.value })}
          placeholder={t('smtp.addressPlaceholder')}
          className={`${field} font-mono`}
        />
      </label>

      <label className="block">
        <span className="block text-muted font-medium mb-1">{t('smtp.password')}</span>
        {/* Locked while SMTP_PASS applies: the server would not store a password entered here */}
        <input
          {...NO_AUTOFILL}
          type="text"
          style={MASKED}
          value={passwordViaEnv ? '' : value.smtpPass || ''}
          onChange={(e) => onChange({ smtpPass: e.target.value })}
          disabled={passwordViaEnv}
          placeholder={passwordSet && !passwordViaEnv ? t('smtp.passwordKept') : '••••••••••••'}
          autoComplete="new-password"
          className={`${field} font-mono disabled:opacity-60`}
        />
        {passwordViaEnv && <span className="block text-[11px] text-muted mt-1">{t('server.fixedBy', { env: 'SMTP_PASS' })}</span>}
      </label>

      <label className="block">
        <span className="block text-muted font-medium mb-1">{t('smtp.from')}</span>
        <input
          {...NO_AUTOFILL}
          type="text"
          value={value.smtpFrom || ''}
          onChange={(e) => onChange({ smtpFrom: e.target.value })}
          placeholder={t('smtp.addressPlaceholder')}
          className={field}
        />
      </label>

      <div>
        <label className="block">
          <span className="block text-muted font-medium mb-1">{t('smtp.fromName')}</span>
          <input
            {...NO_AUTOFILL}
            type="text"
            value={value.smtpFromName || ''}
            onChange={(e) => onChange({ smtpFromName: e.target.value })}
            placeholder="MindSift"
            className={field}
          />
        </label>
        <p className="text-[11px] text-faint mt-1">{t('smtp.fromNameHint')}</p>
      </div>

      <div className="sm:col-span-2 space-y-3 pt-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-main font-medium">{t('smtp.tls')}</p>
            <p className="text-[11px] text-muted">{t('smtp.tlsHint')}</p>
          </div>
          <ToggleSwitch
            checked={value.smtpTls ?? true}
            onChange={(smtpTls) => onChange({ smtpTls })}
            title={t('smtp.tls')}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-main font-medium">{t('smtp.skipVerify')}</p>
            <p className="text-[11px] text-muted">{t('smtp.skipVerifyHint')}</p>
          </div>
          <ToggleSwitch
            checked={value.smtpSkipVerify ?? false}
            disabled={!(value.smtpTls ?? true)}
            onChange={(smtpSkipVerify) => onChange({ smtpSkipVerify })}
            title={t('smtp.skipVerify')}
          />
        </div>
      </div>
    </div>
  );
}
