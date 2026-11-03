import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Retention, User } from '../../../lib/types';
import { api } from '../../../lib/api';

// Kontoeinstellungen → Aufbewahrung: the areas and the delays offered (storage.RetentionChoices)
const RETENTION_AREAS: { key: keyof Retention; title: string; text: string; verb: string }[] = [
  { key: 'doneTasks', title: 'Erledigte Aufgaben', text: 'Wandern danach in den Papierkorb der Aufgaben.', verb: 'in den Papierkorb nach' },
  { key: 'taskTrash', title: 'Papierkorb der Aufgaben', text: 'Gelöschte und geleerte Aufgaben.', verb: 'endgültig löschen nach' },
  { key: 'triageTrash', title: 'Papierkorb der Triage', text: 'Beim Sortieren verworfene Gedanken.', verb: 'endgültig löschen nach' },
  { key: 'noteTrash', title: 'Papierkorb der Notizen', text: 'Gelöschte Notizen im Workspace.', verb: 'endgültig löschen nach' },
  { key: 'listDone', title: 'Abgehakte Listeneinträge', text: 'In Einkaufs- und Checklisten.', verb: 'löschen nach' },
];
const RETENTION_OPTIONS = [
  { days: 7, label: '7 Tagen' },
  { days: 14, label: '14 Tagen' },
  { days: 30, label: '30 Tagen' },
  { days: 90, label: '90 Tagen' },
  { days: 365, label: 'einem Jahr' },
  { days: 730, label: 'zwei Jahren' },
  { days: 0, label: 'nie' },
];

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
      setRetentionError(err?.message || 'Speichern fehlgeschlagen');
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
  const { retentionSaving, retentionError, handleChangeRetention } = retention;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">Aufbewahrung</h2>
        <p className="text-muted mt-0.5">
          Wie lange Erledigtes und Gelöschtes bleibt, gezählt ab dem Abhaken bzw. Löschen. In geteilten Aufgabenlisten,
          Listen und Notizen gilt die Einstellung der Person, der sie gehören.
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
          {RETENTION_AREAS.map((area) => (
            <div key={area.key} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-main">{area.title}</p>
                <p className="text-muted">{area.text}</p>
              </div>
              <label className="flex items-center gap-2 flex-shrink-0">
                <span className="text-muted">{area.verb}</span>
                <select
                  value={currentUser.retention![area.key]}
                  disabled={retentionSaving}
                  onChange={(e) => handleChangeRetention(area.key, Number(e.target.value))}
                  className="h-11 sm:h-8 px-2 input-field text-base sm:text-xs bg-panel"
                  aria-label={`${area.title}: ${area.verb}`}
                >
                  {RETENTION_OPTIONS.filter((o) => o.days > 0 || currentUser.retentionNeverAllowed !== false).map((o) => (
                    <option key={o.days} value={o.days}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
