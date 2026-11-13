import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, Server, Users } from 'lucide-react';
import i18n, { applyLanguage, isLanguage, LANGUAGES } from '../../i18n';
import { SharingMode } from '../../lib/types';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { SelectMenu } from '../../components/SelectMenu';
import { TimeField } from '../../components/TimeField';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_BACKUP_TIME,
  MAX_BACKUP_RETENTION_DAYS,
  validBackupRetentionDays,
} from '../../lib/backupDefaults';
import { browserTimeZone, timeZoneLabel, timeZoneList } from '../../lib/timeZones';

// The setup wizard's questions about the instance, beside the admin account: name, default language,
// time zone, sharing mode, registration, daily backups and sample data. The first-boot wizard asks them together with
// the account; after an admin from ADMIN_USER they come on their own (FinishSetupView). Further questions
// of the setup go here, so both ways ask them (mail server and summary: SetupMailSection, SetupSummary).

export interface SetupChoices {
  instanceName: string;
  sharingMode: SharingMode;
  allowRegistration: boolean;
  createSampleData: boolean;
  defaultLanguage: string;
  // The server's time zone (IANA name); '' leaves it to TZ, else UTC
  timeZone: string;
  backupEnabled: boolean;
  // Only with backups switched on; otherwise the server keeps its defaults for the admin settings
  backupTime?: string;
  backupRetentionDays?: number;
}

export function useSetupChoices(initialInstanceName?: string) {
  const [instanceName, setInstanceName] = useState(initialInstanceName || 'MindSift');
  const [sharingMode, setSharingMode] = useState<SharingMode>('organizations');
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [createSampleData, setCreateSampleData] = useState(false);
  // Daily backups start switched on: a new server should not run without them until someone finds the switch
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [backupTime, setBackupTime] = useState(DEFAULT_BACKUP_TIME);
  // As typed, so the field can be empty for a moment
  const [backupKeepDays, setBackupKeepDays] = useState(String(DEFAULT_BACKUP_RETENTION_DAYS));
  // Default language of the server; the wizard switches to it right away
  const [defaultLanguage, setDefaultLanguage] = useState(i18n.language);
  const chooseLanguage = (lang: string) => {
    setDefaultLanguage(lang);
    if (isLanguage(lang)) void applyLanguage(lang);
  };
  // The server's time zone, suggested from this browser: whoever sets up the server usually lives where it runs
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const keepDays = Number(backupKeepDays);
  const choices: SetupChoices = {
    instanceName: instanceName.trim() || 'MindSift',
    sharingMode,
    allowRegistration,
    createSampleData,
    defaultLanguage,
    timeZone,
    backupEnabled,
    ...(backupEnabled ? { backupTime, backupRetentionDays: keepDays } : {}),
  };
  // What keeps the wizard from sending (the server checks the same), in the current language
  const problem = !backupEnabled
    ? null
    : !backupTime
      ? i18n.t('auth:setup.backupTimeMissing')
      : !validBackupRetentionDays(keepDays)
        ? i18n.t('auth:setup.backupKeepDaysInvalid', { max: MAX_BACKUP_RETENTION_DAYS })
        : null;
  return {
    instanceName,
    setInstanceName,
    sharingMode,
    setSharingMode,
    allowRegistration,
    setAllowRegistration,
    createSampleData,
    setCreateSampleData,
    defaultLanguage,
    chooseLanguage,
    timeZone,
    setTimeZone,
    backupEnabled,
    setBackupEnabled,
    backupTime,
    setBackupTime,
    backupKeepDays,
    setBackupKeepDays,
    choices,
    problem,
  };
}

type SetupChoicesState = ReturnType<typeof useSetupChoices>;

