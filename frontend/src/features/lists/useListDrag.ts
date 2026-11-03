import React, { useState } from 'react';
import { ListItem, SharedList } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { canWriteList, deduplicateItems } from './listItems';

interface UseListDragOptions {
  activeList: SharedList | null;
  setLists: React.Dispatch<React.SetStateAction<SharedList[]>>;
  loadLists: () => Promise<void>;
  onRefreshGlobal: () => void;
}

// HTML5 drag and drop of shopping list entries: reorder within a category, move into another category
// (dropped on an entry or a category's card) or onto another list's tab (lands at the top there)
export function useListDrag({ activeList, setLists, loadLists, onRefreshGlobal }: UseListDragOptions) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemTarget, setDragOverItemTarget] = useState<{ itemId: string; position: 'before' | 'after' } | null>(null);
  const [dragOverCategoryTarget, setDragOverCategoryTarget] = useState<string | null>(null);
  // List tab a dragged entry hovers over (dropping moves it into that list)
  const [dragOverListTab, setDragOverListTab] = useState<string | null>(null);

  const handleItemDragStart = (e: React.DragEvent, item: ListItem) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/mindsift-list-item-id', item.id);
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingItemId(item.id);
  };


  // An entry dragged onto another list's tab lands at the top of that list, like a new entry
  const handleDropOnListTab = async (e: React.DragEvent, target: SharedList) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('application/mindsift-list-item-id') || draggingItemId;
    setDraggingItemId(null);
    setDragOverItemTarget(null);
    setDragOverCategoryTarget(null);
    setDragOverListTab(null);
    const source = activeList;
    const item = source?.items.find((i) => i.id === itemId);
    if (!source || !item || target.id === source.id || !canWriteList(target)) return;
    triggerHaptic(15);
    setLists((prev) =>
      prev.map((l) => {
        if (l.id === source.id) return { ...l, items: l.items.filter((i) => i.id !== item.id) };
        if (l.id === target.id) return { ...l, items: deduplicateItems([{ ...item, listId: target.id }, ...l.items]) };
        return l;
      })
    );
    try {
      await api.moveListItem(source.id, item.id, target.id);
    } catch {
      loadLists();
    }
    onRefreshGlobal?.();
  };

  const handleItemDragOver = (e: React.DragEvent, targetItemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingItemId || draggingItemId === targetItemId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';

    if (
      !dragOverItemTarget ||
      dragOverItemTarget.itemId !== targetItemId ||
      dragOverItemTarget.position !== position
    ) {
      setDragOverItemTarget({ itemId: targetItemId, position });
    }
  };

  const handleItemDragLeave = (e: React.DragEvent, targetItemId: string) => {
    e.stopPropagation();
    if (dragOverItemTarget?.itemId === targetItemId) {
      setDragOverItemTarget(null);
    }
  };

  const handleDropOnItem = async (e: React.DragEvent, targetItem: ListItem, targetCategory: string) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceId =
      e.dataTransfer.getData('application/mindsift-list-item-id') ||
      e.dataTransfer.getData('text/plain') ||
      draggingItemId;

    const position = dragOverItemTarget?.position || 'after';
    setDraggingItemId(null);
    setDragOverItemTarget(null);
    setDragOverCategoryTarget(null);

    if (!activeList || !sourceId || sourceId === targetItem.id) return;

    triggerHaptic(15);

    const sourceItem = activeList.items.find((i) => i.id === sourceId);
    if (!sourceItem) return;

    const targetCatNormalized = targetCategory.trim();
    const isCategoryChanged = (sourceItem.category || '').toLowerCase() !== targetCatNormalized.toLowerCase();

    let newCategory = sourceItem.category;
    let newContent = sourceItem.content;

    if (isCategoryChanged) {
      newCategory = targetCatNormalized;
      if (!targetCatNormalized) {
        newContent = newContent.replace(/#([\p{L}\p{N}_-]+)/gu, '').replace(/\s+/g, ' ').trim();
      } else if (newContent.includes('#')) {
        newContent = newContent.replace(/#([\p{L}\p{N}_-]+)/gu, `#${targetCatNormalized}`).trim();
      }
    }

    const remainingItems = activeList.items.filter((i) => i.id !== sourceId);
    const targetIndex = remainingItems.findIndex((i) => i.id === targetItem.id);
    if (targetIndex === -1) return;

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const updatedSourceItem: ListItem = {
      ...sourceItem,
      category: newCategory,
      content: newContent,
    };

    const newItems = [...remainingItems];
    newItems.splice(insertIndex, 0, updatedSourceItem);

    const reorderPayload: { id: string; sortOrder: number; category?: string; content?: string }[] = [];
    newItems.forEach((it, idx) => {
      it.sortOrder = idx;
      if (it.id === sourceId) {
        reorderPayload.push({
          id: it.id,
          sortOrder: idx,
          category: newCategory,
          content: newContent,
        });
      } else {
        reorderPayload.push({
          id: it.id,
          sortOrder: idx,
        });
      }
    });

    setLists((prev) =>
      prev.map((l) => (l.id === activeList.id ? { ...l, items: newItems } : l))
    );

    try {
      await api.reorderListItems(activeList.id, reorderPayload);
    } catch {
      loadLists();
    }
  };

  const handleDropOnCategoryHeader = async (e: React.DragEvent, targetCategory: string) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceId =
      e.dataTransfer.getData('application/mindsift-list-item-id') ||
      e.dataTransfer.getData('text/plain') ||
      draggingItemId;

    setDraggingItemId(null);
    setDragOverItemTarget(null);
    setDragOverCategoryTarget(null);

    if (!activeList || !sourceId) return;

    triggerHaptic(15);
    const sourceItem = activeList.items.find((i) => i.id === sourceId);
    if (!sourceItem) return;

    const targetCatNormalized = targetCategory.trim();
    const newCategory = targetCatNormalized;
    let newContent = sourceItem.content;

    if (!targetCatNormalized) {
      newContent = newContent.replace(/#([\p{L}\p{N}_-]+)/gu, '').replace(/\s+/g, ' ').trim();
    } else if (newContent.includes('#')) {
      newContent = newContent.replace(/#([\p{L}\p{N}_-]+)/gu, `#${targetCatNormalized}`).trim();
    }

    const updatedSourceItem: ListItem = {
      ...sourceItem,
      category: newCategory,
      content: newContent,
    };

    const remainingItems = activeList.items.filter((i) => i.id !== sourceId);
    const newItems = [updatedSourceItem, ...remainingItems];

    const reorderPayload = newItems.map((it, idx) => {
      it.sortOrder = idx;
      if (it.id === sourceId) {
        return {
          id: it.id,
          sortOrder: idx,
          category: newCategory,
          content: newContent,
        };
      }
      return { id: it.id, sortOrder: idx };
    });

    setLists((prev) =>
      prev.map((l) => (l.id === activeList.id ? { ...l, items: newItems } : l))
    );

    try {
      await api.reorderListItems(activeList.id, reorderPayload);
    } catch {
      loadLists();
    }
  };

  return {
    draggingItemId,
    setDraggingItemId,
    dragOverItemTarget,
    setDragOverItemTarget,
    dragOverCategoryTarget,
    setDragOverCategoryTarget,
    dragOverListTab,
    setDragOverListTab,
    handleItemDragStart,
    handleDropOnListTab,
    handleItemDragOver,
    handleItemDragLeave,
    handleDropOnItem,
    handleDropOnCategoryHeader,
  };
}
