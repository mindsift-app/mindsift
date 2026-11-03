import { Check, FileText, FilePlus, FolderPlus, Hash, Trash2 } from 'lucide-react';
import { MobileMenuGroup } from '../../context/MobileActionContext';
import { WorkspaceSubView } from './workspaceTypes';

interface WorkspaceMenuInput {
  subView: WorkspaceSubView;
  setSubView: (view: WorkspaceSubView) => void;
  setMobileShowDetail: (show: boolean) => void;
  totalOpenTodos: number;
  tagCount: number;
  trashCount: number;
  openNewNote: (folderPath?: string) => void;
  setShowNewFolderModal: (show: boolean) => void;
  openTrash: () => void;
}

// The phone menu of WorkspaceView (header menu): on phones it also switches between notes, to-dos and
// hashtags (like the lists in Tasks and Shopping lists), the tab row is hidden there; then new note,
// new folder and the trash
export function buildWorkspaceMenu({
  subView,
  setSubView,
  setMobileShowDetail,
  totalOpenTodos,
  tagCount,
  trashCount,
  openNewNote,
  setShowNewFolderModal,
  openTrash,
}: WorkspaceMenuInput): MobileMenuGroup[] {
  return [
        {
          id: 'workspace-views',
          title: 'Ansicht',
          items: [
            {
              id: 'view-notes',
              label: 'Notizen',
              icon: <FileText className="w-4 h-4" />,
              active: subView === 'editor' || subView === 'journal' || subView === 'trash',
              onClick: () => {
                setSubView('editor');
                setMobileShowDetail(false);
              },
            },
            {
              id: 'view-todos',
              label: 'To-Dos',
              icon: <Check className="w-4 h-4" />,
              badge: totalOpenTodos || undefined,
              active: subView === 'todos',
              onClick: () => {
                setSubView('todos');
                setMobileShowDetail(true);
              },
            },
            {
              id: 'view-tags',
              label: 'Hashtags',
              icon: <Hash className="w-4 h-4" />,
              badge: tagCount || undefined,
              active: subView === 'tags' || subView === 'tag_detail',
              onClick: () => {
                setSubView('tags');
                setMobileShowDetail(true);
              },
            },
          ],
        },
        {
          id: 'workspace-actions',
          title: 'Notizen & Ordner',
          items: [
            {
              id: 'new-note',
              label: 'Neue Notiz',
              icon: <FilePlus className="w-4 h-4" />,
              variant: 'accent',
              onClick: () => openNewNote(''),
            },
            {
              id: 'new-folder',
              label: 'Neuer Ordner',
              icon: <FolderPlus className="w-4 h-4" />,
              onClick: () => setShowNewFolderModal(true),
            },
            {
              id: 'trash',
              label: 'Papierkorb',
              icon: <Trash2 className="w-4 h-4" />,
              badge: trashCount,
              onClick: openTrash,
            },
          ],
        },
      ];
}
