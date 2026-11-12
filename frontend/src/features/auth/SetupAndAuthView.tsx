import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  Brain,
  Shield,
  Lock,
  KeyRound,
  UserPlus,
  LogIn,
  Check,
  AlertCircle,
  Fingerprint,
} from 'lucide-react';
import { conditionalPasskeysAvailable, getPasskey, passkeyCancelled, passkeysSupported } from '../../lib/webauthn';
import { AuthStatus, MfaMethod, User } from '../../lib/types';
import { MfaStep } from './MfaStep';
import { api, ApiError, triggerHaptic } from '../../lib/api';
import { LegalLinks } from '../../components/LegalLinks';
import { passwordProblem } from '../../lib/password';
import { demoHintText } from '../../components/DemoHint';
import { SetupInstanceSection, useSetupChoices } from './SetupInstanceSection';
import { SetupMailSection, useSetupMail } from './SetupMailSection';
import { SetupSummary } from './SetupSummary';
import { useKeyboardRoom } from '../../lib/useKeyboardInset';

interface SetupAndAuthViewProps {
  authStatus: AuthStatus;
  onAuthenticated: (user: User) => void;
  resetToken?: string | null;
  onResetDone?: () => void;
  onResetCancel?: () => void;
}

export const SetupAndAuthView: React.FC<SetupAndAuthViewProps> = ({
  authStatus,
  onAuthenticated,
  resetToken,
  onResetDone,
  onResetCancel,
}) => {
  const { t } = useTranslation('auth');
  // --- Setup Wizard State ---
  // The keyboard must not cover the fields (phones)
  const keyboardRoom = useKeyboardRoom();
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  // Instance settings of the wizard (shared with FinishSetupView)
  const setupChoices = useSetupChoices(authStatus.instanceName);
  // Mail server when the environment sets none (no test mail before the account exists)
  const setupMail = useSetupMail();

  // --- Login / Invite / Register State ---
  // An invite link (?invite=CODE) opens the invite form with the code filled in
  const [linkInviteCode] = useState(() => new URLSearchParams(window.location.search).get('invite')?.trim().toUpperCase() || '');
  const [authTab, setAuthTab] = useState<'login' | 'invite' | 'register' | 'forgot' | 'reset'>(
    resetToken ? 'reset' : linkInviteCode ? 'invite' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(linkInviteCode);
  // Link from the confirmation mail (?verifyToken=…): confirm right away and say what happens next
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('verifyToken');
    if (!token) return;
    url.searchParams.delete('verifyToken');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    setAuthTab('login');
    api
      .verifyEmail(token)
      .then((res) => setNotice(res.message))
      .catch((err) => setError(err.message || i18n.t('auth:verify.invalidLink')));
  }, []);
  // Login refused because the address is not confirmed: offer to send the link again
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const resendVerification = async () => {
    setResendState('sending');
    try {
      await api.resendVerification(email.trim());
      setResendState('sent');
      setError(null);
      setNotice(t('verify.resent'));
    } catch (err: any) {
      setResendState('idle');
      setError(err.message || t('verify.sendFailed'));
    }
  };

  // The code is in the form now; it should not stay in the address bar (history, screenshots)
  useEffect(() => {
    if (!linkInviteCode) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, [linkInviteCode]);
  // Hint on the sign-up form: which addresses get in, and whether an admin approves first
  const registrationHint = (() => {
    const domains = (authStatus.registrationDomains || []).map((d) => '@' + d.replace(/^\*\./, '')).join(', ');
    switch (authStatus.registrationMode) {
      case 'approval':
        return t('register.hintApproval');
      case 'open':
        return authStatus.emailVerification ? t('register.hintVerify') : '';
      case 'domain':
        return domains ? t('register.hintDomain', { domains }) : '';
      case 'domain+approval':
        return domains
          ? t('register.hintDomainApproval', { domains })
          : t('register.hintApproval');
    }
    return '';
  })();
  const registrationHintFull =
    registrationHint && authStatus.emailVerification && authStatus.registrationMode !== 'open'
      ? t('register.hintVerifyFirst', { hint: registrationHint })
      : registrationHint;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Message of a login refused because the email address is not confirmed yet: while it shows, the link can be sent again
  const [unverifiedError, setUnverifiedError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  // Password right, the account has a second factor: its code or passkey comes next (MfaStep)
  const [mfa, setMfa] = useState<{ token: string; methods: MfaMethod[] } | null>(null);

  // Sign-in with a passkey (no password): the button, and the browser's autofill in the login field
  // (mediation "conditional") where the browser offers it. Only one passkey request can wait at a time:
  // the button stops the autofill one first, the autofill starts again afterwards (conditionalRun).
  const passkeysOn = Boolean(authStatus.passkeys) && passkeysSupported();
  const conditionalRequest = useRef<AbortController | null>(null);
  const [conditionalRun, setConditionalRun] = useState(0);
  useEffect(() => {
    if (!passkeysOn || authTab !== 'login' || mfa || authStatus.needsSetup) return;
    let stopped = false;
    let renew = 0;
    const run = async () => {
      if (stopped || !(await conditionalPasskeysAvailable()) || stopped) return;
      const ctrl = new AbortController();
      conditionalRequest.current = ctrl;
      let answered = false;
      try {
        const { token, options, expiresIn } = await api.passkeyLoginOptions();
        // A fresh challenge before this one expires on the server
        renew = window.setTimeout(() => ctrl.abort(), Math.max(30, (expiresIn || 300) - 30) * 1000);
        const credential = await getPasskey(options, { conditional: true, signal: ctrl.signal });
        answered = true;
        window.clearTimeout(renew);
        setError(null);
        setSubmitting(true);
        const res = await api.loginPasskey(token, credential);
        onAuthenticated(res.user);
      } catch (err: any) {
        window.clearTimeout(renew);
        // Stopped for the button or the form went away: nothing to say
        if (stopped || conditionalRequest.current !== ctrl) return;
        if (answered) setSubmitting(false);
        if (answered && !passkeyCancelled(err)) setError(err?.message || i18n.t('auth:login.passkeyFailed'));
        // The timer ran out or the server refused the passkey: offer the autofill again
        if (answered || ctrl.signal.aborted) void run();
      }
    };
    void run();
    return () => {
      stopped = true;
      window.clearTimeout(renew);
      conditionalRequest.current?.abort();
      conditionalRequest.current = null;
    };
    // onAuthenticated is the app's sign-in callback and stays the same
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkeysOn, authTab, mfa, authStatus.needsSetup, conditionalRun]);

  const handlePasskeyLogin = async () => {
    const pending = conditionalRequest.current;
    conditionalRequest.current = null;
    pending?.abort();
    setError(null);
    setUnverifiedError(null);
    setNotice(null);
    setSubmitting(true);
    triggerHaptic(15);
    try {
      const { token, options } = await api.passkeyLoginOptions();
      const credential = await getPasskey(options);
      const res = await api.loginPasskey(token, credential);
      onAuthenticated(res.user);
    } catch (err: any) {
      if (!passkeyCancelled(err)) setError(err?.message || t('login.passkeyFailed'));
      setSubmitting(false);
      setConditionalRun((n) => n + 1);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.requestPasswordReset(email.trim());
      setNotice(t('forgot.sent'));
      setAuthTab('login');
    } catch (err: any) {
      setError(err.message || t('forgot.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const resetProblem = passwordProblem(newPassword);
    if (resetProblem) {
      setError(resetProblem);
      triggerHaptic(25);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError(t('password.noMatch'));
      triggerHaptic(25);
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(resetToken || '', newPassword);
      setNewPassword('');
      setNewPasswordConfirm('');
      setPassword('');
      setNotice(t('reset.done'));
      setAuthTab('login');
      onResetDone?.();
    } catch (err: any) {
      setError(err.message || t('reset.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const setupProblem = passwordProblem(setupPassword);
    if (setupProblem) {
      setError(setupProblem);
      triggerHaptic(25);
      return;
    }
    if (setupPassword !== setupPasswordConfirm) {
      setError(t('password.noMatch'));
      triggerHaptic(25);
      return;
    }
    const choicesProblem = setupChoices.problem || setupMail.problem;
    if (choicesProblem) {
      setError(choicesProblem);
      triggerHaptic(25);
      return;
    }

    setSubmitting(true);
    triggerHaptic(15);
    try {
      const res = await api.completeSetup({
        email: setupEmail.trim(),
        password: setupPassword,
        displayName: setupName.trim(),
        ...setupChoices.choices,
        ...(setupMail.smtpChoice && !authStatus.setup?.smtpConfigured ? { smtp: setupMail.smtpChoice } : {}),
      });
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || t('setup.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    triggerHaptic(15);
    try {
      const res = await api.login(email.trim(), password);
      if ('mfaToken' in res) {
        // Second step (MfaStep); the password is not needed any more
        setPassword('');
        setNotice(null);
        setMfa({ token: res.mfaToken, methods: res.methods });
        return;
      }
      onAuthenticated(res.user);
    } catch (err: any) {
      const msg = err.message || t('login.failed');
      setUnverifiedError(err instanceof ApiError && err.code === 'email_unverified' ? msg : null);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterOrInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const registerProblem = passwordProblem(password);
    if (registerProblem) {
      setError(registerProblem);
      triggerHaptic(25);
      return;
    }
    setSubmitting(true);
    triggerHaptic(15);
    try {
      const code = authTab === 'invite' ? inviteCode.trim() : '';
      const res = await api.register(email.trim(), password, displayName.trim(), code);
      if (res.pending || !res.user) {
        // Waiting for approval: back to the login form with the explanation
        setNotice(res.message || t('register.pending'));
        setPassword('');
        setAuthTab('login');
        return;
      }
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || t('register.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // FIRST-BOOT SERVER SETUP WIZARD
  // ============================================================================
  if (authStatus.needsSetup) {
    return (
      <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans" style={keyboardRoom}>
        <div className="w-full max-w-xl panel-surface shadow-panel overflow-hidden">
          {/* Top Brand Bar */}
          <div className="p-4 bg-canvas border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-accent text-on-accent rounded-btn flex items-center justify-center">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-base font-bold text-main tracking-tight leading-none">
                  {t('setup.title')}
                </h1>
                <p className="text-[11px] text-muted mt-0.5">
                  {t('setup.subtitle')}
                </p>
              </div>
            </div>
            <span className="badge-accent uppercase tracking-wider">{t('setup.badge')}</span>
          </div>

          <form onSubmit={handleCompleteSetup} className="p-5 space-y-5 text-xs">
            <p className="text-muted leading-relaxed">
              <Trans t={t} i18nKey="setup.welcome" components={{ b: <strong className="text-main" /> }} />
            </p>

            {/* Section 1: Admin Account */}
            <div className="p-3.5 bg-canvas border border-border space-y-3">
              <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-accent" />
                <span>{t('setup.adminSection')}</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1">{t('setup.yourName')}</label>
                  <input
                    type="text"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder={t('setup.yourNamePlaceholder')}
                    required
                    autoFocus
                    className="w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">{t('setup.email')}</label>
                  <input
                    type="email"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder={t('setup.emailPlaceholder')}
                    required
                    className="w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1">{t('setup.password')}</label>
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder={t('password.minPlaceholder')}
                    required
                    className="w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">{t('setup.repeat')}</label>
                  <input
                    type="password"
                    value={setupPasswordConfirm}
                    onChange={(e) => setSetupPasswordConfirm(e.target.value)}
                    placeholder={t('setup.repeatPlaceholder')}
                    required
                    className={`w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field ${
                      setupPasswordConfirm && setupPassword !== setupPasswordConfirm
                        ? 'border-status-err focus:border-status-err'
                        : ''
                    }`}
                  />
                  {setupPasswordConfirm && setupPassword !== setupPasswordConfirm && (
                    <span className="text-[10px] text-status-err mt-1 block">
                      {t('password.noMatchShort')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Server & Isolation */}
            <SetupInstanceSection state={setupChoices} heading={t('setup.instanceSection')} />

            {/* Section 3: Mail server (asked when the environment sets none) */}
            <SetupMailSection state={setupMail} heading={t('setup.mailSection')} info={authStatus.setup} />

            {/* Section 4: What is still open, where backups and administration are */}
            <SetupSummary
              heading={t('setup.summarySection')}
              info={authStatus.setup}
              choices={setupChoices.choices}
              wizardSmtpHost={authStatus.setup?.smtpConfigured ? '' : setupMail.smtpChoice?.smtpHost || ''}
            />

            {/* Beside the button: the form is long, an error on top would be out of sight */}
            {error && (
              <div role="alert" className="alert-err flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>
                  {submitting ? t('setup.submitting') : t('setup.submit')}
                </span>
              </button>
            </div>
          </form>
        </div>
        <LegalLinks legal={authStatus.legal} className="mt-4" />
      </div>
    );
  }

  // ============================================================================
  // STANDARD LOGIN / INVITE CODE / REGISTRATION VIEW
  // ============================================================================
  return (
    <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans" style={keyboardRoom}>
      <div className="w-full max-w-md panel-surface shadow-panel overflow-hidden">
        {/* Top Header */}
        <div className="p-4 bg-canvas border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-accent text-on-accent rounded-btn flex items-center justify-center">
              <Brain className="w-4 h-4" />
            </div>
            <h1 className="text-sm font-bold text-main tracking-tight leading-none">
              {authStatus.instanceName || 'MindSift'}
            </h1>
          </div>
          <Lock className="w-4 h-4 text-faint" />
        </div>

        {/* Navigation Tabs (not while choosing a new password or entering the second factor) */}
        <div className={`${authTab === 'reset' || authTab === 'forgot' || mfa ? 'hidden' : 'flex'} border-b border-border bg-canvas text-xs`}>
          <button
            type="button"
            onClick={() => {
              setAuthTab('login');
              setError(null);
              setNotice(null);
            }}
            className={`flex-1 h-9 px-3 font-medium flex items-center justify-center gap-1.5 border-r border-border transition-colors ${
              authTab === 'login'
                ? 'bg-panel text-main border-b-2 border-b-accent'
                : 'text-muted hover:text-main'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>{t('login.tab')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthTab('invite');
              setError(null);
            }}
            className={`flex-1 h-9 px-3 font-medium flex items-center justify-center gap-1.5 border-r border-border transition-colors ${
              authTab === 'invite'
                ? 'bg-panel text-main border-b-2 border-b-accent'
                : 'text-muted hover:text-main'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{t('invite.tab')}</span>
          </button>

          {authStatus.allowRegistration && (
            <button
              type="button"
              onClick={() => {
                setAuthTab('register');
                setError(null);
              }}
              className={`flex-1 h-9 px-3 font-medium flex items-center justify-center gap-1.5 transition-colors ${
                authTab === 'register'
                  ? 'bg-panel text-main border-b-2 border-b-accent'
                  : 'text-muted hover:text-main'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t('register.tab')}</span>
            </button>
          )}
        </div>

        {/* Form Body */}
        <div className="p-5 text-xs">
          {error && (
            <div className="mb-4 alert-err flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
              <span className="flex-1">{error}</span>
              {error === unverifiedError && email.trim() && (
                <button
                  type="button"
                  onClick={() => void resendVerification()}
                  disabled={resendState !== 'idle'}
                  className="btn-action h-8 px-2.5 text-[11px] shrink-0 disabled:opacity-50"
                >
                  {resendState === 'sending' ? t('sending') : t('verify.resend')}
                </button>
              )}
            </div>
          )}
          {notice && !error && (
            <div role="status" className="mb-4 p-2.5 rounded-card border border-status-ok/40 bg-status-ok/10 text-main flex items-start gap-2">
              <Check className="w-4 h-4 text-status-ok flex-shrink-0 mt-px" />
              <span>{notice}</span>
            </div>
          )}

          {authTab === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-3.5">
              <div>
                <h2 className="text-sm font-bold text-main">{t('forgot.title')}</h2>
                <p className="text-muted mt-1">
                  {t('forgot.intro')}
                </p>
              </div>
              <div>
                <label className="block text-muted mb-1">{t('emailLabel')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  required
                  autoFocus
                  autoComplete="email"
                  className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('login');
                    setError(null);
                  }}
                  className="btn-action h-11 sm:h-9 px-4 text-xs"
                >
                  {t('forgot.back')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 btn-primary h-11 sm:h-9 text-xs font-semibold disabled:opacity-50"
                >
                  {submitting ? t('sending') : t('forgot.submit')}
                </button>
              </div>
            </form>
          )}

          {authTab === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div>
                <h2 className="text-sm font-bold text-main">{t('reset.title')}</h2>
                <p className="text-muted mt-1">{t('reset.intro')}</p>
              </div>
              <div>
                <label className="block text-muted mb-1">{t('reset.newPassword')}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('password.minPlaceholder')}
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">{t('reset.repeat')}</label>
                <input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full btn-primary h-11 sm:h-9 text-xs font-semibold disabled:opacity-50"
              >
                {submitting ? t('reset.saving') : t('reset.submit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAuthTab(authStatus.passwordReset ? 'forgot' : 'login');
                  onResetCancel?.();
                }}
                className="w-full btn-action h-11 sm:h-9 text-xs"
              >
                {authStatus.passwordReset ? t('reset.newLink') : t('reset.toLogin')}
              </button>
            </form>
          )}

          {authTab === 'login' && mfa && (
            <MfaStep
              mfaToken={mfa.token}
              methods={mfa.methods}
              onAuthenticated={onAuthenticated}
              onBack={(message) => {
                setMfa(null);
                setError(message || null);
              }}
            />
          )}

          {authTab === 'login' && !mfa && (
            <form onSubmit={handleLogin} className="space-y-3.5">
              {authStatus.demoMode && (
                <div className="p-2.5 rounded border border-accent/30 bg-accent/10 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-accent">
                    <span>{t('login.demoActive')}</span>
                    <span className="text-[10px] text-muted font-normal">{t('login.demoFill')}</span>
                  </div>
                  <p className="text-[11px] text-muted leading-snug">{demoHintText(t, authStatus.demoResetMinutes)}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEmail('admin');
                        setPassword('admin');
                      }}
                      className="flex-1 py-1 px-2 text-[11px] rounded bg-panel hover:bg-panel-elevated border border-border text-main font-mono transition-colors text-center"
                    >
                      admin / admin
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail('user');
                        setPassword('user');
                      }}
                      className="flex-1 py-1 px-2 text-[11px] rounded bg-panel hover:bg-panel-elevated border border-border text-main font-mono transition-colors text-center"
                    >
                      user / user
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-muted mb-1">{t('login.login')}</label>
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('login.loginPlaceholder')}
                  required
                  autoFocus
                  // "webauthn": the browser offers the passkeys of this site in the autofill
                  autoComplete={passkeysOn ? 'username webauthn' : 'username'}
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div className="relative">
                <label className="block text-muted mb-1">{t('login.password')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full h-8 px-2.5 input-field"
                />
                {/* After the field in the markup, so Tab goes from the name straight to the password;
                    shown next to the label */}
                {authStatus.passwordReset && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('forgot');
                      setError(null);
                      setNotice(null);
                    }}
                    className="absolute right-0 -top-1 text-accent hover:underline text-[11px] py-1"
                  >
                    {t('forgot.title')}
                  </button>
                )}
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full btn-primary h-9 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{submitting ? t('login.submitting') : t('login.tab')}</span>
                </button>
              </div>

              {passkeysOn && (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-faint" aria-hidden="true">
                    <span className="flex-1 border-t border-border" />
                    <span>{t('login.or')}</span>
                    <span className="flex-1 border-t border-border" />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePasskeyLogin()}
                    disabled={submitting}
                    className="w-full btn-action h-11 sm:h-9 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    data-passkey-login
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>{t('login.passkey')}</span>
                  </button>
                </>
              )}

              {!authStatus.allowRegistration && (
                <p className="text-[11px] text-faint text-center pt-2 border-t border-border">
                  <Trans
                    t={t}
                    i18nKey="login.registrationClosed"
                    components={{
                      invite: <button type="button" onClick={() => setAuthTab('invite')} className="text-accent hover:underline" />,
                    }}
                  />
                </p>
              )}
            </form>
          )}

          {(authTab === 'invite' || authTab === 'register') && (
            <form onSubmit={handleRegisterOrInvite} className="space-y-3.5">
              {authTab === 'register' && registrationHintFull && (
                <p className="text-[11px] text-muted bg-canvas border border-border rounded-btn px-2.5 py-2">{registrationHintFull}</p>
              )}
              {authTab === 'invite' && (
                <div>
                  <label className="block text-muted mb-1">{t('invite.code')}</label>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="MS-XXXXXXXX"
                    required
                    autoFocus
                    className="w-full h-8 px-2.5 input-field font-mono uppercase"
                  />
                </div>
              )}

              <div>
                <label className="block text-muted mb-1">{t('register.displayName')}</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('register.displayNamePlaceholder')}
                  required
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div>
                <label className="block text-muted mb-1">{t('register.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  required
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div>
                <label className="block text-muted mb-1">{t('register.password')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('password.minPlaceholder')}
                  required
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full btn-primary h-9 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>
                    {submitting
                      ? t('register.submitting')
                      : authTab === 'invite'
                      ? t('invite.submit')
                      : t('register.submit')}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      <LegalLinks legal={authStatus.legal} className="mt-4" />
    </div>
  );
};
