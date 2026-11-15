import { useCallback, useState } from 'react';
import { toggleTag } from './taskListing';

// Hashtag filter of TasksView: several hashtags at once (a task shows with any of them), a click switches
// one on or off. It belongs to the open list: another list starts without a filter again (its hashtags are
// different ones). Neither stored nor kept per list.
const NO_TAGS: string[] = [];

export function useTagFilter(listId: string) {
  const [state, setState] = useState<{ listId: string; tags: string[] }>({ listId, tags: [] });
  // Another list: reset during render, so the new list never renders with the old filter
  const selectedTags = state.listId === listId ? state.tags : NO_TAGS;
  if (state.listId !== listId) setState({ listId, tags: [] });

  const toggle = useCallback(
    (tag: string) => setState((prev) => ({ listId, tags: toggleTag(prev.listId === listId ? prev.tags : [], tag) })),
    [listId]
  );
  const clear = useCallback(() => setState((prev) => (prev.tags.length === 0 ? prev : { ...prev, tags: [] })), []);
  return { selectedTags, toggleTag: toggle, clearTags: clear };
}
