import React from 'react';
import { Pin, Users } from 'lucide-react';
import { Document, SharedFolder } from '../../lib/types';
import { FolderTreeItem } from './FolderTreeItem';
import { useDocDragDrop } from './useDocDragDrop';
import { FolderTreeNode, WorkspaceSubView } from './workspaceTypes';

interface FolderTreeProps {
  pinnedDocs: Document[];
  rootDocs: Document[];
  folderTree: FolderTreeNode[];
  expandedFolders: Record<string, boolean>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedDocId: string | null;
  subView: WorkspaceSubView;
  drag: ReturnType<typeof useDocDragDrop>;
  handleCreateDocument: (folderPath?: string) => void;
  handleOpenNewFolder: (parentPath?: string, e?: React.MouseEvent) => void;
  handleShareFolderClick: (folderPath: string, existingSf?: SharedFolder) => void;
  requestDeleteFolder: (folderPath: string, at: { x: number; y: number }) => void;
  // A row clicked (pinned or top-level note) and a note picked in a folder (also resets the jump target)
  onOpenDoc: (id: string) => void;
  onSelectDoc: (id: string) => void;
}

// The sidebar's notes: pinned ones, the folder tree, notes on the top level and, while dragging, the drop
// target that moves to the top level
export function FolderTree({
  pinnedDocs,
  rootDocs,
  folderTree,
  expandedFolders,
  setExpandedFolders,
  selectedDocId,
  subView,
  drag,
  handleCreateDocument,
  handleOpenNewFolder,
  handleShareFolderClick,
  requestDeleteFolder,
  onOpenDoc,
  onSelectDoc,
}: FolderTreeProps) {
  const { draggingDocId, draggingFolderPath, dragOverFolder, setDragOverFolder, handleDropOnFolder, handleFolderDragStart, handleDocDragStart, docDropProps, mergeHoverId, markedDocIds, handleDocRowClick } = drag;
  return (
    <>
      {pinnedDocs.length === 0 && folderTree.length === 0 && rootDocs.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted">Noch keine Notizen</div>
      ) : (
        <div>
          {/* Pinned Notes */}
          {pinnedDocs.length > 0 && (
            <div
              className={`space-y-0.5 ${
                folderTree.length > 0 || rootDocs.length > 0
                  ? 'border-b border-border pb-1.5 mb-1.5'
                  : ''
              }`}
            >
              {pinnedDocs.map((d) => (
                <div
                  key={`pin-${d.id}`}
                  draggable
                  data-doc-row={d.id}
                  onDragStart={(e) => handleDocDragStart(e, d.id)}
                  {...docDropProps(d.id)}
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onClick={(e) =>
                    handleDocRowClick(e, d.id, () => onOpenDoc(d.id))
                  }
                  className={`w-full flex items-center gap-2 px-2 py-1.5 min-h-11 sm:min-h-0 rounded-btn text-left text-sm sm:text-xs cursor-pointer border transition-colors ${
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
                  <span className="truncate flex-1">{d.title || 'Unbenannte Notiz'}</span>
                  {d.sharedWith && d.sharedWith.length > 0 && (
                    <Users className="w-3 h-3 text-status-ok shrink-0" />
                  )}
                  <Pin className="w-3 h-3 text-muted shrink-0" />
                </div>
              ))}
            </div>
          )}

          {/* Folders and Root Documents */}
          {(folderTree.length > 0 || rootDocs.length > 0) && (
            <div className="space-y-0.5">
              {folderTree.map((node) => (
                <FolderTreeItem
                  key={node.fullPath}
                  node={node}
                  depth={0}
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
                  handleDeleteFolder={requestDeleteFolder}
                  onSelectDoc={onSelectDoc}
                  docDropProps={docDropProps}
                  mergeHoverId={mergeHoverId}
                  markedDocIds={markedDocIds}
                  onDocRowClick={handleDocRowClick}
                />
              ))}

              {rootDocs.map((d) => (
                <div
                  key={d.id}
                  draggable
                  data-doc-row={d.id}
                  onDragStart={(e) => handleDocDragStart(e, d.id)}
                  {...docDropProps(d.id)}
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onClick={(e) =>
                    handleDocRowClick(e, d.id, () => onOpenDoc(d.id))
                  }
                  className={`w-full flex items-center gap-2 px-2 py-1.5 min-h-11 sm:min-h-0 rounded-btn text-left text-sm sm:text-xs cursor-pointer border transition-colors ${
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
                  <span className="truncate flex-1">{d.title || 'Unbenannte Notiz'}</span>
                  {d.sharedWith && d.sharedWith.length > 0 && (
                    <Users className="w-3 h-3 text-status-ok shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom drop target for moving to root */}
      {(draggingDocId || draggingFolderPath) && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverFolder('__root_bottom__');
          }}
          onDragLeave={() => setDragOverFolder(null)}
          onDrop={(e) => handleDropOnFolder('', e)}
          className={`p-3 rounded-card border-2 border-dashed transition-all flex items-center justify-center text-xs font-medium text-center ${
            dragOverFolder === '__root_bottom__'
              ? 'border-accent bg-accent/20 text-accent ring-2 ring-accent/30'
              : 'border-border/60 bg-panel-elevated/40 text-muted hover:border-accent/40'
          }`}
        >
          <span>Auf Hauptebene verschieben</span>
        </div>
      )}
    </>
  );
}
