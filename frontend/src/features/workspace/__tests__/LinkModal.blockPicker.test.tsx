import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LinkModal } from '../LinkModal';
import { api } from '../../../lib/api';
import { Document, DocumentBlock } from '../../../lib/types';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, api: { ...actual.api, getDocument: vi.fn() } };
});

const block = (id: string, content: string): DocumentBlock =>
  ({ id, documentId: '', type: 'bullet', content, level: 0, position: 0 }) as DocumentBlock;

describe('LinkModal block picker', () => {
  // Picking note A and then quickly note B: A's answer arriving last must not show A's bullets under B
  it('ignores the answer for a note picked before', async () => {
    const answers: Record<string, (d: Document) => void> = {};
    vi.mocked(api.getDocument).mockImplementation(
      (id: string) => new Promise<Document>((resolve) => (answers[id] = resolve))
    );
    render(
      <LinkModal
        isOpen
        onClose={() => {}}
        onInsertLink={() => {}}
        availableDocs={[
          { id: 'doc_a', title: 'Einkauf' },
          { id: 'doc_b', title: 'Urlaub' },
        ]}
      />
    );
    const pickers = screen.getAllByRole('button', { name: 'Punkt dieser Notiz wählen' });
    fireEvent.click(pickers[0]); // Einkauf
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Notizliste' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Punkt dieser Notiz wählen' })[1]); // Urlaub

    await act(async () => answers.doc_b({ id: 'doc_b', title: 'Urlaub', blocks: [block('b1', 'Koffer packen')] } as Document));
    await act(async () => answers.doc_a({ id: 'doc_a', title: 'Einkauf', blocks: [block('a1', 'Milch kaufen')] } as Document));

    expect(screen.getByText('Koffer packen')).toBeTruthy();
    expect(screen.queryByText('Milch kaufen')).toBeNull();
  });
});
