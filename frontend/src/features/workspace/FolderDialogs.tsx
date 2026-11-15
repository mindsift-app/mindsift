import React from 'react';
import { FilePlus, FolderPlus } from 'lucide-react';
import { Document } from '../../lib/types';
import { FormSheet } from '../../components/FormSheet';
import { ConfirmPopover } from '../../components/ConfirmPopover';
import { EmojiIconButton } from '../../components/EmojiIconButton';
import { Trans, useTranslation } from 'react-i18next';
import { NOTE_TITLE_MAX } from '../../lib/noteTitle';
import { SelectMenu } from '../../components/SelectMenu';
import type { TemplateChoice } from './NoteTemplates';

/** The form for a new note: its folder, and on the desktop the point it opens at (centred without) */
export interface NewNoteSheet {
  folderPath: string;
  anchor?: { x: number; y: number } | null;
}

interface FolderDialogsProps {
  showNewFolderModal: boolean;
  setShowNewFolderModal: (show: boolean) => void;
  newFolderParentPath: string;
  newFolderCoords: { x: number; y: number } | null;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  handleCreateFolderSubmit: (e: React.FormEvent) => void;
  newNoteSheet: NewNoteSheet | null;
  setNewNoteSheet: (sheet: NewNoteSheet | null) => void;
  newNoteTitle: string;
  setNewNoteTitle: (title: string) => void;
  newNoteIcon: string;
  setNewNoteIcon: (icon: string) => void;
  /** The person's templates; the template field shows only when there are some */
  templates: TemplateChoice[];
  newNoteTemplate: string;
  setNewNoteTemplate: (id: string) => void;
  handleCreateDocument: (folderPath?: string, title?: string, icon?: string, templateId?: string) => Promise<unknown>;
  pendingFolderDelete: { path: string; x: number; y: number } | null;
  /** A note's delete button was clicked: asks before the note goes to the trash */
  pendingDocDelete?: { id: string; x: number; y: number } | null;
  closeDocDelete?: () => void;
  handleDeleteDocument?: (docId: string) => Promise<void>;
  closeFolderDelete: () => void;
  handleDeleteFolder: (path: string) => Promise<void>;
  docs: Document[];
}

// Dialogs of the folder sidebar: name of a new folder, name, emoji and template of a new note (phones, and
// the desktop when the person has templates) and the confirmation before a folder goes to the trash
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
  templates,
  newNoteTemplate,
  setNewNoteTemplate,
  handleCreateDocument,
  pendingFolderDelete,
  closeFolderDelete,
  pendingDocDelete,
  closeDocDelete,
  handleDeleteDocument,
  handleDeleteFolder,
  docs,
}: FolderDialogsProps) {
  const { t } = useTranslation('workspace');
  return (
    <>
      {/* New Folder Popover (small & positioned near click, asks only for name & OK) */}
      {showNewFolderModal && (
        <FormSheet
          title={newFolderParentPath ? t('folder.subfolderIn', { path: newFolderParentPath }) : t('view.newFolder')}
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
            placeholder={t('folder.namePlaceholder')}
            className="input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
          />
        </FormSheet>
      )}

      {/* Phones (and the desktop with templates): name, emoji and template of a new note before it is created */}
      {newNoteSheet && (
        <FormSheet
          title={t('menu.newNote')}
          icon={<FilePlus className="w-4 h-4 text-accent" />}
          onClose={() => setNewNoteSheet(null)}
          onSubmit={(e) => {
            e.preventDefault();
            const { folderPath } = newNoteSheet;
            setNewNoteSheet(null);
            void handleCreateDocument(folderPath, newNoteTitle, newNoteIcon, newNoteTemplate);
          }}
          anchor={newNoteSheet.anchor}
        >
          <div className="flex items-center gap-1.5">
            <EmojiIconButton value={newNoteIcon} onChange={setNewNoteIcon} />
            <input
              type="text"
              autoFocus
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              maxLength={NOTE_TITLE_MAX}
              placeholder={t('folder.noteNamePlaceholder')}
              className="input-field flex-1 min-w-0 h-11 sm:h-8 px-2.5 text-base sm:text-xs"
            />
          </div>
          {templates.length > 0 && (
            <SelectMenu
              ariaLabel={t('template.field')}
              value={newNoteTemplate}
              onChange={setNewNoteTemplate}
              options={[
                { value: '', label: t('template.blank') },
                ...templates.map((tpl) => ({
                  value: tpl.id,
                  label: tpl.title || t('editor.untitled'),
                  lead: <span>{tpl.icon || '🗒️'}</span>,
                  hint: tpl.folderPath || undefined,
                })),
              ]}
            />
          )}
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
              confirmLabel={t('folder.toTrash')}
              message={
                <Trans
                  t={t}
                  i18nKey={notes > 0 ? 'folder.confirmDeleteWithNotes' : 'folder.confirmDelete'}
                  values={{ name, count: notes }}
                  components={{ b: <strong /> }}
                />
              }
              onCancel={closeFolderDelete}
              onConfirm={() => {
                closeFolderDelete();
                void handleDeleteFolder(path);
              }}
            />
          );
        })()}

      {pendingDocDelete && closeDocDelete && handleDeleteDocument && (
        <ConfirmPopover
          x={pendingDocDelete.x}
          y={pendingDocDelete.y}
          danger
          confirmLabel={t('folder.toTrash')}
          message={t('folder.confirmDeleteNote')}
          onCancel={closeDocDelete}
          onConfirm={() => {
            const { id } = pendingDocDelete;
            closeDocDelete();
            void handleDeleteDocument(id);
          }}
        />
      )}
    </>
  );
}
