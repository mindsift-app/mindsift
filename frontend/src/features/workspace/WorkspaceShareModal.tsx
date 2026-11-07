import { useCallback, useMemo, useState } from 'react';
import { DocShare, Document, SharedFolder, Team, UnifiedShare, User } from '../../lib/types';
import { api } from '../../lib/api';
import { UnifiedShareModal } from '../../components/UnifiedShareModal';
import { PublicLinkSection } from './PublicLinkSection';
import i18n from '../../i18n';

// Sharing dialog of the workspace: the note or shared folder being shared, its shares, and the teams and
// people that can be added
export function useShareModal() {
  const [shareModalDoc, setShareModalDoc] = useState<Document | null>(null);
  const [shareModalFolder, setShareModalFolder] = useState<SharedFolder | null>(null);
  const [activeDocShares, setActiveDocShares] = useState<DocShare[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [collaborators, setCollaborators] = useState<User[]>([]);

  const openDocShareModal = useCallback(async (doc: Document) => {
    setShareModalDoc(doc);
    setShareModalFolder(null);
    try {
      const [sharesRes, teamsRes, collabRes] = await Promise.all([
        api.getDocShares(doc.id).catch(() => []),
        api.getUserTeams().catch(() => []),
        api.getUsersDirectory().catch(() => []),
      ]);
      setActiveDocShares(sharesRes);
      setTeams(teamsRes);
      setCollaborators(collabRes);
    } catch {
      // ignore
    }
  }, []);

  const openFolderShareModal = useCallback(async (sf: SharedFolder) => {
    setShareModalFolder(sf);
    setShareModalDoc(null);
    try {
      const [teamsRes, collabRes, freshSf] = await Promise.all([
        api.getUserTeams().catch(() => []),
        api.getUsersDirectory().catch(() => []),
        api.getSharedFolder(sf.id).catch(() => sf),
      ]);
      setShareModalFolder(freshSf);
      setTeams(teamsRes);
      setCollaborators(collabRes);
    } catch {
      // ignore
    }
  }, []);

  const unifiedShares: UnifiedShare[] = useMemo(() => {
    if (shareModalDoc) {
      return activeDocShares.map((s) => ({
        id: s.userId || s.teamId || s.id,
        targetType: s.targetType || (s.teamId ? 'team' : 'user'),
        targetId: s.targetId || s.teamId || s.userId || '',
        targetName: s.targetName || s.displayName || s.userEmail || i18n.t('common:role.member'),
        targetEmail: s.userEmail,
        permission: s.permission === 'write' ? 'editor' : 'viewer',
        createdAt: s.createdAt,
      }));
    }
    if (shareModalFolder) {
      return (shareModalFolder.shares || []).map((s) => ({
        id: s.id,
        targetType: s.targetType,
        targetId: s.targetId,
        targetName: s.targetName || s.email || i18n.t('common:role.member'),
        targetEmail: s.email,
        permission: s.permission === 'write' ? 'editor' : 'viewer',
        createdAt: s.createdAt,
      }));
    }
    return [];
  }, [activeDocShares, shareModalDoc, shareModalFolder]);

  return {
    shareModalDoc,
    setShareModalDoc,
    shareModalFolder,
    setShareModalFolder,
    setActiveDocShares,
    teams,
    collaborators,
    unifiedShares,
    openDocShareModal,
    openFolderShareModal,
  };
}

export function WorkspaceShareModal({
  share,
  currentUser,
  onFolderChanged,
}: {
  share: ReturnType<typeof useShareModal>;
  currentUser?: User | null;
  // A share of the folder was added or removed, so the folder tree can show whether it is shared
  onFolderChanged?: (sf: SharedFolder) => void;
}) {
  const { shareModalDoc, setShareModalDoc, shareModalFolder, setShareModalFolder, setActiveDocShares, teams, collaborators, unifiedShares } = share;
  if (!shareModalDoc && !shareModalFolder) return null;
  const isOwner = shareModalDoc
    ? Boolean(shareModalDoc.isOwner || shareModalDoc.permission === 'owner')
    : Boolean(shareModalFolder?.isOwner);
  // The owner, named to everyone else (the picture comes from the people directory, where they are)
  const ownerId = shareModalDoc ? shareModalDoc.userId : shareModalFolder?.ownerId;
  const ownerName = shareModalDoc ? shareModalDoc.ownerName : shareModalFolder?.ownerName;
  const ownerEntry = collaborators.find((c) => c.id === ownerId);
  return (
    <UnifiedShareModal
      isOpen={true}
      onClose={() => {
        setShareModalDoc(null);
        setShareModalFolder(null);
      }}
      resourceName={shareModalDoc ? shareModalDoc.title : shareModalFolder?.name || ''}
      resourceIcon={shareModalDoc ? shareModalDoc.icon : '📁'}
      isOwner={isOwner}
      sharedBy={{ id: ownerId, name: ownerName || ownerEntry?.displayName, avatarUrl: ownerEntry?.avatarUrl }}
      extraSection={shareModalDoc && isOwner ? <PublicLinkSection docId={shareModalDoc.id} /> : undefined}
      currentUserId={currentUser?.id}
      shares={unifiedShares}
      teams={teams}
      collaborators={collaborators}
      onAddShare={async (targetType, targetId, role) => {
        const permission = role === 'editor' ? 'write' : 'read';
        if (shareModalDoc) {
          await api.createDocShare(
            shareModalDoc.id,
            targetType === 'team' ? { teamId: targetId, permission } : { userId: targetId, permission }
          );
          const updatedShares = await api.getDocShares(shareModalDoc.id);
          setActiveDocShares(updatedShares);
        } else if (shareModalFolder) {
          await api.createFolderShare(shareModalFolder.id, {
            targetType,
            targetId,
            permission,
          });
          const updatedFolder = await api.getSharedFolder(shareModalFolder.id);
          setShareModalFolder(updatedFolder);
          onFolderChanged?.(updatedFolder);
        }
      }}
      onRemoveShare={async (shareId) => {
        if (shareModalDoc) {
          await api.deleteDocShare(shareModalDoc.id, shareId);
          const updatedShares = await api.getDocShares(shareModalDoc.id);
          setActiveDocShares(updatedShares);
        } else if (shareModalFolder) {
          await api.deleteFolderShare(shareModalFolder.id, shareId);
          const updatedFolder = await api.getSharedFolder(shareModalFolder.id);
          setShareModalFolder(updatedFolder);
          onFolderChanged?.(updatedFolder);
        }
      }}
    />
  );
}
