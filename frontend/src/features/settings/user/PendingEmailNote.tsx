import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import { api } from '../../../lib/api';
import { User } from '../../../lib/types';
import { errorMessage } from '../../../lib/errorMessage';

// A new login address waits for the click on the link mailed to it; until then the old one stays in use.
// Shown under the field, with sending the link again and keeping the old address.
export function PendingEmailNote({ user, onUserUpdated }: { user: User; onUserUpdated: (u: User) => void }) {
  const { t } = useTranslation('settings');
  const pending = user.pendingEmail;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!pending) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await api.resendEmailChange('account');
      setMsg(t('pendingEmail.resent'));
    } catch (err) {
      setMsg(errorMessage(err, t('pendingEmail.failed')));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancelEmailChange('account');
      onUserUpdated({ ...user, pendingEmail: undefined });
    } catch (err) {
      setMsg(errorMessage(err, t('pendingEmail.failed')));
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 p-2.5 rounded-lg border border-border bg-panel text-xs space-y-1.5" role="status">
      <div className="flex items-start gap-2">
        <MailCheck className="w-3.5 h-3.5 mt-0.5 text-accent flex-shrink-0" />
        <p className="text-main min-w-0 break-words">
          {user.emailLinks ? t('pendingEmail.waiting', { email: pending }) : t('pendingEmail.noMail', { email: pending })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 pl-5.5">
        {user.emailLinks && (
          <button type="button" onClick={resend} disabled={busy} className="btn-action h-11 sm:h-7 px-2.5 text-xs disabled:opacity-50">
            {t('pendingEmail.resend')}
          </button>
        )}
        <button type="button" onClick={cancel} disabled={busy} className="btn-action h-11 sm:h-7 px-2.5 text-xs disabled:opacity-50">
          {t('pendingEmail.cancel')}
        </button>
      </div>
      {msg && <p className="pl-5.5 text-muted">{msg}</p>}
    </div>
  );
}
