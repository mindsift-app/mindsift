import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { AlertCircle, Fingerprint, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import { MfaStatus, SecondFactorProof } from '../../../lib/types';
import { passkeyCancelled } from '../../../lib/webauthn';
import { FormSheet } from '../../../components/FormSheet';
import { passkeyProof, secondFactorOf } from './SecondFactorFields';

const EVENT = 'mindsift:ask-second-factor';

interface Request {
  error: string;
  resolve: (proof: SecondFactorProof | null) => void;
}

// Asks for a code of the app, a recovery code or the passkey; null when the person cancels.
function askSecondFactor(error = ''): Promise<SecondFactorProof | null> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: { error, resolve } }));
  });
}

// Runs a sensitive change (new password or address, deleting, a new API key). When the server wants the second
// factor of the account (mfa_required), it asks for it and runs the change again with it; a wrong code asks
// again. Cancelling ends with an error saying nothing was changed.
export async function withSecondFactor<T>(run: (proof?: SecondFactorProof) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'mfa_required') throw err;
  }
  let error = '';
  for (;;) {
    const proof = await askSecondFactor(error);
    if (!proof) throw new ApiError(i18n.t('settings:security.confirm.cancelled'), 403, 'mfa_cancelled');
    try {
      return await run(proof);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'mfa_invalid') throw err;
      error = err.message;
    }
  }
}

// Mounted once in the app: the sheet withSecondFactor opens
export const SecondFactorHost: React.FC = () => {
  const { t } = useTranslation('settings');
  const [req, setReq] = useState<Request | null>(null);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<Request>).detail;
      setReq((prev) => {
        prev?.resolve(null); // a new question replaces an open one
        return detail;
      });
      setCode('');
      setError(detail.error);
      api.getMfaStatus().then(setStatus).catch(() => setStatus(null));
    };
    window.addEventListener(EVENT, onAsk);
    return () => window.removeEventListener(EVENT, onAsk);
  }, []);

  if (!req) return null;
  const factor = secondFactorOf(status);
  const close = (proof: SecondFactorProof | null) => {
    req.resolve(proof);
    setReq(null);
  };
  const withPasskey = async () => {
    setError('');
    try {
      close(await passkeyProof());
    } catch (err) {
      if (!passkeyCancelled(err)) setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <FormSheet
      title={t('security.confirm.title')}
      icon={<ShieldCheck className="w-4 h-4 text-accent" />}
      submitLabel={t('security.confirm.submit')}
      onClose={() => close(null)}
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) close({ code: code.trim() });
      }}
    >
      <div className="space-y-3" data-second-factor-prompt>
        <p className="text-xs text-muted">{t('security.confirm.intro')}</p>
        <label className="block text-xs text-muted">
          {factor.app ? t('security.twoFactor.codeOrRecovery') : t('security.twoFactor.recoveryOnly')}
          <input
            type="text"
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono"
          />
        </label>
        {factor.passkey && (
          <button
            type="button"
            onClick={() => void withPasskey()}
            className="btn-action w-full h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5"
            data-confirm-passkey
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span>{t('security.twoFactor.confirmWithPasskey')}</span>
          </button>
        )}
        {error && (
          <div role="alert" className="alert-err flex items-center gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </FormSheet>
  );
};
