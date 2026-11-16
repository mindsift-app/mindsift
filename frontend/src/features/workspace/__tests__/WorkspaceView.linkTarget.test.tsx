import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { WorkspaceView } from '../WorkspaceView';
import { api } from '../../../lib/api';
import { Document } from '../../../lib/types';

interface EditorProps {
  docId: string;
  initialFocusedBlockId?: string | null;
  onWikiLinkClick?: (link: { title: string; docId?: string; blockId?: string }) => void;
}
const editor = vi.hoisted(() => ({ props: null as EditorProps | null }));

vi.mock('../DocumentEditor', () => ({
  DocumentEditor: (props: EditorProps) => {
    editor.props = props;
    return null;
  },
}));

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocuments: vi.fn(),
      getDocumentTodos: vi.fn(),
      getFolders: vi.fn(),
      getSharedFolders: vi.fn(),
      getWorkspaceTags: vi.fn(),
      getTrash: vi.fn(),
    },
    onWebSocketMessage: vi.fn(() => () => {}),
    triggerHaptic: vi.fn(),
  };
});

const makeDoc = (id: string, title: string): Document => ({
  id,
  title,
  userId: 'u1',
  icon: '',
  folderPath: '',
  content: '',
  blocks: [],
  tags: [],
  isPinned: false,
  isArchived: false,
  createdAt: '2026-11-16T10:00:00Z',
  updatedAt: '2026-11-16T10:00:00Z',
});

describe('WorkspaceView link targets', () => {
  beforeEach(() => {
    editor.props = null;
    vi.mocked(api.getDocuments).mockResolvedValue([makeDoc('doc_start', 'Erste Schritte'), makeDoc('doc_api', 'API & Smart Home')]);
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getSharedFolders).mockResolvedValue([]);
    vi.mocked(api.getWorkspaceTags).mockResolvedValue([]);
    vi.mocked(api.getTrash).mockResolvedValue([]);
  });

  it('a plain link does not carry the bullet the previous note was opened at', async () => {
    render(<WorkspaceView onStatsChange={vi.fn()} initialDocId="doc_start" initialBlockId="blk_hit" />);
    await waitFor(() => expect(editor.props?.docId).toBe('doc_start'));
    expect(editor.props?.initialFocusedBlockId).toBe('blk_hit');

    // Wait for the note list, which the link is resolved against
    await waitFor(() => expect(vi.mocked(api.getDocuments)).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => editor.props?.onWikiLinkClick?.({ title: 'API & Smart Home', docId: 'doc_api' }));
    await waitFor(() => expect(editor.props?.docId).toBe('doc_api'));
    expect(editor.props?.initialFocusedBlockId).toBeNull();

    // A link to a bullet still takes it along
    act(() => editor.props?.onWikiLinkClick?.({ title: 'Erste Schritte', docId: 'doc_start', blockId: 'blk_2' }));
    await waitFor(() => expect(editor.props?.docId).toBe('doc_start'));
    expect(editor.props?.initialFocusedBlockId).toBe('blk_2');
  });
});
