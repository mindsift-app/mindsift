import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FilePlus,
  FolderPlus,
  Search,
  Pin,
  FileText,
  Plus,
  PanelLeftOpen,
  PinOff,
} from 'lucide-react';
import {
  Document,
  DocumentBlock,
  MergeResult,
  SharedFolder,
  TagDetails,
  TrashedDocument,
  User,
} from '../../lib/types';
import {
  api,
  triggerHaptic,
} from '../../lib/api';
import { sendDocOps } from '../../lib/docSync/oneoff';
import { useMobileActions } from '../../context/MobileActionContext';
import { DocumentEditor, DocSaveStatus, DocHeaderStatus } from './DocumentEditor';
import { TrashView } from './TrashView';
import { JournalView } from './JournalView';
import { isJournalEnabled, readWorkspaceSession, writeWorkspaceSession } from '../../lib/journal';
import { MergeDialog } from './MergeDialog';
import { isPhoneWidth } from '../../lib/breakpoints';
import { reportNav, onNavStep, restoringNavPlace } from '../../lib/navHistory';
import { RollupTodo, TodoRollupView } from './TodoRollupView';
import { HashtagOverview } from './HashtagOverview';
import { TagDetailView } from './TagDetailView';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { canTakeBranch, useDocDragDrop } from './useDocDragDrop';
import { useFocusMode } from './useFocusMode';
import { useJournal } from './useJournal';
import { useToast, WorkspaceToast } from './WorkspaceToast';
import { FocusModeChrome } from './FocusModeChrome';
import { useShareModal, WorkspaceShareModal } from './WorkspaceShareModal';
import { FolderTree } from './FolderTree';
import { SidebarJournal, SidebarTags, SidebarTrash } from './SidebarSections';
import { useWorkspaceData } from './useWorkspaceData';
import { useTrashActions } from './useTrashActions';
import { buildWorkspaceMenu } from './workspaceMenu';
import { buildFolderTree, collectFolderPaths, docsWithAllTags, filterFolderTree, folderAncestors, collectRollupTodos, countOpenTodos, filterTags, groupRollupTodosByFolder, isFolderShared, tagGroups, tagsMetadata, withTodoToggled } from './workspaceListing';
import { FolderDialogs, type NewNoteSheet } from './FolderDialogs';
import { WorkspaceSubView } from './workspaceTypes';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { showError } from '../../components/ErrorNotice';
import { askChoice } from '../../components/askConfirm';
import { WikiLinkClickHandler } from '../../lib/wikiLink';
import { findLinkedDoc, useWikiLinkStore, WikiLinkResolverContext } from '../../lib/wikiLinkResolver';
import { cachedBlock, lookupBlock } from '../../lib/blockLookup';
import { errorMessage } from '../../lib/errorMessage';
import { useLatestRef } from '../../lib/useLatestRef';
import { shortNoteTitle } from '../../lib/noteTitle';
import { templateBlocks } from '../../lib/noteTemplate';
import { guardLeave } from '../../lib/leaveGuard';
import { templateChoices } from './NoteTemplates';

interface WorkspaceViewProps {
  currentUser?: User | null;
  initialDocId?: string | null;
  // The demo opens its folders on a first visit, so one sees at once that there is more to look at
  demoMode?: boolean;
  initialBlockId?: string | null;
  // Changes with every opening from outside (search), also of the note already in initialDocId
  openDocNonce?: number;
  onStatsChange: () => void;
  onOpenTask?: (taskId: string) => void;
  // Opens the global search (command palette); the notes sidebar has no search of its own
  onOpenSearch?: () => void;
}

// Room the new-note form needs below its point (title, template, buttons), so it does not run off the bottom
const NEW_NOTE_SHEET_HEIGHT = 260;

