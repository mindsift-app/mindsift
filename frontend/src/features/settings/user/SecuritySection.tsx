import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { AlertCircle, Check, KeyRound, MonitorSmartphone } from 'lucide-react';
import { api, triggerHaptic } from '../../../lib/api';
import { passwordProblem } from '../../../lib/password';
import { User } from '../../../lib/types';
import { askConfirm } from '../../../components/askConfirm';
import { SessionsPanel } from '../SessionsPanel';
import { TwoFactorCard } from './TwoFactorCard';
import { PasskeyCard } from './PasskeyCard';
import { withSecondFactor } from './askSecondFactor';

// Kontoeinstellungen → Sicherheit: a new password, two-factor sign-in, passkeys and the signed-in devices.
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
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('security.title')}</h2>
        <p className="text-muted mt-0.5">{t('security.intro')}</p>
      </div>
      <PasswordCard onUserUpdated={onUserUpdated} demoMode={demoMode} />
      <div className="pt-5 border-t border-border">
        <TwoFactorCard currentUser={currentUser} demoMode={demoMode} refreshKey={twoFactorKey} onChanged={() => setPasskeyKey((k) => k + 1)} />
      </div>
      <div className="pt-5 border-t border-border">
        <PasskeyCard currentUser={currentUser} demoMode={demoMode} refreshKey={passkeyKey} onChanged={() => setTwoFactorKey((k) => k + 1)} />
      </div>
      <div className="pt-5 border-t border-border">
        <SessionsCard demoMode={demoMode} />
      </div>
    </div>
  );
}

// A new password: needs the current one; every other device is signed out (the server sends this one a
// fresh token)
function PasswordCard({ onUserUpdated, demoMode }: { onUserUpdated: (u: User) => void; demoMode: boolean }) {
  const { t } = useTranslation('settings');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const problem = passwordProblem(next);
    if (problem) {
      setMsg({ type: 'err', text: problem });
      return;
    }
    if (next !== repeat) {
      setMsg({ type: 'err', text: t('security.password.noMatch') });
      return;
    }
    setBusy(true);
    try {
      // Not trimmed: login compares the password exactly as typed
      // With a second factor on, the server asks for it as well (withSecondFactor)
      const updated = await withSecondFactor((proof) => api.updateSettings({ password: next, currentPassword: current, ...proof }));
      onUserUpdated(updated);
      setNext('');
      setRepeat('');
      setCurrent('');
      setMsg({ type: 'ok', text: t('security.password.saved') });
      triggerHaptic(15);
    } catch (err: any) {
      setMsg({ type: 'err', text: err?.message || t('security.password.failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-security-card="password">
      <div>
        <h3 className="text-xs font-bold text-main flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-accent" />
          <span>{t('security.password.title')}</span>
        </h3>
        <p className="text-[11px] text-muted">{t('security.password.hint')}</p>
      </div>
      {msg && (
        <div role={msg.type === 'ok' ? 'status' : 'alert'} className={`flex items-center gap-2 ${msg.type === 'ok' ? 'alert-ok' : 'alert-err'}`}>
          {msg.type === 'ok' ? <Check className="w-4 h-4 text-status-ok flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-muted font-medium">
          {t('security.password.new')}
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={demoMode ? t('profile.demoDisabled') : t('security.password.minChars')}
            autoComplete="new-password"
            disabled={demoMode}
            className="mt-1 w-full h-11 sm:h-9 px-3 input-field text-base sm:text-xs disabled:opacity-60"
          />
        </label>
        <label className="block text-muted font-medium">
          {t('security.password.repeat')}
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            disabled={demoMode}
            className="mt-1 w-full h-11 sm:h-9 px-3 input-field text-base sm:text-xs disabled:opacity-60"
          />
        </label>
      </div>
      {next !== '' && (
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
          disabled={demoMode || busy || !next || !current}
          title={demoMode ? t('profile.demoDisabled') : undefined}
          className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? t('saving') : t('security.password.save')}
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
    } catch (err: any) {
      setError(err?.message || i18n.t('settings:security.sessions.revokeFailed'));
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-3" data-security-card="sessions">
      <div>
        <h3 className="text-xs font-bold text-main flex items-center gap-1.5">
          <MonitorSmartphone className="w-3.5 h-3.5 text-accent" />
          <span>{t('security.sessions.title')}</span>
        </h3>
        <p className="text-[11px] text-muted">{t('security.sessions.hint')}</p>
      </div>
      <SessionsPanel />
      {error && <p className="text-[11px] text-status-err">{error}</p>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-card border border-border bg-canvas">
        <div className="text-xs">
          <p className="font-semibold text-main">{t('security.sessions.revokeAll')}</p>
          <p className="text-[11px] text-faint">{t('security.sessions.revokeAllHint')}</p>
        </div>
        <button
          type="button"
          onClick={revokeAll}
          disabled={demoMode || revoking}
          title={demoMode ? t('profile.demoDisabled') : undefined}
          className="btn-danger h-11 sm:h-8 px-3 text-xs shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {revoking ? t('security.sessions.revoking') : t('security.sessions.revokeAllButton')}
        </button>
      </div>
    </div>
  );
}
