import { useTranslation } from 'react-i18next';
import { FingerprintPattern } from 'lucide-react';
import { api } from '../../../lib/api';
import { MfaStatus, SecondFactorProof } from '../../../lib/types';
import { getPasskey, passkeysSupported } from '../../../lib/webauthn';

// A passkey of the own account confirms a sensitive change: the server's challenge, answered in the browser
export async function passkeyProof(): Promise<SecondFactorProof> {
  const { passkeyToken, options } = await api.passkeyChallenge();
  return { passkeyToken, passkey: await getPasskey(options) };
}

// What the account can confirm with beside the password (the server's confirmWithSecondFactor)
export function secondFactorOf(status: MfaStatus | null) {
  const app = Boolean(status?.totp.enabled);
  const passkeys = (status?.passkeys?.length ?? 0) > 0;
  return {
    // any second factor is on: the password alone does not confirm
    needed: Boolean(status?.enabled) || app || passkeys,
    app,
    // a passkey can answer here (passkeys on at the server, a browser that can)
    passkey: passkeys && !status?.passkeysOff && passkeysSupported(),
  };
}

// Password and second factor of a sensitive change: a code of the app or a recovery code, or the passkey
// button (which sends the form with the passkey instead of the code).
export function SecondFactorFields({
  status,
  password,
  onPassword,
  code,
  onCode,
  onPasskey,
  busy,
  passwordLabel,
}: {
  status: MfaStatus | null;
  password: string;
  onPassword: (v: string) => void;
  code: string;
  onCode: (v: string) => void;
  onPasskey: () => void;
  busy: boolean;
  passwordLabel?: string;
}) {
  const { t } = useTranslation('settings');
  const factor = secondFactorOf(status);
  return (
    <>
      <label className="block text-xs text-muted">
        {passwordLabel || t('security.twoFactor.password')}
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
        />
      </label>
      {factor.needed && (
        <label className="block text-xs text-muted">
          {factor.app ? t('security.twoFactor.codeOrRecovery') : t('security.twoFactor.recoveryOnly')}
          <input
            type="text"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => onCode(e.target.value)}
            className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono"
          />
        </label>
      )}
      {factor.needed && factor.passkey && (
        <button
          type="button"
          onClick={onPasskey}
          disabled={busy || !password}
          className="btn-action w-full h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
          data-confirm-passkey
        >
          <FingerprintPattern className="w-3.5 h-3.5" />
          <span>{t('security.twoFactor.confirmWithPasskey')}</span>
        </button>
      )}
    </>
  );
}
