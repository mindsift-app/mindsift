import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { DocumentEditor } from './DocumentEditor';
import { LazyMount } from '../../components/LazyMount';
import { Document } from '../../lib/types';
import { WorkspaceSubView } from './workspaceTypes';
import { useTranslation } from 'react-i18next';

type EditorProps = React.ComponentProps<typeof DocumentEditor>;

// One note on the hashtag page: its bullets with the tag are shown in a live editor
export type TagPageGroup = { docId: string; title: string; icon?: string };

interface TagDetailViewProps {
  selectedTag: string;
  setSubView: (view: WorkspaceSubView) => void;
  tagNoteDraft: string;
  setTagNoteDraft: (text: string) => void;
  handleSaveTagNote: () => void;
  tagPageGroups: TagPageGroup[];
  currentUser: EditorProps['currentUser'];
  docs: Document[];
  allFolderPaths: string[];
  handleDocMetadataChange: EditorProps['onDocMetadataChange'];
  handleDeleteDocument: EditorProps['onDeleteDoc'];
  openDocShareModal: EditorProps['onOpenShareModal'];
  handleSelectTag: EditorProps['onSelectTag'];
  handleWikiLinkClick: EditorProps['onWikiLinkClick'];
  handleJumpToDocBlock: EditorProps['onOpenDocBlock'];
  onOpenTask: EditorProps['onOpenTask'];
}

// Page of one hashtag: a note about the tag, then every note with matching bullets, edited right there
// (DocumentEditor variant "tag", loaded when scrolled near)
export function TagDetailView({
  selectedTag,
  setSubView,
  tagNoteDraft,
  setTagNoteDraft,
  handleSaveTagNote,
  tagPageGroups,
  currentUser,
  docs,
  allFolderPaths,
  handleDocMetadataChange,
  handleDeleteDocument,
  openDocShareModal,
  handleSelectTag,
  handleWikiLinkClick,
  handleJumpToDocBlock,
  onOpenTask,
}: TagDetailViewProps) {
  const { t } = useTranslation('workspace');
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-editor">
      <div className="w-full space-y-4">
        {/* Back to all tags */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <button
            type="button"
            onClick={() => setSubView('tags')}
            className="btn-action inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-main cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('tags.allTiles')}</span>
          </button>
        </div>

        {/* Tag Context Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-btn bg-accent/10 border border-accent/20 text-accent font-bold flex items-center justify-center shrink-0 text-sm">
              #
            </span>
            <h1 className="text-xl font-bold text-main">
              #{selectedTag}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setSubView('tags')}
            className="text-xs text-accent hover:underline flex items-center gap-1 cursor-pointer"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>{t('tags.overview')}</span>
          </button>
        </div>

        {/* Tag Context Note */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-faint">
            {t('workspace:tags.note')}
          </label>
          <textarea
            rows={3}
            value={tagNoteDraft}
            onChange={(e) => setTagNoteDraft(e.target.value)}
            onBlur={handleSaveTagNote}
            placeholder={t('tags.notesFor', { tag: selectedTag })}
            className="input-field w-full p-2.5 text-xs text-main"
          />
        </div>

        {/* Matched bullets: each note as a fixed heading with the live outliner of its branches below,
            edited right in the note (DocumentEditor variant "tag"); editors load when scrolled near */}
        {tagPageGroups.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted">{t('tags.noBlocks', { tag: selectedTag })}</p>
        ) : (
          <div className="space-y-2 -mx-2 sm:-mx-8">
            {tagPageGroups.map((docGroup) => (
              <LazyMount
                key={docGroup.docId}
                placeholder={
                  <div className="px-2 sm:px-8 py-2 min-h-[6rem] text-lg font-semibold text-muted">
                    {docGroup.icon && <span className="mr-2">{docGroup.icon}</span>}
                    {docGroup.title}
                  </div>
                }
              >
                <DocumentEditor
                  key={`${docGroup.docId}:${selectedTag}`}
                  variant="tag"
                  tagFilter={selectedTag}
                  docId={docGroup.docId}
                  currentUser={currentUser}
                  initialDoc={docs.find((d) => d.id === docGroup.docId) || null}
                  availableFolders={allFolderPaths}
                  onDocMetadataChange={handleDocMetadataChange}
                  onDeleteDoc={handleDeleteDocument}
                  onOpenShareModal={openDocShareModal}
                  onSelectTag={handleSelectTag}
                  onWikiLinkClick={handleWikiLinkClick}
                  onOpenDocBlock={handleJumpToDocBlock}
                  onOpenTask={onOpenTask}
                />
              </LazyMount>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
