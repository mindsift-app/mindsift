import React from 'react';
import { UserAvatar } from '../../components/UserAvatar';
import { AvatarStack } from '../../components/AvatarStack';
import { Presence } from '../../lib/docSync/transport';
import { useTranslation } from 'react-i18next';

const MAX_VISIBLE = 3;

interface PresenceAvatarsProps {
  people: Presence[];
  avatars: Map<string, string>; // userId -> avatarUrl
}

// Who else has the note open: the shared AvatarStack plus the full list on hover / keyboard focus
export const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({ people, avatars }) => {
  const { t } = useTranslation('workspace');
  if (people.length === 0) return null;
  return (
    <div
      className="group/presence relative flex items-center outline-none"
      tabIndex={0}
      aria-label={t('presence.onlineList', { names: people.map((p) => p.name).join(', ') })}
    >
      <AvatarStack
        people={people.map((p) => ({ id: p.userId, name: p.name, avatarUrl: avatars.get(p.userId) }))}
        max={MAX_VISIBLE}
      />

      <div className="invisible opacity-0 group-hover/presence:visible group-hover/presence:opacity-100 group-focus/presence:visible group-focus/presence:opacity-100 transition-opacity absolute right-0 top-full mt-1.5 z-30 min-w-[11rem] max-w-[16rem] p-1.5 rounded-card bg-panel border border-border shadow-lg">
        <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-faint">{t('presence.online')}</div>
        {people.map((p) => (
          <div key={p.userId} className="flex items-center gap-2 px-1.5 py-1 text-xs text-main">
            <span className="relative">
              <UserAvatar userId={p.userId} name={p.name} avatarUrl={avatars.get(p.userId) || ''} size="xs" />
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-status-ok ring-2 ring-[var(--bg-panel)]" />
            </span>
            <span className="truncate">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
