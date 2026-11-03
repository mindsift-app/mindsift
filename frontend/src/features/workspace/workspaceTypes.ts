import { Document, SharedFolder } from '../../lib/types';

// Types shared by WorkspaceView and its parts

export type WorkspaceSubView = 'editor' | 'tag_detail' | 'todos' | 'tags' | 'trash' | 'journal';

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  subfolders: FolderTreeNode[];
  docs: Document[];
  sharedFolderObj?: SharedFolder;
}
