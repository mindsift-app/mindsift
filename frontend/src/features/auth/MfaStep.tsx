import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { MfaMethod, User } from '../../lib/types';
import { api, ApiError, triggerHaptic } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';

// Days a trusted device signs in without a code (storage.TrustedDeviceLifetime on the server)
export const TRUST_DAYS = 30;
// From this many recovery codes left on, the login says to make new ones
export const LOW_RECOVERY_CODES = 3;

interface MfaStepProps {
  mfaToken: string;
  methods: MfaMethod[];
  onAuthenticated: (user: User) => void;
  // Back to the password: the challenge expired or the person wants another account
  onBack: (message?: string) => void;
}

// Second step of the sign-in when the account has an authenticator app: the app's code (sent as soon as
// six digits are there) or a recovery code, and whether to trust this device. After a recovery code the
// step says how many are left before the app opens.
export const MfaStep: React.FC<MfaStepProps> = ({ mfaToken, methods, onAuthenticated, onBack }) => {
  const { t } = useTranslation('auth');
  const [method, setMethod] = useState<MfaMethod>(methods.includes('totp') ? 'totp' : 'recovery');
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed in with a recovery code: how many are left, shown before going on
  const [recoveryDone, setRecoveryDone] = useState<{ user: User; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const send = async (value: string) => {
    if (sending.current || !value.trim()) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    triggerHaptic(15);
    try {
      const res = await api.loginMfa(mfaToken, value, trust);
      if (res.method === 'recovery') {
        setRecoveryDone({ user: res.user, left: res.recoveryCodesLeft });
        return;
      }
      onAuthenticated(res.user);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'mfa_expired') {
        onBack(err.message);
        return;
      }
      setError(err?.message || t('mfa.failed'));
      setCode('');
      triggerHaptic(25);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const onCodeChange = (value: string) => {
    if (method === 'totp') {
      const digits = value.replace(/\D/g, '').slice(0, 6);
      setCode(digits);
      if (digits.length === 6) void send(digits);
      return;
    }
    setCode(value);
  };

  const switchMethod = () => {
    setMethod((m) => (m === 'totp' ? 'recovery' : 'totp'));
    setCode('');
    setError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (recoveryDone) {
    const low = recoveryDone.left <= LOW_RECOVERY_CODES;
    return (
      <div className="space-y-3.5" data-mfa-step="recovery-left">
        <div role="status" className={`flex items-start gap-2 ${low ? 'alert-err' : 'alert-ok'}`}>
          {low ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" /> : <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-px" />}
          <div className="space-y-1">
            <p>{t('mfa.recoveryUsed', { count: recoveryDone.left })}</p>
            {low && <p>{recoveryDone.left === 0 ? t('mfa.recoveryNone') : t('mfa.recoveryLow')}</p>}
          </div>
        </div>
        <button
          type="button"
          autoFocus
          onClick={() => onAuthenticated(recoveryDone.user)}
          className="w-full btn-primary h-11 sm:h-9 text-xs font-semibold"
        >
          {t('mfa.continue')}
        </button>
      </div>
    );
  }

  const canSwitch = methods.includes('totp') && methods.includes('recovery');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(code);
      }}
      className="space-y-3.5"
      data-mfa-step={method}
    >
      <div>
        <h2 className="text-sm font-bold text-main flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span>{t('mfa.title')}</span>
        </h2>
        <p className="text-muted mt-1">{method === 'totp' ? t('mfa.intro') : t('mfa.introRecovery')}</p>
      </div>

      {error && (
        <div role="alert" className="alert-err flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Before the field: six digits send the code at once */}
      <div className="flex items-center justify-between gap-3 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-card border border-border bg-canvas">
        <div className="min-w-0">
          <span className="block text-main">{t('mfa.trust', { count: TRUST_DAYS })}</span>
          <span className="block text-[11px] text-muted">{t('mfa.trustHint')}</span>
        </div>
        <ToggleSwitch checked={trust} onChange={setTrust} title={t('mfa.trust', { count: TRUST_DAYS })} />
      </div>

      <div>
        <label htmlFor="mfa-code" className="block text-muted mb-1">
          {method === 'totp' ? t('mfa.code') : t('mfa.recoveryCode')}
        </label>
        {method === 'totp' ? (
          <input
            key="totp"
            ref={inputRef}
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="123456"
            required
            autoFocus
            disabled={busy}
            className="w-full h-11 sm:h-9 px-2.5 input-field text-base sm:text-sm font-mono tracking-[0.3em] text-center"
          />
        ) : (
          <input
            key="recovery"
            ref={inputRef}
            id="mfa-code"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="abcde-fghjk"
            required
            autoFocus
            disabled={busy}
            className="w-full h-11 sm:h-9 px-2.5 input-field text-base sm:text-sm font-mono text-center"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={busy || !code.trim()}
        className="w-full btn-primary h-11 sm:h-9 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>{busy ? t('mfa.submitting') : t('mfa.submit')}</span>
      </button>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-1 pt-1 border-t border-border">
        <button
          type="button"
          onClick={() => onBack()}
          className="h-11 sm:h-8 text-muted hover:text-main flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('mfa.back')}</span>
        </button>
        {canSwitch && (
          <button type="button" onClick={switchMethod} className="h-11 sm:h-8 text-accent hover:underline flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            <span>{method === 'totp' ? t('mfa.useRecovery') : t('mfa.useApp')}</span>
          </button>
        )}
      </div>
    </form>
  );
};
