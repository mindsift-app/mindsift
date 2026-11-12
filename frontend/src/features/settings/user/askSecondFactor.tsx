import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { AlertCircle, Check, Fingerprint, ShieldCheck, X } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import { MfaStatus, SecondFactorProof } from '../../../lib/types';
import { passkeyCancelled } from '../../../lib/webauthn';
import { FormSheet } from '../../../components/FormSheet';
import { passkeyProof, secondFactorOf } from './SecondFactorFields';
import { oidcName, startOidcConfirm, takeOidcResult, type OidcResult } from '../../../lib/oidc';

const EVENT = 'mindsift:ask-second-factor';
const OIDC_EVENT = 'mindsift:ask-oidc-confirm';

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
// again. Cancelling ends with an error saying nothing was changed. An account of the OIDC provider confirms
// there instead (oidc_confirm_required): the sheet offers the new sign-in, the browser leaves for the provider
// and comes back here; the change is then made once more.
export async function withSecondFactor<T>(run: (proof?: SecondFactorProof) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'oidc_confirm_required') {
      window.dispatchEvent(new CustomEvent(OIDC_EVENT));
      throw new ApiError(i18n.t('settings:security.oidc.confirmFirst', { name: oidcName() }), 403, 'mfa_cancelled');
    }
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

// Mounted once in the app: the sheets withSecondFactor opens, and what the return from the OIDC provider says
export const SecondFactorHost: React.FC = () => (
  <>
    <SecondFactorSheet />
    <OidcConfirmSheet />
    <OidcReturnToast />
  </>
);

// Confirming at the OIDC provider: sign in there again (the page leaves and comes back)
function OidcConfirmSheet() {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const onAsk = () => {
      setOpen(true);
      setBusy(false);
      setError('');
    };
    window.addEventListener(OIDC_EVENT, onAsk);
    return () => window.removeEventListener(OIDC_EVENT, onAsk);
  }, []);
  if (!open) return null;
  const name = oidcName();
  return (
    <FormSheet
      title={t('security.oidc.confirmTitle')}
      icon={<ShieldCheck className="w-4 h-4 text-accent" />}
      submitLabel={t('security.oidc.confirmButton', { name })}
      busy={busy}
      onClose={() => setOpen(false)}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        startOidcConfirm().catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        });
      }}
    >
      <div className="space-y-3" data-oidc-confirm-prompt>
        <p className="text-xs text-muted">{t('security.oidc.confirmIntro', { name })}</p>
        {error && (
          <div role="alert" className="alert-err flex items-center gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </FormSheet>
  );
}

// Back from the provider while signed in: confirmed (for a few minutes), linked, or why not
function OidcReturnToast() {
  const { t } = useTranslation('settings');
  const [result, setResult] = useState<OidcResult | null>(null);
  useEffect(() => {
    const r = takeOidcResult();
    if (r && r.kind !== 'signedIn') setResult(r);
  }, []);
  if (!result) return null;
  const ok = result.kind === 'confirmed';
  const text =
    result.kind === 'error'
      ? result.message
      : result.kind === 'confirmed' && result.linked
        ? t('security.oidc.linkedDone', { name: oidcName() })
        : t('security.oidc.confirmedDone', { name: oidcName() });
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className="fixed z-[70] left-4 right-4 sm:left-auto sm:right-6 sm:w-96 top-[calc(4.5rem+env(safe-area-inset-top))] sm:top-auto sm:bottom-6 p-3 rounded-xl border border-border bg-panel shadow-lg flex items-start gap-2.5 text-sm"
      data-oidc-result
    >
      {ok ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-status-ok" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-status-err" />}
      <p className="flex-1 min-w-0 text-main">{text}</p>
      <button
        type="button"
        onClick={() => setResult(null)}
        title={t('common:close')}
        aria-label={t('common:close')}
        className="h-11 w-11 sm:h-7 sm:w-7 -m-1.5 flex items-center justify-center rounded-lg text-muted hover:text-main"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function SecondFactorSheet() {
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
}
