import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, TriangleAlert, ArrowLeft, FingerprintPattern, KeyRound, ShieldCheck } from 'lucide-react';
import { MfaLoginResult, MfaMethod, User } from '../../lib/types';
import { api, ApiError, triggerHaptic } from '../../lib/api';
import { getPasskey, PasskeyJSON, passkeyCancelled, passkeysSupported } from '../../lib/webauthn';
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

// Second step of the sign-in when the account has a second factor: the app's code (sent as soon as six
// digits are there), a passkey, or a recovery code, and whether to trust this device. With passkeys and no
// app the passkey comes first; with both the app's field stays and the passkey is a button below. After a
// recovery code the step says how many are left before the app opens.
export const MfaStep: React.FC<MfaStepProps> = ({ mfaToken, methods, onAuthenticated, onBack }) => {
  const { t } = useTranslation('auth');
  const hasApp = methods.includes('totp');
  const hasPasskey = methods.includes('passkey') && passkeysSupported();
  const [method, setMethod] = useState<MfaMethod>(hasApp ? 'totp' : hasPasskey ? 'passkey' : 'recovery');
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed in with a recovery code: how many are left, shown before going on
  const [recoveryDone, setRecoveryDone] = useState<{ user: User; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  // The passkey options are fetched ahead, so the click opens the browser's dialog right away (Safari asks
  // for it within the person's action)
  const passkeyOptions = useRef<Promise<{ options: PasskeyJSON }> | null>(null);
  const prefetch = () => {
    const p = api.mfaPasskeyOptions(mfaToken);
    p.catch(() => {});
    passkeyOptions.current = p;
  };
  useEffect(() => {
    if (hasPasskey) prefetch();
    // Once per challenge; prefetch only reads the token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfaToken, hasPasskey]);

  const finish = (res: MfaLoginResult) => {
    if (res.method === 'recovery') {
      setRecoveryDone({ user: res.user, left: res.recoveryCodesLeft });
      return;
    }
    onAuthenticated(res.user);
  };

  const failed = (err: any, fallback: string) => {
    if (err instanceof ApiError && err.code === 'mfa_expired') {
      onBack(err.message);
      return;
    }
    setError(err?.message || fallback);
    triggerHaptic(25);
  };

  const send = async (value: string) => {
    if (sending.current || !value.trim()) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    triggerHaptic(15);
    try {
      finish(await api.loginMfa(mfaToken, value, trust));
    } catch (err: any) {
      failed(err, t('mfa.failed'));
      setCode('');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const confirmWithPasskey = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const pending = passkeyOptions.current ?? api.mfaPasskeyOptions(mfaToken);
    passkeyOptions.current = null;
    try {
      const { options } = await pending;
      const credential = await getPasskey(options);
      finish(await api.loginMfaPasskey(mfaToken, credential, trust));
    } catch (err: any) {
      if (!passkeyCancelled(err)) failed(err, t('mfa.passkeyFailed'));
      // A new challenge for the next try (each one is used up by an answer)
      prefetch();
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

  const switchTo = (next: MfaMethod) => {
    setMethod(next);
    setCode('');
    setError(null);
    if (next !== 'passkey') window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (recoveryDone) {
    const low = recoveryDone.left <= LOW_RECOVERY_CODES;
    return (
      <div className="space-y-3.5" data-mfa-step="recovery-left">
        <div role="status" className={`flex items-start gap-2 ${low ? 'alert-err' : 'alert-ok'}`}>
          {low ? <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-px" /> : <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-px" />}
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

  const passkeyButton = (primary: boolean) => (
    <button
      type="button"
      autoFocus={primary}
      onClick={() => void confirmWithPasskey()}
      disabled={busy}
      className={`w-full ${primary ? 'btn-primary font-semibold' : 'btn-action'} h-11 sm:h-9 text-xs flex items-center justify-center gap-2 disabled:opacity-50`}
      data-mfa-passkey
    >
      <FingerprintPattern className="w-3.5 h-3.5" />
      <span>{busy && method === 'passkey' ? t('mfa.passkeyWaiting') : t('mfa.usePasskey')}</span>
    </button>
  );

  // The other way, offered at the bottom: recovery code from the app or passkey, back from the code
  const other: { to: MfaMethod; label: string } | null =
    method !== 'recovery'
      ? methods.includes('recovery')
        ? { to: 'recovery', label: t('mfa.useRecovery') }
        : null
      : hasApp
        ? { to: 'totp', label: t('mfa.useApp') }
        : hasPasskey
          ? { to: 'passkey', label: t('mfa.switchPasskey') }
          : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (method === 'passkey') void confirmWithPasskey();
        else void send(code);
      }}
      className="space-y-3.5"
      data-mfa-step={method}
    >
      <div>
        <h2 className="text-sm font-bold text-main flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span>{t('mfa.title')}</span>
        </h2>
        <p className="text-muted mt-1">{method === 'totp' ? t('mfa.intro') : method === 'passkey' ? t('mfa.introPasskey') : t('mfa.introRecovery')}</p>
      </div>

      {error && (
        <div role="alert" className="alert-err flex items-center gap-2">
          <CircleAlert className="w-4 h-4 text-status-err flex-shrink-0" />
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

      {method === 'passkey' ? (
        passkeyButton(true)
      ) : (
        <>
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
          {method === 'totp' && hasPasskey && passkeyButton(false)}
        </>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-1 pt-1 border-t border-border">
        <button
          type="button"
          onClick={() => onBack()}
          className="h-11 sm:h-8 text-muted hover:text-main flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('mfa.back')}</span>
        </button>
        {other && (
          <button type="button" onClick={() => switchTo(other.to)} className="h-11 sm:h-8 text-accent hover:underline flex items-center gap-1.5">
            {other.to === 'passkey' ? <FingerprintPattern className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
            <span>{other.label}</span>
          </button>
        )}
      </div>
    </form>
  );
};
