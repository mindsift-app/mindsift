import React, { useEffect, useState, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';
import {
  Columns2,
  Users,
  SquareCheckBig,
  User as 
  Lock,
} from 'lucide-react';
import { TaskList, Thought, Team, User, TaskListMember, KanbanColumn, TrashedTask } from '../../lib/types';
import { readViewMemory, writeViewMemory } from '../../lib/viewSession';
import { useKanbanLayout } from './useKanbanLayout';
import { MobileTaskCreateSheet, MobileTaskDraft } from './MobileTaskCreateSheet';
import { TagFilterRow } from './TagFilterRow';
import { inIdOrder } from '../../lib/useTabReorder';
import { useTaskDrag } from './useTaskDrag';
import { useLatestCallback } from '../../lib/useLatestCallback';
import { KanbanBoard } from './KanbanBoard';
import { TaskRow } from './TaskRow';
import { buildTasksMenu } from './tasksMenu';
import { TasksFilterSheet } from './TasksFilterSheet';
import { TaskListTabs } from './TaskListTabs';
import { TaskListView } from './TaskListView';
import { filterAndSortTasks, groupTasks, tasksWithTag } from './taskListing';
import { useTaskRealtime } from './useTaskRealtime';
import { useTaskUndo } from './useTaskUndo';
import { useTaskActions } from './useTaskActions';
import { QuickAddTaskBar } from './QuickAddTaskBar';
import { NewTaskListSheet } from './NewTaskListSheet';
import { RenameListSheet } from '../../components/RenameListSheet';
import { CalendarModeSwitch, TaskCalendar, useCalendarMode } from './TaskCalendar';
import { TaskListShareDialog } from './TaskListShareDialog';
import { ActiveFilterBanner } from './ActiveFilterBanner';
import { GROUP_LABELS, GroupBy, TaskFilter, TaskSort, ViewMode } from './taskViewTypes';
import { api, triggerHaptic } from '../../lib/api';
import { TaskDetailModal } from './TaskDetailModal';
import { ManageColumnsModal, DEFAULT_KANBAN_COLUMNS } from './ManageColumnsModal';
import { activeColumnsFor, boardIdOfColumn, columnsOfTask, combinedBoardColumns, ownColumnIn } from '../../lib/kanbanColumns';
import { AvatarStack, AvatarPerson } from '../../components/AvatarStack';
import { ListSwitcher } from '../../components/ListSwitcher';
import { reportNav, onNavStep, restoringNavPlace } from '../../lib/navHistory';
import { LivePill } from '../../components/LivePill';
import { useMobileActions } from '../../context/MobileActionContext';
import { askConfirm } from '../../components/askConfirm';
import { showError } from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errorMessage';
import { useLatestRef } from '../../lib/useLatestRef';




interface TasksViewProps {
  currentUser?: User | null;
  onRefreshStats: () => void;
  onOpenDocument: (docId: string, blockId?: string) => void;
  refreshTrigger?: number;
  initialSelectedTaskId?: string | null;
  // The task from initialSelectedTaskId was opened; the parent forgets it, so returning to the tab does
  // not open it again
  onInitialTaskShown?: () => void;
  openTasksCount?: number; // all open tasks incl. shared lists (same as the nav bar counter)
}


// viewModes: list or Kanban per task list ("all" for Alle Aufgaben); viewMode is the old single value
type TasksSession = {
  listId: string;
  viewModes: Record<string, ViewMode>;
  viewMode?: ViewMode;
  groupAll: GroupBy;
  groupList: GroupBy;
};

// "Alle Aufgaben" is grouped by task list unless the user picks something else; a single list has no
// grouping by default (grouping it by list would give one group)
const DEFAULT_GROUP_ALL: GroupBy = 'list';
const DEFAULT_GROUP_LIST: GroupBy = 'none';

// Title of a task created from a Kanban column until it gets its own
// Placeholder title of a task created from the + button until it gets its own
const newTaskTitle = () => i18n.t('tasks:detail.new');

export const TasksView: React.FC<TasksViewProps> = ({
  currentUser,
  onRefreshStats,
  onOpenDocument,
  refreshTrigger = 0,
  initialSelectedTaskId,
  onInitialTaskShown,
  openTasksCount,
}) => {
  const { t } = useTranslation('tasks');
  // Open list, view per list and grouping are remembered on this device (new tab, restart of the
  // installed app)
  const remembered = useMemo(() => readViewMemory<TasksSession>('tasks'), []);
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>(() => {
    const out: Record<string, ViewMode> = {};
    if (remembered.viewModes && typeof remembered.viewModes === 'object') {
      for (const [id, mode] of Object.entries(remembered.viewModes)) {
        if (mode === 'kanban' || mode === 'calendar') out[id] = mode;
      }
    } else if (remembered.viewMode === 'kanban' && remembered.listId) {
      out[remembered.listId] = 'kanban'; // stored before views were kept per list
    }
    return out;
  });
  const [groupAll, setGroupAll] = useState<GroupBy>(() =>
    remembered.groupAll && remembered.groupAll in GROUP_LABELS ? remembered.groupAll : DEFAULT_GROUP_ALL
  );
  const [groupList, setGroupList] = useState<GroupBy>(() =>
    remembered.groupList && remembered.groupList in GROUP_LABELS && remembered.groupList !== 'list'
      ? remembered.groupList
      : DEFAULT_GROUP_LIST
  );
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [tasks, setTasksState] = useState<Thought[]>([]);
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [selectedListId, setSelectedListIdState] = useState<string>(
    () => {
      // Coming back here by the browser's back/forward: the list of that step
      const step = restoringNavPlace();
      return (step?.tab === 'tasks' && step.taskList) || remembered.listId || 'all';
    }
  );
  // The switch shows the chosen view at once; the view itself follows as a deferred render, so a board with
  // many cards does not hold the click back (React renders it in the background, interruptibly)
  const chosenViewMode: ViewMode = viewModes[selectedListId] || 'list';
  const viewMode: ViewMode = useDeferredValue(chosenViewMode);
  // Only Kanban and calendar are stored; the list view is the default
  const setViewMode = useCallback(
    (mode: ViewMode) =>
      setViewModes((prev) => {
        const next = { ...prev };
        if (mode !== 'list') next[selectedListId] = mode;
        else delete next[selectedListId];
        return next;
      }),
    [selectedListId]
  );
  const [calendarMode, setCalendarMode] = useCalendarMode();
  const isAllTasks = selectedListId === 'all';
  const groupBy: GroupBy = isAllTasks ? groupAll : groupList;
  const setGroupBy = (g: GroupBy) => (isAllTasks ? setGroupAll(g) : setGroupList(g));
  const defaultGroupBy = isAllTasks ? DEFAULT_GROUP_ALL : DEFAULT_GROUP_LIST;
  // "Nach Liste" only where several lists show up
  const groupOptions = (Object.keys(GROUP_LABELS) as GroupBy[])
    .filter((id) => isAllTasks || id !== 'list')
    .map((id) => ({ id, label: GROUP_LABELS[id] }));
  useEffect(() => {
    writeViewMemory<TasksSession>('tasks', { listId: selectedListId, viewModes, groupAll, groupList });
  }, [selectedListId, viewModes, groupAll, groupList]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [collaborators, setCollaborators] = useState<User[]>([]);
  // Task trash of the selected list (or all): deleted tasks and cleared or cleaned-up completed ones
  const [taskTrash, setTaskTrash] = useState<TrashedTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Drag and Drop state

  const { setGroups, setPrimaryAction } = useMobileActions();

  // Mobile task creation & filter modal state
  const [showMobileCreateModal, setShowMobileCreateModal] = useState(false);
  const [mobileCreateListId, setMobileCreateListId] = useState<string>('');
  const [showFilterModal, setShowFilterModal] = useState(false);

  // New TaskList modal state
  const [showNewListModal, setShowNewListModal] = useState(false);

  // Share TaskList modal state
  const [showShareListModal, setShowShareListModal] = useState(false);
  const [sharingTaskList, setSharingTaskList] = useState<TaskList | null>(null);
  const [renamingList, setRenamingList] = useState<TaskList | null>(null);

  // Detail modal state
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [extraTask, setExtraTask] = useState<Thought | null>(null);
  // Every change to the tasks also reaches a task opened from outside the shown list (a link, the
  // search): it is not in `tasks`, so the detail dialog kept showing the old values of priority, status,
  // title … although the server had them (bug of 2026-11-13).
  const setTasks = useCallback<React.Dispatch<React.SetStateAction<Thought[]>>>((update) => {
    setTasksState(update);
    setExtraTask((prev) => {
      if (!prev) return prev;
      const next = typeof update === 'function' ? update([prev]) : update;
      return next.find((t) => t.id === prev.id) ?? prev;
    });
  }, []);

  const onInitialTaskShownRef = useLatestRef(onInitialTaskShown);
  useEffect(() => {
    if (initialSelectedTaskId) {
      // A task asked for from outside (link, search) opens once
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailTaskId(initialSelectedTaskId);
      setShowDetailModal(true);
      setFilter('open');
      onInitialTaskShownRef.current?.();
      api.getThought(initialSelectedTaskId).then((th) => {
        if (th) setExtraTask(th);
      }).catch(() => {});
    }
  }, [initialSelectedTaskId, onInitialTaskShownRef]);

  // Manage columns modal state
  const [showManageColumnsModal, setShowManageColumnsModal] = useState(false);
  const [globalColumns, setGlobalColumns] = useState<KanbanColumn[]>(() => {
    try {
      const stored = localStorage.getItem('mindsift:kanban_columns');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_KANBAN_COLUMNS;
  });

  // Hashtag filtering, grouping and sorting state
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<TaskSort>('custom');

  // Reloads happen after almost every action and on realtime events. Only the first load of a list shows
  // the loading placeholder: replacing the rendered list on every reload swallowed clicks and taps that
  // happened to fall into the reload (press and release then hit different elements).
  const loadedListRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const loadData = async () => {
    const seq = ++loadSeqRef.current;
    const listId = selectedListId;
    if (loadedListRef.current !== listId) setLoading(true);
    try {
      const [allTasks, allLists, allTeams, allCollabs, trash] = await Promise.all([
        api.getTasks(listId === 'all' ? undefined : listId).catch(() => []),
        api.getTaskLists().catch(() => []),
        api.getUserTeams().catch(() => []),
        api.getCollaborators().catch(() => []),
        api.getTaskTrash(listId === 'all' ? '' : listId).catch(() => []),
      ]);
      if (seq !== loadSeqRef.current) return; // a newer reload is under way
      loadedListRef.current = listId;
      listCacheRef.current.set(listId, {
        tasks: Array.isArray(allTasks) ? allTasks : [],
        trash: Array.isArray(trash) ? trash : [],
      });
      setTasks(Array.isArray(allTasks) ? allTasks : []);
      setTaskLists(Array.isArray(allLists) ? allLists : []);
      // The remembered list was deleted or unshared meanwhile
      if (listId !== 'all' && Array.isArray(allLists) && !allLists.some((l) => l.id === listId)) {
        // Declared further down; loadData runs after render, when it exists
        // eslint-disable-next-line react-hooks/immutability
        setSelectedListId('all');
      }
      setTeams(Array.isArray(allTeams) ? allTeams : []);
      setCollaborators(Array.isArray(allCollabs) ? allCollabs : []);
      setTaskTrash(Array.isArray(trash) ? trash : []);
    } catch {
      // Prevent unhandled promise rejection from crashing view
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    // Loads the tasks when the view opens and another list is chosen
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    // loadData reads the selected list and refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger, selectedListId]);

  const selectedListIdRef = useLatestRef(selectedListId);

  // Last known tasks of every list opened in this session. Switching lists shows them in the same render
  // as the new list's view (list or Kanban), so the board never flashes the previous list's tasks; the
  // reload then brings them up to date. A list not opened yet takes its share of "Alle Aufgaben".
  const listCacheRef = useRef(new Map<string, { tasks: Thought[]; trash: TrashedTask[] }>());
  useEffect(() => {
    if (!loading && loadedListRef.current === selectedListId) {
      listCacheRef.current.set(selectedListId, { tasks, trash: taskTrash });
    }
  }, [tasks, taskTrash, loading, selectedListId]);
  // Reads refs on purpose; the app is not built with the React Compiler
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const setSelectedListId = useCallback((id: string) => {
    if (id === selectedListIdRef.current) return;
    const cache = listCacheRef.current;
    let known = cache.get(id);
    const all = cache.get('all');
    if (!known && id !== 'all' && all) {
      known = {
        tasks: all.tasks.filter((t) => t.taskListId === id),
        trash: all.trash.filter((t) => t.taskListId === id),
      };
    }
    setTasks(known ? known.tasks : []);
    setTaskTrash(known ? known.trash : []);
    setLoading(!known);
    loadedListRef.current = known ? id : null;
    setSelectedListIdState(id);
  }, [selectedListIdRef, setTasks]);

  // Switching task lists is a step of the browser history (lib/navHistory.ts)
  useEffect(() => reportNav({ taskList: selectedListId }), [selectedListId]);
  useEffect(
    () =>
      onNavStep((place) => {
        if (place.tab === 'tasks' && place.taskList) setSelectedListId(place.taskList);
      }),
    [setSelectedListId]
  );

  // The realtime handler is registered once; it must reload with the current list, not the first one
  const loadDataRef = useLatestRef(loadData);

  // Live-Sync of tasks and task lists (useTaskRealtime)
  useTaskRealtime({ setTasks, setTaskLists, listIdRef: selectedListIdRef, loadDataRef });

  const safeTaskLists = useMemo(() => (Array.isArray(taskLists) ? taskLists : []), [taskLists]);
  const currentSelectedList = safeTaskLists.find((l) => l.id === selectedListId);
  const isSelectedListReadOnly = currentSelectedList?.permission === 'viewer';
  const isTaskReadOnly = (task: Thought) =>
    !!task.taskListId && safeTaskLists.find((l) => l.id === task.taskListId)?.permission === 'viewer';

  // Assigning only makes sense in shared lists (someone besides the owner); members also filter out
  // assignees who lost access before the task payload caught up
  const membersByList = useMemo(() => {
    const m = new Map<string, TaskListMember[]>();
    for (const tl of safeTaskLists) m.set(tl.id, tl.members || []);
    return m;
  }, [safeTaskLists]);
  const assignableMembers = (task: Thought): TaskListMember[] => {
    const members = (task.taskListId && membersByList.get(task.taskListId)) || [];
    return members.length > 1 ? members : [];
  };
  const memberToPerson = (m: TaskListMember): AvatarPerson => ({
    id: m.userId,
    name: m.displayName || m.email,
    avatarUrl: m.avatarUrl,
  });
  const getAssigneePeople = (task: Thought): AvatarPerson[] => {
    const members = assignableMembers(task);
    return (task.assignees || [])
      .map((id) => members.find((m) => m.userId === id))
      .filter((m): m is TaskListMember => !!m)
      .map(memberToPerson);
  };
  const renderAssignees = (task: Thought, size: 'xxs' | 'xs') => {
    const people = getAssigneePeople(task);
    if (people.length === 0) return null;
    return (
      <AvatarStack
        people={people}
        size={size}
        ringClass="ring-[var(--bg-panel)]"
        title={i18n.t('tasks:assignedTo', { names: people.map((p) => p.name).join(', ') })}
      />
    );
  };

  // Kanban columns (lib/kanbanColumns.ts): of the selected list, or the personal ones
  const activeColumns: KanbanColumn[] = useMemo(
    () => activeColumnsFor(currentSelectedList, globalColumns),
    [currentSelectedList, globalColumns]
  );

  // The columns of the list a task belongs to: in "Alle Aufgaben" every task keeps its own list's columns
  const columnsFor = useCallback(
    (task: Thought): KanbanColumn[] => columnsOfTask(task, safeTaskLists, activeColumns),
    [safeTaskLists, activeColumns]
  );

  // The column of its own list a task stands in
  const ownColumnOf = useCallback((task: Thought): KanbanColumn | undefined => ownColumnIn(task, columnsFor(task)), [columnsFor]);

  // Board columns: those of the chosen list; in "Alle Aufgaben" the columns of all lists joined by name
  const isCombinedBoard = selectedListId === 'all';
  const boardIdOf = useCallback((col: KanbanColumn) => boardIdOfColumn(col, isCombinedBoard), [isCombinedBoard]);
  const boardColumns: KanbanColumn[] = useMemo(
    () => (isCombinedBoard ? combinedBoardColumns(safeTaskLists, globalColumns) : activeColumns),
    [isCombinedBoard, activeColumns, safeTaskLists, globalColumns]
  );

  // The task's own column behind a board column, or null if its list has no column of that name
  const ownColumnIdFor = (task: Thought | undefined, boardColId: string): string | null =>
    task ? (columnsFor(task).find((c) => boardIdOf(c) === boardColId)?.id ?? null) : null;
  const inBoardColumn = useCallback(
    (task: Thought, boardCol: KanbanColumn) => {
      const own = ownColumnOf(task);
      return !!own && boardIdOf(own) === boardCol.id;
    },
    [ownColumnOf, boardIdOf]
  );

  // Kanban layout: column heights, rows on desktop, snapping on phones (useKanbanLayout)
  const isKanban = viewMode === 'kanban';
  const kanbanLayout = useKanbanLayout({
    isKanban,
    isCalendar: viewMode === 'calendar',
    columnCount: boardColumns.length,
    listId: selectedListId,
    loading,
  });
  const {
    kanbanBoardRef,
    kanbanPhoneSnap,
    kanbanPhoneTop,
  } = kanbanLayout;

  const safeTasks = useMemo(() => {
    if (!Array.isArray(tasks)) return [];
    const seen = new Set<string>();
    const unique: Thought[] = [];
    for (const t of tasks) {
      if (t && t.id && !seen.has(t.id)) {
        seen.add(t.id);
        unique.push(t);
      }
    }
    return unique;
  }, [tasks]);

  const detailTask = useMemo(() => {
    if (!detailTaskId) return null;
    return tasks.find((t) => t.id === detailTaskId) || (extraTask?.id === detailTaskId ? extraTask : null);
  }, [detailTaskId, tasks, extraTask]);

  const safeTeams = Array.isArray(teams) ? teams : [];
  const safeCollaborators = Array.isArray(collaborators) ? collaborators : [];

  // Available unique hashtags from current tasks
  const allAvailableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of safeTasks) {
      if (Array.isArray(t.tags)) {
        for (const tg of t.tags) {
          if (tg) set.add(tg);
        }
      }
    }
    return Array.from(set).sort();
  }, [safeTasks]);


  // Filtered tasks for List view
  const openTasks = safeTasks.filter((t) => !t.isCompleted);
  const doneTasks = safeTasks.filter((t) => t.isCompleted);

  const filteredTasks = useMemo(
    () => filterAndSortTasks(safeTasks, filter, selectedTag, sortBy),
    [safeTasks, filter, selectedTag, sortBy]
  );

  // Tasks for Kanban board (shows all non-discarded matching tag)
  const kanbanTasks = useMemo(() => tasksWithTag(safeTasks, selectedTag), [safeTasks, selectedTag]);

  // Grouped tasks calculation (taskListing.ts)
  const groupedTasks = useMemo(
    () => groupTasks(filteredTasks, groupBy, { lists: safeTaskLists, boardColumns, inBoardColumn, now: new Date() }),
    [filteredTasks, groupBy, boardColumns, inBoardColumn, safeTaskLists]
  );

  // --- TASK ACTIONS ---

  // Undo with Ctrl/Cmd+Z and the notice below (useTaskUndo)
  const { toast, pushUndo, orderSnapshot, showToast, undoLast } = useTaskUndo({ tasks, setTasks, selectedListId, loadData, onRefreshStats });

  // Task actions (useTaskActions)
  const {
    handleToggleDone,
    handleSetKanbanStatus,
    handleSetPriority,
    handleCyclePriority,
    handleUpdateTaskTitle,
    handleUpdateTaskDueDate,
    handleUpdateTaskTaskList,
    handleUpdateTaskNotes,
    handleUpdateTaskRecurrence,
    handleUpdateTaskReminders,
    handleUpdateTaskAssignees,
    handleUpdateTaskTags,
    handleToggleSubtask,
    handleAddSubtask,
    handleDeleteSubtask,
    handleRenameSubtask,
    handleReorderSubtasks,
    handleConvertToDoc,
    handleDeletePermanent,
    handleRestoreTrashed,
    handlePurgeTrashed,
    handleClearDone,
    handleEmptyTaskTrash,
  } = useTaskActions({
    columnsFor,
    currentSelectedList,
    doneTasks,
    isTaskReadOnly,
    loadData,
    onOpenDocument,
    onRefreshStats,
    pushUndo,
    selectedListId,
    setTasks,
    showToast,
  });

  // Creates the task from the phone sheet (MobileTaskCreateSheet); false keeps the sheet and its draft
  const handleMobileCreateTask = async (draft: MobileTaskDraft): Promise<boolean> => {
    triggerHaptic(12);

    try {
      const created = await api.captureThought(draft.title, draft.priority, 'manual', draft.dueDate || undefined, {
        target: 'task',
        taskListId: draft.listId || (selectedListId === 'all' ? '' : selectedListId),
      });
      setTasks((prev) => {
        if (prev.some((t) => t.id === created.id)) return prev;
        return [created, ...prev];
      });
      setShowMobileCreateModal(false);
      onRefreshStats();
      return true;
    } catch {
      loadData();
      return false;
    }
  };

  // Calendar: a task moved to another day (or out of the calendar with ''), undoable
  const handleMoveDue = (task: Thought, due: string) => {
    if ((task.dueDate || '') === due) return;
    triggerHaptic(12);
    pushUndo({ kind: 'due', id: task.id, dueDate: task.dueDate || '' });
    handleUpdateTaskDueDate(task, due).catch(() => loadData());
    showToast(due ? t('calendar.moved') : t('calendar.unscheduled'), true);
  };

  // "Add task" at the foot of a column: a draft "New task" in that column opens in the task
  // dialog with its title ready to be typed over. Closed without a title of its own, the draft goes again.
  const [draftTaskId, setDraftTaskId] = useState<string | null>(null);
  // Latest tasks for closing the dialog: "Save" in its unsaved-changes question renames the draft and closes
  // right after, before a render would bring the new title into this closure
  const tasksRef = useLatestRef(tasks);
  const handleQuickAddTaskToColumn = async (columnId: string) => {
    triggerHaptic(10);
    const targetCol = activeColumns.find((c) => boardIdOf(c) === columnId);
    if (!targetCol) return;
    columnId = targetCol.id;
    const isCompleted = !!targetCol.isDone;
    try {
      const created = await api.captureThought(newTaskTitle(), 'normal', 'manual', undefined, {
        target: 'task',
        taskListId: selectedListId === 'all' ? '' : selectedListId,
      });
      if (created && created.id) {
        const updated = await api.updateThought(created.id, { kanbanStatus: columnId, isCompleted });
        setTasks((prev) => [updated, ...prev.filter((t) => t.id !== updated.id)]);
        onRefreshStats();
        setDraftTaskId(updated.id);
        setDetailTaskId(updated.id);
        setShowDetailModal(true);
      }
    } catch {
      loadData();
    }
  };
  // The dialog closes: a draft that kept its placeholder title is removed for good (not left in the trash)
  const closeTaskDetail = () => {
    setShowDetailModal(false);
    setDetailTaskId(null);
    const draft = draftTaskId ? tasksRef.current.find((t) => t.id === draftTaskId) : undefined;
    setDraftTaskId(null);
    if (draft && draft.content === newTaskTitle()) {
      setTasks((prev) => prev.filter((t) => t.id !== draft.id));
      void api
        .deleteThought(draft.id)
        .then(() => api.purgeTrashedTask(draft.id))
        .catch(() => loadData())
        .finally(() => onRefreshStats());
    }
  };

  // Dragging tasks with mouse and finger (useTaskDrag)
  const taskDrag = useTaskDrag({
    tasks,
    setTasks,
    columnsFor,
    ownColumnIdFor,
    isTaskReadOnly,
    pushUndo,
    orderSnapshot,
    setSortBy,
    selectedListId,
    loadData,
    globalColumns,
    setTaskLists,
    onRefreshStats,
    viewMode,
    kanbanBoardRef,
    kanbanPhoneSnap,
    kanbanPhoneTop,
  });


  // The phone menu asks here; the tabs ask in a popover at the mouse first (TaskListTabs, confirmed)
  const handleDeleteTaskList = async (listId: string, confirmed = false) => {
    if (
      !confirmed &&
      !(await askConfirm({ message: i18n.t('tasks:view.confirmDeleteList'), confirmLabel: i18n.t('common:delete'), danger: true }))
    )
      return;
    try {
      await api.deleteTaskList(listId);
      setTaskLists((prev) => prev.filter((l) => l.id !== listId));
      // Plain switch: the deleted list's tasks belong to "Alle Aufgaben" anyway (and the menu effect keeps
      // this handler out of its dependencies)
      setSelectedListIdState('all');
    } catch (err) {
      showError(errorMessage(err));
    }
  };

  // Mute: no list-wide notifications from this shared list for me (assignments, mentions and watched
  // tasks still come)
  const handleToggleMute = async (tl: TaskList) => {
    const muted = !tl.isMuted;
    setTaskLists((prev) => prev.map((l) => (l.id === tl.id ? { ...l, isMuted: muted } : l)));
    try {
      await api.muteTaskList(tl.id, muted);
    } catch (err) {
      setTaskLists((prev) => prev.map((l) => (l.id === tl.id ? { ...l, isMuted: !muted } : l)));
      showError(errorMessage(err));
    }
  };

  const handleRenameTaskList = async (tl: TaskList, title: string, icon: string) => {
    const updated = await api.updateTaskList(tl.id, { title, icon });
    setTaskLists((prev) => prev.map((l) => (l.id === updated.id ? { ...l, title: updated.title, icon: updated.icon } : l)));
  };

  const handleOpenShareModal = async (tl: TaskList) => {
    setSharingTaskList(tl);
    setShowShareListModal(true);
    try {
      const [freshTeams, freshUsers, freshShares] = await Promise.all([
        api.getUserTeams().catch(() => []),
        api.getUsersDirectory ? api.getUsersDirectory().catch(() => api.getCollaborators().catch(() => [])) : api.getCollaborators().catch(() => []),
        api.getTaskListShares(tl.id).catch(() => []),
      ]);
      setTeams(freshTeams);
      setCollaborators(freshUsers);
      setSharingTaskList((prev) => (prev && prev.id === tl.id ? { ...prev, shares: freshShares } : prev));
    } catch {
      // ignore
    }
  };

  const handleSaveColumns = async (newColumns: KanbanColumn[]) => {
    triggerHaptic(15);
    if (currentSelectedList && selectedListId !== 'all') {
      const updated = await api.updateTaskList(currentSelectedList.id, { columns: newColumns });
      setTaskLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } else {
      localStorage.setItem('mindsift:kanban_columns', JSON.stringify(newColumns));
      setGlobalColumns(newColumns);
    }
  };

  // Phone menu: new task, filter, lists, views (tasksMenu.tsx)
  useEffect(() => {
    const menu = buildTasksMenu({
      currentSelectedList,
      defaultGroupBy,
      doneCount: doneTasks.length,
      filter,
      groupBy,
      handleDeleteTaskList,
      handleOpenShareModal,
      handleRenameList: setRenamingList,
      handleToggleMute,
      isSelectedListReadOnly,
      kanbanCount: kanbanTasks.length,
      openCount: openTasks.length,
      openTasksCount,
      selectedListId,
      selectedTag,
      setFilter,
      setMobileCreateListId,
      setSelectedListId,
      setShowFilterModal,
      setShowManageColumnsModal,
      setShowMobileCreateModal,
      setShowNewListModal,
      setViewMode,
      sortBy,
      trashCount: taskTrash.length,
      safeTaskLists,
      viewMode,
    });
    setPrimaryAction(menu.primaryAction);
    setGroups(menu.groups);
  }, [
    viewMode,
    filter,
    selectedListId,
    selectedTag,
    groupBy,
    defaultGroupBy,
    setViewMode,
    setSelectedListId,
    sortBy,
    openTasks.length,
    doneTasks.length,
    taskTrash.length,
    kanbanTasks.length,
    safeTaskLists,
    openTasksCount,
    currentSelectedList,
    isSelectedListReadOnly,
    setPrimaryAction,
    setGroups,
  ]);

  const renderTaskProgressBar = (task: Thought) => {
    if (!task.subtasks || task.subtasks.length === 0) return null;
    const total = task.subtasks.length;
    const done = task.subtasks.filter((s) => s.isCompleted).length;
    const percent = Math.round((done / total) * 100);

    return (
      <div
        className="space-y-0.5 mt-0.5 mb-0.5 select-none"
        title={t('view.subtasksTitle', { done, total, percent })}
      >
        <div className="flex items-center justify-between text-[9px] text-muted font-medium">
          <span className="flex items-center gap-1">
            <SquareCheckBig className="w-2.5 h-2.5 text-accent" />
            <span>
              {t('view.subtasks', { done, total })}
            </span>
          </span>
          <span className={percent === 100 ? 'text-status-ok font-bold' : 'text-muted'}>
            {percent}%
          </span>
        </div>
        <div className="w-full h-1 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              percent === 100 ? 'bg-status-ok' : 'bg-accent'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  };

  // Clean Task Row in List View
  // One row of the list view (TaskRow)
  // Stable functions for the rows (TaskRow is memoized): opening the task dialog, dragging or a change
  // to one task renders only the rows it touches. columnsFor changes with the lists, which renders all rows
  // again, so their columns and assignees follow.
  const openTaskDetail = useLatestCallback((taskId: string) => {
    setDetailTaskId(taskId);
    setShowDetailModal(true);
  });
  const rowDragStart = useLatestCallback(taskDrag.handleTaskDragStart);
  const rowDragEnd = useLatestCallback(() => {
    taskDrag.setDraggingTaskId(null);
    taskDrag.setDragOverTaskTarget(null);
    taskDrag.setDragOverKanbanCol(null);
    taskDrag.setDragOverListTab(null);
  });
  const rowDragOver = useLatestCallback(taskDrag.handleTaskDragOver);
  const rowDragLeave = useLatestCallback(taskDrag.handleTaskDragLeave);
  const rowDrop = useLatestCallback(taskDrag.handleDropOnTask);
  const rowConvertToDoc = useLatestCallback(handleConvertToDoc);
  const rowCyclePriority = useLatestCallback(handleCyclePriority);
  const rowDelete = useLatestCallback(handleDeletePermanent);
  const rowSetStatus = useLatestCallback(handleSetKanbanStatus);
  const rowToggleDone = useLatestCallback(handleToggleDone);
  const rowOpenDocument = useLatestCallback(onOpenDocument);
  const rowRenderAssignees = useLatestCallback(renderAssignees);
  const rowProgressBar = useLatestCallback(renderTaskProgressBar);

  // One row of the list view (TaskRow)
  const renderTaskRow = (task: Thought, compact = false) => {
    const target = taskDrag.dragOverTaskTarget;
    return (
      <TaskRow
        key={task.id}
        task={task}
        compact={compact}
        readOnly={isTaskReadOnly(task)}
        isDragging={taskDrag.draggingTaskId === task.id}
        dropPosition={target?.taskId === task.id ? target.position : null}
        onDragStart={rowDragStart}
        onDragEnd={rowDragEnd}
        onDragOver={rowDragOver}
        onDragLeave={rowDragLeave}
        onDrop={rowDrop}
        onOpen={openTaskDetail}
        columnsFor={columnsFor}
        handleConvertToDoc={rowConvertToDoc}
        handleCyclePriority={rowCyclePriority}
        handleDeletePermanent={rowDelete}
        handleSetKanbanStatus={rowSetStatus}
        handleToggleDone={rowToggleDone}
        onOpenDocument={rowOpenDocument}
        renderAssignees={rowRenderAssignees}
        renderTaskProgressBar={rowProgressBar}
        selectedTag={selectedTag}
        setSelectedTag={setSelectedTag}
      />
    );
  };

  return (
    // Phone Kanban: the page top is the first snap point (bar and first column)
    <div className={`w-full space-y-3 ${kanbanPhoneSnap ? 'snap-start' : ''}`}>
      <TaskListTabs
        drag={taskDrag}
        currentSelectedList={currentSelectedList}
        currentUser={currentUser}
        deleteTaskList={(listId) => handleDeleteTaskList(listId, true)}
        handleOpenShareModal={handleOpenShareModal}
        onRenameList={setRenamingList}
        onToggleMute={handleToggleMute}
        memberToPerson={memberToPerson}
        openTasksCount={openTasksCount}
        safeTaskLists={safeTaskLists}
        selectedListId={selectedListId}
        setSelectedListId={setSelectedListId}
        setShowNewListModal={setShowNewListModal}
        setViewMode={setViewMode}
        viewMode={chosenViewMode}
        tasks={tasks}
        onReorderLists={(ids) => {
          setTaskLists((prev) => inIdOrder(prev, ids));
          api.setTaskListOrder(ids).catch(() => void loadDataRef.current());
        }}
      />

      {/* Mobile Compact Context Bar (replaces cluttered button rows; options live in MindSift Logo Menu) */}
      {/* Same height with or without the 36 px share button (Tasks, Shopping lists) */}
      <div className="flex sm:hidden items-center justify-between gap-2 px-3 py-2 min-h-[54px] rounded-btn bg-panel border border-border !mt-0">
        <div className="flex items-center gap-2 min-w-0">
          <ListSwitcher
            label={currentSelectedList ? [currentSelectedList.icon, currentSelectedList.title].filter(Boolean).join(' ') : '📋 Alle Aufgaben'}
            items={[
              { id: 'all', title: t('allTasks'), icon: '📋', count: openTasksCount },
              ...safeTaskLists.map((tl) => ({ id: tl.id, title: tl.title, icon: tl.icon, count: tl.tasksCount })),
            ]}
            activeId={selectedListId}
            onSelect={setSelectedListId}
          />
          <span className="badge-neutral text-[11px] flex-shrink-0">
            {viewMode === 'kanban'
              ? 'Kanban'
              : viewMode === 'calendar'
              ? t('calendar.label')
              : filter === 'open'
              ? t('tabCount.open', { count: openTasks.length })
              : filter === 'done'
              ? t('tabCount.done', { count: doneTasks.length })
              : t('tabCount.trash', { count: taskTrash.length })}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <LivePill />
          {currentSelectedList && (
            <>
              <span className="w-px h-5 bg-border" aria-hidden />
              <button
                type="button"
                onClick={() => handleOpenShareModal(currentSelectedList)}
                className="btn-icon min-h-[36px] min-w-[36px] flex items-center justify-center"
                title={t('tabs.shareList')}
              >
                <Users className="w-4 h-4 text-accent" />
              </button>
            </>
          )}
        </div>
      </div>

      {isSelectedListReadOnly && (
        <div className="flex items-center gap-2 p-2.5 rounded-btn bg-panel-elevated border border-border text-xs text-muted">
          <Lock className="w-3.5 h-3.5 text-faint shrink-0" />
          <span>
            {t('view.readOnlyShared', { name: currentSelectedList?.ownerName || t('view.otherUser') })}
          </span>
        </div>
      )}

      {/* Quick Add Task Input (Desktop only - on mobile, tapping the bottom '+' FAB opens mobile create sheet) */}
      <QuickAddTaskBar
        hidden={isSelectedListReadOnly}
        currentSelectedList={currentSelectedList}
        selectedListId={selectedListId}
        setTasks={setTasks}
        onRefreshStats={onRefreshStats}
        loadData={loadData}
      />

      {/* Mobile Active Filter Badge Banner (minimal and clean) */}
      <ActiveFilterBanner
        selectedTag={selectedTag}
        setSelectedTag={setSelectedTag}
        groupBy={groupBy}
        defaultGroupBy={defaultGroupBy}
        setGroupBy={setGroupBy}
        sortBy={sortBy}
        setSortBy={setSortBy}
      />

      {/* Hashtag Filter & Grouping / Sorting Toolbar (Desktop only - on mobile accessible via Logo Menu Filter & Sort) */}
      <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 pt-1 pb-0.5">
        <TagFilterRow tags={allAvailableTags} tasks={safeTasks} selected={selectedTag} onSelect={setSelectedTag} />

        {/* Kanban: manage columns; calendar: month or week (the list view has grouping and sorting above the
            list) */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {viewMode === 'calendar' && <CalendarModeSwitch mode={calendarMode} onChange={setCalendarMode} />}
          {viewMode === 'kanban' && !isSelectedListReadOnly && (
            <button
              onClick={() => setShowManageColumnsModal(true)}
              className="tool-btn"
              title={t('view.columnsTitle')}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>{t('view.columns')}</span>
            </button>
          )}
        </div>
      </div>

      {/* MOBILE CREATE TASK BOTTOM SHEET MODAL */}
      <MobileTaskCreateSheet
        open={showMobileCreateModal}
        onClose={() => setShowMobileCreateModal(false)}
        lists={safeTaskLists}
        listId={mobileCreateListId}
        onListIdChange={setMobileCreateListId}
        onCreate={handleMobileCreateTask}
      />

      {/* MOBILE FILTER & SORT MODAL */}
      <TasksFilterSheet
        allAvailableTags={allAvailableTags}
        defaultGroupBy={defaultGroupBy}
        groupBy={groupBy}
        groupOptions={groupOptions}
        safeTasks={safeTasks}
        selectedTag={selectedTag}
        setGroupBy={setGroupBy}
        setSelectedTag={setSelectedTag}
        setShowFilterModal={setShowFilterModal}
        setSortBy={setSortBy}
        sortBy={sortBy}
        viewMode={viewMode}
        showFilterModal={showFilterModal}
      />

      {/* NEW LIST MODAL */}
      <NewTaskListSheet
        showNewListModal={showNewListModal}
        setShowNewListModal={setShowNewListModal}
        setTaskLists={setTaskLists}
        setSelectedListId={setSelectedListId}
      />

      {renamingList && (
        <RenameListSheet
          initialTitle={renamingList.title}
          initialIcon={renamingList.icon}
          onSave={(title, icon) => handleRenameTaskList(renamingList, title, icon)}
          onClose={() => setRenamingList(null)}
        />
      )}

      {/* Short notice after deleting or undoing (same look as in the workspace) */}
      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 z-50 max-w-[calc(100vw-1.5rem)] px-3 py-2 rounded-card text-xs text-main bg-panel-elevated border border-border shadow-panel flex items-center gap-3"
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => void undoLast()}
              className="font-semibold text-accent hover:underline min-h-[44px] sm:min-h-0 shrink-0"
              title={t('view.undoTitle')}
            >
              {t('triage:undo')}
            </button>
          )}
        </div>
      )}

      {/* UNIFIED SHARE LIST MODAL */}
      <TaskListShareDialog
        showShareListModal={showShareListModal}
        setShowShareListModal={setShowShareListModal}
        sharingTaskList={sharingTaskList}
        setSharingTaskList={setSharingTaskList}
        currentUser={currentUser}
        safeTeams={safeTeams}
        safeCollaborators={safeCollaborators}
        setTaskLists={setTaskLists}
        loadData={loadData}
      />

      {/* MANAGE COLUMNS MODAL */}
      <ManageColumnsModal
        isOpen={showManageColumnsModal}
        onClose={() => setShowManageColumnsModal(false)}
        initialColumns={activeColumns}
        onSave={handleSaveColumns}
        listTitle={currentSelectedList?.title || t('allTasks')}
      />

      {/* TASK DETAIL MODAL */}
      <TaskDetailModal
        task={detailTask}
        isOpen={showDetailModal}
        onClose={closeTaskDetail}
        editTitleOnOpen={!!detailTask && detailTask.id === draftTaskId}
        activeColumns={detailTask ? columnsFor(detailTask) : activeColumns}
        taskLists={safeTaskLists}
        onOpenDocument={onOpenDocument}
        onUpdateTitle={handleUpdateTaskTitle}
        onUpdateStatus={handleSetKanbanStatus}
        onUpdatePriority={handleSetPriority}
        onUpdateDueDate={handleUpdateTaskDueDate}
        onUpdateRecurrence={handleUpdateTaskRecurrence}
        onUpdateReminders={handleUpdateTaskReminders}
        leadMinutes={currentUser?.notifyBeforeMinutes ?? 30}
        onUpdateTaskList={handleUpdateTaskTaskList}
        onUpdateNotes={handleUpdateTaskNotes}
        onUpdateTags={handleUpdateTaskTags}
        assignableMembers={detailTask ? assignableMembers(detailTask) : []}
        onUpdateAssignees={handleUpdateTaskAssignees}
        onToggleSubtask={handleToggleSubtask}
        onAddSubtask={handleAddSubtask}
        onDeleteSubtask={handleDeleteSubtask}
        onRenameSubtask={handleRenameSubtask}
        onReorderSubtasks={handleReorderSubtasks}
        onConvertToDoc={handleConvertToDoc}
        onDeleteTask={handleDeletePermanent}
        readOnly={detailTask ? isTaskReadOnly(detailTask) : false}
        onTaskChange={(taskId, changes) => setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...changes } : t)))}
      />

      {/* VIEW MODES: LIST, KANBAN OR CALENDAR */}
      {viewMode === 'calendar' ? (
        <TaskCalendar
          tasks={kanbanTasks}
          lists={safeTaskLists}
          showListIcon={selectedListId === 'all'}
          isTaskReadOnly={isTaskReadOnly}
          onOpenTask={(task) => {
            setDetailTaskId(task.id);
            setShowDetailModal(true);
          }}
          onMoveDue={handleMoveDue}
          onCreateForDay={
            isSelectedListReadOnly
              ? null
              : (day, title) =>
                  handleMobileCreateTask({ title, priority: 'normal', dueDate: day, listId: selectedListId === 'all' ? '' : selectedListId })
          }
          renderTaskRow={renderTaskRow}
          mode={calendarMode}
          boardRef={kanbanBoardRef}
          fillsScreen={kanbanLayout.kanbanMultiRow}
        />
      ) : viewMode === 'kanban' ? (
        /* DYNAMIC KANBAN BOARD */
        <KanbanBoard
          drag={taskDrag}
          layout={kanbanLayout}
          activeColumns={activeColumns}
          boardColumns={boardColumns}
          boardIdOf={boardIdOf}
          columnsFor={columnsFor}
          getAssigneePeople={getAssigneePeople}
          handleConvertToDoc={handleConvertToDoc}
          handleCyclePriority={handleCyclePriority}
          handleDeletePermanent={handleDeletePermanent}
          handleQuickAddTaskToColumn={handleQuickAddTaskToColumn}
          handleSetKanbanStatus={handleSetKanbanStatus}
          inBoardColumn={inBoardColumn}
          isSelectedListReadOnly={isSelectedListReadOnly}
          isTaskReadOnly={isTaskReadOnly}
          kanbanTasks={kanbanTasks}
          ownColumnIdFor={ownColumnIdFor}
          ownColumnOf={ownColumnOf}
          renderAssignees={renderAssignees}
          renderTaskProgressBar={renderTaskProgressBar}
          safeTaskLists={safeTaskLists}
          selectedTag={selectedTag}
          setDetailTaskId={setDetailTaskId}
          setSelectedTag={setSelectedTag}
          setShowDetailModal={setShowDetailModal}
          tasks={tasks}
          onOpenDocument={onOpenDocument}
        />
      ) : (
        <TaskListView
          doneTasks={doneTasks}
          filter={filter}
          filteredTasks={filteredTasks}
          groupBy={groupBy}
          groupOptions={groupOptions}
          groupedTasks={groupedTasks}
          handleClearDone={handleClearDone}
          handleEmptyTaskTrash={handleEmptyTaskTrash}
          handlePurgeTrashed={handlePurgeTrashed}
          handleRestoreTrashed={handleRestoreTrashed}
          isSelectedListReadOnly={isSelectedListReadOnly}
          loading={loading}
          openTasks={openTasks}
          renderTaskRow={renderTaskRow}
          safeTaskLists={safeTaskLists}
          selectedListId={selectedListId}
          selectedTag={selectedTag}
          setFilter={setFilter}
          setGroupBy={setGroupBy}
          setSortBy={setSortBy}
          sortBy={sortBy}
          taskTrash={taskTrash}
        />
      )}
    </div>
  );
};