/** The point below an element (its middle) where an anchored form opens, kept clear of the window's bottom */
function anchorBelow(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: Math.max(8, Math.min(r.bottom, window.innerHeight - NEW_NOTE_SHEET_HEIGHT)) };
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  currentUser,
  initialDocId,
  demoMode,
  initialBlockId,
  openDocNonce,
  onStatsChange,
  onOpenTask,
  onOpenSearch,
}) => {
  const { t } = useTranslation('workspace');
  // Coming back here by the browser's back/forward: the note and view of that step
  const navStep = useMemo(() => {
    const place = restoringNavPlace();
    return place && place.tab === 'workspace' ? place : null;
  }, []);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(
    navStep ? navStep.docId ?? null : initialDocId || readWorkspaceSession().docId || null
  );
  // The bullet a link or search hit pointed to, kept with its note: opening another note any other way
  // (tree, plain link, back) must not look for it there ("bullet no longer exists")
  const [target, setTarget] = useState<{ docId: string; blockId: string } | null>(
    initialDocId && initialBlockId ? { docId: initialDocId, blockId: initialBlockId } : null
  );
  const targetBlockId = target && target.docId === selectedDocId ? target.blockId : null;
  const [newlyCreatedDocId, setNewlyCreatedDocId] = useState<string | null>(null);
  // Journal open and the last regular note survive switching to other tabs (the view remounts)
  const [subView, setSubView] = useState<WorkspaceSubView>(() =>
    navStep?.view
      ? (navStep.view as WorkspaceSubView)
      : !initialDocId && isJournalEnabled() && readWorkspaceSession().journal
      ? 'journal'
      : 'editor'
  );
  const [trash, setTrash] = useState<TrashedDocument[]>([]);
  // Bumped after a restore so the open editor reloads the note without the trash banner
  const [editorNonce, setEditorNonce] = useState(0);
  const reloadTrash = useCallback(() => {
    api.getTrash().then(setTrash).catch(() => {});
  }, []);
  useEffect(() => {
    reloadTrash();
  }, [reloadTrash]);

  // A note the app picked by itself (not a step of its own in the browser history)
  const autoSelectedDocRef = useRef(false);
  const { docs, setDocs, folders, setFolders, sharedFolders, setSharedFolders, tagsSummary, loadWorkspaceData, reloadDocList, reloadFolders, rollupTodos, setRollupTodos } =
    useWorkspaceData({ currentUser, setSelectedDocId, autoSelectedDocRef, reloadTrash, todosShown: subView === 'todos' });

  // Journal: one note per day, listed separately from the folder tree (can be switched off per device)
  const {
    journalEnabled,
    journalDays,
    journalExtra,
    journalActive,
    setJournalActive,
    journalJump,
    reloadJournal,
    reloadJournalSoon,
    journalDocIds,
    openJournalDay,
    jumpToJournalDay,
    removeJournalDay,
  } = useJournal(setDocs);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagDetails, setTagDetails] = useState<TagDetails | null>(null);
  const [tagNoteDraft, setTagNoteDraft] = useState<string>('');
  const [tagSearchQuery, setTagSearchQuery] = useState<string>('');
  const [tagSortBy, setTagSortBy] = useState<'count' | 'name'>('count');

  const hadSavedFolders = useRef(true);
  // Runs once in the first render: remembers whether folders were saved at all
  // eslint-disable-next-line react-hooks/refs
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('mindsift:workspace_expanded_folders');
      hadSavedFolders.current = saved !== null;
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('mindsift:workspace_expanded_folders', JSON.stringify(expandedFolders));
    } catch {}
  }, [expandedFolders]);

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
  const [mobileShowDetail, setMobileShowDetail] = useState<boolean>(
    navStep ? Boolean(navStep.detail) : Boolean(initialDocId) || subView === 'journal'
  );
  // Browser back/forward: the open note and view (and on phones list or note) are steps of their own
  useEffect(() => {
    const replace = autoSelectedDocRef.current;
    autoSelectedDocRef.current = false;
    reportNav({ docId: selectedDocId, view: subView, detail: isPhoneWidth() ? mobileShowDetail : undefined }, { replace });
  }, [selectedDocId, subView, mobileShowDetail]);
  useEffect(
    () =>
      onNavStep((place) => {
        if (place.tab !== 'workspace') return;
        setSelectedDocId(place.docId ?? null);
        if (place.view) setSubView(place.view as WorkspaceSubView);
        if (isPhoneWidth()) setMobileShowDetail(Boolean(place.detail));
      }),
    []
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mindsift:workspace_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mindsift:workspace_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const [docSaveStatus, setDocSaveStatus] = useState<DocSaveStatus>('saved');
  const [docSaveError, setDocSaveError] = useState<string | null>(null);
  const [docHeaderStatus, setDocHeaderStatus] = useState<DocHeaderStatus | null>(null);
  const [docActionsTarget, setDocActionsTarget] = useState<HTMLDivElement | null>(null);


  const treeRef = useRef<HTMLDivElement>(null);

  // Merging notes: dialog (picker/confirmation) and a toast with undo afterwards
  const [mergeDialog, setMergeDialog] = useState<{ sourceId: string; targetId?: string } | null>(null);
  const { toast, setToast, showToast } = useToast();

  // Rollup drilldown & View Mode
  const [todoFolderDrilldown, setTodoFolderDrilldown] = useState<string | null>(null);
  const [todoGrouping, setTodoGrouping] = useState<'grouped' | 'list'>(() => {
    const saved = localStorage.getItem('mindsift_todo_grouping');
    return saved === 'list' ? 'list' : 'grouped';
  });
  const [todoShow, setTodoShowState] = useState<'open' | 'all'>(() =>
    localStorage.getItem('mindsift_todo_show') === 'all' ? 'all' : 'open'
  );
  const setTodoShow = useCallback((s: 'open' | 'all') => {
    setTodoShowState(s);
    localStorage.setItem('mindsift_todo_show', s);
  }, []);
  const setTodoGroupingSaved = useCallback((g: 'grouped' | 'list') => {
    setTodoGrouping(g);
    localStorage.setItem('mindsift_todo_grouping', g);
  }, []);
  const [collapsedTodoFolders, setCollapsedTodoFolders] = useState<Set<string>>(new Set());
  const [collapsedTodoNotes, setCollapsedTodoNotes] = useState<Set<string>>(new Set());

  // Sharing a note or a shared folder
  const share = useShareModal();
  const { openDocShareModal, openFolderShareModal } = share;

  const isCreatingRef = useRef<boolean>(false);
  const { setGroups, setPrimaryAction } = useMobileActions();

  useEffect(() => {
    if (initialDocId) {
      // A note asked for from outside (link, search) opens once
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDocId(initialDocId);
      // A bullet hit of the search while the workspace is already open
      setTarget(initialBlockId ? { docId: initialDocId, blockId: initialBlockId } : null);
      setSubView('editor');
      setMobileShowDetail(true);
    }
  }, [initialDocId, initialBlockId, openDocNonce]);

  // The person's templates (personal marks, lib/noteTemplate.ts): /vorlage and "Neue Notiz" offer them
  const templates = useMemo(() => templateChoices(docs), [docs]);

  const handleCreateDocument = useCallback(
    async (folderPath = '', title = i18n.t('workspace:editor.newNote'), icon = '🗒️', templateId = '') => {
      if (isCreatingRef.current) return;
      isCreatingRef.current = true;
      triggerHaptic(10);
      try {
        // A wiki link to a missing note may be longer than a title may be
        const noteTitle = shortNoteTitle(title) || i18n.t('workspace:editor.newNote');
        // From a template: a copy of its bullets (the server checks pictures and hidden values like a paste)
        let blocks: DocumentBlock[] = [];
        if (templateId) {
          try {
            const template = await api.getDocument(templateId);
            blocks = templateBlocks(template.blocks, { docId: '', title: noteTitle });
          } catch (err) {
            showError(errorMessage(err, i18n.t('workspace:template.loadFailed')));
            return undefined;
          }
        }
        if (blocks.length === 0) {
          blocks = [
            {
              id: `blk_${Date.now().toString(36)}_0`,
              type: 'text',
              content: '',
              level: 0,
              position: 1000,
            },
          ];
        }
        const created = await api.createDocument({
          title: noteTitle,
          icon: icon.trim(),
          folderPath,
          blocks,
        });
        setDocs((prev) => (prev.some((d) => d.id === created.id) ? prev : [created, ...prev]));
        setNewlyCreatedDocId(created.id);
        setTarget(null);
        setSelectedDocId(created.id);
        setSubView('editor');
        setMobileShowDetail(true);
        if (folderPath) {
          setExpandedFolders((prev) => ({ ...prev, [folderPath]: true }));
        }
        onStatsChange();
        return created;
      } catch {
        return undefined;
      } finally {
        setTimeout(() => {
          isCreatingRef.current = false;
        }, 300);
      }
    },
    [onStatsChange, setDocs]
  );

  // Phones: "+" asks for name and emoji first, so a stray tap does not leave an empty note behind.
  // The desktop keeps creating at once.
  const [newNoteSheet, setNewNoteSheet] = useState<NewNoteSheet | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteIcon, setNewNoteIcon] = useState('🗒️');
  // '' = an empty note; otherwise the id of the template the note starts from
  const [newNoteTemplate, setNewNoteTemplate] = useState('');
  // With templates the desktop asks too (name, emoji, template); without, it creates at once as before
  const hasTemplates = templates.length > 0;
  const openNewNote = useCallback(
    (folderPath = '', e?: React.MouseEvent) => {
      if (!isPhoneWidth() && !hasTemplates) {
        void handleCreateDocument(folderPath);
        return;
      }
      setNewNoteTitle('');
      setNewNoteIcon('🗒️');
      setNewNoteTemplate('');
      // On the desktop the form opens at the button that was clicked (centred without one, e.g. a shortcut)
      setNewNoteSheet({ folderPath, anchor: e ? anchorBelow(e.currentTarget as HTMLElement) : null });
    },
    [handleCreateDocument, hasTemplates]
  );

  // Links between notes, the journal and the trash leave the open note: they ask first while a dictation
  // into a text field would be lost (lib/leaveGuard.ts)
  const handleJumpToDocBlock = useCallback(
    (docId: string, blockId?: string) =>
      guardLeave(() => {
        setSelectedDocId(docId);
        setTarget(blockId ? { docId, blockId } : null);
        setNewlyCreatedDocId(null);
        setSubView('editor');
        setMobileShowDetail(true);
      }),
    []
  );

  const openJournal = useCallback(
    () =>
      guardLeave(() => {
        reloadJournal();
        setSubView('journal');
        setMobileShowDetail(true);
      }),
    [reloadJournal]
  );

  // A second click closes the journal and shows the regular note again
  const toggleJournal = useCallback(() => {
    if (subView === 'journal') {
      setSubView('editor');
      setSelectedDocId((prev) => prev ?? treeDocsRef.current[0]?.id ?? null);
    } else {
      openJournal();
    }
  // treeDocsRef (a ref that never changes) is declared further down, with the tree it follows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, openJournal]);

  const openTrash = useCallback(
    () =>
      guardLeave(() => {
        reloadTrash();
        setSubView('trash');
        setMobileShowDetail(true);
      }),
    [reloadTrash]
  );

  const handleDeleteDocument = useCallback(
    async (docId: string) => {
      try {
        await api.deleteDocument(docId);
        setDocs((prev) => {
          const remaining = prev.filter((d) => d.id !== docId);
          if (selectedDocId === docId) {
            setSelectedDocId(remaining.length > 0 ? remaining[0].id : null);
          }
          return remaining;
        });
        setMobileShowDetail(false);
        onStatsChange();
        reloadTrash();
      } catch {
        // ignore
      }
    },
    [onStatsChange, selectedDocId, reloadTrash, setDocs]
  );

  const handleOpenTrashedDoc = (docId: string) => {
    setSelectedDocId(docId);
    setTarget(null);
    setNewlyCreatedDocId(null);
    setSubView('editor');
    setMobileShowDetail(true);
  };

  // Trash: restore, delete for good, empty (useTrashActions.ts)
  const { handleRestoreDocument, handleRestoreTrashItem, handlePurgeTrashItem, handleEmptyTrash } = useTrashActions({
    selectedDocId,
    setSelectedDocId,
    trash,
    reloadDocList,
    reloadFolders,
    setEditorNonce,
    reloadTrash,
    onStatsChange,
  });

  const handleDocMetadataChange = useCallback((updated: Document) => {
    setDocs((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
  }, [setDocs]);

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    if (!cleanName) return;
    if (renameFolderPath !== null) {
      await renameFolder(renameFolderPath, cleanName);
      return;
    }
    const cleanPath = newFolderParentPath ? `${newFolderParentPath}/${cleanName}` : cleanName;
    try {
      const res = await api.createFolder(cleanPath);
      setFolders((prev) => (prev.includes(res.path) ? prev : [...prev, res.path].sort()));
      setExpandedFolders((prev) => ({ ...prev, ...folderAncestors(res.path) }));
      setNewFolderName('');
      setNewFolderParentPath('');
      setShowNewFolderModal(false);
    } catch (err) {
      showError(errorMessage(err, i18n.t('workspace:folder.createFailed')));
    }
  };

  // A folder renamed: shown under its new name at once (notes, subfolders, opened folders); the moved notes
  // also come as DOC_UPDATED and the folders are fetched again on WORKSPACE_FOLDERS_UPDATED
  const renameFolder = async (path: string, name: string) => {
    try {
      const { newPath } = await api.renameFolder(path, name);
      const moved = (p: string) => (p === path ? newPath : p.startsWith(`${path}/`) ? newPath + p.slice(path.length) : p);
      setFolders((prev) => Array.from(new Set(prev.map(moved))).sort());
      setDocs((prev) =>
        prev.map((d) => (d.folderPath && moved(d.folderPath) !== d.folderPath ? { ...d, folderPath: moved(d.folderPath) } : d))
      );
      setExpandedFolders((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [moved(k), v])));
      setRenameFolderPath(null);
      setShowNewFolderModal(false);
    } catch (err) {
      showError(errorMessage(err, i18n.t('workspace:folder.renameFailed')));
    }
  };

  // Deleting a folder asks first, in a small popover where the click was
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{ path: string; x: number; y: number } | null>(null);
  const requestDeleteFolder = (path: string, at: { x: number; y: number }) => setPendingFolderDelete({ path, ...at });
  const closeFolderDelete = useCallback(() => setPendingFolderDelete(null), []);
  // Likewise a note's delete button in the tree
  const [pendingDocDelete, setPendingDocDelete] = useState<{ id: string; x: number; y: number } | null>(null);
  const requestDeleteDoc = useCallback((id: string, at: { x: number; y: number }) => setPendingDocDelete({ id, ...at }), []);
  const closeDocDelete = useCallback(() => setPendingDocDelete(null), []);

  const handleDeleteFolder = async (folderPath: string) => {
    try {
      const res = await api.deleteFolder(folderPath);
      setFolders((prev) =>
        prev.filter((f) => f !== folderPath && !f.startsWith(`${folderPath}/`))
      );
      if (res.deletedDocIds && res.deletedDocIds.length > 0) {
        setDocs((prev) => prev.filter((d) => !res.deletedDocIds.includes(d.id)));
        if (selectedDocId && res.deletedDocIds.includes(selectedDocId)) {
          setSelectedDocId(null);
        }
      }
      onStatsChange();
      reloadTrash();
    } catch {
      // ignore
    }
  };

  const drag = useDocDragDrop({
    docs,
    setDocs,
    setFolders,
    selectedDocId,
    setSelectedDocId,
    setMobileShowDetail,
    setExpandedFolders,
    setMergeDialog,
    treeRef,
    showToast,
    reloadDocList,
    reloadTrash,
    onStatsChange,
  });
  const { markedDocIds, setMarkedDocIds } = drag;

  const handleMerged = async (result: MergeResult) => {
    setMergeDialog(null);
    triggerHaptic(20);
    setDocs((prev) => prev.filter((d) => d.id !== result.sourceId));
    setSelectedDocId(result.targetId);
    setTarget(null);
    setSubView('editor');
    setMobileShowDetail(true);
    setEditorNonce((n) => n + 1);
    reloadTrash();
    showToast(i18n.t('workspace:merge.appended', { title: result.sourceTitle || i18n.t('workspace:merge.note') }), [
      {
        label: i18n.t('common:sync.undo'),
        run: async () => {
          try {
            await api.undoMerge(result);
            // The note is back in the lists by DOC_CREATED as well; fetched here so it is there before it opens
            await reloadDocList();
            setSelectedDocId(result.sourceId);
            setEditorNonce((n) => n + 1);
            reloadTrash();
            showToast(i18n.t('workspace:merge.undone'));
          } catch (err) {
            showToast(errorMessage(err, i18n.t('workspace:merge.undoFailed')));
          }
        },
      },
    ]);
  };

  const handleSelectTag = useCallback(async (tag: string) => {
    const cleanTag = tag.replace(/^#/, '').toLowerCase();
    setSelectedTag(cleanTag);
    setSubView('tag_detail');
    setMobileShowDetail(true);
    try {
      const details = await api.getTagDetails(cleanTag);
      setTagDetails(details);
      setTagNoteDraft(details.noteContent || '');
    } catch {
      setTagDetails(null);
    }
  }, []);

  const handleSaveTagNote = async () => {
    if (!selectedTag) return;
    try {
      await api.updateTagPageNote(selectedTag, tagNoteDraft);
    } catch {
      // ignore
    }
  };

  // Opens what a link points to; a note that is gone (deleted or never created) asks first
  const openWikiLink = useCallback(
    (match: Document | undefined, ...[link, actions]: Parameters<WikiLinkClickHandler>) => {
      if (match && link.blockId) {
        handleJumpToDocBlock(match.id, link.blockId);
      } else if (match) {
        handleJumpToDocBlock(match.id);
      } else if (link.title.trim()) {
        // Deleted or never created: ask instead of creating a note right away
        const title = link.title.trim();
        void askChoice({
          message: <Trans i18nKey="common:wikiLink.missing" values={{ title }} components={{ b: <strong /> }} />,
          confirmLabel: i18n.t('common:wikiLink.create'),
          altLabel: actions ? i18n.t('common:wikiLink.removeLink') : undefined,
        }).then(async (answer) => {
          if (answer === 'confirm') {
            const created = await handleCreateDocument('', title);
            if (created) actions?.retarget(created.id, created.title);
          } else if (answer === 'alt') actions?.remove();
        });
      }
    },
    [handleCreateDocument, handleJumpToDocBlock]
  );
  // Links carry the id of the note (renaming does not break them); older ones go by the bullet or title
  const docsRef = useLatestRef(docs);
  const handleWikiLinkClick = useCallback<WikiLinkClickHandler>(
    (link, actions) => {
      // An older link to one bullet (no note id) whose note is not known here: the bullet is looked up first
      // (the note list has no bullets)
      const { blockId } = link;
      if (blockId && !link.docId && cachedBlock(blockId) === undefined && !docs.some((d) => d.blocks?.some((b) => b.id === blockId))) {
        void lookupBlock(blockId).then(() => openWikiLink(findLinkedDoc(docsRef.current, link), link, actions));
        return;
      }
      openWikiLink(findLinkedDoc(docs, link), link, actions);
    },
    [docs, docsRef, openWikiLink]
  );
  const wikiLinkStore = useWikiLinkStore(docs);

  const handleShareFolderClick = useCallback(
    async (folderPath: string, existingSf?: SharedFolder) => {
      if (existingSf) {
        openFolderShareModal(existingSf);
        return;
      }
      try {
        const clean = folderPath.trim().replace(/^\/+|\/+$/g, '');
        const sf = await api.createSharedFolder({ name: clean, mountPath: clean });
        setSharedFolders((prev) => [...prev.filter((f) => f.id !== sf.id), sf]);
        openFolderShareModal(sf);
      } catch {
        // ignore
      }
    },
    [openFolderShareModal, setSharedFolders]
  );

  // Shown ticked at once (the note's bullets or its counts, and the fetched to-dos), then sent into the note
  const handleToggleRollupTodo = async ({ doc, blockId, content, checked: currentChecked }: RollupTodo) => {
    triggerHaptic(10);
    const checked = !currentChecked;
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? withTodoToggled(d, blockId, content, checked) : d)));
    setRollupTodos((prev) => prev && prev.map((item) => (item.docId === doc.id && item.blockId === blockId ? { ...item, checked } : item)));
    try {
      const [result] = await sendDocOps(doc.id, [{ kind: 'set_props', blockId, patch: { checked } }]);
      if (result?.status !== 'applied') loadWorkspaceData();
    } catch {
      loadWorkspaceData();
    }
  };

  // Own journal notes appear under "Journal", not in the folder tree
  const treeDocs = useMemo(
    () => (journalDocIds.size ? docs.filter((d) => !(d.isOwner && journalDocIds.has(d.id))) : docs),
    [docs, journalDocIds]
  );
  // Notes a bullet of the open note can be moved into, recently changed first
  const moveTargets = useMemo(
    () =>
      docs
        .filter((d) => d.id !== selectedDocId && canTakeBranch(d))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .map((d) => ({ id: d.id, title: d.title, icon: d.icon })),
    [docs, selectedDocId]
  );
  const treeDocsRef = useLatestRef(treeDocs);

  useEffect(() => {
    writeWorkspaceSession({ journal: subView === 'journal', docId: selectedDocId });
  }, [subView, selectedDocId]);

  // The journal's day marked in the calendar stands for the open note in the tab bar and focus mode
  const journalDocId = subView === 'journal' ? journalDays.find((d) => d.date === journalActive)?.docId || null : null;
  const journalDocObj = journalDocId ? docs.find((d) => d.id === journalDocId) || null : null;
  const barDocId = subView === 'journal' ? journalDocId : selectedDocId;
  const canFocus = (subView === 'editor' || (subView === 'journal' && journalEnabled)) && Boolean(barDocId);
  const {
    focusMode,
    setFocusMode,
    zenSidebar,
    setZenSidebar,
    zenActionsTarget,
    setZenActionsTarget,
    zenPinTop,
    setZenPinTop,
    zenPinSide,
    setZenPinSide,
    zenSideOpen,
  } = useFocusMode(canFocus, barDocId);


  const allFolderPaths = useMemo(() => collectFolderPaths(folders, docs, sharedFolders), [docs, folders, sharedFolders]);

  const folderTree = useMemo(() => buildFolderTree(allFolderPaths, treeDocs, sharedFolders), [allFolderPaths, treeDocs, sharedFolders]);

  // Hashtags clicked in the sidebar filter the tree: only notes carrying all of them, their folders open.
  // Not saved (a reload shows everything again); a hashtag that no note carries any more drops out.
  const [sidebarTagFilter, setSidebarTagFilter] = useState<string[]>([]);
  // Folders folded up while the filter is on (all open otherwise); a changed filter opens them again
  const [filterFolded, setFilterFolded] = useState<Record<string, boolean>>({});
  const activeTagFilter = useMemo(
    () => sidebarTagFilter.filter((tag) => tagsSummary.some((s) => s.tag === tag)),
    [sidebarTagFilter, tagsSummary]
  );
  const toggleSidebarTag = useCallback((tag: string) => {
    setSidebarTagFilter((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
    setFilterFolded({});
  }, []);
  const clearSidebarTagFilter = useCallback(() => {
    setSidebarTagFilter([]);
    setFilterFolded({});
  }, []);
  const filterDocIds = useMemo(() => docsWithAllTags(tagsSummary, activeTagFilter), [tagsSummary, activeTagFilter]);
  const filteredTree = useMemo(() => {
    if (!filterDocIds) return null;
    const paths: string[] = [];
    const tree = filterFolderTree(folderTree, filterDocIds, paths);
    return { tree, expanded: Object.fromEntries(paths.map((p) => [p, !filterFolded[p]])) };
  }, [folderTree, filterDocIds, filterFolded]);
  // Folding a folder while filtering changes only the filter's view, not the saved open folders
  const setFilterExpanded = useCallback<React.Dispatch<React.SetStateAction<Record<string, boolean>>>>(
    (action) => {
      const current = filteredTree?.expanded || {};
      const next = typeof action === 'function' ? action(current) : action;
      setFilterFolded(Object.fromEntries(Object.keys(current).map((p) => [p, !next[p]])));
    },
    [filteredTree]
  );

  // Demo, first visit in this browser: all folders open once (folding them up afterwards is kept)
  useEffect(() => {
    if (!demoMode || hadSavedFolders.current || allFolderPaths.length === 0) return;
    hadSavedFolders.current = true;
    setExpandedFolders(Object.fromEntries(allFolderPaths.map((p) => [p, true])));
  }, [demoMode, allFolderPaths]);

  // An opened note shows where it lives (link, search, backlinks …): its folders open. Only when another
  // note opens or it moves, so folding its folder up afterwards stays
  const selectedFolder = treeDocs.find((d) => d.id === selectedDocId)?.folderPath || '';
  useEffect(() => {
    if (!selectedFolder) return;
    const open = folderAncestors(selectedFolder);
    // An opened note shows its folders open
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedFolders((prev) => (Object.keys(open).every((k) => prev[k]) ? prev : { ...prev, ...open }));
  }, [selectedDocId, selectedFolder]);

  const pinnedDocs = useMemo(
    () => treeDocs.filter((d) => d.isPinned && (!filterDocIds || filterDocIds.has(d.id))),
    [treeDocs, filterDocIds]
  );

  const rootDocs = useMemo(
    () => treeDocs.filter((d) => !d.folderPath && !d.isPinned && (!filterDocIds || filterDocIds.has(d.id))),
    [treeDocs, filterDocIds]
  );

  // Global To-Dos rollup collections
  const allRollupTodos = useMemo(
    () => collectRollupTodos(docs, rollupTodos, todoFolderDrilldown, todoShow === 'open'),
    [docs, rollupTodos, todoFolderDrilldown, todoShow]
  );

  const hasDoneTodos = useMemo(
    () => todoShow === 'open' && collectRollupTodos(docs, rollupTodos, todoFolderDrilldown).some((i) => i.checked),
    [docs, rollupTodos, todoFolderDrilldown, todoShow]
  );

  const rollupTodosByFolder = useMemo(() => groupRollupTodosByFolder(allRollupTodos), [allRollupTodos]);

  const totalOpenTodos = useMemo(() => countOpenTodos(docs), [docs]);

  // Register mobile FAB actions and the menu at the top (workspaceMenu.tsx)
  useEffect(() => {
    setPrimaryAction(() => openNewNote(''));
    setGroups(
      buildWorkspaceMenu({
        subView,
        setSubView,
        setMobileShowDetail,
        totalOpenTodos,
        tagCount: tagsSummary.length,
        trashCount: trash.length,
        openNewNote,
        setShowNewFolderModal,
        openTrash,
      })
    );
    return () => {
      setGroups([]);
      setPrimaryAction(undefined);
    };
  }, [handleCreateDocument, openNewNote, setGroups, setPrimaryAction, trash.length, openTrash, subView, totalOpenTodos, tagsSummary.length]);

  // Real-time matched blocks and all nested children for the selected hashtag
  const activeTagGroups = useMemo(() => tagGroups(docs, selectedTag, tagDetails), [docs, selectedTag, tagDetails]);

  // The hashtag page keeps its order while open: a note whose last hashtag was just removed stays in its
  // place (its editor then shows nothing), new matches come at the end; leaving the page starts afresh
  const tagPageOrderRef = useRef<{ tag: string | null; groups: typeof activeTagGroups }>({ tag: null, groups: [] });
  // The order of the last result is read and kept in the ref while computing the next one, on purpose
  /* eslint-disable react-hooks/refs */
  const tagPageGroups = useMemo(() => {
    const prev = tagPageOrderRef.current;
    const byId = new Map(activeTagGroups.map((g) => [g.docId, g]));
    let groups = activeTagGroups;
    if (prev.tag === selectedTag) {
      const known = new Set(prev.groups.map((g) => g.docId));
      groups = [
        ...prev.groups.map((g) => byId.get(g.docId) || g),
        ...activeTagGroups.filter((g) => !known.has(g.docId)),
      ];
    }
    tagPageOrderRef.current = { tag: selectedTag, groups };
    return groups;
  }, [activeTagGroups, selectedTag]);
  /* eslint-enable react-hooks/refs */
  useEffect(() => {
    if (subView !== 'tag_detail') tagPageOrderRef.current = { tag: null, groups: [] };
  }, [subView]);


  const selectedDocObj = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || null,
    [docs, selectedDocId]
  );
  const barDocObj = subView === 'journal' ? journalDocObj : selectedDocObj;

  // Aggregated metadata map for every tag (documents where it occurs, open todos count)
  const tagsMetadataMap = useMemo(() => tagsMetadata(tagsSummary, docs), [tagsSummary, docs]);

  // Filtered and sorted tags for the Kachel Grid view
  const filteredTags = useMemo(() => filterTags(tagsSummary, tagSearchQuery, tagSortBy), [tagsSummary, tagSearchQuery, tagSortBy]);

  return (
    <WikiLinkResolverContext.Provider value={wikiLinkStore}>
    <div className="w-full h-full min-h-0 flex flex-col gap-3">
      {/* Top Header: Workspace Tabs & Actions */}
      {/* Phones: the views are switched in the menu at the top, so the row is hidden there */}
      <WorkspaceTabBar
        subView={subView}
        setSubView={setSubView}
        setMobileShowDetail={setMobileShowDetail}
        isSidebarCollapsed={isSidebarCollapsed}
        toggleSidebar={toggleSidebar}
        totalOpenTodos={totalOpenTodos}
        tagsSummary={tagsSummary}
        selectedDocId={barDocId}
        selectedDocObj={barDocObj}
        currentUser={currentUser}
        docSaveStatus={docSaveStatus}
        docSaveError={docSaveError}
        docHeaderStatus={docHeaderStatus}
        openDocShareModal={openDocShareModal}
        inSharedFolder={isFolderShared(sharedFolders.find((f) => f.id === barDocObj?.sharedFolderId))}
        setDocActionsTarget={setDocActionsTarget}
      />

      {/* Main Workspace Split Pane */}
      <div
        data-ws-pane
        className={
          focusMode
            ? `fixed inset-0 z-45 flex bg-editor focus-mode-enter ${zenPinTop ? 'lg:pt-[45px]' : ''} ${
                zenPinSide ? 'lg:pl-80' : ''
              }`
            : 'flex flex-1 min-h-0 bg-editor rounded-card border border-border overflow-hidden'
        }
      >
        {focusMode && (
          <FocusModeChrome
            selectedDocObj={barDocObj}
            zenSidebar={zenSidebar}
            setZenSidebar={setZenSidebar}
            zenSideOpen={zenSideOpen}
            zenPinTop={zenPinTop}
            setZenPinTop={setZenPinTop}
            zenPinSide={zenPinSide}
            setZenPinSide={setZenPinSide}
            setZenActionsTarget={setZenActionsTarget}
            setFocusMode={setFocusMode}
          />
        )}
        {/* LEFT MASTER SIDEBAR */}
        <aside
          data-tour="note-list"
          onMouseLeave={() => setZenSidebar((v) => (v === 'hover' ? 'closed' : v))}
          className={
            focusMode
              ? // Pinned: from lg on it stays open beside the note (below a pinned header), without shadow
                `fixed left-0 inset-y-0 z-47 w-80 max-w-[85vw] flex flex-col bg-sidebar border-r border-border transition-transform duration-300 ease-out ${
                  zenSidebar !== 'closed'
                    ? 'translate-x-0 shadow-panel'
                    : zenPinSide
                    ? '-translate-x-full lg:translate-x-0'
                    : '-translate-x-full'
                } ${zenPinSide && zenPinTop ? 'lg:top-[45px]' : ''}`
              : `${
                  (subView !== 'editor' && subView !== 'trash' && subView !== 'journal') || isSidebarCollapsed
                    ? 'hidden'
                    : mobileShowDetail
                    ? 'hidden lg:flex'
                    : 'flex'
                } w-full lg:w-72 xl:w-80 shrink-0 flex-col bg-sidebar border-r border-border transition-all duration-200 max-lg:animate-in max-lg:slide-in-from-left-1/4 max-lg:fade-in max-lg:duration-200`
          }
        >
          {/* Sidebar header: search and the create buttons in one row */}
          <div className="p-3 border-b border-border flex items-center gap-1.5">
            {/* Opens the global full-text search, which also finds the content of every bullet */}
            {onOpenSearch && (
              <button
                type="button"
                onClick={onOpenSearch}
                className="input-field flex-1 min-w-0 h-11 sm:h-8 px-2.5 flex items-center gap-2 text-xs text-faint hover:text-main cursor-pointer"
                title={t('view.searchTitle')}
              >
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 text-left truncate">{t('view.search')}</span>
                <span className="hidden xl:inline font-mono text-[10px]">⌘K</span>
              </button>
            )}
            {/* On phones these are in the menu at the top (and the + button), so not repeated here */}
            <div className="hidden sm:flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={(e) => handleOpenNewFolder('', e)}
                className="btn-icon h-8 w-8"
                title={t('view.newFolder')}
                aria-label={t('view.newFolder')}
              >
                <FolderPlus className="w-4 h-4" />
              </button>
              {/* A bullet dragged here becomes a note of its own */}
              <button
                type="button"
                onClick={(e) => openNewNote('', e)}
                data-tour="new-note"
                {...drag.newNoteDropProps}
                className={`btn-icon h-8 w-8 transition-transform ${drag.newNoteHover ? 'scale-110 text-accent ring-2 ring-accent bg-accent/10' : ''}`}
                title={t('view.newNoteDrop')}
                aria-label={t('view.newNote')}
              >
                <FilePlus className="w-4 h-4 pointer-events-none" />
              </button>
              {/* Focus mode: pin the sliding sidebar so it stays beside the note */}
              {focusMode && (
                <button
                  type="button"
                  onClick={() => {
                    // Unpinned, it stays until the mouse leaves it
                    setZenSidebar(zenPinSide ? 'hover' : 'closed');
                    setZenPinSide((v) => !v);
                  }}
                  className={`hidden lg:inline-flex btn-icon h-8 w-8 ${zenPinSide ? 'text-accent' : ''}`}
                  title={zenPinSide ? t('view.unpinSidebar') : t('view.pinSidebar')}
                  aria-label={zenPinSide ? t('view.unpinSidebar') : t('view.pinSidebar')}
                  aria-pressed={zenPinSide}
                >
                  {zenPinSide ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

        {/* Scrollable Navigation Tree */}
        <div
          ref={treeRef}
          className="flex-1 overflow-y-auto p-2 space-y-3"
          onClick={(e) => {
            if (e.target === e.currentTarget && markedDocIds.size > 0) setMarkedDocIds(new Set());
          }}
        >
          {/* Journal on top; open, it shows the calendar */}
          {journalEnabled && (
            <SidebarJournal
              subView={subView}
              toggleJournal={toggleJournal}
              journalActive={journalActive}
              journalDays={journalDays}
              jumpToJournalDay={jumpToJournalDay}
            />
          )}
          <FolderTree
            pinnedDocs={pinnedDocs}
            rootDocs={rootDocs}
            folderTree={filteredTree ? filteredTree.tree : folderTree}
            expandedFolders={filteredTree ? filteredTree.expanded : expandedFolders}
            setExpandedFolders={filteredTree ? setFilterExpanded : setExpandedFolders}
            filterActive={Boolean(filteredTree)}
            selectedDocId={selectedDocId}
            subView={subView}
            drag={drag}
            handleCreateDocument={openNewNote}
            handleOpenNewFolder={handleOpenNewFolder}
            handleShareFolderClick={handleShareFolderClick}
            requestDeleteFolder={requestDeleteFolder}
            requestRenameFolder={handleOpenRenameFolder}
            requestDeleteDoc={requestDeleteDoc}
            onOpenDoc={(id) =>
              // Another note: asks first while a dictation into a text field would be lost
              guardLeave(() => {
                setSelectedDocId(id);
                setTarget(null);
                setSubView('editor');
                setMobileShowDetail(true);
              })
            }
            onSelectDoc={(id) =>
              guardLeave(() => {
                setSelectedDocId(id);
                setTarget(null);
                setNewlyCreatedDocId(null);
                setSubView('editor');
                setMobileShowDetail(true);
              })
            }
          />

          {/* Tags Explorer */}
          {tagsSummary.length > 0 && (
            <SidebarTags
              tagsSummary={tagsSummary}
              selectedTags={activeTagFilter}
              toggleTag={toggleSidebarTag}
              clearFilter={clearSidebarTagFilter}
            />
          )}
        </div>

        {/* Trash at the bottom of the tree */}
        <SidebarTrash
          drag={drag}
          subView={subView}
          trashCount={trash.length}
          openTrash={openTrash}
          filterActive={activeTagFilter.length > 0}
        />
      </aside>

      {/* RIGHT DETAIL AREA (STRICTLY ISOLATED BY KEY) */}
      <main
        className={`${
          subView !== 'editor' || mobileShowDetail || isSidebarCollapsed || focusMode ? 'flex' : 'hidden lg:flex'
        } flex-1 flex-col min-w-0 h-full overflow-hidden bg-editor max-lg:animate-in max-lg:slide-in-from-right-1/3 max-lg:fade-in max-lg:duration-200`}
      >
        {subView === 'journal' && journalEnabled ? (
          <JournalView
            days={journalDays}
            extraDates={journalExtra}
            activeDate={journalActive}
            onActiveDateChange={setJournalActive}
            jumpRequest={journalJump}
            onOpenDay={openJournalDay}
            onJump={jumpToJournalDay}
            getDoc={(id) => docs.find((d) => d.id === id)}
            currentUser={currentUser}
            availableFolders={allFolderPaths}
            onOpenShareModal={openDocShareModal}
            onDocMetadataChange={handleDocMetadataChange}
            onDeleteDoc={handleDeleteDocument}
            onSelectTag={handleSelectTag}
            onWikiLinkClick={handleWikiLinkClick}
            onOpenDocBlock={handleJumpToDocBlock}
            onOpenTask={onOpenTask}
            onBackMobile={() => setMobileShowDetail(false)}
            onDaySaved={reloadJournalSoon}
            onDayEmptied={removeJournalDay}
            actionsTarget={focusMode ? zenActionsTarget : docActionsTarget}
            focusMode={focusMode}
            focusBarPinned={zenPinTop}
            onToggleFocusMode={() => setFocusMode((v) => !v)}
            onActiveSaveStatusChange={(status, err) => {
              setDocSaveStatus(status);
              setDocSaveError(err || null);
            }}
            onActiveHeaderStatusChange={setDocHeaderStatus}
          />
        ) : subView === 'trash' ? (
          <TrashView
            items={trash}
            onOpen={handleOpenTrashedDoc}
            onRestore={handleRestoreTrashItem}
            onPurge={handlePurgeTrashItem}
            onEmpty={handleEmptyTrash}
            onBackMobile={() => {
              setSubView('editor');
              setMobileShowDetail(false);
            }}
          />
        ) : subView === 'editor' && selectedDocId ? (
          <DocumentEditor
            key={`${selectedDocId}:${editorNonce}`}
            docId={selectedDocId}
            currentUser={currentUser}
            initialDoc={selectedDocObj}
            availableFolders={allFolderPaths}
            autoFocusTitle={newlyCreatedDocId === selectedDocId}
            initialFocusedBlockId={targetBlockId}
            onDocMetadataChange={handleDocMetadataChange}
            onDeleteDoc={handleDeleteDocument}
            onRestoreDoc={handleRestoreDocument}
            onOpenShareModal={openDocShareModal}
            onSelectTag={handleSelectTag}
            onWikiLinkClick={handleWikiLinkClick}
            onOpenDocBlock={handleJumpToDocBlock}
            onRequestMerge={(d) => setMergeDialog({ sourceId: d.id })}
            onDocCreated={(created) => {
              setDocs((prev) => (prev.some((d) => d.id === created.id) ? prev : [created, ...prev]));
              const folderPath = created.folderPath;
              if (folderPath) setExpandedFolders((prev) => ({ ...prev, ...folderAncestors(folderPath) }));
              onStatsChange();
            }}
            onDocRemoved={(id) => {
              setDocs((prev) => prev.filter((d) => d.id !== id));
              reloadTrash();
              onStatsChange();
            }}
            moveTargets={moveTargets}
            templates={templates}
            onBackMobile={() => setMobileShowDetail(false)}
            onOpenTask={onOpenTask}
            onSaveStatusChange={(status, err) => {
              setDocSaveStatus(status);
              setDocSaveError(err || null);
            }}
            onHeaderStatusChange={setDocHeaderStatus}
            actionsTarget={focusMode ? zenActionsTarget : docActionsTarget}
            focusMode={focusMode}
            focusBarPinned={zenPinTop}
            onToggleFocusMode={() => setFocusMode((v) => !v)}
          />
        ) : subView === 'tags' ? (
          <HashtagOverview
            filteredTags={filteredTags}
            tagsSummary={tagsSummary}
            tagsMetadataMap={tagsMetadataMap}
            handleSelectTag={handleSelectTag}
            tagSearchQuery={tagSearchQuery}
            setTagSearchQuery={setTagSearchQuery}
            tagSortBy={tagSortBy}
            setTagSortBy={setTagSortBy}
          />
        ) : subView === 'tag_detail' && selectedTag ? (
          <TagDetailView
            selectedTag={selectedTag}
            setSubView={setSubView}
            tagNoteDraft={tagNoteDraft}
            setTagNoteDraft={setTagNoteDraft}
            handleSaveTagNote={handleSaveTagNote}
            tagPageGroups={tagPageGroups}
            currentUser={currentUser}
            docs={docs}
            allFolderPaths={allFolderPaths}
            handleDocMetadataChange={handleDocMetadataChange}
            handleDeleteDocument={handleDeleteDocument}
            openDocShareModal={openDocShareModal}
            handleSelectTag={handleSelectTag}
            handleWikiLinkClick={handleWikiLinkClick}
            handleJumpToDocBlock={handleJumpToDocBlock}
            onOpenTask={onOpenTask}
          />
        ) : subView === 'todos' ? (
          <TodoRollupView
            allRollupTodos={allRollupTodos}
            rollupTodosByFolder={rollupTodosByFolder}
            totalOpenTodos={totalOpenTodos}
            collapsedTodoFolders={collapsedTodoFolders}
            setCollapsedTodoFolders={setCollapsedTodoFolders}
            collapsedTodoNotes={collapsedTodoNotes}
            setCollapsedTodoNotes={setCollapsedTodoNotes}
            todoFolderDrilldown={todoFolderDrilldown}
            setTodoFolderDrilldown={setTodoFolderDrilldown}
            todoGrouping={todoGrouping}
            setTodoGrouping={setTodoGroupingSaved}
            todoShow={todoShow}
            setTodoShow={setTodoShow}
            hasDoneTodos={hasDoneTodos}
            handleJumpToDocBlock={handleJumpToDocBlock}
            handleToggleRollupTodo={handleToggleRollupTodo}
            loading={rollupTodos === null}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-editor">
            <FileText className="w-10 h-10 text-faint mb-2" />
            <h3 className="text-sm font-semibold text-main mb-1">
              {t('view.noneSelected')}
            </h3>
            <p className="text-xs text-muted max-w-sm mb-3">
              {isSidebarCollapsed
                ? t('view.sidebarCollapsed')
                : t('view.pickHint')}
            </p>
            <div className="flex items-center gap-2">
              {isSidebarCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="btn-action inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                  <span>{t('view.showFolders')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => openNewNote('', e)}
                className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('view.createNote')}</span>
              </button>
            </div>
          </div>
        )}
      </main>

      <FolderDialogs
        showNewFolderModal={showNewFolderModal}
        setShowNewFolderModal={setShowNewFolderModal}
        newFolderParentPath={newFolderParentPath}
        renamingFolder={renameFolderPath !== null}
        newFolderCoords={newFolderCoords}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        handleCreateFolderSubmit={handleCreateFolderSubmit}
        newNoteSheet={newNoteSheet}
        setNewNoteSheet={setNewNoteSheet}
        newNoteTitle={newNoteTitle}
        setNewNoteTitle={setNewNoteTitle}
        newNoteIcon={newNoteIcon}
        setNewNoteIcon={setNewNoteIcon}
        templates={templates}
        newNoteTemplate={newNoteTemplate}
        setNewNoteTemplate={setNewNoteTemplate}
        handleCreateDocument={handleCreateDocument}
        pendingFolderDelete={pendingFolderDelete}
        pendingDocDelete={pendingDocDelete}
        closeDocDelete={closeDocDelete}
        handleDeleteDocument={handleDeleteDocument}
        closeFolderDelete={closeFolderDelete}
        handleDeleteFolder={handleDeleteFolder}
        docs={docs}
      />

      {mergeDialog && (
        <MergeDialog
          docs={docs}
          sourceId={mergeDialog.sourceId}
          targetId={mergeDialog.targetId}
          onClose={() => setMergeDialog(null)}
          onMerged={(r) => void handleMerged(r)}
        />
      )}

      <WorkspaceToast toast={toast} setToast={setToast} />

      <WorkspaceShareModal
        share={share}
        currentUser={currentUser}
        onFolderChanged={(sf) =>
          setSharedFolders((prev) => prev.map((f) => (f.id === sf.id ? { ...f, shares: sf.shares } : f)))
        }
      />
      </div>
    </div>
    </WikiLinkResolverContext.Provider>
  );
};
