import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Brain, LogOut, ShieldCheck } from 'lucide-react';
import { AuthStatus, User } from '../../lib/types';
import { api } from '../../lib/api';
import { LegalLinks } from '../../components/LegalLinks';
import { TwoFactorCard } from '../settings/user/TwoFactorCard';
import { PasskeyCard } from '../settings/user/PasskeyCard';
import { useKeyboardRoom } from '../../lib/useKeyboardInset';

// The administration requires a second factor this account has not set up yet: until it is, the server answers
// nothing else, so the app shows only this – the app or a passkey, like in the security settings. "Continue"
// comes once one is on, so the recovery codes shown after the setup can be saved first.
export const MfaSetupRequiredView: React.FC<{
  user: User;
  authStatus: AuthStatus;
  onDone: () => void;
  onLogout: () => void;
}> = ({ user, authStatus, onDone, onLogout }) => {
  const { t } = useTranslation('auth');
  const keyboardRoom = useKeyboardRoom();
  // The two cards share the state of two-factor sign-in: a change in one reloads the other
  const [twoFactorKey, setTwoFactorKey] = useState(0);
  const [passkeyKey, setPasskeyKey] = useState(0);
  const [ready, setReady] = useState(false);

  const recheck = () => {
    api
      .getMe()
      .then((me) => setReady(!me.mfaSetupRequired))
      .catch(() => {});
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans" style={keyboardRoom}>
      <div className="w-full max-w-xl panel-surface shadow-panel overflow-hidden">
        <div className="p-4 bg-canvas border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent text-on-accent rounded-btn flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight leading-none">{t('mfaRequired.title')}</h1>
            <p className="text-[11px] text-muted mt-0.5">{user.displayName || user.username}</p>
          </div>
        </div>

        <div className="p-5 space-y-5 text-xs" data-mfa-setup-required>
          <p className="text-muted leading-relaxed flex gap-2">
            <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
            <span>{t('mfaRequired.intro')}</span>
          </p>
          <TwoFactorCard
            currentUser={user}
            demoMode={false}
            refreshKey={twoFactorKey}
            onChanged={() => {
              setPasskeyKey((k) => k + 1);
              recheck();
            }}
          />
          <div className="pt-5 border-t border-border">
            <PasskeyCard
              currentUser={user}
              demoMode={false}
              refreshKey={passkeyKey}
              onChanged={() => {
                setTwoFactorKey((k) => k + 1);
                recheck();
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button type="button" onClick={onLogout} className="h-11 sm:h-9 px-3 text-xs text-muted hover:text-main flex items-center gap-1.5">
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('mfaRequired.logout')}</span>
            </button>
            <button
              type="button"
              onClick={onDone}
              disabled={!ready}
              className="btn-primary h-11 sm:h-9 px-4 text-xs flex items-center gap-1.5 disabled:opacity-50"
              data-mfa-setup-continue
            >
              <span>{t('mfaRequired.continue')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {!ready && <p className="text-[11px] text-faint text-right">{t('mfaRequired.continueHint')}</p>}
        </div>
      </div>
      <LegalLinks legal={authStatus.legal} className="mt-4" />
    </div>
  );
};
