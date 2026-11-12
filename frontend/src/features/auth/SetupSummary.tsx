import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, Archive, CheckCircle2, ClipboardList, Settings, AtSign } from 'lucide-react';
import { SetupInfo } from '../../lib/types';
import { formatTimeField } from '../../lib/dateInput';
import { SetupChoices } from './SetupInstanceSection';

// The last part of the setup wizard: what is still open (no mail server, no BASE_URL, no address of the
// admin) and what is good to know (where the backups go and that they belong somewhere else too, where the
// administration is). Follows the answers above as they change; info is what the server says.

type Item = { key: string; tone: 'warn' | 'ok' | 'info'; icon: React.ReactNode; text: React.ReactNode };

export const SetupSummary: React.FC<{
  heading: string;
  info: SetupInfo | null | undefined;
  choices: SetupChoices;
  // Host of the mail server set up in the wizard (empty: none)
  wizardSmtpHost: string;
  // The admin's address in FinishSetupView: undefined when the wizard does not ask for it (the account
  // has one, or the first-boot wizard, where it is the login address)
  email?: string;
}> = ({ heading, info, choices, wizardSmtpHost, email }) => {
  const { t } = useTranslation('auth');
  const b = <strong className="text-main font-semibold" />;
  const c = <code className="font-mono break-all" />;
  const mailReady = Boolean(info?.smtpConfigured || wizardSmtpHost);
  const linksReady = mailReady && Boolean(info?.baseUrlSet);

  const open: Item[] = [];
  const good: Item[] = [];
  const warnIcon = <AlertTriangle className="w-3.5 h-3.5 text-status-warn" />;
  const okIcon = <CheckCircle2 className="w-3.5 h-3.5 text-status-ok" />;

  if (email !== undefined) {
    const address = email.trim();
    if (!address) {
      open.push({ key: 'email', tone: 'warn', icon: warnIcon, text: <Trans t={t} i18nKey="setupSummary.noEmail" components={{ b }} /> });
    } else {
      const item: Item = {
        key: 'email',
        tone: linksReady ? 'info' : 'warn',
        icon: linksReady ? <AtSign className="w-3.5 h-3.5 text-accent" /> : warnIcon,
        text: (
          <Trans
            t={t}
            i18nKey={linksReady ? 'setupSummary.emailLink' : 'setupSummary.emailWaiting'}
            values={{ email: address }}
            components={{ b }}
          />
        ),
      };
      (linksReady ? good : open).push(item);
    }
  }
  if (info) {
    if (!mailReady) {
      open.push({ key: 'mail', tone: 'warn', icon: warnIcon, text: <Trans t={t} i18nKey="setupSummary.noMail" components={{ b }} /> });
    } else {
      const host = wizardSmtpHost || info.smtpHost;
      good.push({
        key: 'mail',
        tone: 'ok',
        icon: okIcon,
        text: host ? <Trans t={t} i18nKey="setupSummary.mailOk" values={{ host }} components={{ c }} /> : t('setupSummary.mailOkNoHost'),
      });
    }
    if (!info.baseUrlSet) {
      open.push({ key: 'baseUrl', tone: 'warn', icon: warnIcon, text: <Trans t={t} i18nKey="setupSummary.noBaseUrl" components={{ b, c }} /> });
    } else {
      good.push({ key: 'baseUrl', tone: 'ok', icon: okIcon, text: t('setupSummary.baseUrlOk') });
    }
  }
  if (choices.backupEnabled) {
    good.push({
      key: 'backups',
      tone: 'info',
      icon: <Archive className="w-3.5 h-3.5 text-accent" />,
      text: (
        <Trans
          t={t}
          i18nKey="setupSummary.backups"
          count={choices.backupRetentionDays ?? 0}
          values={{
            time: formatTimeField(choices.backupTime || ''),
            dir: info?.backupDir || 'data/backups',
            count: choices.backupRetentionDays ?? 0,
          }}
          components={{ b, c }}
        />
      ),
    });
  } else {
    open.push({ key: 'backups', tone: 'warn', icon: warnIcon, text: <Trans t={t} i18nKey="setupSummary.backupsOff" components={{ b }} /> });
  }
  good.push({
    key: 'admin',
    tone: 'info',
    icon: <Settings className="w-3.5 h-3.5 text-accent" />,
    text: <Trans t={t} i18nKey="setupSummary.admin" components={{ b }} />,
  });

  const list = (items: Item[]) => (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} data-tone={item.tone} className="flex items-start gap-2 leading-relaxed">
          <span className="mt-0.5 flex-shrink-0">{item.icon}</span>
          <span className="min-w-0 text-muted break-words">{item.text}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="p-3.5 bg-canvas border border-border space-y-3" data-testid="setup-summary">
      <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5 text-accent" />
        <span>{heading}</span>
      </h2>
      {/* Without the server's answer nothing can be said about mail server and BASE_URL */}
      {(open.length > 0 || info) && (
        <div className="space-y-1.5 pb-2 border-b border-border">
          <h3 className="font-semibold text-main">{t('setupSummary.open')}</h3>
          {open.length > 0 ? (
            list(open)
          ) : (
            <p className="flex items-start gap-2 text-muted">
              <span className="mt-0.5 flex-shrink-0">{okIcon}</span>
              <span>{t('setupSummary.nothingOpen')}</span>
            </p>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="font-semibold text-main">{t('setupSummary.good')}</h3>
        {list(good)}
      </div>
    </div>
  );
};
