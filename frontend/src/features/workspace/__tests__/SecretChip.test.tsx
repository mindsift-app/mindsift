import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInlineMarkdown } from '../../../lib/markdown';
import { blocksToMarkdown } from '../../../lib/outlineMarkdown';
import { ApiError } from '../../../lib/api/client';
import { SecretChip, revealFailure } from '../SecretChip';
import { OutlinerBlock } from '../OutlinerBlock';
import type { DocumentBlock } from '../../../lib/types';
import { api } from '../../../lib/api';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, api: { ...actual.api, revealSecret: vi.fn(), updateSecret: vi.fn(), createSecret: vi.fn() } };
});

const text = 'Server: {{secret:secab12}} Port 22';

describe('hidden values in a bullet', () => {
  beforeEach(() => vi.mocked(api.revealSecret).mockReset());

  it('never shows the reference or the value as text', () => {
    const { container } = render(<p>{renderInlineMarkdown(text)}</p>);
    expect(container.textContent).toBe('Server:  Port 22');
  });

  it('copies as dots', () => {
    expect(blocksToMarkdown([{ id: 'a', type: 'bullet', content: text, level: 0 } as never])).toBe('Server: •••• Port 22');
  });

  it('reveals on click, keeps the value out of the text and hides it again', async () => {
    vi.mocked(api.revealSecret).mockResolvedValue('192.168.1.10');
    const { container } = render(<SecretChip docId="doc1" secretId="secab12" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Versteckter Wert' }));
    await waitFor(() => expect(container.querySelector('[data-v="192.168.1.10"]')).not.toBeNull());
    expect(api.revealSecret).toHaveBeenCalledWith('doc1', 'secab12');
    expect(container.textContent).not.toContain('192.168');
    expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wieder verstecken' }));
    expect(container.querySelector('[data-v="192.168.1.10"]')).toBeNull();
  });

  it('starts afresh when the server swaps the reference for the copy in this note', async () => {
    // Pasted from another note: until the sync answers, the bullet holds the old reference, which this note
    // does not reveal
    vi.mocked(api.revealSecret).mockRejectedValueOnce(new ApiError('weg', 404, 'secret_gone'));
    const { rerender } = render(<SecretChip docId="doc1" secretId="secfremd" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Versteckter Wert' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Versteckter Wert' })).toBeNull());
    rerender(<SecretChip docId="doc1" secretId="seceigen" canEdit />);
    vi.mocked(api.revealSecret).mockResolvedValue('10.0.0.1');
    fireEvent.click(screen.getByRole('button', { name: 'Versteckter Wert' }));
    await waitFor(() => expect(api.revealSecret).toHaveBeenLastCalledWith('doc1', 'seceigen'));
  });

  it('tells deleted and unreadable values apart from other errors', () => {
    expect(revealFailure(new ApiError('weg', 404, 'secret_gone'))).toBe('gone');
    expect(revealFailure(new ApiError('kaputt', 409, 'secret_unreadable'))).toBe('unreadable');
    expect(revealFailure(new Error('offline'))).toBe('error');
  });
});

// /hidden, and /secret (its name before) and the German name still find it
describe.each(['/hidden', '/secret', '/versteckt'])('%s', (command) => {
  it('stores the value and puts only the reference into the bullet', async () => {
    vi.mocked(api.createSecret).mockResolvedValue({ id: 'secx1', ref: '{{secret:secx1}}' });
    const updates: DocumentBlock[] = [];
    const Wrapper = () => {
      const [blk, setBlk] = React.useState<DocumentBlock>({ id: 'b1', type: 'bullet', content: '', level: 0, position: 1 } as DocumentBlock);
      return (
        <OutlinerBlock
          docId="doc1"
          block={blk}
          isLast
          maxAllowedLevel={0}
          hasChildren={false}
          isFocused={false}
          canEdit
          onUpdateBlock={(u) => {
            updates.push(u);
            setBlk(u);
          }}
          onCreateBlockBelow={() => {}}
          onDeleteBlock={() => {}}
          onIndentBlock={() => {}}
          onNavigateFocus={() => {}}
          registerTextareaRef={() => {}}
        />
      );
    };
    const { container } = render(<Wrapper />);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: `IP ${command}` } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    const input = await screen.findByPlaceholderText('z. B. Passwort oder Token');
    fireEvent.change(input, { target: { value: '10.0.0.5' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(updates[updates.length - 1]?.content).toBe('IP {{secret:secx1}}'));
    expect(api.createSecret).toHaveBeenCalledWith('doc1', '10.0.0.5');
    expect(updates.some((u) => u.content.includes('10.0.0.5'))).toBe(false);
  });
});
