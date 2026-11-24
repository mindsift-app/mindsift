import React from 'react';
import { useTranslation } from 'react-i18next';
import { Retention, User } from '../../../lib/types';
import { SelectMenu } from '../../../components/SelectMenu';
import { InstantSaveToast, useInstantSave } from './InstantSave';
import { SettingRow } from '../../../components/SettingsCard';

// Kontoeinstellungen → Aufbewahrung: the areas and the delays offered (storage.RetentionChoices); texts in
// settings:retention.areas.<key> and settings:retention.options.<days>
const RETENTION_AREAS: (keyof Retention)[] = ['doneTasks', 'taskTrash', 'triageTrash', 'noteTrash', 'listDone'];
const RETENTION_DAYS = [7, 14, 30, 90, 365, 730, 0];

// Retention: one delay per area (storage/retention.go); "nie" only when the server allows it
export function useRetentionSettings(currentUser: User, onUserUpdated: (u: User) => void) {
  const instant = useInstantSave(onUserUpdated);
  const handleChangeRetention = async (key: keyof Retention, days: number) => {
    if (!currentUser.retention) return;
    await instant.save({ retention: { ...currentUser.retention, [key]: days } });
  };

  return { instant, retentionSaving: instant.saving, handleChangeRetention };
}

// Kontoeinstellungen → Aufbewahrung
export function RetentionSection({
  retention,
  currentUser,
}: {
  retention: ReturnType<typeof useRetentionSettings>;
  currentUser: User;
}) {
  const { t } = useTranslation('settings');
  const { instant, retentionSaving, handleChangeRetention } = retention;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('retention.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('retention.intro')}
        </p>
      </div>
      <InstantSaveToast save={instant} />
      {currentUser.retention && (
        <div className="divide-y divide-border">
          {RETENTION_AREAS.map((key) => {
            const area = {
              key,
              title: t(`retention.areas.${key}.title`),
              text: t(`retention.areas.${key}.text`),
              verb: t(`retention.areas.${key}.verb`),
            };
            return (
            <SettingRow key={area.key} plain className="py-3" title={area.title} hint={area.text}>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-muted">{area.verb}</span>
                <SelectMenu
                  size="sm"
                  ariaLabel={`${area.title}: ${area.verb}`}
                  value={String(currentUser.retention![area.key])}
                  disabled={retentionSaving}
                  onChange={(days) => handleChangeRetention(area.key, Number(days))}
                  options={RETENTION_DAYS.filter((days) => days > 0 || currentUser.retentionNeverAllowed !== false).map((days) => ({
                    value: String(days),
                    label: t(`retention.options.${days}`),
                  }))}
                />
              </div>
            </SettingRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
