import React, { useCallback, useState } from 'react';
import { isPhoneWidth } from '../../lib/breakpoints';
import type { NewNoteSheet } from './FolderDialogs';

// Groups of WorkspaceView's state: the two small forms (FolderDialogs, a new or renamed folder and a new
// note) and the view of the to-do rollup

/** The folder form: a new folder in parentPath, or the folder at renamePath renamed */
export function useFolderForm() {
  const [showNewFolderModal, setShowNewFolderModal] = useState<boolean>(false);
  const [newFolderCoords, setNewFolderCoords] = useState<{ x: number; y: number } | null>(null);
  const [newFolderParentPath, setNewFolderParentPath] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState<string>('');
  // The same form renames a folder: its path while it does (null for a new folder)
  const [renameFolderPath, setRenameFolderPath] = useState<string | null>(null);

  const handleOpenRenameFolder = (path: string, at: { x: number; y: number }) => {
    setRenameFolderPath(path);
    setNewFolderParentPath('');
    setNewFolderName(path.split('/').pop() || path);
    // FormSheet keeps the form inside the window
    setNewFolderCoords(at);
    setShowNewFolderModal(true);
  };

  const handleOpenNewFolder = (parentPath = '', e?: React.MouseEvent) => {
    setRenameFolderPath(null);
    setNewFolderParentPath(parentPath);
    setNewFolderName('');
    if (e) {
      setNewFolderCoords({ x: e.clientX, y: e.clientY });
    } else {
      setNewFolderCoords({ x: 100, y: 150 });
    }
    setShowNewFolderModal(true);
  };

  return {
    showNewFolderModal,
    setShowNewFolderModal,
    newFolderCoords,
    newFolderParentPath,
    setNewFolderParentPath,
    newFolderName,
    setNewFolderName,
    renameFolderPath,
    setRenameFolderPath,
    handleOpenRenameFolder,
    handleOpenNewFolder,
  };
}

// Room the new-note form needs below its point (title, template, buttons), so it does not run off the bottom
const NEW_NOTE_SHEET_HEIGHT = 260;

/** The point below an element (its middle) where an anchored form opens, kept clear of the window's bottom */
function anchorBelow(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: Math.max(8, Math.min(r.bottom, window.innerHeight - NEW_NOTE_SHEET_HEIGHT)) };
}

/**
 * The new-note form. Phones: "+" asks for name and emoji first, so a stray tap does not leave an empty note
 * behind. With templates the desktop asks too (name, emoji, template); without, it creates at once
 * (createNow).
 */
export function useNewNoteForm(createNow: (folderPath: string) => unknown, hasTemplates: boolean) {
  const [newNoteSheet, setNewNoteSheet] = useState<NewNoteSheet | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteIcon, setNewNoteIcon] = useState('🗒️');
  // '' = an empty note; otherwise the id of the template the note starts from
  const [newNoteTemplate, setNewNoteTemplate] = useState('');
  const openNewNote = useCallback(
    (folderPath = '', e?: React.MouseEvent) => {
      if (!isPhoneWidth() && !hasTemplates) {
        void createNow(folderPath);
        return;
      }
      setNewNoteTitle('');
      setNewNoteIcon('🗒️');
      setNewNoteTemplate('');
      // On the desktop the form opens at the button that was clicked (centred without one, e.g. a shortcut)
      setNewNoteSheet({ folderPath, anchor: e ? anchorBelow(e.currentTarget as HTMLElement) : null });
    },
    [createNow, hasTemplates]
  );

  return {
    newNoteSheet,
    setNewNoteSheet,
    newNoteTitle,
    setNewNoteTitle,
    newNoteIcon,
    setNewNoteIcon,
    newNoteTemplate,
    setNewNoteTemplate,
    openNewNote,
  };
}

export type TodoGrouping = 'grouped' | 'list';
export type TodoShow = 'open' | 'all';

/** How the to-do rollup shows its to-dos (grouping and open/all are remembered), and what is folded or opened */
export function useTodoRollupView() {
  const [todoFolderDrilldown, setTodoFolderDrilldown] = useState<string | null>(null);
  const [todoGrouping, setTodoGroupingState] = useState<TodoGrouping>(() => {
    const saved = localStorage.getItem('mindsift_todo_grouping');
    return saved === 'list' ? 'list' : 'grouped';
  });
  const [todoShow, setTodoShowState] = useState<TodoShow>(() =>
    localStorage.getItem('mindsift_todo_show') === 'all' ? 'all' : 'open'
  );
  const setTodoShow = useCallback((s: TodoShow) => {
    setTodoShowState(s);
    localStorage.setItem('mindsift_todo_show', s);
  }, []);
  const setTodoGrouping = useCallback((g: TodoGrouping) => {
    setTodoGroupingState(g);
    localStorage.setItem('mindsift_todo_grouping', g);
  }, []);
  const [collapsedTodoFolders, setCollapsedTodoFolders] = useState<Set<string>>(new Set());
  const [collapsedTodoNotes, setCollapsedTodoNotes] = useState<Set<string>>(new Set());

  return {
    todoFolderDrilldown,
    setTodoFolderDrilldown,
    todoGrouping,
    setTodoGrouping,
    todoShow,
    setTodoShow,
    collapsedTodoFolders,
    setCollapsedTodoFolders,
    collapsedTodoNotes,
    setCollapsedTodoNotes,
  };
}
