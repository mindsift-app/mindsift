// Notes: blocks, notes and folders, shares, backlinks, the journal, tags, search, the note trash, public links, the calendar feed.

import type { ListItem } from './lists';
import type { Thought } from './tasks';

export type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'text' | 'todo' | 'bullet' | 'numbered' | 'code' | 'callout' | 'warning' | 'error' | 'divider' | 'table' | 'progress' | 'image' | 'audio' | 'drawing';

export interface DocumentBlock {
  id: string;
  docId?: string;
  documentId?: string;
  taskId?: string;
  // Checkbox tied to a subtask of this task (the task itself is linked to another checkbox)
  subtaskOf?: string;
  type: BlockType;
  content: string;
  checked?: boolean;
  lang?: string;
  level?: number;
  position?: number;
  collapsed?: boolean;
  sortOrder?: number;
  updatedAt?: string;
  conflictOf?: string; // set on conflict copies: ID of the contested block, or 'title'
  conflictAuthor?: string;
}

/** A to-do with text of a note (GET /documents/todos). */
export interface DocTodo {
  docId: string;
  blockId: string;
  content: string;
  checked: boolean;
}

/** One bullet looked up by its id (GET /blocks/{id}), e.g. for a link to it. */
export interface BlockInfo {
  documentId: string;
  content: string;
  type: BlockType;
}

export interface DocShare {
  id: string;
  docId: string;
  targetType?: 'user' | 'team';
  targetId?: string;
  targetName?: string;
  teamId?: string;
  userId?: string;
  userEmail?: string;
  displayName?: string;
  permission: 'read' | 'write';
  createdBy: string;
  createdAt: string;
}

/** A note linking to the current one via [[Title]] (GET /documents/{id}/backlinks). */
export interface Backlink {
  docId: string;
  title: string;
  icon: string;
  folderPath: string;
  blocks: { id: string; content: string }[];
  more?: number;
}

/** A note in the trash (GET /documents/trash). */
/** A day of the own journal; `empty` while its note has no text yet. */
export interface JournalDay {
  date: string; // YYYY-MM-DD
  docId: string;
  empty: boolean;
}

// A note in the trash, or a deleted folder (kind "folder": id of the trashed folder, title its name,
// folderPath where it was, noteCount the notes it holds)
export interface TrashedDocument {
  id: string;
  kind?: 'note' | 'folder';
  title: string;
  icon: string;
  folderPath: string;
  deletedAt: string;
  isOwner: boolean;
  noteCount?: number;
}

export interface Document {
  id: string;
  userId: string;
  spaceId?: string;
  title: string;
  icon: string;
  folderId?: string;
  markdownCache?: string;
  // The note list (GET /documents) leaves both empty; the note itself (GET /documents/{id}) has them
  content: string;
  blocks: DocumentBlock[];
  tags: string[];
  folderPath?: string;
  isPinned: boolean;
  /** The person uses the note as one of their templates (personal, like the pin) */
  isTemplate?: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;

  // What the note list reports of the bullets instead (workspaceListing.ts noteStats)
  // Open to-dos with text
  openTodos?: number;
  // Hashtag (lower case) → number of bullets carrying it
  tagCounts?: Record<string, number>;
  // Hashtag (lower case) → number of open to-dos among the bullets carrying it
  tagOpenTodos?: Record<string, number>;

  // Collaboration & Permissions
  permission?: 'owner' | 'write' | 'read';
  isOwner?: boolean;
  ownerName?: string;
  sharedWith?: DocShare[];
  // The note has a valid public link (only set for its owner)
  hasPublicLink?: boolean;
  sharedFolderId?: string;
  subFolderPath?: string;
  isSharedFolder?: boolean;
  folderPermission?: string;
}

export interface SharedFolder {
  id: string;
  ownerId: string;
  ownerName?: string;
  name: string;
  mountPath: string;
  isOwner: boolean;
  permission: 'owner' | 'write' | 'read';
  shares?: FolderShare[];
  createdAt: string;
  updatedAt: string;
}

export interface FolderShare {
  id: string;
  folderId: string;
  targetType: 'user' | 'team';
  targetId: string;
  targetName?: string;
  email?: string;
  avatarUrl?: string;
  permission: 'read' | 'write';
  createdBy: string;
  createdAt: string;
}

export interface TagSummary {
  tag: string;
  count: number;
  // The notes carrying the hashtag (the sidebar filters its folder tree by them)
  docIds?: string[];
}

export interface MatchedTagBlock {
  rootBlock: DocumentBlock;
  children: DocumentBlock[];
}

export interface TagDocumentGroup {
  docId: string;
  title: string;
  icon: string;
  folderPath: string;
  updatedAt: string;
  isOwner: boolean;
  permission: 'owner' | 'write' | 'read';
  ownerName?: string;
  matchedBlocks: MatchedTagBlock[];
}

export interface TagDetails {
  tag: string;
  noteContent?: string;
  noteUpdatedAt?: string;
  documents: TagDocumentGroup[];
  totalMatches: number;
}

export interface SearchHit {
  type: 'document' | 'thought' | 'list_item';
  id: string;
  title: string;
  snippet: string;
  score?: number;
  docId?: string;
  blockId?: string;
  listId?: string;
  icon?: string;
  // Bullets: their raw text, and (with context: 1) the bullet before and after
  content?: string;
  before?: string;
  after?: string;
}

/** Narrowing of the global search (GET /search); empty fields do not filter. */
export interface SearchFilter {
  type?: 'document' | 'thought' | 'list_item';
  limit?: number;
  taskStatus?: 'open' | 'done';
  taskListId?: string; // 'personal' = without list
  priority?: string;
  due?: 'today' | 'overdue' | 'week';
  folder?: string;
  listId?: string;
  itemStatus?: 'open' | 'done';
  // Bullets: also the text of the bullet before and after (costs the server more; large view only)
  context?: 1;
}

export interface SearchResults {
  thoughts: Thought[];
  documents: Document[];
  listItems: ListItem[];
  hits: SearchHit[];
  counts?: Partial<Record<'document' | 'thought' | 'list_item', number>>;
}

// A branch moved into another note (POST /documents/{id}/move)
export interface MoveResult {
  targetId: string;
  targetTitle: string;
  rootId: string; // the branch's bullet in the target note
  moved: Record<string, string>; // new block id in the target → block id here
}

// Answer of merging two notes; kept by the client to undo it
export interface MergeResult {
  targetId: string;
  sourceId: string;
  sourceTitle: string;
  headingId: string;
}

// A note's public link as its owner sees it (GET/PUT /documents/{id}/public-link)
export interface PublicLinkState {
  enabled: boolean;
  maxDays: number;
  link: { token: string; expiresAt: string; hasPassword: boolean } | null;
}

// The own calendar subscription (GET/PUT/DELETE /calendar-feed): enabled = the server allows it,
// active = the person switched it on; url only with BASE_URL (else built from the page's origin);
// unreadable = the stored token no longer decrypts (SECRETS_KEY changed), a new link helps
export interface CalendarFeedState {
  enabled: boolean;
  active: boolean;
  token: string | null;
  url: string | null;
  createdAt?: string;
  unreadable?: boolean;
}
