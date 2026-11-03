import React, { useState } from 'react';
import { ListItem, SharedList } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';

interface UseItemEditingOptions {
  activeList: SharedList | null;
  setLists: React.Dispatch<React.SetStateAction<SharedList[]>>;
  onRefreshGlobal: () => void;
}

// Changing entries of the open list: the quantity being edited, ticking, deleting, clearing done entries
// (the list is updated right away, the server afterwards)
export function useItemEditing({ activeList, setLists, onRefreshGlobal }: UseItemEditingOptions) {
  const [editingQtyItemId, setEditingQtyItemId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState('');

  const handleSaveQuantity = async (itemId: string, quantity: string) => {
    setEditingQtyItemId(null);
    if (!activeList) return;
    const trimmed = quantity.trim();
    try {
      const updated = await api.updateListItem(activeList.id, itemId, { quantity: trimmed });
      setLists((prev) =>
        prev.map((l) => {
          if (l.id !== activeList.id) return l;
          return {
            ...l,
            items: l.items.map((i) => (i.id === itemId ? { ...i, quantity: updated.quantity } : i)),
          };
        })
      );
    } catch (err: any) {
      console.error('Fehler beim Aktualisieren der Menge', err);
    }
  };

  const handleToggleItem = async (item: ListItem) => {
    if (!activeList) return;
    triggerHaptic(10);
    const nextCompleted = !item.isCompleted;

    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== activeList.id) return l;
        return {
          ...l,
          items: l.items.map((i) => (i.id === item.id ? { ...i, isCompleted: nextCompleted } : i)),
        };
      })
    );

    await api.toggleListItem(activeList.id, item.id, nextCompleted);
    onRefreshGlobal();
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!activeList) return;
    triggerHaptic(15);
    setLists((prev) =>
      prev.map((l) =>
        l.id === activeList.id ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l
      )
    );
    await api.deleteListItem(activeList.id, itemId);
    onRefreshGlobal();
  };

  const handleClearCompleted = async () => {
    if (!activeList) return;
    triggerHaptic(20);
    await api.clearCompletedItems(activeList.id);
    setLists((prev) =>
      prev.map((l) =>
        l.id === activeList.id ? { ...l, items: l.items.filter((i) => !i.isCompleted) } : l
      )
    );
  };

  return {
    editingQtyItemId,
    setEditingQtyItemId,
    editingQtyValue,
    setEditingQtyValue,
    handleSaveQuantity,
    handleToggleItem,
    handleDeleteItem,
    handleClearCompleted,
  };
}
