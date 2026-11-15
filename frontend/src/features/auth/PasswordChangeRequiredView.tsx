import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Brain, CircleAlert, KeyRound, LogOut } from 'lucide-react';
import { AuthStatus, User } from '../../lib/types';
import { api } from '../../lib/api';
import { LegalLinks } from '../../components/LegalLinks';
import { useKeyboardRoom } from '../../lib/useKeyboardInset';
import { passwordProblem } from '../../lib/password';
import { errorMessage } from '../../lib/errorMessage';

// A reset by the administration asked for a new own password at the next sign-in: until it is chosen the
// server answers nothing else, so the app shows only this – the password just used, the new one twice. Like
// MfaSetupRequiredView, which may follow when the administration also requires a second factor.
export const PasswordChangeRequiredView: React.FC<{
  user: User;
  authStatus: AuthStatus;
  onDone: () => void;
  onLogout: () => void;
}> = ({ user, authStatus, onDone, onLogout }) => {
  const { t } = useTranslation('auth');
  const keyboardRoom = useKeyboardRoom();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    if (next !== repeat) {
      setError(t('passwordRequired.noMatch'));
      return;
    }
    if (next === current) {
      setError(t('passwordRequired.same'));
      return;
    }
    setBusy(true);
    try {
      // Not trimmed: login compares the password exactly as typed
      await api.changeOwnPassword(current, next);
      onDone();
    } catch (err) {
      setError(errorMessage(err, t('passwordRequired.failed')));
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1 w-full h-11 sm:h-9 px-3 input-field text-base sm:text-xs';

  return (
    <div className="min-h-dvh bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans" style={keyboardRoom}>
      <div className="w-full max-w-md panel-surface shadow-panel overflow-hidden">
        <div className="p-4 bg-canvas border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent text-on-accent rounded-btn flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight leading-none">{t('passwordRequired.title')}</h1>
            <p className="text-[11px] text-muted mt-0.5">{user.displayName || user.username}</p>
          </div>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 text-xs" data-password-change-required>
          <p className="text-muted leading-relaxed flex gap-2">
            <KeyRound className="w-4 h-4 text-accent shrink-0" />
            <span>{t('passwordRequired.intro')}</span>
          </p>
          {error && (
            <div role="alert" className="flex items-center gap-2 alert-err">
              <CircleAlert className="w-4 h-4 text-status-err shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <label className="block text-muted font-medium">
            {t('passwordRequired.current')}
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              className={field}
            />
          </label>
          <label className="block text-muted font-medium">
            {t('passwordRequired.new')}
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required className={field} />
          </label>
          <label className="block text-muted font-medium">
            {t('passwordRequired.repeat')}
            <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required className={field} />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button type="button" onClick={onLogout} className="h-11 sm:h-9 px-3 text-xs text-muted hover:text-main flex items-center gap-1.5">
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('passwordRequired.logout')}</span>
            </button>
            <button
              type="submit"
              disabled={busy || !current || !next || !repeat}
              className="btn-primary h-11 sm:h-9 px-4 text-xs flex items-center gap-1.5 disabled:opacity-50"
              data-password-change-submit
            >
              <span>{busy ? t('passwordRequired.saving') : t('passwordRequired.save')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
      <LegalLinks legal={authStatus.legal} className="mt-4" />
    </div>
  );
};