export const SetupInstanceSection: React.FC<{ state: SetupChoicesState; heading: string }> = ({ state, heading }) => {
  const { t } = useTranslation('auth');
  const modes: { id: SharingMode; label: string; hint: string }[] = [
    { id: 'private', label: t('setup.private'), hint: t('setup.privateHint') },
    { id: 'organizations', label: t('setup.organizations'), hint: t('setup.organizationsHint') },
    { id: 'open', label: t('setup.open'), hint: t('setup.openHint') },
  ];
  // Same list as the administration's setting (TimeZoneSetting), with the browser's zone always in it
  const zoneOptions = useMemo(
    () => [
      { value: '', label: t('setup.timeZoneNotSet') },
      ...timeZoneList([browserTimeZone(), state.timeZone]).map((z) => ({ value: z, label: timeZoneLabel(z) })),
    ],
    [t, state.timeZone],
  );
  return (
    <div className="p-3.5 bg-canvas border border-border space-y-3">
      <h2 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
        <Server className="w-3.5 h-3.5 text-accent" />
        <span>{heading}</span>
      </h2>

      <div>
        <label className="block text-muted mb-1">{t('setup.instanceName')}</label>
        <input
          type="text"
          value={state.instanceName}
          onChange={(e) => state.setInstanceName(e.target.value)}
          placeholder="MindSift"
          className="w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field"
        />
      </div>

      <div>
        <p className="block text-muted mb-1">{t('setup.language')}</p>
        <SelectMenu
          ariaLabel={t('setup.language')}
          value={state.defaultLanguage}
          onChange={state.chooseLanguage}
          options={LANGUAGES.map((l) => ({ value: l.id, label: l.name }))}
        />
        <p className="text-[11px] text-muted mt-1">{t('setup.languageHint')}</p>
      </div>

      <div data-setup-time-zone>
        <p className="block text-muted mb-1">{t('setup.timeZone')}</p>
        <SelectMenu ariaLabel={t('setup.timeZone')} value={state.timeZone} onChange={state.setTimeZone} options={zoneOptions} />
        <p className="text-[11px] text-muted mt-1">{t('setup.timeZoneHint')}</p>
      </div>

      <div>
        <label className="block text-muted mb-1.5 flex items-center gap-1">
          <Users className="w-3 h-3 text-accent" />
          <span>{t('setup.sharing')}</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => state.setSharingMode(m.id)}
              className={`p-2.5 text-left border transition-colors ${
                state.sharingMode === m.id
                  ? 'bg-panel border-accent text-main'
                  : 'border-border text-muted hover:text-main'
              }`}
            >
              <p className="font-bold text-xs">{m.label}</p>
              <p className="text-[10px] text-muted mt-0.5">{m.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-border space-y-2">
        <div className="flex items-center justify-between gap-3 select-none">
          <div>
            <span className="font-medium text-main block">{t('setup.allowRegistration')}</span>
            <span className="text-[11px] text-muted">{t('setup.allowRegistrationHint')}</span>
          </div>
          <ToggleSwitch checked={state.allowRegistration} onChange={state.setAllowRegistration} />
        </div>

        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between gap-3 select-none">
            <div>
              <span className="font-medium text-main flex items-center gap-1">
                <Archive className="w-3 h-3 text-accent" />
                <span>{t('setup.backups')}</span>
              </span>
              <span className="text-[11px] text-muted">
                <Trans t={t} i18nKey="setup.backupsHint" components={{ c: <code className="font-mono" /> }} />
              </span>
            </div>
            <ToggleSwitch checked={state.backupEnabled} onChange={state.setBackupEnabled} title={t('setup.backups')} />
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
                    // block: on touch the field is the bare system input, which would sit beside the label
                    className="block mt-1 w-36 sm:w-28"
                    inputClassName="h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
                  />
                </div>
                <label className="text-[11px] text-muted">
                  {t('setup.backupKeepDays')}
                  <input
                    type="number"
                    min={1}
                    max={MAX_BACKUP_RETENTION_DAYS}
                    value={state.backupKeepDays}
                    onChange={(e) => state.setBackupKeepDays(e.target.value)}
                    className="block mt-1 h-11 sm:h-8 px-2 input-field text-base sm:text-xs w-24"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted">
                <Trans t={t} i18nKey="setup.backupsCopyHint" components={{ c: <code className="font-mono" /> }} />
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 select-none pt-1">
          <div>
            <span className="font-medium text-main block">{t('setup.sampleData')}</span>
            <span className="text-[11px] text-muted">{t('setup.sampleDataHint')}</span>
          </div>
          <ToggleSwitch checked={state.createSampleData} onChange={state.setCreateSampleData} />
        </div>
      </div>
    </div>
  );
};
