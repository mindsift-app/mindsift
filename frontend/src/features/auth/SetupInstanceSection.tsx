import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, Users } from 'lucide-react';
import i18n, { applyLanguage, isLanguage, LANGUAGES } from '../../i18n';
import { SharingMode } from '../../lib/types';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { SelectMenu } from '../../components/SelectMenu';

// The setup wizard's questions about the instance, beside the admin account: name, default language,
// sharing mode, registration and sample data. The first-boot wizard asks them together with the account;
// after an admin from ADMIN_USER they come on their own (FinishSetupView). Further questions of the setup
// go here, so both ways ask them.

export interface SetupChoices {
  instanceName: string;
  sharingMode: SharingMode;
  allowRegistration: boolean;
  createSampleData: boolean;
  defaultLanguage: string;
}

export function useSetupChoices(initialInstanceName?: string) {
  const [instanceName, setInstanceName] = useState(initialInstanceName || 'MindSift');
  const [sharingMode, setSharingMode] = useState<SharingMode>('organizations');
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [createSampleData, setCreateSampleData] = useState(false);
  // Default language of the server; the wizard switches to it right away
  const [defaultLanguage, setDefaultLanguage] = useState(i18n.language);
  const chooseLanguage = (lang: string) => {
    setDefaultLanguage(lang);
    if (isLanguage(lang)) void applyLanguage(lang);
  };
  const choices: SetupChoices = {
    instanceName: instanceName.trim() || 'MindSift',
    sharingMode,
    allowRegistration,
    createSampleData,
    defaultLanguage,
  };
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
    choices,
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
          className="w-full h-8 px-2.5 input-field"
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
