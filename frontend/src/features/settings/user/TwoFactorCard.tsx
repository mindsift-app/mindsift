import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { AlertCircle, AlertTriangle, Check, Copy, Monitor, ShieldCheck, ShieldOff, Smartphone, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { MfaStatus, SecondFactorProof, User } from '../../../lib/types';
import { formatDate } from '../../../lib/format';
import { trustedDeviceId } from '../../../lib/trustedDevice';
import { passkeyCancelled } from '../../../lib/webauthn';
import { FormSheet } from '../../../components/FormSheet';
import { describeDevice } from '../SessionsPanel';
import { TotpQrCode } from './TotpQrCode';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { passkeyProof, secondFactorOf, SecondFactorFields } from './SecondFactorFields';
import { LOW_RECOVERY_CODES } from '../../auth/MfaStep';

type Flow =
  | { step: 'idle' }
  | { step: 'password' }
  | { step: 'scan'; secret: string; uri: string }
  | { step: 'codes'; codes: string[] };

// What the sheet asking password and code confirms
type SheetAction = 'disable' | 'codes';

const groupSecret = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

// Einstellungen → Sicherheit → Zwei-Faktor-Anmeldung: switch the authenticator app on (password, QR code
// or key, first code, recovery codes once), and while a second factor is on (app or passkey, PasskeyCard):
// codes left, new codes, remove the app (password and second factor), trusted devices. refreshKey: the
// passkeys changed, load again; onChanged tells the passkeys about changes here.
export function TwoFactorCard({
  currentUser,
  demoMode,
  refreshKey = 0,
  onChanged,
}: {
  currentUser: User;
  demoMode: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<SheetAction | null>(null);
  const confirming = useRef(false);

  const load = async () => {
    try {
      setStatus(await api.getMfaStatus());
      setLoadError('');
    } catch (err: any) {
      setLoadError(err?.message || i18n.t('settings:security.twoFactor.loadFailed'));
    }
  };
  useEffect(() => {
    void load();
  }, [refreshKey]);

  const changed = () => {
    void load();
    onChanged?.();
  };

  const reset = (next: Flow = { step: 'idle' }) => {
    setFlow(next);
    setPassword('');
    setCode('');
    setError('');
  };

  const copySecret = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const factor = secondFactorOf(status);

  // proof: the account has passkeys already, a second factor confirms the new app too
  const startSetup = async (proof?: SecondFactorProof) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const res = factor.needed ? await api.setupTotp(password, proof ?? { code }) : await api.setupTotp(password);
      reset({ step: 'scan', secret: res.secret, uri: res.uri });
    } catch (err: any) {
      if (!passkeyCancelled(err)) setError(err?.message || t('security.twoFactor.failed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (value: string) => {
    if (confirming.current || flow.step !== 'scan') return;
    confirming.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await api.confirmTotp(value);
      // An account with passkeys keeps its recovery codes: none to show
      reset(res.recoveryCodes?.length ? { step: 'codes', codes: res.recoveryCodes } : { step: 'idle' });
      setDone(t('security.twoFactor.enabledDone'));
      changed();
    } catch (err: any) {
      setError(err?.message || t('security.twoFactor.failed'));
      setCode('');
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  };

  const onSetupCode = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void confirmSetup(digits);
  };

  const runSheet = async (proof: SecondFactorProof) => {
    setBusy(true);
    setError('');
    try {
      if (sheet === 'disable') {
        const res = await api.disableTotp(currentUser.id, password, proof);
        reset();
        setDone(res?.mfaOff === false ? t('security.twoFactor.appRemoved') : t('security.twoFactor.disabled'));
      } else {
        const res = await api.newRecoveryCodes(password, proof);
        reset({ step: 'codes', codes: res.recoveryCodes });
        setDone('');
      }
      setSheet(null);
      changed();
    } catch (err: any) {
      if (!passkeyCancelled(err)) setError(err?.message || t('security.twoFactor.failed'));
    } finally {
      setBusy(false);
    }
  };

  const withPasskey = async (run: (proof: SecondFactorProof) => Promise<void>) => {
    setError('');
    try {
      await run(await passkeyProof());
    } catch (err: any) {
      if (!passkeyCancelled(err)) setError(err?.message || t('security.twoFactor.failed'));
    }
  };

  const removeDevice = async (id?: string) => {
    setError('');
    try {
      await api.removeTrustedDevice(currentUser.id, id);
      void load();
    } catch (err: any) {
      setError(err?.message || t('security.twoFactor.failed'));
    }
  };

  const appOn = Boolean(status?.totp.enabled);
  const passkeyCount = status?.passkeys?.length ?? 0;
  const anyOn = appOn || passkeyCount > 0;
  const thisDevice = trustedDeviceId(currentUser.id);

  return (
    <div className="space-y-3" data-security-card="two-factor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-main flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-accent" />
            <span>{t('security.twoFactor.title')}</span>
          </h3>
          <p className="text-[11px] text-muted">{t('security.twoFactor.intro')}</p>
        </div>
        {status && !demoMode && (
          <span className={`shrink-0 ${anyOn ? 'badge-accent' : 'text-[11px] text-muted border border-border rounded-pill px-2 py-0.5'}`}>
            {anyOn ? t('security.twoFactor.on') : t('security.twoFactor.off')}
          </span>
        )}
      </div>

      {demoMode || status?.available === false ? (
        <p className="text-[11px] text-muted p-3 rounded-card border border-border bg-canvas">{t('security.twoFactor.demo')}</p>
      ) : loadError ? (
        <p className="text-[11px] text-status-err">{loadError}</p>
      ) : !status ? (
        <p className="text-[11px] text-muted">{t('security.twoFactor.loading')}</p>
      ) : (
        <>
          {done && (
            <div role="status" className="alert-ok flex items-center gap-2">
              <Check className="w-4 h-4 text-status-ok flex-shrink-0" />
              <span>{done}</span>
            </div>
          )}
          {error && !sheet && (
            <div role="alert" className="alert-err flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* No app: set it up, starting with the password */}
          {!appOn && flow.step === 'idle' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-card border border-border bg-canvas">
              <p className="text-[11px] text-muted">{anyOn ? t('security.twoFactor.appOffWithPasskeys') : t('security.twoFactor.offHint')}</p>
              <button
                type="button"
                onClick={() => {
                  reset({ step: 'password' });
                  setDone('');
                }}
                className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold shrink-0"
              >
                {t('security.twoFactor.setUp')}
              </button>
            </div>
          )}

          {flow.step === 'password' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void startSetup();
              }}
              className="p-3.5 rounded-card border border-border bg-canvas space-y-3"
            >
              {factor.needed && <p className="text-[11px] text-muted">{t('security.twoFactor.setupConfirmHint')}</p>}
              <SecondFactorFields
                status={status}
                password={password}
                onPassword={setPassword}
                code={code}
                onCode={setCode}
                busy={busy}
                passwordLabel={t('security.twoFactor.passwordHint')}
                onPasskey={() => void withPasskey(startSetup)}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => reset()} className="btn-action h-11 sm:h-8 px-3 text-xs">
                  {t('common:cancel')}
                </button>
                <button
                  type="submit"
                  disabled={busy || !password || (factor.needed && !code.trim())}
                  className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold disabled:opacity-50"
                >
                  {t('security.twoFactor.continue')}
                </button>
              </div>
            </form>
          )}

          {flow.step === 'scan' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void confirmSetup(code);
              }}
              className="p-3.5 rounded-card border border-border bg-canvas space-y-4"
              data-totp-setup
            >
              <div className="space-y-2">
                <p className="font-semibold text-main">{t('security.twoFactor.scanTitle')}</p>
                <p className="text-[11px] text-muted">{t('security.twoFactor.scanHint')}</p>
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                  <TotpQrCode value={flow.uri} label={t('security.twoFactor.qrLabel')} />
                  <div className="w-full min-w-0 space-y-1.5">
                    <p className="text-[11px] text-muted">{t('security.twoFactor.secretLabel')}</p>
                    <code className="block font-mono text-sm text-main break-all bg-panel border border-border rounded-btn px-2.5 py-2 select-all" data-totp-secret>
                      {groupSecret(flow.secret)}
                    </code>
                    <button
                      type="button"
                      onClick={() => copySecret(flow.secret)}
                      className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? t('security.twoFactor.copied') : t('security.twoFactor.copy')}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-2 pt-3 border-t border-border">
                <p className="font-semibold text-main">{t('security.twoFactor.codeTitle')}</p>
                <p className="text-[11px] text-muted">{t('security.twoFactor.codeHint')}</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123456"
                    aria-label={t('security.twoFactor.code')}
                    value={code}
                    onChange={(e) => onSetupCode(e.target.value)}
                    disabled={busy}
                    className="input-field h-11 sm:h-9 px-3 sm:w-40 text-base sm:text-sm font-mono tracking-[0.3em] text-center"
                  />
                  <button type="submit" disabled={busy || code.length !== 6} className="btn-primary h-11 sm:h-9 px-4 text-xs font-semibold disabled:opacity-50">
                    {busy ? t('security.twoFactor.confirming') : t('security.twoFactor.confirm')}
                  </button>
                  <button type="button" onClick={() => reset()} className="btn-action h-11 sm:h-9 px-3 text-xs sm:ml-auto">
                    {t('common:cancel')}
                  </button>
                </div>
              </div>
            </form>
          )}

          {flow.step === 'codes' && (
            <RecoveryCodesPanel codes={flow.codes} account={currentUser.email || currentUser.username || ''} onDone={() => reset()} />
          )}

          {/* On (app or passkey): since when, codes left, new codes, remove the app */}
          {anyOn && flow.step === 'idle' && (
            <div className="p-3.5 rounded-card border border-border bg-canvas space-y-3">
              <div className="text-[11px] space-y-1">
                <p className="text-main">
                  {appOn
                    ? t('security.twoFactor.enabledSince', { date: formatDate(status.totp.enabledAt, { dateStyle: 'medium' }) })
                    : t('security.twoFactor.onWithPasskeys', { count: passkeyCount })}
                </p>
                <p className={status.recoveryCodesLeft <= LOW_RECOVERY_CODES ? 'text-status-err flex items-center gap-1.5' : 'text-muted'}>
                  {status.recoveryCodesLeft <= LOW_RECOVERY_CODES && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                  <span>
                    {t('security.twoFactor.codesLeft', { count: status.recoveryCodesLeft })}
                    {status.recoveryCodesLeft <= LOW_RECOVERY_CODES && ` ${t('security.twoFactor.codesLow')}`}
                  </span>
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setSheet('codes');
                  }}
                  className="btn-action h-11 sm:h-8 px-3 text-xs"
                >
                  {t('security.twoFactor.newCodes')}
                </button>
                {appOn && (
                  <button
                    type="button"
                    onClick={() => {
                      reset();
                      setSheet('disable');
                    }}
                    className="btn-danger h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 sm:ml-auto"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    <span>{passkeyCount > 0 ? t('security.twoFactor.removeApp') : t('security.twoFactor.disable')}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {anyOn && (
            <div className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-main">{t('security.twoFactor.trustedTitle')}</p>
                  <p className="text-[11px] text-muted">{t('security.twoFactor.trustedHint', { count: status.trustDays })}</p>
                </div>
                {status.trustedDevices.length > 1 && (
                  <button type="button" onClick={() => void removeDevice()} className="btn-action h-11 sm:h-8 px-3 text-xs shrink-0">
                    {t('security.twoFactor.forgetAll')}
                  </button>
                )}
              </div>
              {status.trustedDevices.length === 0 ? (
                <p className="text-[11px] text-faint">{t('security.twoFactor.trustedNone')}</p>
              ) : (
                <ul className="divide-y divide-border rounded-card border border-border bg-canvas">
                  {status.trustedDevices.map((d) => {
                    const device = describeDevice(d.userAgent);
                    const Icon = device.mobile ? Smartphone : Monitor;
                    return (
                      <li key={d.id} className="flex items-center gap-3 p-3 text-xs" data-trusted-device>
                        <Icon size={16} className="text-muted shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-main truncate">
                            {device.label}
                            {d.id === thisDevice && <span className="ml-2 text-[10px] font-semibold text-accent">{t('sessions.thisDevice')}</span>}
                          </p>
                          <p className="text-[11px] text-faint truncate">
                            {t('security.twoFactor.trustedUntil', { date: formatDate(d.expiresAt, { dateStyle: 'medium' }) })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeDevice(d.id)}
                          title={t('security.twoFactor.forget')}
                          className="btn-secondary min-h-[44px] sm:min-h-0 h-8 px-3 text-xs shrink-0 flex items-center gap-1.5"
                        >
                          <X size={13} />
                          <span>{t('security.twoFactor.forget')}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {sheet && (
        <FormSheet
          title={sheet === 'disable' ? (passkeyCount > 0 ? t('security.twoFactor.removeApp') : t('security.twoFactor.disable')) : t('security.twoFactor.newCodes')}
          icon={sheet === 'disable' ? <ShieldOff className="w-4 h-4 text-status-err" /> : <ShieldCheck className="w-4 h-4 text-accent" />}
          onClose={() => {
            setSheet(null);
            reset();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void runSheet({ code });
          }}
          submitLabel={sheet === 'disable' ? (passkeyCount > 0 ? t('security.twoFactor.removeApp') : t('security.twoFactor.disable')) : t('security.twoFactor.newCodesSubmit')}
          danger={sheet === 'disable'}
          busy={busy || !password || !code.trim()}
        >
          <p className="text-xs text-muted">
            {sheet === 'disable'
              ? passkeyCount > 0
                ? t('security.twoFactor.disableAppHint')
                : t('security.twoFactor.disableHint')
              : passkeyCount > 0
                ? t('security.twoFactor.newCodesHintPasskey')
                : t('security.twoFactor.newCodesHint')}
          </p>
          <SecondFactorFields
            status={status}
            password={password}
            onPassword={setPassword}
            code={code}
            onCode={setCode}
            busy={busy}
            onPasskey={() => void withPasskey(runSheet)}
          />
          {error && <p className="text-[11px] text-status-err">{error}</p>}
        </FormSheet>
      )}
    </div>
  );
}
