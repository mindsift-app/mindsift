import React, { useState } from 'react';

const TAB_TYPE = 'application/mindsift-tab-id';

// Sorting a row of tabs by drag and drop (task lists, shared lists). The tab being dragged carries its own
// data type, so the drops of tasks or list items onto a tab keep working beside it. onReorder gets the new
// order of all ids.
export function useTabReorder(ids: string[], onReorder: (ids: string[]) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Where the dragged tab would land: before or after this tab
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(null);

  const end = () => {
    setDraggingId(null);
    setTarget(null);
  };

  return {
    draggingId,
    // Marker for the tab: a line on the side where the dragged tab would go
    dropSide: (id: string): 'before' | 'after' | null =>
      draggingId && target?.id === id && draggingId !== id ? (target.after ? 'after' : 'before') : null,
    dragProps: (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData(TAB_TYPE, id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingId(id);
      },
      onDragEnd: end,
    }),
    // For the tab's onDragOver; true when a tab is being dragged (then the other drops stay out)
    handleDragOver: (e: React.DragEvent, id: string): boolean => {
      if (!draggingId) return false;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientX > box.left + box.width / 2;
      if (target?.id !== id || target.after !== after) setTarget({ id, after });
      return true;
    },
    // For the tab's onDrop; true when it was a tab
    handleDrop: (e: React.DragEvent, id: string): boolean => {
      const moved = draggingId || e.dataTransfer.getData(TAB_TYPE);
      if (!moved) return false;
      e.preventDefault();
      const after = target?.id === id ? target.after : false;
      end();
      if (moved === id) return true;
      const rest = ids.filter((x) => x !== moved);
      const at = rest.indexOf(id);
      if (at < 0) return true;
      rest.splice(after ? at + 1 : at, 0, moved);
      if (rest.join() !== ids.join()) onReorder(rest);
      return true;
    },
  };
}

// The items in the given order of ids; items missing from it keep their place at the end
export function inIdOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const sorted = ids.map((id) => byId.get(id)).filter((it): it is T => Boolean(it));
  return [...sorted, ...items.filter((it) => !ids.includes(it.id))];
}
