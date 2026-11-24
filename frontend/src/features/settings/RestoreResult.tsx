import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, FileArchive } from 'lucide-react';
import { DATA_SECTIONS, DataSection, ImportSummary } from '../../lib/types';
import { summaryParts } from './importSummary';

interface RestoreResultProps {
  // What a file would bring (preview) or what an import or restore brought (done)
  summary: ImportSummary;
  done: boolean;
  title: string;
  // Lines and buttons below the summary (media, settings, the confirmation, the actions)
  children?: React.ReactNode;
}

// The box after reading or restoring a backup or an import: title, what it creates or created, the
// entries left out (folded), then whatever the caller adds. Used by the import, the server backups and the
// desktop app's take-over of a server account.
export const RestoreResult: React.FC<RestoreResultProps> = ({ summary, done, title, children }) => {
  const { t } = useTranslation('settings');
  return (
    <div className={`p-3 rounded-card border text-xs space-y-2 ${done ? 'border-status-ok/40 bg-status-ok/10' : 'border-border bg-panel'}`}>
      <p className="font-semibold text-main flex items-center gap-1.5">
        {done ? <Check className="w-3.5 h-3.5 text-status-ok shrink-0" /> : <FileArchive className="w-3.5 h-3.5 text-accent shrink-0" />}
        <span>{title}</span>
      </p>
      <p className="text-muted">{t(done ? 'import.created' : 'import.willCreate', { what: summaryParts(summary).join(', ') || t('import.nothing') })}</p>
      {summary.skipped.length > 0 && (
        <details className="text-[11px] text-muted">
          <summary className="cursor-pointer">{t('import.skipped', { count: summary.skipped.length })}</summary>
          <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
            {summary.skipped.map((s, i) => (
              <li key={i}>
                <span className="font-mono text-main">{s.path}</span> – {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {children}
    </div>
  );
};

interface RestoreConfirmProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // The sections that will be replaced, named in the warning
  sections: DataSection[];
  // The warning, a text with <b>…</b> and {{sections}} (default: replacing by a backup)
  i18nKey?: string;
}

// Replacing data cannot be undone: a red box with the warning and a checkbox that unlocks the button
export const RestoreConfirm: React.FC<RestoreConfirmProps> = ({ checked, onChange, sections, i18nKey = 'import.restoreWarning' }) => {
  const { t } = useTranslation('settings');
  const names = DATA_SECTIONS.filter((s) => sections.includes(s.id))
    .map((s) => s.label)
    .join(', ');
  return (
    <label className="flex items-start gap-2 p-2.5 rounded-card border border-status-err/40 bg-status-err/10 text-[11px] text-main cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0" />
      <span>
        <Trans t={t} i18nKey={i18nKey} values={{ sections: names }} components={{ b: <strong className="text-status-err" /> }} />
      </span>
    </label>
  );
};
