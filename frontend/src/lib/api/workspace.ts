// REST calls: Notes, folders, shared folders, tags, journal, push devices and note sharing
import {
  Document,
  TrashedDocument,
  JournalDay,
  PushDevice,
  Backlink,
  DocumentBlock,
  DocShare,
  SharedFolder,
  FolderShare,
  Thought,
  TagDetails,
  TagSummary,
  User,
  MergeResult,
  MoveResult,
  PublicLinkState,
} from '../types';
import { ensureArray, request } from './client';

export const workspaceApi = {
  // --- WORKSPACE FOLDERS ---
  async getFolders(): Promise<string[]> {
    const res = await request<string[]>('/api/v1/folders');
    return ensureArray(res);
  },

  async createFolder(path: string): Promise<{ path: string }> {
    return request<{ path: string }>('/api/v1/folders', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  async deleteFolder(path: string): Promise<{ deleted: boolean; deletedDocIds: string[] }> {
    return request<{ deleted: boolean; deletedDocIds: string[] }>(
      `/api/v1/folders?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    );
  },

  async moveFolder(sourcePath: string, targetParentPath: string): Promise<{ newPath: string; movedDocIds: string[] }> {
    return request<{ newPath: string; movedDocIds: string[] }>('/api/v1/folders/move', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, targetParentPath }),
    });
  },

  // --- WORKSPACE SHARED FOLDERS ---
  async getSharedFolders(): Promise<SharedFolder[]> {
    const res = await request<SharedFolder[]>('/api/v1/workspace/folders/shared');
    return ensureArray(res);
  },

  async createSharedFolder(payload: { name: string; mountPath?: string }): Promise<SharedFolder> {
    return request<SharedFolder>('/api/v1/workspace/folders/shared', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getSharedFolder(id: string): Promise<SharedFolder> {
    return request<SharedFolder>(`/api/v1/workspace/folders/shared/${id}`);
  },

  async deleteSharedFolder(id: string): Promise<void> {
    await request(`/api/v1/workspace/folders/shared/${id}`, { method: 'DELETE' });
  },

  async updateFolderMount(id: string, mountPath: string): Promise<void> {
    await request(`/api/v1/workspace/folders/shared/${id}/mount`, {
      method: 'PUT',
      body: JSON.stringify({ mountPath }),
    });
  },

  async getFolderShares(folderId: string): Promise<FolderShare[]> {
    const res = await request<FolderShare[]>(`/api/v1/workspace/folders/shared/${folderId}/shares`);
    return ensureArray(res);
  },

  async createFolderShare(
    folderId: string,
    payload: { targetType?: 'team' | 'user'; targetId?: string; userId?: string; email?: string; teamId?: string; permission: 'read' | 'write' }
  ): Promise<FolderShare> {
    return request<FolderShare>(`/api/v1/workspace/folders/shared/${folderId}/shares`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteFolderShare(folderId: string, shareId: string): Promise<void> {
    await request(`/api/v1/workspace/folders/shared/${folderId}/shares/${shareId}`, { method: 'DELETE' });
  },

  // --- WORKSPACE TAGS ---
  async getWorkspaceTags(): Promise<TagSummary[]> {
    const res = await request<TagSummary[]>('/api/v1/workspace/tags');
    return ensureArray(res);
  },

  async getTagDetails(tag: string): Promise<TagDetails> {
    const clean = encodeURIComponent(tag.replace(/^#/, ''));
    const res = await request<TagDetails>(`/api/v1/workspace/tags/${clean}`);
    return {
      ...res,
      documents: ensureArray(res.documents).map((doc) => ({
        ...doc,
        matchedBlocks: ensureArray(doc.matchedBlocks).map((mb) => ({
          rootBlock: mb.rootBlock,
          children: ensureArray(mb.children),
        })),
      })),
    };
  },

  async updateTagPageNote(
    tag: string,
    content: string
  ): Promise<{ tag: string; content: string; updatedAt: string }> {
    const clean = encodeURIComponent(tag.replace(/^#/, ''));
    return request<{ tag: string; content: string; updatedAt: string }>(
      `/api/v1/workspace/tags/${clean}/note`,
      {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }
    );
  },

  // --- WORKSPACE DOCUMENTS ---
  async getDocuments(): Promise<Document[]> {
    const res = await request<Document[]>('/api/v1/documents');
    return ensureArray(res).map((d) => ({
      ...d,
      blocks: ensureArray(d.blocks),
      tags: ensureArray(d.tags),
    }));
  },

  async getDocument(id: string): Promise<Document> {
    const d = await request<Document>(`/api/v1/documents/${id}`);
    return {
      ...d,
      blocks: ensureArray(d.blocks),
      tags: ensureArray(d.tags),
    };
  },

  async createDocument(payload: {
    title: string;
    icon?: string;
    folderPath?: string;
    blocks?: DocumentBlock[];
    tags?: string[];
    isPinned?: boolean;
  }): Promise<Document> {
    const d = await request<Document>('/api/v1/documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      ...d,
      blocks: ensureArray(d.blocks),
      tags: ensureArray(d.tags),
    };
  },

  async updateDocument(
    id: string,
    patch: {
      title?: string;
      icon?: string;
      folderPath?: string;
      isPinned?: boolean;
    }
  ): Promise<Document> {
    // Block content is saved through the note sync engine (lib/docSync), not here
    const d = await request<Document>(`/api/v1/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    return {
      ...d,
      blocks: ensureArray(d.blocks),
      tags: ensureArray(d.tags),
    };
  },

  async joinSSERoom(sseId: string, room: string, action: 'join' | 'leave' = 'join'): Promise<{ success: boolean }> {
    return request<{ success: boolean }>('/api/v1/events/rooms', {
      method: 'POST',
      body: JSON.stringify({ sseId, room, action }),
    });
  },

  /** Moves the note to the trash (owner) or leaves a shared note (others). */
  async deleteDocument(id: string): Promise<void> {
    await request(`/api/v1/documents/${id}`, { method: 'DELETE' });
  },

  // --- HIDDEN VALUES ({{secret:id}} in a bullet; only a login can reveal them) ---
  async createSecret(docId: string, value: string): Promise<{ id: string; ref: string }> {
    return request(`/api/v1/documents/${docId}/secrets`, { method: 'POST', body: JSON.stringify({ value }) });
  },

  async revealSecret(docId: string, secretId: string): Promise<string> {
    const res = await request<{ value: string }>(`/api/v1/documents/${docId}/secrets/${secretId}`);
    return res.value;
  },

  async updateSecret(docId: string, secretId: string, value: string): Promise<void> {
    await request(`/api/v1/documents/${docId}/secrets/${secretId}`, { method: 'PUT', body: JSON.stringify({ value }) });
  },

  async getBacklinks(id: string): Promise<Backlink[]> {
    return request<Backlink[]>(`/api/v1/documents/${id}/backlinks`);
  },

  async getTrash(): Promise<TrashedDocument[]> {
    return request<TrashedDocument[]>('/api/v1/documents/trash');
  },

  async getPushKey(): Promise<{ enabled: boolean; publicKey?: string }> {
    return request('/api/v1/push/key');
  },

  async getPushDevices(): Promise<PushDevice[]> {
    const res = await request<{ devices: PushDevice[] }>('/api/v1/push/devices');
    return res.devices || [];
  },

  async subscribePush(sub: PushSubscriptionJSON, device: string, replaces?: string): Promise<void> {
    await request('/api/v1/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub, device, replaces: replaces || '' }) });
  },

  async unsubscribePush(endpoint: string): Promise<void> {
    await request('/api/v1/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
  },

  async testPush(): Promise<{ devices: number }> {
    return request('/api/v1/push/test', { method: 'POST' });
  },

  /** Days of the own journal (newest first) with their notes. */
  async getJournal(): Promise<JournalDay[]> {
    const res = await request<{ days: JournalDay[] }>('/api/v1/journal');
    return res.days || [];
  },

  /** The note of a journal day (YYYY-MM-DD); created on first use. */
  async openJournalDay(date: string): Promise<Document> {
    return request<Document>(`/api/v1/journal/${date}`, { method: 'POST' });
  },

  /** Creates a note from a bullet's children; the editor then replaces the branch by `link` itself. */
  async extractBranch(docId: string, blockId: string, clientId: string): Promise<{ document: Document; link: string }> {
    return request<{ document: Document; link: string }>(`/api/v1/documents/${docId}/extract`, {
      method: 'POST',
      body: JSON.stringify({ blockId, clientId }),
    });
  },

  /** The way back from extractBranch: the linked note's blocks for the bullet; the note goes to the trash. */
  async inlineNote(docId: string, blockId: string): Promise<{ sourceId: string; content: string; blocks: DocumentBlock[] }> {
    return request(`/api/v1/documents/${docId}/inline`, { method: 'POST', body: JSON.stringify({ blockId }) });
  },

  /** Copies a bullet with its children to the end of another note; the editor then removes it here itself. */
  async moveBranch(docId: string, blockId: string, targetId: string, clientId: string): Promise<MoveResult> {
    return request<MoveResult>(`/api/v1/documents/${docId}/move`, {
      method: 'POST',
      body: JSON.stringify({ blockId, targetId, clientId }),
    });
  },

  /** Takes a moved branch out of the target note again (the editor brings it back here by its own undo). */
  async undoMove(docId: string, moved: MoveResult, clientId: string): Promise<void> {
    await request(`/api/v1/documents/${docId}/move/undo`, { method: 'POST', body: JSON.stringify({ ...moved, clientId }) });
  },

  /** Puts a note created by extractBranch into the trash again. */
  async undoExtract(newDocId: string): Promise<void> {
    await request(`/api/v1/documents/${newDocId}/extract/undo`, { method: 'POST' });
  },

  /** Appends the source note to the target; the source goes to the trash. */
  async mergeDocuments(targetId: string, sourceId: string): Promise<MergeResult> {
    return request<MergeResult>(`/api/v1/documents/${targetId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
    });
  },

  async undoMerge(m: MergeResult): Promise<void> {
    await request(`/api/v1/documents/${m.targetId}/merge/undo`, {
      method: 'POST',
      body: JSON.stringify({ sourceId: m.sourceId, headingId: m.headingId }),
    });
  },

  async restoreDocument(id: string): Promise<void> {
    await request(`/api/v1/documents/${id}/restore`, { method: 'POST' });
  },

  async purgeDocument(id: string): Promise<void> {
    await request(`/api/v1/documents/${id}/permanent`, { method: 'DELETE' });
  },

  async restoreFolder(trashId: string): Promise<void> {
    await request(`/api/v1/folders/trash/${trashId}/restore`, { method: 'POST' });
  },

  async purgeFolder(trashId: string): Promise<void> {
    await request(`/api/v1/folders/trash/${trashId}`, { method: 'DELETE' });
  },

  async emptyTrash(): Promise<{ deleted: number }> {
    return request<{ deleted: number }>('/api/v1/documents/trash', { method: 'DELETE' });
  },

  async moveDocument(id: string, folderPath: string): Promise<Document> {
    const d = await request<Document>(`/api/v1/documents/${id}/move`, {
      method: 'PUT',
      body: JSON.stringify({ folderPath }),
    });
    return {
      ...d,
      blocks: ensureArray(d.blocks),
      tags: ensureArray(d.tags),
    };
  },

  async createEnhancedTask(
    docId: string,
    blockId: string,
    payload: { content: string; checked: boolean }
  ): Promise<Thought> {
    return request<Thought>(`/api/v1/documents/${docId}/blocks/${blockId}/enhanced-task`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async unlinkEnhancedTask(taskId: string): Promise<{ unlinked: boolean }> {
    return request<{ unlinked: boolean }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/unlink`, {
      method: 'POST',
    });
  },

  // --- PUBLIC LINK (owner only; the visitor side is lib/publicNote.ts) ---
  async getPublicLink(docId: string): Promise<PublicLinkState> {
    return request<PublicLinkState>(`/api/v1/documents/${encodeURIComponent(docId)}/public-link`);
  },

  // A new link (the previous address stops working): duration in hours, optional password
  async setPublicLink(docId: string, hours: number, password: string): Promise<PublicLinkState> {
    return request<PublicLinkState>(`/api/v1/documents/${encodeURIComponent(docId)}/public-link`, {
      method: 'PUT',
      body: JSON.stringify({ hours, password }),
    });
  },

  async deletePublicLink(docId: string): Promise<PublicLinkState> {
    return request<PublicLinkState>(`/api/v1/documents/${encodeURIComponent(docId)}/public-link`, { method: 'DELETE' });
  },

  // --- DOCUMENT SHARING ---
  async getDocShares(docId: string): Promise<DocShare[]> {
    const res = await request<DocShare[]>(`/api/v1/documents/${docId}/shares`);
    return ensureArray(res);
  },

  async createDocShare(
    docId: string,
    payload: { userId?: string; email?: string; teamId?: string; permission: 'read' | 'write' }
  ): Promise<DocShare> {
    return request<DocShare>(`/api/v1/documents/${docId}/shares`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteDocShare(docId: string, userId: string): Promise<void> {
    await request(`/api/v1/documents/${docId}/shares/${userId}`, { method: 'DELETE' });
  },

  async getCollaborators(): Promise<User[]> {
    const res = await request<User[]>('/api/v1/collaborators');
    return ensureArray(res);
  },
};
