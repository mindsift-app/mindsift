import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PublicNoteView } from '../PublicNoteView';

const block = (id: string, parentId: string, orderKey: string, content: string) => ({
  id,
  parentId,
  orderKey,
  type: 'text',
  content,
  props: {},
  version: 1,
});

vi.mock('../../../lib/publicNote', async (orig) => ({
  ...(await orig<typeof import('../../../lib/publicNote')>()),
  storedPublicKey: () => '',
  fetchPublicNote: vi.fn(async () => ({
    status: 'ok',
    note: {
      title: 'Umzug',
      icon: '📦',
      expiresAt: '2026-12-01T00:00:00Z',
      headSeq: 1,
      titleVersion: 1,
      blocks: [block('a', '', 'a0', 'Küche'), block('b', 'a', 'a0', 'Teller einpacken'), block('c', '', 'a1', 'Keller')],
    },
  })),
}));

describe('PublicNoteView', () => {
  it('shows no empty action bubble and zooms into a bullet', async () => {
    const { container } = render(<PublicNoteView token="tok" />);
    const shown = () => [...container.querySelectorAll('[data-outline-block]')].map((el) => el.getAttribute('data-outline-block'));
    await waitFor(() => expect(shown()).toEqual(['a', 'b', 'c']));
    // Read only without a link to copy: the bubble is not rendered visibly at all
    const bubbles = [...container.querySelectorAll('[data-outline-block] .rounded-pill')].filter((el) => !el.className.includes('hidden'));
    expect(bubbles).toHaveLength(0);
    // A click on the dot of "Küche" zooms in: its children only, with a path back
    const kitchen = container.querySelector('[data-outline-block="a"]') as HTMLElement;
    const dot = [...kitchen.querySelectorAll('button')].find((b) => b.getAttribute('title')?.match(/zoom/i) || b.getAttribute('draggable') !== null);
    fireEvent.click(dot as HTMLElement);
    await waitFor(() => expect(container.querySelector('nav')).toBeTruthy());
    expect(shown()).toEqual(['b']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Küche');
  });
});
