import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, CheckCircle2, Mail, Send } from 'lucide-react';
import i18n from '../../i18n';
import { SetupInfo, SmtpForm } from '../../lib/types';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { SmtpFields } from '../settings/admin/SmtpFields';
import { NO_AUTOFILL } from '../../lib/noAutofill';

// The setup wizard's mail questions, shared by the first-boot wizard and the rest of it after an admin from
// ADMIN_USER (FinishSetupView): the mail server when the environment sets none (the fields of the
// administration, with a test mail where the admin is signed in already), and the admin's address when the
// account has none. Skipped, the summary says what is missing and where to set it up later.

const SETUP_INPUT = 'h-11 sm:h-8 px-2.5 text-base sm:text-xs';

export function useSetupMail() {
  // Asked only when the environment sets no mail server; starts skipped, it is optional
  const [smtpOn, setSmtpOn] = useState(false);
  const [smtp, setSmtp] = useState<SmtpForm>({
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    smtpFromName: '',
    smtpTls: true,
    smtpSkipVerify: false,
  });
  const updateSmtp = (patch: Partial<SmtpForm>) => setSmtp((prev) => ({ ...prev, ...patch }));
  const host = (smtp.smtpHost || '').trim();
  // What the wizard sends: the mail server only when switched on
  const smtpChoice: SmtpForm | undefined = smtpOn ? { ...smtp, smtpHost: host } : undefined;
  const problem = smtpOn && !host ? i18n.t('auth:setupMail.hostMissing') : null;
  return { smtpOn, setSmtpOn, smtp, updateSmtp, host, smtpChoice, problem };
}

export type SetupMailState = ReturnType<typeof useSetupMail>;

// The admin's address after ADMIN_USER without ADMIN_EMAIL; confirmed by the link mailed to it
export const SetupEmailSection: React.FC<{ email: string; onChange: (email: string) => void; heading: string }> = ({
  email,
  onChange,
  heading,
}) => {
  const { t } = useTranslation('auth');
  return (
    <div className="p-3.5 bg-canvas border border-border space-y-2">
      <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
        <AtSign className="w-3.5 h-3.5 text-accent" />
        <span>{heading}</span>
      </h2>
      <label className="block">
        <span className="block text-muted mb-1">{t('setupMail.email')}</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('setupMail.emailPlaceholder')}
          className={`w-full input-field ${SETUP_INPUT}`}
        />
      </label>
      <p className="text-[11px] text-muted">{t('setupMail.emailHint')}</p>
    </div>
  );
};

export const SetupMailSection: React.FC<{
  state: SetupMailState;
  heading: string;
  // What the server says (null while unknown: the mail server is asked)
  info: SetupInfo | null | undefined;
  // Sends a test mail; without it (no account yet) the wizard points to the administration instead
  onTest?: (to: string, smtp?: SmtpForm) => Promise<void>;
  // Address the test mail goes to unless another is typed
  testTo?: string;
}> = ({ state, heading, info, onTest, testTo = '' }) => {
  const { t } = useTranslation('auth');
  const configured = Boolean(info?.smtpConfigured);
  return (
    <div className="p-3.5 bg-canvas border border-border space-y-3">
      <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
        <Mail className="w-3.5 h-3.5 text-accent" />
        <span>{heading}</span>
      </h2>

      {configured ? (
        <div className="space-y-1">
          <p className="flex items-start gap-1.5 text-main font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 mt-px text-status-ok flex-shrink-0" />
            <span className="min-w-0 break-words">
              {info?.smtpViaEnv ? t('setupMail.envSet') : t('setupMail.alreadySet')}
              {info?.smtpHost && <code className="font-mono font-normal text-muted"> · {info.smtpHost}</code>}
            </span>
          </p>
          <p className="text-[11px] text-muted">{t('setupMail.envSetHint')}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 select-none">
            <div>
              <span className="font-medium text-main block">{t('setupMail.configure')}</span>
              <span className="text-[11px] text-muted">{t('setupMail.configureHint')}</span>
            </div>
            <ToggleSwitch checked={state.smtpOn} onChange={state.setSmtpOn} title={t('setupMail.configure')} />
          </div>
          {state.smtpOn ? (
            <SmtpFields value={state.smtp} onChange={state.updateSmtp} inputClassName={SETUP_INPUT} />
          ) : (
            <p className="text-[11px] text-muted">{t('setupMail.skippedHint')}</p>
          )}
        </>
      )}

      {(configured || state.smtpOn) &&
        (onTest ? (
          <SetupTestMail
            defaultTo={testTo}
            // Not set up yet: the test goes through the server as typed, before anything is stored
            send={(to) => onTest(to, configured ? undefined : state.smtpChoice)}
            disabled={!configured && !state.host}
          />
        ) : (
          <p className="text-[11px] text-muted">{t('setupMail.testLater')}</p>
        ))}
    </div>
  );
};

function SetupTestMail({ defaultTo, send, disabled }: { defaultTo: string; send: (to: string) => Promise<void>; disabled: boolean }) {
  const { t } = useTranslation('auth');
  // null: follows the address given above
  const [typed, setTyped] = useState<string | null>(null);
  const to = (typed ?? defaultTo).trim();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setSending(true);
    setResult(null);
    try {
      await send(to);
      setResult({ ok: true, text: t('setupMail.testSent', { email: to }) });
    } catch (err: any) {
      setResult({ ok: false, text: t('setupMail.testFailed', { error: err.message || '' }) });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="pt-2 border-t border-border space-y-1.5">
      <label className="block text-muted" htmlFor="setup-test-mail">
        {t('setupMail.testTo')}
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          {...NO_AUTOFILL}
          id="setup-test-mail"
          type="email"
          value={typed ?? defaultTo}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t('setupMail.emailPlaceholder')}
          className={`flex-1 min-w-0 input-field ${SETUP_INPUT}`}
        />
        <button
          type="button"
          onClick={run}
          disabled={disabled || sending || !to}
          className="btn-action h-11 sm:h-8 px-4 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5 text-accent" />
          <span>{sending ? t('setupMail.testSending') : t('setupMail.testSend')}</span>
        </button>
      </div>
      {result && (
        <p role="status" className={`text-[11px] break-words ${result.ok ? 'text-status-ok' : 'text-status-err'}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
