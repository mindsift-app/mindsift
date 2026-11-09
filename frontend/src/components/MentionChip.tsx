import React from 'react';
import { useMentionName } from '../lib/mentions';

// An @-mention in a text: the person's current name, highlighted like a hashtag
export function MentionChip({ userId }: { userId: string }) {
  const name = useMentionName(userId);
  return <span className="text-accent bg-accent-dim rounded-btn px-0.5 font-medium whitespace-nowrap">@{name}</span>;
}
