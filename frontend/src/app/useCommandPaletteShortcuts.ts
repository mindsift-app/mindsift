import React, { useEffect } from 'react';

// Global Command Palette shortcuts: Cmd+K / Ctrl+K, and '/' when not in input
export function useCommandPaletteShortcuts(setShowCommandPalette: React.Dispatch<React.SetStateAction<boolean>>) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const isEditing =
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      if (!isEditing && e.key === '/') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setShowCommandPalette]);
}
