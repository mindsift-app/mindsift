import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, Brain, Check, CircleAlert, Monitor } from 'lucide-react';
import { AuthStatus, User } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { desktopShell } from '../../lib/desktopShell';
import { LANGUAGES } from '../../i18n';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { SelectMenu } from '../../components/SelectMenu';
import { TimeField } from '../../components/TimeField';
import { NumberField } from '../../components/NumberField';
import { DEFAULT_BACKUP_RETENTION_DAYS, MAX_BACKUP_RETENTION_DAYS } from '../../lib/backupDefaults';
import { browserTimeZone, timeZoneLabel, timeZoneList } from '../../lib/timeZones';
import { useKeyboardRoom } from '../../lib/useKeyboardInset';
import { errorMessage } from '../../lib/errorMessage';
import { useSetupChoices } from './SetupInstanceSection';
import { BackupFolderField } from '../settings/BackupFolderField';

// The desktop app's setup wizard, once on a local instance's first start. The account exists already (the
// app made it and signs it in), and what a server needs (address, mail, registration, sharing,
// organizations, public address, sign-in providers) is off in the app, so only this is asked: the
// instance's name (the entry's name from the start view), language, time zone (the system's unless chosen),
// daily backups with their folder, and the help notes. Every field starts with a default, so one click
// finishes it; all of it stays changeable in the administration.
export const DesktopSetupView: React.FC<{
  user: User;
  authStatus: AuthStatus;
  onDone: () => void;
}> = ({ user, authStatus, onDone }) => {
  const { t } = useTranslation('auth');
  const keyboardRoom = useKeyboardRoom();
  const state = useSetupChoices(authStatus.instanceName, { createSampleData: true, timeZone: '' });
  const [backupDir, setBackupDir] = useState('');
  // The stored folder as the person knows it (under Flatpak the host's path for the portal's), while unchanged
  const [stored, setStored] = useState({ dir: '', shown: '' });
  const [defaultDir, setDefaultDir] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The name given in the start view is the better suggestion than "MindSift"; not once the person typed
  const nameTouched = useRef(false);
  const { setInstanceName } = state;
  useEffect(() => {
    desktopShell
      .state()
      .then((st) => {
        const name = st.entries.find((e) => e.id === st.current)?.name;
        if (name && !nameTouched.current) setInstanceName(name);
      })
      .catch(() => {});
    api
      .adminGetBackupLocation()
      .then((loc) => {
        setDefaultDir(loc.defaultDir);
        if (loc.custom) {
          setBackupDir(loc.dir);
          setStored({ dir: loc.dir, shown: loc.dirShown || loc.dir });
        }
      })
      .catch(() => {});
  }, [setInstanceName]);

  const systemZone = browserTimeZone();
  const zoneOptions = useMemo(
    () => [
      { value: '', label: systemZone ? t('desktopSetup.timeZoneSystem', { zone: timeZoneLabel(systemZone) }) : t('desktopSetup.timeZoneSystemUnknown') },
      ...timeZoneList([systemZone, state.timeZone]).map((z) => ({ value: z, label: timeZoneLabel(z) })),
    ],
    [t, systemZone, state.timeZone],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (state.problem) {
      setError(state.problem);
      triggerHaptic(25);
      return;
    }
    setSubmitting(true);
    try {
      const c = state.choices;
      await api.finishSetup({
        instanceName: c.instanceName,
        defaultLanguage: c.defaultLanguage,
        timeZone: c.timeZone,
        createSampleData: c.createSampleData,
        backupEnabled: c.backupEnabled,
        ...(c.backupEnabled ? { backupTime: c.backupTime, backupRetentionDays: c.backupRetentionDays, backupDir } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t('setup.failed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas text-main flex flex-col items-center justify-center p-4 sm:py-1.5 sm:px-3 font-sans" style={keyboardRoom}>
      {/* The window is 860 px high at the start: the wizard fits that without scrolling; on a lower window the button row stays at the bottom edge (overflow-clip, not -hidden: that would stop it from sticking) */}
      <div className="w-full max-w-xl panel-surface shadow-panel overflow-hidden sm:overflow-clip" data-testid="desktop-setup">
        <div className="p-4 sm:p-2.5 bg-canvas border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent text-on-accent rounded-btn flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight leading-none">{t('desktopSetup.title')}</h1>
            <p className="text-[11px] text-muted mt-0.5">{t('desktopSetup.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 sm:p-4 sm:pb-0 sm:space-y-2.5 text-xs">
          <p className="text-muted leading-relaxed sm:leading-normal">
            <Trans
              t={t}
              i18nKey="desktopSetup.welcome"
              values={{ name: user.displayName || user.username }}
              components={{ b: <strong className="text-main" /> }}
            />
          </p>

          <div className="p-3.5 sm:p-2.5 bg-canvas border border-border space-y-3 sm:space-y-2">
            <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-accent" />
              <span>{t('desktopSetup.section')}</span>
            </h2>
            <div>
              <label className="block text-muted mb-1" htmlFor="desktop-setup-name">
                {t('setup.instanceName')}
              </label>
              <input
                id="desktop-setup-name"
                type="text"
                value={state.instanceName}
                onChange={(e) => {
                  nameTouched.current = true;
                  state.setInstanceName(e.target.value);
                }}
                placeholder="MindSift"
                className="w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field"
              />
              <p className="text-[11px] text-muted mt-1">{t('desktopSetup.instanceNameHint')}</p>
            </div>
            <div>
              <p className="block text-muted mb-1">{t('setup.language')}</p>
              <SelectMenu
                ariaLabel={t('setup.language')}
                value={state.defaultLanguage}
                onChange={state.chooseLanguage}
                options={LANGUAGES.map((l) => ({ value: l.id, label: l.name }))}
              />
            </div>
            <div data-setup-time-zone>
              <p className="block text-muted mb-1">{t('setup.timeZone')}</p>
              <SelectMenu ariaLabel={t('setup.timeZone')} value={state.timeZone} onChange={state.setTimeZone} options={zoneOptions} />
              <p className="text-[11px] text-muted mt-1">{t('desktopSetup.timeZoneHint')}</p>
            </div>
            <div className="flex items-center justify-between gap-3 select-none pt-2 border-t border-border">
              <div>
                <span className="font-medium text-main block">{t('setup.helpNotes')}</span>
                <span className="text-[11px] text-muted">{t('desktopSetup.helpNotesHint')}</span>
              </div>
              <ToggleSwitch checked={state.createSampleData} onChange={state.setCreateSampleData} title={t('setup.helpNotes')} />
            </div>
          </div>

          <div className="p-3.5 sm:p-2.5 bg-canvas border border-border space-y-3 sm:space-y-2">
            <div className="flex items-center justify-between gap-3 select-none">
              <div>
                <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
                  <Archive className="w-3.5 h-3.5 text-accent" />
                  <span>{t('desktopSetup.backups')}</span>
                </h2>
                <p className="text-[11px] text-muted mt-1">{t('desktopSetup.backupsHint')}</p>
              </div>
              <ToggleSwitch checked={state.backupEnabled} onChange={state.setBackupEnabled} title={t('desktopSetup.backups')} />
            </div>
            {state.backupEnabled && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="text-[11px] text-muted">
                    {t('setup.backupTime')}
                    <TimeField
                      ariaLabel={t('setup.backupTime')}
                      value={state.backupTime}
                      onChange={state.setBackupTime}
                      className="block mt-1 w-36 sm:w-28"
                      inputClassName="h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
                    />
                  </div>
                  <label className="text-[11px] text-muted">
                    {t('setup.backupKeepDays')}
                    <NumberField
                      value={Number(state.backupKeepDays) || DEFAULT_BACKUP_RETENTION_DAYS}
                      min={1}
                      max={MAX_BACKUP_RETENTION_DAYS}
                      unit={t('setup.backupDays', { count: Number(state.backupKeepDays) || DEFAULT_BACKUP_RETENTION_DAYS })}
                      label={t('setup.backupKeepDays')}
                      onCommit={(n) => state.setBackupKeepDays(String(n))}
                      className="mt-1 w-28"
                    />
                  </label>
                </div>
                <div>
                  <p className="text-[11px] text-muted mb-1">{t('desktopSetup.backupFolder')}</p>
                  <BackupFolderField
                    value={backupDir}
                    shown={backupDir === stored.dir ? stored.shown : undefined}
                    defaultDir={defaultDir}
                    onCommit={setBackupDir}
                  />
                  <p className="text-[11px] text-muted mt-1">{t('desktopSetup.backupFolderHint')}</p>
                </div>
              </>
            )}
          </div>

          {error && (
            <div role="alert" className="alert-err flex items-center gap-2">
              <CircleAlert className="w-4 h-4 text-status-err shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end pt-1 sm:sticky sm:bottom-0 sm:z-10 sm:-mx-4 sm:px-4 sm:py-2.5 sm:bg-panel sm:border-t sm:border-border">
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{submitting ? t('desktopSetup.submitting') : t('desktopSetup.submit')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
