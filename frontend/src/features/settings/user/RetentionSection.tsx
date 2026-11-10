import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { AlertCircle } from 'lucide-react';
import { Retention, User } from '../../../lib/types';
import { api } from '../../../lib/api';
import { SelectMenu } from '../../../components/SelectMenu';

// Kontoeinstellungen → Aufbewahrung: the areas and the delays offered (storage.RetentionChoices); texts in
// settings:retention.areas.<key> and settings:retention.options.<days>
const RETENTION_AREAS: (keyof Retention)[] = ['doneTasks', 'taskTrash', 'triageTrash', 'noteTrash', 'listDone'];
const RETENTION_DAYS = [7, 14, 30, 90, 365, 730, 0];

// Retention: one delay per area (storage/retention.go); "nie" only when the server allows it
export function useRetentionSettings(currentUser: User, onUserUpdated: (u: User) => void) {
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const handleChangeRetention = async (key: keyof Retention, days: number) => {
    if (!currentUser.retention) return;
    setRetentionSaving(true);
    setRetentionError(null);
    try {
      onUserUpdated(await api.updateSettings({ retention: { ...currentUser.retention, [key]: days } }));
    } catch (err: any) {
      setRetentionError(err?.message || i18n.t('settings:api.saveFailed'));
    } finally {
      setRetentionSaving(false);
    }
  };

  return { retentionSaving, retentionError, handleChangeRetention };
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
  const { retentionSaving, retentionError, handleChangeRetention } = retention;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('retention.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('retention.intro')}
        </p>
      </div>
      {retentionError && (
        <div className="alert-err flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          <span>{retentionError}</span>
        </div>
      )}
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
            <div key={area.key} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-main">{area.title}</p>
                <p className="text-muted">{area.text}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
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
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
