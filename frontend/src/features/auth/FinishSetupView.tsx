import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CircleAlert, Brain, Check, LogOut } from 'lucide-react';
import { AuthStatus, SetupInfo, User } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { LegalLinks } from '../../components/LegalLinks';
import { SetupInstanceSection, useSetupChoices } from './SetupInstanceSection';
import { SetupEmailSection, SetupMailSection, useSetupMail } from './SetupMailSection';
import { SetupSummary } from './SetupSummary';
import { useKeyboardRoom } from '../../lib/useKeyboardInset';
import { errorMessage } from '../../lib/errorMessage';

// The rest of the setup wizard for an admin that ADMIN_USER / ADMIN_PASSWORD created at startup: the
// account exists, so only the instance settings are asked, once, after the first sign-in – plus the
// admin's address when ADMIN_EMAIL was missing, the mail server when the environment sets none, and a
// summary of what is still open.
export const FinishSetupView: React.FC<{
  user: User;
  authStatus: AuthStatus;
  onDone: () => void;
  onLogout: () => void;
}> = ({ user, authStatus, onDone, onLogout }) => {
  const { t } = useTranslation('auth');
  const keyboardRoom = useKeyboardRoom();
  const setupChoices = useSetupChoices(authStatus.instanceName);
  const setupMail = useSetupMail();
  // Asked only when the account has no address (ADMIN_EMAIL was not set)
  const asksEmail = !user.email;
  const [email, setEmail] = useState('');
  // Mail server, BASE_URL and backup folder; null while loading or when the server did not answer
  const [info, setInfo] = useState<SetupInfo | null>(null);
  useEffect(() => {
    api.getSetupStatus().then(setInfo).catch(() => setInfo(null));
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = setupChoices.problem || setupMail.problem;
    if (problem) {
      setError(problem);
      triggerHaptic(25);
      return;
    }
    setSubmitting(true);
    triggerHaptic(15);
    try {
      await api.finishSetup({
        ...setupChoices.choices,
        ...(setupMail.smtpChoice && !info?.smtpConfigured ? { smtp: setupMail.smtpChoice } : {}),
        ...(asksEmail && email.trim() ? { email: email.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t('setup.failed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans" style={keyboardRoom}>
      <div className="w-full max-w-xl panel-surface shadow-panel overflow-hidden">
        <div className="p-4 bg-canvas border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent text-on-accent rounded-btn flex items-center justify-center">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-main tracking-tight leading-none">{t('setup.title')}</h1>
              <p className="text-[11px] text-muted mt-0.5">{t('setup.finishSubtitle')}</p>
            </div>
          </div>
          <span className="badge-accent uppercase tracking-wider">{t('setup.badge')}</span>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 text-xs">
          <p className="text-muted leading-relaxed">
            <Trans
              t={t}
              i18nKey="setup.finishWelcome"
              values={{ username: user.username || user.displayName }}
              components={{ b: <strong className="text-main" /> }}
            />
          </p>

          {asksEmail && <SetupEmailSection email={email} onChange={setEmail} heading={t('setup.finishEmailSection')} />}

          <SetupInstanceSection state={setupChoices} heading={t('setup.finishSection')} />

          <SetupMailSection
            state={setupMail}
            heading={t('setup.finishMailSection')}
            info={info}
            onTest={async (to, smtp) => {
              await api.adminTestSMTP(to, smtp);
            }}
            testTo={asksEmail ? email : user.email}
          />

          <SetupSummary
            heading={t('setup.finishSummarySection')}
            info={info}
            choices={setupChoices.choices}
            wizardSmtpHost={info?.smtpConfigured ? '' : setupMail.smtpChoice?.smtpHost || ''}
            email={asksEmail ? email : undefined}
          />

          {/* Beside the button: the form is long, an error on top would be out of sight */}
          {error && (
            <div role="alert" className="alert-err flex items-center gap-2">
              <CircleAlert className="w-4 h-4 text-status-err flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onLogout}
              className="h-11 sm:h-9 px-3 text-xs text-muted hover:text-main flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('setup.logout')}</span>
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{submitting ? t('setup.submitting') : t('setup.submit')}</span>
            </button>
          </div>
        </form>
      </div>
      <LegalLinks legal={authStatus.legal} className="mt-4" />
    </div>
  );
};
