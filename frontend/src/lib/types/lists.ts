// Lists: shopping and other lists, their items, shares and suggestions.

import type { Origin, TaskListMember } from './tasks';

// An entry of a list's history: GET /lists/{id}/suggestions (features/lists/itemSuggestions.ts)
export interface ListItemSuggestion {
  content: string;
  category: string;
  count: number;
  lastUsed: string;
}

export interface ListItem {
  id: string;
  listId: string;
  content: string;
  category?: string;
  quantity?: string;
  isCompleted: boolean;
  completedBy?: string;
  completedByName?: string;
  createdBy?: string;
  createdByName?: string;
  sortOrder: number;
  createdAt: string;
  completedAt?: string;
  origin?: Origin;
}

export interface ListShare {
  id: string;
  listId: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  targetEmail?: string;
  role: 'editor' | 'viewer';
  createdBy?: string;
  createdAt: string;
}

export interface SharedList {
  id: string;
  userId?: string;
  ownerName?: string;
  isOwner?: boolean;
  role?: string;
  spaceId?: string;
  title: string;
  icon: string;
  listType: 'shopping' | 'checklist' | 'vacation';
  items: ListItem[];
  shares?: ListShare[];
  members?: TaskListMember[]; // owner + everyone the list is shared with
  updatedAt: string;
  createdAt: string;
  // App only: the open count of LIST_COUNTS for a list not open, whose entries (ITEM_* go to the open
  // list only) are then out of date; loading the lists drops it (features/lists/listItems.ts listOpenCount)
  liveOpenCount?: number;
}
