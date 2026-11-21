import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, RotateCcw } from 'lucide-react';
import { DesktopShellError, desktopShell } from '../../lib/desktopShell';

// Desktop app only: the folder a local instance writes its backups to. The path can be typed or chosen in
// the system's folder dialog (the shell's pick-folder); '' is the default, backups/ in the instance's
// folder, shown as the placeholder. onCommit gets the folder when it was chosen, reset, or typed and left
// (Enter or leaving the field); the server checks it. Used by the desktop setup wizard and the
// administration's backup card.
export const BackupFolderField: React.FC<{
  value: string;
  defaultDir: string;
  onCommit: (dir: string) => void;
  disabled?: boolean;
}> = ({ value, defaultDir, onCommit, disabled }) => {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  // A new value from outside (stored, or refused and reset) replaces what was typed
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }

  const commit = (dir: string) => {
    setProblem(null);
    const clean = dir.trim();
    setDraft(clean);
    if (clean !== value) onCommit(clean);
  };

  const pick = async () => {
    setProblem(null);
    try {
      const { path } = await desktopShell.pickFolder(draft.trim() || defaultDir);
      if (path) commit(path);
    } catch (e) {
      const code = e instanceof DesktopShellError ? e.problem.code : 'failed';
      setProblem(t(code === 'unavailable' ? 'backups.folderPickUnavailable' : 'backups.folderPickFailed'));
    }
  };

  return (
    <div className="space-y-1" data-backup-folder>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            }
          }}
          placeholder={defaultDir}
          aria-label={t('backups.folder')}
          spellCheck={false}
          className="flex-1 min-w-48 h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono input-field"
        />
        <button
          type="button"
          onClick={pick}
          disabled={disabled}
          className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <FolderOpen className="w-3.5 h-3.5 text-accent" />
          {t('backups.folderChoose')}
        </button>
        {value !== '' && (
          <button
            type="button"
            onClick={() => commit('')}
            disabled={disabled}
            title={t('backups.folderResetHint')}
            className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('backups.folderReset')}
          </button>
        )}
      </div>
      {problem && <p className="text-[11px] text-status-err">{problem}</p>}
    </div>
  );
};
