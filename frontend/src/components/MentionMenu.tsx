import React from 'react';
import { useTranslation } from 'react-i18next';
import { MentionInput } from '../lib/useMentionInput';
import { UserAvatar } from './UserAvatar';

// The list of the @-mention picker (useMentionInput), placed by the field it belongs to. Rows take the
// mouse down (not click), so the field keeps its focus.
export function MentionMenu({
  mention,
  text,
  apply,
  className = 'absolute left-0 top-full mt-1',
}: {
  mention: MentionInput;
  text: string;
  apply: (next: string, caret: number) => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
  if (!mention.open) return null;
  return (
    <div
      role="listbox"
      aria-label={t('mention.pick')}
      className={`${className} z-50 w-72 max-w-[calc(100vw-2rem)] p-1 rounded-card bg-panel border border-border shadow-panel text-xs`}
    >
      {mention.items.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={i === mention.index}
          aria-disabled={!c.hasAccess}
          onMouseDown={(e) => {
            e.preventDefault();
            mention.pick(c, text, apply);
          }}
          onMouseEnter={() => c.hasAccess && mention.setIndex(i)}
          className={`w-full min-h-[44px] sm:min-h-0 px-2 py-1.5 rounded-btn text-left flex items-center gap-2 ${
            !c.hasAccess ? 'opacity-50 cursor-default' : i === mention.index ? 'bg-accent-dim text-accent' : 'text-main hover:bg-panel-elevated cursor-pointer'
          }`}
        >
          <UserAvatar userId={c.id} name={c.displayName} avatarUrl={c.avatarUrl} size="xs" />
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="truncate font-medium">{c.displayName}</span>
            {!c.hasAccess ? (
              <span className="text-[10px] text-muted">{t('mention.noAccess')}</span>
            ) : (
              c.username && <span className="text-[10px] text-muted truncate">@{c.username}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
