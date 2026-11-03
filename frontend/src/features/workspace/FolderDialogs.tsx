import React from 'react';
import { FilePlus, FolderPlus } from 'lucide-react';
import { Document } from '../../lib/types';
import { FormSheet } from '../../components/FormSheet';
import { ConfirmPopover } from '../../components/ConfirmPopover';
import { EmojiIconButton } from '../../components/EmojiIconButton';

interface FolderDialogsProps {
  showNewFolderModal: boolean;
  setShowNewFolderModal: (show: boolean) => void;
  newFolderParentPath: string;
  newFolderCoords: { x: number; y: number } | null;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  handleCreateFolderSubmit: (e: React.FormEvent) => void;
  newNoteSheet: { folderPath: string } | null;
  setNewNoteSheet: (sheet: { folderPath: string } | null) => void;
  newNoteTitle: string;
  setNewNoteTitle: (title: string) => void;
  newNoteIcon: string;
  setNewNoteIcon: (icon: string) => void;
  handleCreateDocument: (folderPath?: string, title?: string, icon?: string) => Promise<unknown>;
  pendingFolderDelete: { path: string; x: number; y: number } | null;
  closeFolderDelete: () => void;
  handleDeleteFolder: (path: string) => Promise<void>;
  docs: Document[];
}

// Dialogs of the folder sidebar: name of a new folder, name and emoji of a new note (phones) and the
// confirmation before a folder goes to the trash
export function FolderDialogs({
  showNewFolderModal,
  setShowNewFolderModal,
  newFolderParentPath,
  newFolderCoords,
  newFolderName,
  setNewFolderName,
  handleCreateFolderSubmit,
  newNoteSheet,
  setNewNoteSheet,
  newNoteTitle,
  setNewNoteTitle,
  newNoteIcon,
  setNewNoteIcon,
  handleCreateDocument,
  pendingFolderDelete,
  closeFolderDelete,
  handleDeleteFolder,
  docs,
}: FolderDialogsProps) {
  return (
    <>
      {/* New Folder Popover (small & positioned near click, asks only for name & OK) */}
      {showNewFolderModal && (
        <FormSheet
          title={newFolderParentPath ? `Unterordner in "${newFolderParentPath}"` : 'Neuer Ordner'}
          icon={<FolderPlus className="w-4 h-4 text-accent" />}
          onClose={() => setShowNewFolderModal(false)}
          onSubmit={handleCreateFolderSubmit}
          anchor={newFolderCoords}
        >
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Ordnername"
            className="input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
          />
        </FormSheet>
      )}

      {/* Phones: name and emoji of a new note before it is created */}
      {newNoteSheet && (
        <FormSheet
          title="Neue Notiz"
          icon={<FilePlus className="w-4 h-4 text-accent" />}
          onClose={() => setNewNoteSheet(null)}
          onSubmit={(e) => {
            e.preventDefault();
            const { folderPath } = newNoteSheet;
            setNewNoteSheet(null);
            void handleCreateDocument(folderPath, newNoteTitle, newNoteIcon);
          }}
        >
          <div className="flex items-center gap-1.5">
            <EmojiIconButton value={newNoteIcon} onChange={setNewNoteIcon} />
            <input
              type="text"
              autoFocus
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              placeholder="Name der Notiz"
              className="input-field flex-1 min-w-0 h-11 sm:h-8 px-2.5 text-base sm:text-xs"
            />
          </div>
        </FormSheet>
      )}

      {pendingFolderDelete &&
        (() => {
          const { path } = pendingFolderDelete;
          const name = path.split('/').pop() || path;
          const notes = docs.filter((d) => d.folderPath === path || (d.folderPath || '').startsWith(`${path}/`)).length;
          return (
            <ConfirmPopover
              x={pendingFolderDelete.x}
              y={pendingFolderDelete.y}
              danger
              confirmLabel="In den Papierkorb"
              message={
                <>
                  Ordner <strong>„{name}“</strong>
                  {notes > 0 ? ` mit ${notes === 1 ? '1 Notiz' : `${notes} Notizen`}` : ''} wirklich löschen?
                </>
              }
              onCancel={closeFolderDelete}
              onConfirm={() => {
                closeFolderDelete();
                void handleDeleteFolder(path);
              }}
            />
          );
        })()}
    </>
  );
}
