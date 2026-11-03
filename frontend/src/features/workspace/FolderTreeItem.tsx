import React from 'react';
import { Folder, FolderOpen, FolderPlus, Plus, Trash2, Users } from 'lucide-react';
import { SharedFolder } from '../../lib/types';
import { FolderTreeNode, WorkspaceSubView } from './workspaceTypes';
import { useTranslation } from 'react-i18next';

interface FolderTreeItemProps {
  node: FolderTreeNode;
  depth: number;
  expandedFolders: Record<string, boolean>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedDocId: string | null;
  subView: WorkspaceSubView;
  dragOverFolder: string | null;
  setDragOverFolder: (f: string | null) => void;
  handleDropOnFolder: (folderPath: string, e: React.DragEvent) => void;
  handleFolderDragStart: (e: React.DragEvent, path: string) => void;
  handleDocDragStart: (e: React.DragEvent, id: string) => void;
  handleCreateDocument: (folderPath?: string) => void;
  handleOpenNewFolder: (parentPath?: string, e?: React.MouseEvent) => void;
  handleShareFolderClick: (folderPath: string, existingSf?: SharedFolder) => void;
  // Asks first (popover at the given point), then moves the folder to the trash
  handleDeleteFolder: (folderPath: string, at: { x: number; y: number }) => void;
  onSelectDoc: (id: string) => void;
  // Dropping a note onto another one offers to merge them
  docDropProps: (targetId: string) => React.HTMLAttributes<HTMLDivElement>;
  mergeHoverId: string | null;
  // Several notes marked with Ctrl/Cmd or Shift; a plain click opens the note
  markedDocIds: Set<string>;
  onDocRowClick: (e: React.MouseEvent, id: string, open: () => void) => void;
}

// One folder of the notes sidebar with its subfolders and notes (recursive)
export const FolderTreeItem: React.FC<FolderTreeItemProps> = ({
  node,
  depth,
  expandedFolders,
  setExpandedFolders,
  selectedDocId,
  subView,
  dragOverFolder,
  setDragOverFolder,
  handleDropOnFolder,
  handleFolderDragStart,
  handleDocDragStart,
  handleCreateDocument,
  handleOpenNewFolder,
  handleShareFolderClick,
  handleDeleteFolder,
  onSelectDoc,
  docDropProps,
  mergeHoverId,
  markedDocIds,
  onDocRowClick,
}) => {
  const { t } = useTranslation('workspace');
  const hasContent = node.subfolders.length > 0 || node.docs.length > 0;
  const isExpanded = Boolean(hasContent && expandedFolders[node.fullPath]);
  const isDragOver = dragOverFolder === node.fullPath;

  return (
    <div className="space-y-0.5">
      <div
        draggable
        onDragStart={(e) => handleFolderDragStart(e, node.fullPath)}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOverFolder(node.fullPath);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (dragOverFolder === node.fullPath) setDragOverFolder(null);
        }}
        onDrop={(e) => handleDropOnFolder(node.fullPath, e)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`group flex items-center justify-between pr-1.5 h-11 sm:h-7 rounded-btn text-sm sm:text-xs cursor-pointer border-l-2 transition-colors ${
          isDragOver
            ? 'bg-accent/20 border-accent text-main font-semibold'
            : 'border-transparent hover:bg-panel-elevated text-muted'
        }`}
      >
        <button
          type="button"
          onClick={() =>
            hasContent &&
            setExpandedFolders((prev) => ({
              ...prev,
              [node.fullPath]: !prev[node.fullPath],
            }))
          }
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left h-full cursor-pointer"
        >
          {/* No arrow: the open/closed folder icon shows the state, and empty folders line up the same */}
          {isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-accent shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
          {node.sharedFolderObj && (
            <Users className="w-3 h-3 text-status-ok shrink-0" />
          )}
        </button>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateDocument(node.fullPath);
            }}
            className="p-1 h-6 w-6 flex items-center justify-center text-muted hover:text-main transition-colors cursor-pointer"
            title={t('folder.newNoteHere')}
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenNewFolder(node.fullPath, e);
            }}
            className="p-1 h-6 w-6 flex items-center justify-center text-muted hover:text-main transition-colors cursor-pointer"
            title={t('folder.newSubfolder')}
          >
            <FolderPlus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleShareFolderClick(node.fullPath, node.sharedFolderObj);
            }}
            className={`p-1 h-6 w-6 flex items-center justify-center transition-colors cursor-pointer ${
              node.sharedFolderObj ? 'text-accent' : 'text-faint hover:text-accent'
            }`}
            title={t('folder.share')}
          >
            <Users className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Keyboard clicks have no pointer position: open at the button instead
              const r = e.currentTarget.getBoundingClientRect();
              const byPointer = e.clientX !== 0 || e.clientY !== 0;
              handleDeleteFolder(node.fullPath, byPointer ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.bottom });
            }}
            className="p-1 h-6 w-6 flex items-center justify-center text-faint hover:text-status-err transition-colors cursor-pointer"
            title={t('folder.delete')}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-0.5">
          {/* Subfolders in this folder */}
          {node.subfolders.map((childNode) => (
            <FolderTreeItem
              key={childNode.fullPath}
              node={childNode}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              setExpandedFolders={setExpandedFolders}
              selectedDocId={selectedDocId}
              subView={subView}
              dragOverFolder={dragOverFolder}
              setDragOverFolder={setDragOverFolder}
              handleDropOnFolder={handleDropOnFolder}
              handleFolderDragStart={handleFolderDragStart}
              handleDocDragStart={handleDocDragStart}
              handleCreateDocument={handleCreateDocument}
              handleOpenNewFolder={handleOpenNewFolder}
              handleShareFolderClick={handleShareFolderClick}
              handleDeleteFolder={handleDeleteFolder}
              onSelectDoc={onSelectDoc}
              docDropProps={docDropProps}
              mergeHoverId={mergeHoverId}
              markedDocIds={markedDocIds}
              onDocRowClick={onDocRowClick}
            />
          ))}

          {/* Notes directly in this folder */}
          {node.docs.map((d) => (
            <div
              key={d.id}
              draggable
              data-doc-row={d.id}
              onDragStart={(e) => handleDocDragStart(e, d.id)}
{...docDropProps(d.id)}
              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
              onClick={(e) => onDocRowClick(e, d.id, () => onSelectDoc(d.id))}
              style={{ paddingLeft: `${(depth + 1) * 12 + 9}px` }}
              className={`w-full flex items-center gap-2 pr-2 py-1.5 min-h-11 sm:min-h-0 rounded-btn text-left text-sm sm:text-xs cursor-pointer border transition-colors ${
                mergeHoverId === d.id
                  ? 'border-accent bg-accent/15 ring-2 ring-accent/30 text-main'
                  : markedDocIds.has(d.id)
                  ? 'border-accent/40 bg-accent/10 text-main'
                  : selectedDocId === d.id && subView === 'editor'
                  ? 'bg-panel-elevated text-main font-semibold border-transparent'
                  : 'border-transparent text-main hover:bg-panel-elevated'
              }`}
            >
              {d.icon && <span className="shrink-0">{d.icon}</span>}
              <span className="truncate flex-1">{d.title || t('editor.untitled')}</span>
            </div>
          ))}

          {!hasContent && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 12 + 9}px` }}
              className="py-1 text-[10px] text-faint italic"
            >
              {t('workspace:folder.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
