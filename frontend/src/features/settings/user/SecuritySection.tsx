import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { CircleAlert, KeyRound, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { api, getCurrentOidc, triggerHaptic } from '../../../lib/api';
import { startOidcConfirm } from '../../../lib/oidc';
import { passwordPairProblem } from '../../../lib/password';
import { NewPasswordFields } from '../../../components/NewPasswordFields';
import { User } from '../../../lib/types';
import { askConfirm } from '../../../components/askConfirm';
import { StatusToast } from '../../../components/StatusToast';
import { SessionsPanel } from '../SessionsPanel';
import { TwoFactorCard } from './TwoFactorCard';
import { PasskeyCard } from './PasskeyCard';
import { withSecondFactor } from './askSecondFactor';
import { errorMessage } from '../../../lib/errorMessage';
import { SettingRow, SettingsHeading } from '../../../components/SettingsCard';

// Kontoeinstellungen → Sicherheit: a new password, two-factor sign-in, passkeys and the signed-in devices; with
// an OIDC provider how the account signs in there. The password and the second factors only matter where the
// account can sign in with a password: with the password login off only administrators can (emergency access),
// and an account from the provider has no password until it sets one.
export function SecuritySection({
  currentUser,
  onUserUpdated,
  demoMode,
}: {
  currentUser: User;
  onUserUpdated: (u: User) => void;
  demoMode: boolean;
}) {
  const { t } = useTranslation('settings');
  // The app and the passkeys share the state of two-factor sign-in: a change in one card reloads the other
  const [twoFactorKey, setTwoFactorKey] = useState(0);
  const [passkeyKey, setPasskeyKey] = useState(0);
  const oidc = getCurrentOidc();
  const passwordUsable = oidc.passwordLogin || currentUser.role === 'admin';
  const secondFactors = passwordUsable && !currentUser.noPassword;
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('security.title')}</h2>
      </div>
      {oidc.enabled && <OidcCard currentUser={currentUser} name={oidc.name} />}
      {passwordUsable && (
        <div className={oidc.enabled ? 'pt-5 border-t border-border' : ''}>
          <PasswordCard currentUser={currentUser} onUserUpdated={onUserUpdated} demoMode={demoMode} />
        </div>
      )}
      {secondFactors && (
        <>
          <div className="pt-5 border-t border-border">
            <TwoFactorCard currentUser={currentUser} demoMode={demoMode} refreshKey={twoFactorKey} onChanged={() => setPasskeyKey((k) => k + 1)} />
          </div>
          <div className="pt-5 border-t border-border">
            <PasskeyCard currentUser={currentUser} demoMode={demoMode} refreshKey={passkeyKey} onChanged={() => setTwoFactorKey((k) => k + 1)} />
          </div>
        </>
      )}
      <div className="pt-5 border-t border-border">
        <SessionsCard demoMode={demoMode} />
      </div>
    </div>
  );
}

