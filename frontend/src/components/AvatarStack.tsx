import React from 'react';
import { UserAvatar } from './UserAvatar';

export interface AvatarPerson {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface AvatarStackProps {
  people: AvatarPerson[];
  max?: number;
  size?: 'xxs' | 'xs';
  // Ring in the color of the surface behind the stack, so overlapping circles stay separated
  ringClass?: string;
  title?: string;
  className?: string;
}

const OVERFLOW_SIZE = {
  xxs: 'w-4 h-4 text-[7px]',
  xs: 'w-5 h-5 text-[9px]',
};

// Small overlapping profile pictures: at most `max` circles, the rest as a monochrome "+n" circle.
// Used for presence in notes, list/task-list tabs, task assignees and list item authors (Doku/ui-patterns.md).
export const AvatarStack: React.FC<AvatarStackProps> = ({
  people,
  max = 3,
  size = 'xs',
  ringClass = 'ring-[var(--bg-app)]',
  title,
  className = '',
}) => {
  if (people.length === 0) return null;
  const visible = people.slice(0, max);
  const hidden = people.length - visible.length;

  return (
    <span className={`inline-flex items-center -space-x-1.5 shrink-0 ${className}`} title={title}>
      {visible.map((p) => (
        <UserAvatar
          key={p.id}
          userId={p.id}
          colorRing
          name={p.name}
          avatarUrl={p.avatarUrl || ''}
          size={size}
          showTitle={false}
          className={`ring-2 ${ringClass}`}
        />
      ))}
      {hidden > 0 && (
        <span
          className={`relative inline-flex items-center justify-center rounded-full font-bold leading-none bg-muted text-panel ring-2 ${ringClass} ${OVERFLOW_SIZE[size]}`}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
};
