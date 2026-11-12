import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { AlertCircle, AlertTriangle, Check, Copy, Download, Monitor, ShieldCheck, ShieldOff, Smartphone, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { MfaStatus, User } from '../../../lib/types';
import { formatDate } from '../../../lib/format';
import { saveBlob } from '../../../lib/download';
import { trustedDeviceId } from '../../../lib/trustedDevice';
import { FormSheet } from '../../../components/FormSheet';
import { describeDevice } from '../SessionsPanel';
import { TotpQrCode } from './TotpQrCode';
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
// or key, first code, recovery codes once), and when on: codes left, new codes, switch off (password and
// code), trusted devices.
export function TwoFactorCard({ currentUser, demoMode }: { currentUser: User; demoMode: boolean }) {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [copied, setCopied] = useState<'secret' | 'codes' | ''>('');
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
  }, []);

  const reset = (next: Flow = { step: 'idle' }) => {
    setFlow(next);
    setPassword('');
    setCode('');
    setError('');
  };

  const copy = (text: string, what: 'secret' | 'codes') => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(''), 2000);
    });
  };

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      const res = await api.setupTotp(password);
      reset({ step: 'scan', secret: res.secret, uri: res.uri });
    } catch (err: any) {
      setError(err?.message || t('security.twoFactor.failed'));
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
      reset({ step: 'codes', codes: res.recoveryCodes });
      setDone(t('security.twoFactor.enabledDone'));
      void load();
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

  const submitSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (sheet === 'disable') {
        await api.disableTotp(currentUser.id, password, code);
        reset();
        setDone(t('security.twoFactor.disabled'));
      } else {
        const res = await api.newRecoveryCodes(password, code);
        reset({ step: 'codes', codes: res.recoveryCodes });
        setDone('');
      }
      setSheet(null);
      void load();
    } catch (err: any) {
      setError(err?.message || t('security.twoFactor.failed'));
    } finally {
      setBusy(false);
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

  const downloadCodes = (codes: string[]) => {
    const text = `${t('security.twoFactor.codesFileTitle', { account: currentUser.email || currentUser.username })}\n\n${codes.join('\n')}\n`;
    saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'mindsift-recovery-codes.txt');
  };

  const enabled = Boolean(status?.totp.enabled);
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
          <span className={`shrink-0 ${enabled ? 'badge-accent' : 'text-[11px] text-muted border border-border rounded-pill px-2 py-0.5'}`}>
            {enabled ? t('security.twoFactor.on') : t('security.twoFactor.off')}
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

          {/* Off: start with the password */}
          {!enabled && flow.step === 'idle' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-card border border-border bg-canvas">
              <p className="text-[11px] text-muted">{t('security.twoFactor.offHint')}</p>
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
            <form onSubmit={startSetup} className="p-3.5 rounded-card border border-border bg-canvas space-y-3">
              <label className="block text-muted">
                {t('security.twoFactor.passwordHint')}
                <input
                  type="password"
                  autoFocus
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 input-field w-full h-11 sm:h-9 px-3 text-base sm:text-xs"
                />
              </label>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => reset()} className="btn-action h-11 sm:h-8 px-3 text-xs">
                  {t('common:cancel')}
                </button>
                <button type="submit" disabled={busy || !password} className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold disabled:opacity-50">
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
                      onClick={() => copy(flow.secret, 'secret')}
                      className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5"
                    >
                      {copied === 'secret' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied === 'secret' ? t('security.twoFactor.copied') : t('security.twoFactor.copy')}</span>
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
            <div className="p-3.5 rounded-card border border-accent/40 bg-accent/5 space-y-3" data-recovery-codes>
              <div>
                <p className="font-semibold text-main">{t('security.twoFactor.codesTitle')}</p>
                <p className="text-[11px] text-muted">{t('security.twoFactor.codesIntro')}</p>
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm text-main bg-panel border border-border rounded-btn p-3">
                {flow.codes.map((c) => (
                  <li key={c} data-recovery-code>
                    {c}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => copy(flow.codes.join('\n'), 'codes')}
                  className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5"
                >
                  {copied === 'codes' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied === 'codes' ? t('security.twoFactor.copied') : t('security.twoFactor.copyCodes')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadCodes(flow.codes)}
                  className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('security.twoFactor.downloadCodes')}</span>
                </button>
                <button type="button" onClick={() => reset()} className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold sm:ml-auto">
                  {t('security.twoFactor.codesDone')}
                </button>
              </div>
            </div>
          )}

          {/* On: since when, codes left, new codes, switch off */}
          {enabled && flow.step === 'idle' && (
            <div className="p-3.5 rounded-card border border-border bg-canvas space-y-3">
              <div className="text-[11px] space-y-1">
                <p className="text-main">{t('security.twoFactor.enabledSince', { date: formatDate(status.totp.enabledAt, { dateStyle: 'medium' }) })}</p>
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
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setSheet('disable');
                  }}
                  className="btn-danger h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 sm:ml-auto"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                  <span>{t('security.twoFactor.disable')}</span>
                </button>
              </div>
            </div>
          )}

          {enabled && (
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
          title={sheet === 'disable' ? t('security.twoFactor.disable') : t('security.twoFactor.newCodes')}
          icon={sheet === 'disable' ? <ShieldOff className="w-4 h-4 text-status-err" /> : <ShieldCheck className="w-4 h-4 text-accent" />}
          onClose={() => {
            setSheet(null);
            reset();
          }}
          onSubmit={submitSheet}
          submitLabel={sheet === 'disable' ? t('security.twoFactor.disable') : t('security.twoFactor.newCodesSubmit')}
          danger={sheet === 'disable'}
          busy={busy || !password || !code.trim()}
        >
          <p className="text-xs text-muted">{sheet === 'disable' ? t('security.twoFactor.disableHint') : t('security.twoFactor.newCodesHint')}</p>
          <label className="block text-xs text-muted">
            {t('security.twoFactor.password')}
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
            />
          </label>
          <label className="block text-xs text-muted">
            {t('security.twoFactor.codeOrRecovery')}
            <input
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono"
            />
          </label>
          {error && <p className="text-[11px] text-status-err">{error}</p>}
        </FormSheet>
      )}
    </div>
  );
}
