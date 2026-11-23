import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Brain, Shield, Check, CircleAlert } from 'lucide-react';
import { AuthStatus, User } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { LegalLinks } from '../../components/LegalLinks';
import { passwordPairProblem } from '../../lib/password';
import { NewPasswordFields } from '../../components/NewPasswordFields';
import { SetupInstanceSection, useSetupChoices } from './SetupInstanceSection';
import { SetupMailSection, useSetupMail } from './SetupMailSection';
import { SetupSummary } from './SetupSummary';
import { useKeyboardRoom } from '../../lib/useKeyboardInset';
import { errorMessage } from '../../lib/errorMessage';

interface SetupWizardViewProps {
  authStatus: AuthStatus;
  onAuthenticated: (user: User) => void;
}

// First-boot server setup wizard. A chunk of its own (App.tsx loads it lazily): only the very first start
// of a server needs it, so the sign-in page does not carry its sections.
export const SetupWizardView: React.FC<SetupWizardViewProps> = ({ authStatus, onAuthenticated }) => {
  const { t } = useTranslation('auth');
  // The keyboard must not cover the fields (phones)
  const keyboardRoom = useKeyboardRoom();
  const [setupCode, setSetupCode] = useState('');
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  // Instance settings of the wizard (shared with FinishSetupView)
  const setupChoices = useSetupChoices(authStatus.instanceName);
  // Mail server when the environment sets none (no test mail before the account exists)
  const setupMail = useSetupMail();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCompleteSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const setupProblem = passwordPairProblem(setupPassword, setupPasswordConfirm);
    if (setupProblem) {
      setError(setupProblem);
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
        ...(authStatus.setupCodeRequired ? { setupCode: setupCode.trim() } : {}),
        email: setupEmail.trim(),
        password: setupPassword,
        displayName: setupName.trim(),
        ...setupChoices.choices,
        ...(setupMail.smtpChoice && !authStatus.setup?.smtpConfigured ? { smtp: setupMail.smtpChoice } : {}),
      });
      onAuthenticated(res.user);
    } catch (err) {
      setError(errorMessage(err, t('setup.failed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans" style={keyboardRoom}>
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

            {/* Only whoever can read the server's log may become its admin (setup_code.go) */}
            {authStatus.setupCodeRequired && (
              <div>
                <label htmlFor="setup-code" className="block text-muted mb-1">{t('setup.code')}</label>
                <input
                  id="setup-code"
                  data-setup-code
                  type="text"
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value)}
                  placeholder={t('setup.codePlaceholder')}
                  required
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={32}
                  className="w-full sm:w-56 h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono tracking-wider input-field"
                />
                <span className="text-[11px] text-muted mt-1 block">
                  <Trans t={t} i18nKey="setup.codeHint" components={{ c: <code className="font-mono" /> }} />
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-muted mb-1">{t('setup.yourName')}</label>
                <input
                  type="text"
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  placeholder={t('setup.yourNamePlaceholder')}
                  required
                  autoFocus={!authStatus.setupCodeRequired}
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

            <NewPasswordFields
              value={setupPassword}
              onChange={setSetupPassword}
              repeat={setupPasswordConfirm}
              onRepeatChange={setSetupPasswordConfirm}
              label={t('setup.password')}
              repeatLabel={t('setup.repeat')}
              placeholder={t('password.minPlaceholder')}
              repeatPlaceholder={t('setup.repeatPlaceholder')}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              labelClassName="block text-muted"
              inputClassName="h-11 sm:h-8 px-2.5 text-base sm:text-xs"
            />
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
              <CircleAlert className="w-4 h-4 text-status-err shrink-0" />
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
};
