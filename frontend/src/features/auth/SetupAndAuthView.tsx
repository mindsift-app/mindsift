import React, { useEffect, useState } from 'react';
import {
  Brain,
  Shield,
  Lock,
  KeyRound,
  UserPlus,
  LogIn,
  Server,
  Users,
  Check,
  AlertCircle,
} from 'lucide-react';
import { AuthStatus, SharingMode, User } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { LegalLinks } from '../../components/LegalLinks';
import { passwordProblem } from '../../lib/password';

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
  // --- Setup Wizard State ---
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  const [instanceName, setInstanceName] = useState(authStatus.instanceName || 'MindSift');
  const [sharingMode, setSharingMode] = useState<SharingMode>('organizations');
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [createSampleData, setCreateSampleData] = useState(false);

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
      .catch((err) => setError(err.message || 'Der Bestätigungslink ist ungültig oder abgelaufen.'));
  }, []);
  // Login refused because the address is not confirmed: offer to send the link again
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const resendVerification = async () => {
    setResendState('sending');
    try {
      await api.resendVerification(email.trim());
      setResendState('sent');
      setError(null);
      setNotice('Falls die Adresse noch auf Bestätigung wartet, haben wir dir den Link erneut geschickt.');
    } catch (err: any) {
      setResendState('idle');
      setError(err.message || 'Senden fehlgeschlagen');
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
        return 'Nach der Registrierung gibt ein Administrator dein Konto frei.';
      case 'open':
        return authStatus.emailVerification ? 'Du bekommst eine E-Mail, um deine Adresse zu bestätigen.' : '';
      case 'domain':
        return domains ? `Registrierung mit E-Mail-Adressen von ${domains}.` : '';
      case 'domain+approval':
        return domains
          ? `Mit Adressen von ${domains} geht es sofort, andere Konten gibt ein Administrator frei.`
          : 'Nach der Registrierung gibt ein Administrator dein Konto frei.';
    }
    return '';
  })();
  const registrationHintFull =
    registrationHint && authStatus.emailVerification && authStatus.registrationMode !== 'open'
      ? `${registrationHint} Vorher bestätigst du deine Adresse per E-Mail.`
      : registrationHint;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.requestPasswordReset(email.trim());
      setNotice('Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir dir einen Link zum Zurücksetzen geschickt. Er gilt eine Stunde.');
      setAuthTab('login');
    } catch (err: any) {
      setError(err.message || 'Anfrage fehlgeschlagen');
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
      setError('Die eingegebenen Passwörter stimmen nicht überein.');
      triggerHaptic(25);
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(resetToken || '', newPassword);
      setNewPassword('');
      setNewPasswordConfirm('');
      setPassword('');
      setNotice('Dein Passwort wurde geändert. Melde dich jetzt mit dem neuen Passwort an.');
      setAuthTab('login');
      onResetDone?.();
    } catch (err: any) {
      setError(err.message || 'Passwort konnte nicht geändert werden');
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
      setError('Die eingegebenen Passwörter stimmen nicht überein.');
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
        instanceName: instanceName.trim() || 'MindSift',
        sharingMode,
        allowRegistration,
        createSampleData,
      });
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Fehler bei der Ersteinrichtung');
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
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Ungültige Anmeldedaten');
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
        setNotice(res.message || 'Dein Konto wartet auf die Freigabe durch einen Administrator.');
        setPassword('');
        setAuthTab('login');
        return;
      }
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Registrierung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // FIRST-BOOT SERVER SETUP WIZARD
  // ============================================================================
  if (authStatus.needsSetup) {
    return (
      <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-full max-w-xl panel-surface shadow-panel overflow-hidden">
          {/* Top Brand Bar */}
          <div className="p-4 bg-canvas border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-accent text-on-accent rounded-btn flex items-center justify-center">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-base font-bold text-main tracking-tight leading-none">
                  MindSift Ersteinrichtung
                </h1>
                <p className="text-[11px] text-muted mt-0.5">
                  Initiales Administrator-Konto & Server-Konfiguration
                </p>
              </div>
            </div>
            <span className="badge-accent uppercase tracking-wider">First Boot</span>
          </div>

          <form onSubmit={handleCompleteSetup} className="p-5 space-y-5 text-xs">
            <p className="text-muted leading-relaxed">
              Willkommen auf deiner neuen MindSift-Instanz. Es existiert noch kein Benutzerkonto in
              der Datenbank. Lege jetzt das erste <strong className="text-main">Server-Admin-Konto</strong> an und
              bestimme die Sicherheitseinstellungen.
            </p>

            {error && (
              <div className="alert-err flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Section 1: Admin Account */}
            <div className="p-3.5 bg-canvas border border-border space-y-3">
              <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-accent" />
                <span>1. Server-Administrator anlegen</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1">Dein Anzeigename *</label>
                  <input
                    type="text"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="z.B. Admin / Dein Name"
                    required
                    autoFocus
                    className="w-full h-8 px-2.5 input-field"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">E-Mail-Adresse (Login) *</label>
                  <input
                    type="email"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="admin@deinedomain.de"
                    required
                    className="w-full h-8 px-2.5 input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1">Administrator-Passwort *</label>
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Mindestens 8 Zeichen"
                    required
                    className="w-full h-8 px-2.5 input-field"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">Passwort wiederholen *</label>
                  <input
                    type="password"
                    value={setupPasswordConfirm}
                    onChange={(e) => setSetupPasswordConfirm(e.target.value)}
                    placeholder="Passwort erneut eingeben"
                    required
                    className={`w-full h-8 px-2.5 input-field ${
                      setupPasswordConfirm && setupPassword !== setupPasswordConfirm
                        ? 'border-status-err focus:border-status-err'
                        : ''
                    }`}
                  />
                  {setupPasswordConfirm && setupPassword !== setupPasswordConfirm && (
                    <span className="text-[10px] text-status-err mt-1 block">
                      Passwörter stimmen nicht überein
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Server & Isolation */}
            <div className="p-3.5 bg-canvas border border-border space-y-3">
              <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-accent" />
                <span>2. Instanz & Berechtigungen</span>
              </h2>

              <div>
                <label className="block text-muted mb-1">Name der Instanz</label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="MindSift"
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div>
                <label className="block text-muted mb-1.5 flex items-center gap-1">
                  <Users className="w-3 h-3 text-accent" />
                  <span>Sichtbarkeit & Sharing-Isolation zwischen Benutzern</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSharingMode('private')}
                    className={`p-2.5 text-left border transition-colors ${
                      sharingMode === 'private'
                        ? 'bg-panel border-accent text-main'
                        : 'border-border text-muted hover:text-main'
                    }`}
                  >
                    <p className="font-bold text-xs">Privat</p>
                    <p className="text-[10px] text-muted mt-0.5">
                      Keiner sieht andere Nutzer. Teilen und Gruppen sind aus.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSharingMode('organizations')}
                    className={`p-2.5 text-left border transition-colors ${
                      sharingMode === 'organizations'
                        ? 'bg-panel border-accent text-main'
                        : 'border-border text-muted hover:text-main'
                    }`}
                  >
                    <p className="font-bold text-xs">Organisationen</p>
                    <p className="text-[10px] text-muted mt-0.5">
                      Nutzer sehen nur Mitglieder ihrer Organisation. Du startest in einer Organisation mit dem Namen der Instanz.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSharingMode('open')}
                    className={`p-2.5 text-left border transition-colors ${
                      sharingMode === 'open'
                        ? 'bg-panel border-accent text-main'
                        : 'border-border text-muted hover:text-main'
                    }`}
                  >
                    <p className="font-bold text-xs">Alle sehen alle</p>
                    <p className="text-[10px] text-muted mt-0.5">
                      Offene Zusammenarbeit auf dem gesamten Server.
                    </p>
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between gap-3 select-none">
                  <div>
                    <span className="font-medium text-main block">
                      Öffentliche Selbstregistrierung erlauben
                    </span>
                    <span className="text-[11px] text-muted">
                      Wenn deaktiviert, können neue Nutzer nur per Einladungscode oder durch einen
                      Admin angelegt werden.
                    </span>
                  </div>
                  <ToggleSwitch checked={allowRegistration} onChange={setAllowRegistration} />
                </div>

                <div className="flex items-center justify-between gap-3 select-none pt-1">
                  <div>
                    <span className="font-medium text-main block">
                      Beispieldaten anlegen
                    </span>
                    <span className="text-[11px] text-muted">
                      Füllt dein Konto mit Beispiel-Gedanken, Notizen, Aufgabenlisten und Einkaufslisten zum Ausprobieren.
                      Es werden keine weiteren Benutzer angelegt.
                    </span>
                  </div>
                  <ToggleSwitch checked={createSampleData} onChange={setCreateSampleData} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary h-9 px-5 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'Richte Server ein…'
                    : 'Ersteinrichtung abschließen & Starten'}
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
    <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans">
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

        {/* Navigation Tabs (not while choosing a new password) */}
        <div className={`${authTab === 'reset' || authTab === 'forgot' ? 'hidden' : 'flex'} border-b border-border bg-canvas text-xs`}>
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
            <span>Anmelden</span>
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
            <span>Einladungscode</span>
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
              <span>Registrieren</span>
            </button>
          )}
        </div>

        {/* Form Body */}
        <div className="p-5 text-xs">
          {error && (
            <div className="mb-4 alert-err flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
              <span className="flex-1">{error}</span>
              {/bestätige zuerst deine E-Mail/i.test(error) && email.trim() && (
                <button
                  type="button"
                  onClick={() => void resendVerification()}
                  disabled={resendState !== 'idle'}
                  className="btn-action h-8 px-2.5 text-[11px] shrink-0 disabled:opacity-50"
                >
                  {resendState === 'sending' ? 'Sende…' : 'Link erneut senden'}
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
                <h2 className="text-sm font-bold text-main">Passwort vergessen?</h2>
                <p className="text-muted mt-1">
                  Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.
                </p>
              </div>
              <div>
                <label className="block text-muted mb-1">E-Mail-Adresse</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@beispiel.de"
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
                  Zurück zur Anmeldung
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 btn-primary h-11 sm:h-9 text-xs font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Sende…' : 'Link anfordern'}
                </button>
              </div>
            </form>
          )}

          {authTab === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div>
                <h2 className="text-sm font-bold text-main">Neues Passwort festlegen</h2>
                <p className="text-muted mt-1">Danach bist du überall abgemeldet und meldest dich mit dem neuen Passwort an.</p>
              </div>
              <div>
                <label className="block text-muted mb-1">Neues Passwort</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mindestens 8 Zeichen"
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Passwort wiederholen</label>
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
                {submitting ? 'Speichere…' : 'Passwort speichern'}
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
                {authStatus.passwordReset ? 'Neuen Link anfordern' : 'Zur Anmeldung'}
              </button>
            </form>
          )}

          {authTab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3.5">
              {authStatus.demoMode && (
                <div className="p-2.5 rounded border border-accent/30 bg-accent/10 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-accent">
                    <span>🧪 Demo-Modus aktiv</span>
                    <span className="text-[10px] text-muted font-normal">Klick zum Ausfüllen:</span>
                  </div>
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
                <label className="block text-muted mb-1">Benutzername oder E-Mail-Adresse</label>
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin oder name@beispiel.de"
                  required
                  autoFocus
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div className="relative">
                <label className="block text-muted mb-1">Passwort</label>
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
                    Passwort vergessen?
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
                  <span>{submitting ? 'Melde an…' : 'Anmelden'}</span>
                </button>
              </div>

              {!authStatus.allowRegistration && (
                <p className="text-[11px] text-faint text-center pt-2 border-t border-border">
                  Öffentliche Registrierung ist deaktiviert. Zugang nur mit Konto oder{' '}
                  <button
                    type="button"
                    onClick={() => setAuthTab('invite')}
                    className="text-accent hover:underline"
                  >
                    Einladungscode
                  </button>
                  .
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
                  <label className="block text-muted mb-1">Einladungscode *</label>
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
                <label className="block text-muted mb-1">Anzeigename *</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Dein Name"
                  required
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div>
                <label className="block text-muted mb-1">E-Mail-Adresse *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@beispiel.de"
                  required
                  className="w-full h-8 px-2.5 input-field"
                />
              </div>

              <div>
                <label className="block text-muted mb-1">Passwort *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mindestens 8 Zeichen"
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
                      ? 'Konto wird erstellt…'
                      : authTab === 'invite'
                      ? 'Einladung einlösen & Konto erstellen'
                      : 'Konto registrieren'}
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
