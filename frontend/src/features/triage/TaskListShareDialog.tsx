import React from 'react';
import { api } from '../../lib/api';
import { TaskList, Team, User } from '../../lib/types';
import { UnifiedShareModal } from '../../components/UnifiedShareModal';
import i18n from '../../i18n';

interface TaskListShareDialogProps {
  showShareListModal: boolean;
  setShowShareListModal: (show: boolean) => void;
  sharingTaskList: TaskList | null;
  setSharingTaskList: (tl: TaskList | null) => void;
  currentUser: User | null | undefined;
  safeTeams: Team[];
  safeCollaborators: User[];
  setTaskLists: React.Dispatch<React.SetStateAction<TaskList[]>>;
  loadData: () => Promise<void>;
}

// Sharing a task list (people and groups, edit or read only); TasksView opens it via handleOpenShareModal
export function TaskListShareDialog({
  showShareListModal,
  setShowShareListModal,
  sharingTaskList,
  setSharingTaskList,
  currentUser,
  safeTeams,
  safeCollaborators,
  setTaskLists,
  loadData,
}: TaskListShareDialogProps) {
  if (!showShareListModal || !sharingTaskList) return null;
  return (
    <UnifiedShareModal
      isOpen={showShareListModal}
      onClose={() => {
        setShowShareListModal(false);
        setSharingTaskList(null);
      }}
      title={i18n.t('tasks:shareDialogTitle', { title: sharingTaskList.title })}
      resourceName={sharingTaskList.title}
      resourceIcon={sharingTaskList.icon || undefined}
      isOwner={sharingTaskList.isOwner !== false}
      currentUserId={currentUser?.id}
      shares={(sharingTaskList.shares || []).map((sh) => ({
        id: sh.id,
        targetType: sh.targetType,
        targetId: sh.targetId,
        targetName: sh.targetName || (sh.targetType === 'team' ? i18n.t('common:share.group') : sh.email || i18n.t('common:share.user')),
        targetEmail: sh.email,
        avatarUrl: sh.avatarUrl,
        permission: sh.permission === 'viewer' ? 'viewer' as const : 'editor' as const,
        role: sh.permission === 'viewer' ? 'viewer' : 'editor',
        createdAt: sh.createdAt,
      }))}
      teams={safeTeams}
      collaborators={safeCollaborators}
      onAddShare={async (targetType, targetId, permission) => {
        await api.addTaskListShare(sharingTaskList.id, {
          targetType,
          targetId,
          permission,
        });
        const [freshLists, freshShares] = await Promise.all([
          api.getTaskLists(),
          api.getTaskListShares(sharingTaskList.id).catch(() => []),
        ]);
        setTaskLists(freshLists);
        const updated = freshLists.find((l) => l.id === sharingTaskList.id);
        if (updated) {
          setSharingTaskList({ ...updated, shares: freshShares });
        }
        await loadData();
      }}
      onRemoveShare={async (shareId) => {
        await api.removeTaskListShare(sharingTaskList.id, shareId);
        const [freshLists, freshShares] = await Promise.all([
          api.getTaskLists(),
          api.getTaskListShares(sharingTaskList.id).catch(() => []),
        ]);
        setTaskLists(freshLists);
        const updated = freshLists.find((l) => l.id === sharingTaskList.id);
        if (updated) {
          setSharingTaskList({ ...updated, shares: freshShares });
        }
        await loadData();
      }}
    />
  );
}
