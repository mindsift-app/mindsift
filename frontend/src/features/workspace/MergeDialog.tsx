import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge, Search } from 'lucide-react';
import { FormSheet } from '../../components/FormSheet';
import { api } from '../../lib/api';
import { Document, MergeResult } from '../../lib/types';

interface MergeDialogProps {
  docs: Document[];
  sourceId: string;
  /** Known after a drop in the sidebar; otherwise the user picks it here */
  targetId?: string | null;
  onClose: () => void;
  onMerged: (result: MergeResult) => void;
}

const canWrite = (d: Document) => d.isOwner || d.permission === 'owner' || d.permission === 'write';

// Merging a note into another: pick the target (when not dropped onto one), confirm, merge. The source
// is appended to the target under a heading with its title and goes to the trash.
export const MergeDialog: React.FC<MergeDialogProps> = ({ docs, sourceId, targetId, onClose, onMerged }) => {
  const { t } = useTranslation('workspace');
  const [target, setTarget] = useState<string | null>(targetId || null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = docs.find((d) => d.id === sourceId);
  const targetDoc = docs.find((d) => d.id === target);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => d.id !== sourceId && !d.isArchived && canWrite(d))
      .filter((d) => !q || (d.title || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [docs, sourceId, query]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      onMerged(await api.mergeDocuments(target, sourceId));
    } catch (err: any) {
      setError(err?.message || t('merge.failed'));
      setBusy(false);
    }
  };

  const title = (d?: Document) => `„${d?.title || t('editor.untitled')}“`;

  return (
    <FormSheet
      title={t('merge.title')}
      icon={<GitMerge className="w-4 h-4" />}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={target ? t('merge.submit') : t('merge.pickTarget')}
      busy={busy || !target}
    >
      {targetDoc ? (
        <div className="space-y-2 text-xs">
          <p className="text-main">
            {t('merge.question', { source: title(source), target: title(targetDoc) })}
          </p>
          <p className="text-muted">
            {t('merge.explain', { source: title(source), target: title(targetDoc) })}
          </p>
          {!targetId && (
            <button type="button" onClick={() => setTarget(null)} className="text-accent hover:underline min-h-[44px] sm:min-h-0">
              {t('merge.otherTarget')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted">{t('merge.whichTarget', { source: title(source) })}</p>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('merge.search')}
              className="w-full h-11 sm:h-9 pl-8 pr-2 input-field text-sm"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-border rounded-card border border-border">
            {candidates.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setTarget(d.id)}
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 flex items-center gap-2 text-left text-xs text-main hover:bg-panel-elevated"
                >
                  {d.icon && <span className="shrink-0">{d.icon}</span>}
                  <span className="truncate flex-1">{d.title || t('editor.untitled')}</span>
                  {d.folderPath && <span className="text-[10px] text-faint truncate max-w-[40%]">{d.folderPath}</span>}
                </button>
              </li>
            ))}
            {candidates.length === 0 && <li className="px-3 py-3 text-xs text-faint">{t('merge.none')}</li>}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-status-err">{error}</p>}
    </FormSheet>
  );
};