// Signing in through the OIDC provider: how this account does, or linking it (with the password, so a session
// alone cannot tie somebody's account at the provider to it). Linking leaves for the provider and comes back.
function OidcCard({ currentUser, name }: { currentUser: User; name: string }) {
  const { t } = useTranslation('settings');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await withSecondFactor((proof) => startOidcConfirm({ link: true, password, ...proof }));
    } catch (err) {
      setError(errorMessage(err, t('security.oidc.linkFailed')));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={link} className="space-y-3" data-security-card="oidc">
      <SettingsHeading
        title={<>{t('security.oidc.title', { name })}</>}
        icon={<ShieldCheck className="w-3.5 h-3.5 text-accent" />}
        hint={currentUser.oidc ? t('security.oidc.linked', { name }) : t('security.oidc.notLinked', { name })}
      />
      {!currentUser.oidc && (
        <>
          <label className="block text-muted font-medium">
            {t('profile.currentPassword')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full h-11 sm:h-9 px-3 input-field text-base sm:text-xs"
            />
          </label>
          {error && (
            <div role="alert" className="alert-err flex items-center gap-2">
              <CircleAlert className="w-4 h-4 text-status-err shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !password} className="btn-action h-11 sm:h-9 px-5 text-xs font-semibold disabled:opacity-50">
              {t('security.oidc.link', { name })}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

// A new password: needs the current one; every other device is signed out (the server sends this one a
// fresh token). An account from the OIDC provider without a password sets its first one, confirmed there.
function PasswordCard({ currentUser, onUserUpdated, demoMode }: { currentUser: User; onUserUpdated: (u: User) => void; demoMode: boolean }) {
  const { t } = useTranslation('settings');
  const firstPassword = Boolean(currentUser.noPassword);
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const problem = passwordPairProblem(next, repeat);
    if (problem) {
      setMsg({ type: 'err', text: problem });
      return;
    }
    setBusy(true);
    try {
      // Not trimmed: login compares the password exactly as typed
      // With a second factor on, the server asks for it as well (withSecondFactor)
      const updated = await withSecondFactor((proof) =>
        api.updateSettings({ password: next, ...(firstPassword ? {} : { currentPassword: current }), ...proof })
      );
      onUserUpdated(updated);
      setNext('');
      setRepeat('');
      setCurrent('');
      setMsg({ type: 'ok', text: t('security.password.saved') });
      triggerHaptic(15);
    } catch (err) {
      setMsg({ type: 'err', text: errorMessage(err, t('security.password.failed')) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-security-card="password">
      <SettingsHeading
        title={firstPassword ? t('security.password.setTitle') : t('security.password.title')}
        icon={<KeyRound className="w-3.5 h-3.5 text-accent" />}
        hint={
          <>
            {firstPassword
            ? t(currentUser.role === 'admin' && !getCurrentOidc().passwordLogin ? 'security.password.setHintAdmin' : 'security.password.setHint', {
            name: getCurrentOidc().name,
            })
            : t('security.password.hint')}
          </>
        }
      />
      <StatusToast msg={msg} onClose={() => setMsg(null)} />
      <NewPasswordFields
        value={next}
        onChange={setNext}
        repeat={repeat}
        onRepeatChange={setRepeat}
        label={t('security.password.new')}
        repeatLabel={t('security.password.repeat')}
        placeholder={demoMode ? t('profile.demoDisabled') : t('security.password.minChars')}
        disabled={demoMode}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        inputClassName="h-11 sm:h-9 px-3 text-base sm:text-xs"
      />
      {next !== '' && !firstPassword && (
        <label className="block text-muted font-medium">
          {t('profile.currentPassword')}
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 w-full h-11 sm:h-9 px-3 input-field text-base sm:text-xs"
          />
        </label>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={demoMode || busy || !next || (!firstPassword && !current)}
          title={demoMode ? t('profile.demoDisabled') : undefined}
          className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? t('saving') : firstPassword ? t('security.password.set') : t('security.password.save')}
        </button>
      </div>
    </form>
  );
}

// The signed-in devices and "end all sessions"
function SessionsCard({ demoMode }: { demoMode: boolean }) {
  const { t } = useTranslation('settings');
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');

  const revokeAll = async () => {
    const ok = await askConfirm({
      message: i18n.t('settings:security.sessions.confirmRevokeAll'),
      confirmLabel: i18n.t('settings:security.sessions.revokeAllButton'),
      danger: true,
    });
    if (!ok) return;
    setRevoking(true);
    try {
      await api.revokeAllSessions();
      await api.logout();
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err, i18n.t('settings:security.sessions.revokeFailed')));
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-3" data-security-card="sessions">
      <SettingsHeading
        title={t('security.sessions.title')}
        icon={<MonitorSmartphone className="w-3.5 h-3.5 text-accent" />}
        hint={t('security.sessions.hint')}
      />
      <SessionsPanel />
      {error && <p className="text-[11px] text-status-err">{error}</p>}
      <SettingRow title={t('security.sessions.revokeAll')} hint={t('security.sessions.revokeAllHint')}>
        <button
          type="button"
          onClick={revokeAll}
          disabled={demoMode || revoking}
          title={demoMode ? t('profile.demoDisabled') : undefined}
          className="btn-danger h-11 sm:h-8 px-3 text-xs shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {revoking ? t('security.sessions.revoking') : t('security.sessions.revokeAllButton')}
        </button>
      </SettingRow>
    </div>
  );
}
