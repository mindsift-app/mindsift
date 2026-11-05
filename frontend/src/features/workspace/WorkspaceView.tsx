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
import { TodoRollupView } from './TodoRollupView';
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
import { buildFolderTree, collectFolderPaths, collectRollupTodos, countOpenTodos, filterTags, groupRollupTodosByFolder, isFolderShared, tagGroups, tagsMetadata } from './workspaceListing';
import { FolderDialogs } from './FolderDialogs';
import { WorkspaceSubView } from './workspaceTypes';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { showError } from '../../components/ErrorNotice';

interface WorkspaceViewProps {
  currentUser?: User | null;
  initialDocId?: string | null;
  initialBlockId?: string | null;
  onStatsChange: () => void;
  onOpenTask?: (taskId: string) => void;
  // Opens the global search (command palette); the notes sidebar has no search of its own
  onOpenSearch?: () => void;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  currentUser,
  initialDocId,
  initialBlockId,
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
  const [targetBlockId, setTargetBlockId] = useState<string | null>(initialBlockId || null);
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
  const { docs, setDocs, folders, setFolders, sharedFolders, setSharedFolders, tagsSummary, loadWorkspaceData } =
    useWorkspaceData({ currentUser, setSelectedDocId, autoSelectedDocRef, reloadTrash });

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
  } = useJournal(setDocs);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagDetails, setTagDetails] = useState<TagDetails | null>(null);
  const [tagNoteDraft, setTagNoteDraft] = useState<string>('');
  const [tagSearchQuery, setTagSearchQuery] = useState<string>('');
  const [tagSortBy, setTagSortBy] = useState<'count' | 'name'>('count');

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('mindsift:workspace_expanded_folders');
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

  const handleOpenNewFolder = (parentPath = '', e?: React.MouseEvent) => {
    setNewFolderParentPath(parentPath);
    setNewFolderName('');
    if (e) {
      setNewFolderCoords({
        x: Math.min(e.clientX, window.innerWidth - 270),
        y: Math.min(e.clientY, window.innerHeight - 200),
      });
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
  const [collapsedTodoFolders, setCollapsedTodoFolders] = useState<Set<string>>(new Set());
  const [collapsedTodoNotes, setCollapsedTodoNotes] = useState<Set<string>>(new Set());

  // Sharing a note or a shared folder
  const share = useShareModal();
  const { openDocShareModal, openFolderShareModal } = share;

  const isCreatingRef = useRef<boolean>(false);
  const { setGroups, setPrimaryAction } = useMobileActions();

  useEffect(() => {
    if (initialDocId) {
      setSelectedDocId(initialDocId);
      setSubView('editor');
      setMobileShowDetail(true);
    }
  }, [initialDocId]);

  const handleCreateDocument = useCallback(
    async (folderPath = '', title = i18n.t('workspace:editor.newNote'), icon = '🗒️') => {
      if (isCreatingRef.current) return;
      isCreatingRef.current = true;
      triggerHaptic(10);
      try {
        const created = await api.createDocument({
          title: title.trim() || i18n.t('workspace:editor.newNote'),
          icon: icon.trim(),
          folderPath,
          blocks: [
            {
              id: `blk_${Date.now().toString(36)}_0`,
              type: 'text',
              content: '',
              level: 0,
              position: 1000,
            },
          ],
        });
        setDocs((prev) => (prev.some((d) => d.id === created.id) ? prev : [created, ...prev]));
        setNewlyCreatedDocId(created.id);
        setTargetBlockId(null);
        setSelectedDocId(created.id);
        setSubView('editor');
        setMobileShowDetail(true);
        if (folderPath) {
          setExpandedFolders((prev) => ({ ...prev, [folderPath]: true }));
        }
        onStatsChange();
      } catch {
        // ignore
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
  const [newNoteSheet, setNewNoteSheet] = useState<{ folderPath: string } | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteIcon, setNewNoteIcon] = useState('🗒️');
  const openNewNote = useCallback(
    (folderPath = '') => {
      if (!isPhoneWidth()) {
        void handleCreateDocument(folderPath);
        return;
      }
      setNewNoteTitle('');
      setNewNoteIcon('🗒️');
      setNewNoteSheet({ folderPath });
    },
    [handleCreateDocument]
  );

  const handleJumpToDocBlock = useCallback((docId: string, blockId?: string) => {
    setSelectedDocId(docId);
    setTargetBlockId(blockId || null);
    setNewlyCreatedDocId(null);
    setSubView('editor');
    setMobileShowDetail(true);
  }, []);

  const openJournal = useCallback(() => {
    reloadJournal();
    setSubView('journal');
    setMobileShowDetail(true);
  }, [reloadJournal]);

  // A second click closes the journal and shows the regular note again
  const toggleJournal = useCallback(() => {
    if (subView === 'journal') {
      setSubView('editor');
      setSelectedDocId((prev) => prev ?? treeDocsRef.current[0]?.id ?? null);
    } else {
      openJournal();
    }
  }, [subView, openJournal]);

  const openTrash = useCallback(() => {
    reloadTrash();
    setSubView('trash');
    setMobileShowDetail(true);
  }, [reloadTrash]);

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
    setTargetBlockId(null);
    setNewlyCreatedDocId(null);
    setSubView('editor');
    setMobileShowDetail(true);
  };

  // Trash: restore, delete for good, empty (useTrashActions.ts)
  const { handleRestoreDocument, handleRestoreTrashItem, handlePurgeTrashItem, handleEmptyTrash } = useTrashActions({
    selectedDocId,
    setSelectedDocId,
    trash,
    setDocs,
    setFolders,
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
    const cleanPath = newFolderParentPath ? `${newFolderParentPath}/${cleanName}` : cleanName;
    try {
      const res = await api.createFolder(cleanPath);
      setFolders((prev) => (prev.includes(res.path) ? prev : [...prev, res.path].sort()));
      const parts = res.path.split('/');
      let acc = '';
      const expansions: Record<string, boolean> = {};
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        expansions[acc] = true;
      }
      setExpandedFolders((prev) => ({ ...prev, ...expansions }));
      setNewFolderName('');
      setNewFolderParentPath('');
      setShowNewFolderModal(false);
    } catch (err: any) {
      showError(err.message || i18n.t('workspace:folder.createFailed'));
    }
  };

  // Deleting a folder asks first, in a small popover where the click was
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{ path: string; x: number; y: number } | null>(null);
  const requestDeleteFolder = (path: string, at: { x: number; y: number }) => setPendingFolderDelete({ path, ...at });
  const closeFolderDelete = useCallback(() => setPendingFolderDelete(null), []);

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
    selectedDocId,
    setSelectedDocId,
    setMobileShowDetail,
    setExpandedFolders,
    setMergeDialog,
    treeRef,
    showToast,
    loadWorkspaceData,
    reloadTrash,
    onStatsChange,
  });
  const { markedDocIds, setMarkedDocIds } = drag;

  const handleMerged = async (result: MergeResult) => {
    setMergeDialog(null);
    triggerHaptic(20);
    setDocs((prev) => prev.filter((d) => d.id !== result.sourceId));
    setSelectedDocId(result.targetId);
    setTargetBlockId(null);
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
            await loadWorkspaceData();
            setSelectedDocId(result.sourceId);
            setEditorNonce((n) => n + 1);
            reloadTrash();
            showToast(i18n.t('workspace:merge.undone'));
          } catch (err: any) {
            showToast(err?.message || i18n.t('workspace:merge.undoFailed'));
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

  const handleWikiLinkClick = useCallback(
    (pageTitle: string, blockId?: string) => {
      const clean = pageTitle.trim().toLowerCase();
      const match = docs.find((d) => d.title.trim().toLowerCase() === clean);
      if (match && blockId) {
        handleJumpToDocBlock(match.id, blockId);
      } else if (match) {
        setSelectedDocId(match.id);
        setSubView('editor');
        setMobileShowDetail(true);
      } else {
        handleCreateDocument('');
      }
    },
    [docs, handleCreateDocument, handleJumpToDocBlock]
  );

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

  const handleToggleRollupTodo = async (doc: Document, blockId: string, currentChecked: boolean) => {
    triggerHaptic(10);
    const updatedBlocks = (doc.blocks || []).map((b) =>
      b.id === blockId ? { ...b, checked: !currentChecked } : b
    );
    setDocs((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, blocks: updatedBlocks } : d))
    );
    try {
      const [result] = await sendDocOps(doc.id, [{ kind: 'set_props', blockId, patch: { checked: !currentChecked } }]);
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
  const treeDocsRef = useRef(treeDocs);
  treeDocsRef.current = treeDocs;

  useEffect(() => {
    writeWorkspaceSession({ journal: subView === 'journal', docId: selectedDocId });
  }, [subView, selectedDocId]);

  const canFocus = subView === 'editor' && Boolean(selectedDocId);
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
  } = useFocusMode(canFocus, selectedDocId);


  const allFolderPaths = useMemo(() => collectFolderPaths(folders, docs, sharedFolders), [docs, folders, sharedFolders]);

  const folderTree = useMemo(() => buildFolderTree(allFolderPaths, treeDocs, sharedFolders), [allFolderPaths, treeDocs, sharedFolders]);

  const pinnedDocs = useMemo(
    () => treeDocs.filter((d) => d.isPinned),
    [treeDocs]
  );

  const rootDocs = useMemo(
    () => treeDocs.filter((d) => !d.folderPath && !d.isPinned),
    [treeDocs]
  );

  // Global To-Dos rollup collections
  const allRollupTodos = useMemo(() => collectRollupTodos(docs, todoFolderDrilldown), [docs, todoFolderDrilldown]);

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
  useEffect(() => {
    if (subView !== 'tag_detail') tagPageOrderRef.current = { tag: null, groups: [] };
  }, [subView]);


  const selectedDocObj = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || null,
    [docs, selectedDocId]
  );

  // Aggregated metadata map for every tag (documents where it occurs, open todos count)
  const tagsMetadataMap = useMemo(() => tagsMetadata(tagsSummary, docs), [tagsSummary, docs]);

  // Filtered and sorted tags for the Kachel Grid view
  const filteredTags = useMemo(() => filterTags(tagsSummary, tagSearchQuery, tagSortBy), [tagsSummary, tagSearchQuery, tagSortBy]);

  return (
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
        selectedDocId={selectedDocId}
        selectedDocObj={selectedDocObj}
        currentUser={currentUser}
        docSaveStatus={docSaveStatus}
        docSaveError={docSaveError}
        docHeaderStatus={docHeaderStatus}
        openDocShareModal={openDocShareModal}
        inSharedFolder={isFolderShared(sharedFolders.find((f) => f.id === selectedDocObj?.sharedFolderId))}
        setDocActionsTarget={setDocActionsTarget}
      />

      {/* Main Workspace Split Pane */}
      <div
        data-ws-pane
        className={
          focusMode
            ? `fixed inset-0 z-[45] flex bg-editor focus-mode-enter ${zenPinTop ? 'lg:pt-[45px]' : ''} ${
                zenPinSide ? 'lg:pl-80' : ''
              }`
            : 'flex flex-1 min-h-0 bg-editor rounded-card border border-border overflow-hidden'
        }
      >
        {focusMode && (
          <FocusModeChrome
            selectedDocObj={selectedDocObj}
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
          onMouseLeave={() => setZenSidebar((v) => (v === 'hover' ? 'closed' : v))}
          className={
            focusMode
              ? // Pinned: from lg on it stays open beside the note (below a pinned header), without shadow
                `fixed left-0 inset-y-0 z-[47] w-80 max-w-[85vw] flex flex-col bg-sidebar border-r border-border transition-transform duration-300 ease-out ${
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
                onClick={() => handleCreateDocument('')}
                {...drag.newNoteDropProps}
                className={`btn-icon h-8 w-8 transition-transform ${drag.newNoteHover ? 'scale-110 text-accent ring-2 ring-accent bg-accent/10' : ''}`}
                title={t('view.newNoteDrop')}
                aria-label={t('view.newNote')}
              >
                <FilePlus className="w-4 h-4" />
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
            folderTree={folderTree}
            expandedFolders={expandedFolders}
            setExpandedFolders={setExpandedFolders}
            selectedDocId={selectedDocId}
            subView={subView}
            drag={drag}
            handleCreateDocument={handleCreateDocument}
            handleOpenNewFolder={handleOpenNewFolder}
            handleShareFolderClick={handleShareFolderClick}
            requestDeleteFolder={requestDeleteFolder}
            onOpenDoc={(id) => {
              setSelectedDocId(id);
              setSubView('editor');
              setMobileShowDetail(true);
            }}
            onSelectDoc={(id) => {
              setSelectedDocId(id);
              setTargetBlockId(null);
              setNewlyCreatedDocId(null);
              setSubView('editor');
              setMobileShowDetail(true);
            }}
          />

          {/* Tags Explorer */}
          {tagsSummary.length > 0 && (
            <SidebarTags tagsSummary={tagsSummary} subView={subView} selectedTag={selectedTag} handleSelectTag={handleSelectTag} />
          )}
        </div>

        {/* Trash at the bottom of the tree */}
        <SidebarTrash drag={drag} subView={subView} trashCount={trash.length} openTrash={openTrash} />
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
              if (created.folderPath) {
                const parts = created.folderPath.split('/');
                const open: Record<string, boolean> = {};
                parts.forEach((_, i) => {
                  open[parts.slice(0, i + 1).join('/')] = true;
                });
                setExpandedFolders((prev) => ({ ...prev, ...open }));
              }
              onStatsChange();
            }}
            onDocRemoved={(id) => {
              setDocs((prev) => prev.filter((d) => d.id !== id));
              reloadTrash();
              onStatsChange();
            }}
            moveTargets={moveTargets}
            onBackMobile={() => setMobileShowDetail(false)}
            onOpenTask={onOpenTask}
            onSaveStatusChange={(status, err) => {
              setDocSaveStatus(status);
              setDocSaveError(err || null);
            }}
            onHeaderStatusChange={setDocHeaderStatus}
            actionsTarget={focusMode ? zenActionsTarget : docActionsTarget}
            focusMode={focusMode}
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
            setTodoGrouping={setTodoGrouping}
            handleJumpToDocBlock={handleJumpToDocBlock}
            handleToggleRollupTodo={handleToggleRollupTodo}
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
                onClick={() => openNewNote('')}
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
        handleCreateDocument={handleCreateDocument}
        pendingFolderDelete={pendingFolderDelete}
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
  );
};
