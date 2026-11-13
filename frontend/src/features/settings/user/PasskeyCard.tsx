import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { CircleAlert, TriangleAlert, Check, Cloud, FingerprintPattern, KeyRound, Pencil, Trash } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import { MfaStatus, Passkey, SecondFactorProof, User } from '../../../lib/types';
import { formatDate } from '../../../lib/format';
import { createPasskey, PasskeyJSON, passkeyCancelled, passkeysSupported } from '../../../lib/webauthn';
import { FormSheet } from '../../../components/FormSheet';
import { describeDevice } from '../SessionsPanel';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { passkeyProof, secondFactorOf, SecondFactorFields } from './SecondFactorFields';
import { errorMessage } from '../../../lib/errorMessage';

type Flow =
  | { step: 'idle' }
  // Password (and second factor, when the account has one) before the browser is asked
  | { step: 'confirm' }
  // The options are there: the name, then navigator.credentials.create() right in the click
  | { step: 'name'; token: string; options: PasskeyJSON }
  | { step: 'codes'; codes: string[] };

// Einstellungen → Sicherheit → Passkeys: the own passkeys (name, created, last used, synced), add one
// (password and second factor, name, the browser's dialog; the first second factor shows the recovery
// codes), rename, remove (password and second factor; the last one switches two-factor sign-in off).
// Passkeys need BASE_URL with https: otherwise the card says why. refreshKey/onChanged as TwoFactorCard.
export function PasskeyCard({
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
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const factor = secondFactorOf(status);

  const load = async () => {
    try {
      setStatus(await api.getMfaStatus());
      setLoadError('');
    } catch (err) {
      setLoadError(errorMessage(err, i18n.t('settings:security.twoFactor.loadFailed')));
    }
  };
  useEffect(() => {
    // Loads the status when the card opens and after changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const fail = (err: unknown) => {
    if (!passkeyCancelled(err)) setError(errorMessage(err, t('security.passkeys.failed')));
  };

  const confirm = async (proof?: SecondFactorProof) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const res = factor.needed ? await api.passkeyRegisterOptions(password, proof ?? { code }) : await api.passkeyRegisterOptions(password);
      setName(describeDevice(navigator.userAgent).label);
      reset({ step: 'name', token: res.token, options: res.options });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // Right in the click: Safari only opens the passkey dialog during a user's action
  const create = async () => {
    if (flow.step !== 'name' || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const credential = await createPasskey(flow.options);
      const res = await api.registerPasskey(flow.token, name.trim(), credential);
      if (res.recoveryCodes?.length) {
        reset({ step: 'codes', codes: res.recoveryCodes });
        setDone(t('security.passkeys.addedFirst'));
      } else {
        reset();
        setDone(t('security.passkeys.added'));
      }
      changed();
    } catch (err) {
      // Cancelled in the browser: the step stays, the options are still valid for a while
      if (passkeyCancelled(err)) return;
      fail(err);
      if (err instanceof ApiError && err.code === 'passkey_expired') reset();
    } finally {
      setBusy(false);
    }
  };

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming || !renaming.name.trim()) return;
    setError('');
    try {
      await api.renamePasskey(renaming.id, renaming.name.trim());
      setRenaming(null);
      void load();
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (proof: SecondFactorProof) => {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.removePasskey(currentUser.id, removing.id, password, proof);
      setRemoving(null);
      reset();
      setDone(res?.mfaOff ? t('security.passkeys.removedOff') : t('security.passkeys.removed'));
      changed();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const withPasskey = async (run: (proof: SecondFactorProof) => Promise<void>) => {
    setError('');
    try {
      await run(await passkeyProof());
    } catch (err) {
      fail(err);
    }
  };

  const passkeys = status?.passkeys ?? [];
  const off = status?.passkeysOff || '';
  const browserCan = passkeysSupported();
  // Removing this one leaves no second factor: two-factor sign-in goes off
  const lastFactor = passkeys.length === 1 && !status?.totp.enabled;

  return (
    <div className="space-y-3" data-security-card="passkeys">
      <div>
        <h3 className="text-xs font-bold text-main flex items-center gap-1.5">
          <FingerprintPattern className="w-3.5 h-3.5 text-accent" />
          <span>{t('security.passkeys.title')}</span>
        </h3>
        <p className="text-[11px] text-muted">{t('security.passkeys.intro')}</p>
      </div>

      {demoMode || status?.available === false ? (
        <p className="text-[11px] text-muted p-3 rounded-card border border-border bg-canvas">{t('security.twoFactor.demo')}</p>
      ) : loadError ? (
        <p className="text-[11px] text-status-err">{loadError}</p>
      ) : !status ? (
        <p className="text-[11px] text-muted">{t('security.twoFactor.loading')}</p>
      ) : (
        <>
          {off && (
            <p className="text-[11px] text-muted p-3 rounded-card border border-border bg-canvas" data-passkeys-off={off}>
              {t(`security.passkeys.off_${off}`)}
            </p>
          )}
          {!off && !browserCan && <p className="text-[11px] text-muted p-3 rounded-card border border-border bg-canvas">{t('security.passkeys.unsupported')}</p>}
          {done && (
            <div role="status" className="alert-ok flex items-center gap-2">
              <Check className="w-4 h-4 text-status-ok flex-shrink-0" />
              <span>{done}</span>
            </div>
          )}
          {error && !removing && (
            <div role="alert" className="alert-err flex items-center gap-2">
              <CircleAlert className="w-4 h-4 text-status-err flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {passkeys.length > 0 && (
            <ul className="divide-y divide-border rounded-card border border-border bg-canvas" data-passkey-list>
              {passkeys.map((p) => (
                <li key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 text-xs" data-passkey>
                  {renaming?.id === p.id ? (
                    <form onSubmit={saveName} className="flex flex-col sm:flex-row gap-2 w-full">
                      <input
                        autoFocus
                        maxLength={60}
                        aria-label={t('security.passkeys.nameLabel')}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                        className="input-field h-11 sm:h-8 px-2.5 text-base sm:text-xs flex-1 min-w-0"
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setRenaming(null)} className="btn-action h-11 sm:h-8 px-3 text-xs flex-1 sm:flex-none">
                          {t('common:cancel')}
                        </button>
                        <button type="submit" disabled={!renaming.name.trim()} className="btn-primary h-11 sm:h-8 px-3 text-xs font-semibold flex-1 sm:flex-none disabled:opacity-50">
                          {t('security.passkeys.save')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <KeyRound size={16} className="text-muted shrink-0" />
                        <div className="min-w-0">
                          <p className="font-semibold text-main truncate flex items-center gap-2">
                            <span className="truncate">{p.name}</span>
                            {p.synced && (
                              <span title={t('security.passkeys.syncedHint')} className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-accent">
                                <Cloud size={11} />
                                {t('security.passkeys.synced')}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-faint">
                            {t('security.passkeys.createdOn', { date: formatDate(p.createdAt, { dateStyle: 'medium' }) })}
                            {' · '}
                            {p.lastUsedAt ? t('security.passkeys.lastUsed', { date: formatDate(p.lastUsedAt, { dateStyle: 'medium' }) }) : t('security.passkeys.neverUsed')}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 sm:shrink-0">
                        <button
                          type="button"
                          onClick={() => setRenaming({ id: p.id, name: p.name })}
                          className="btn-secondary h-11 sm:h-8 px-3 text-xs flex-1 sm:flex-none flex items-center justify-center gap-1.5"
                        >
                          <Pencil size={13} />
                          <span>{t('security.passkeys.rename')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            reset();
                            setDone('');
                            setRemoving(p);
                          }}
                          className="btn-secondary h-11 sm:h-8 px-3 text-xs flex-1 sm:flex-none flex items-center justify-center gap-1.5"
                        >
                          <Trash size={13} />
                          <span>{t('security.passkeys.remove')}</span>
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!off && browserCan && flow.step === 'idle' && (
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                passkeys.length === 0 ? 'p-3.5 rounded-card border border-border bg-canvas' : 'sm:justify-end'
              }`}
            >
              {passkeys.length === 0 && <p className="text-[11px] text-muted">{t('security.passkeys.none')}</p>}
              <button
                type="button"
                onClick={() => {
                  reset({ step: 'confirm' });
                  setDone('');
                }}
                className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold shrink-0 flex items-center justify-center gap-1.5"
              >
                <FingerprintPattern className="w-3.5 h-3.5" />
                <span>{t('security.passkeys.add')}</span>
              </button>
            </div>
          )}

          {flow.step === 'confirm' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void confirm();
              }}
              className="p-3.5 rounded-card border border-border bg-canvas space-y-3"
              data-passkey-setup="confirm"
            >
              <SecondFactorFields
                status={status}
                password={password}
                onPassword={setPassword}
                code={code}
                onCode={setCode}
                busy={busy}
                passwordLabel={t('security.passkeys.passwordHint')}
                onPasskey={() => void withPasskey(confirm)}
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
                  {t('security.passkeys.continue')}
                </button>
              </div>
            </form>
          )}

          {flow.step === 'name' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
              className="p-3.5 rounded-card border border-border bg-canvas space-y-3"
              data-passkey-setup="name"
            >
              <label className="block text-xs text-muted">
                {t('security.passkeys.nameLabel')}
                <input
                  autoFocus
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
                />
              </label>
              <p className="text-[11px] text-muted">{t('security.passkeys.nameHint')}</p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => reset()} className="btn-action h-11 sm:h-8 px-3 text-xs">
                  {t('common:cancel')}
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <FingerprintPattern className="w-3.5 h-3.5" />
                  <span>{busy ? t('security.passkeys.creating') : t('security.passkeys.create')}</span>
                </button>
              </div>
            </form>
          )}

          {flow.step === 'codes' && (
            <RecoveryCodesPanel codes={flow.codes} account={currentUser.email || currentUser.username || ''} onDone={() => reset()} />
          )}
        </>
      )}

      {removing && (
        <FormSheet
          title={t('security.passkeys.removeTitle')}
          icon={<Trash className="w-4 h-4 text-status-err" />}
          onClose={() => {
            setRemoving(null);
            reset();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void remove({ code });
          }}
          submitLabel={t('security.passkeys.remove')}
          danger
          busy={busy || !password || !code.trim()}
        >
          <p className="text-xs text-muted">{t('security.passkeys.removeHint', { name: removing.name })}</p>
          {lastFactor && (
            <p role="alert" className="text-xs text-status-err flex items-start gap-1.5" data-last-factor>
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{t('security.passkeys.removeLast')}</span>
            </p>
          )}
          <SecondFactorFields
            status={status}
            password={password}
            onPassword={setPassword}
            code={code}
            onCode={setCode}
            busy={busy}
            onPasskey={() => void withPasskey(remove)}
          />
          {error && <p className="text-[11px] text-status-err">{error}</p>}
        </FormSheet>
      )}
    </div>
  );
}
