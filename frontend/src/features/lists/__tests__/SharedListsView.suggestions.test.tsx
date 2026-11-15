import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const recent = new Date().toISOString();
const createListItem = vi.fn(async (listId: string, content: string, category?: string, quantity?: string) => ({
  id: `itm_${content}`,
  listId,
  content,
  category: category || '',
  quantity: quantity || '',
  isCompleted: false,
  sortOrder: 0,
  createdAt: recent,
}));
const getListSuggestions = vi.fn(async () => [
  { content: 'Milch', category: 'Kühlregal', count: 9, lastUsed: recent },
  { content: 'Mineralwasser', category: 'Getränke', count: 4, lastUsed: recent },
  { content: 'Hafermilch', category: 'Kühlregal', count: 20, lastUsed: recent },
  { content: 'Brot', category: 'Backwaren', count: 5, lastUsed: recent },
]);

vi.mock('../../../lib/api', () => ({
  api: {
    getAllLists: vi.fn(async () => [
      {
        id: 'lst_1',
        userId: 'u1',
        title: 'Einkauf',
        icon: '🛒',
        listType: 'shopping',
        isOwner: true,
        items: [{ id: 'itm_open', listId: 'lst_1', content: 'Hafermilch', category: 'Kühlregal', isCompleted: false, sortOrder: 0, createdAt: recent }],
        shares: [],
        members: [],
        updatedAt: recent,
        createdAt: recent,
      },
    ]),
    getWorkspaceTags: vi.fn(async () => [{ tag: 'Kühlregal' }, { tag: 'Getränke' }]),
    getListSuggestions: (...args: unknown[]) => getListSuggestions(...(args as [])),
    createListItem: (...args: unknown[]) => createListItem(...(args as [string, string, string?, string?])),
    setListOrder: vi.fn(async () => {}),
    getAuthStatus: vi.fn(async () => ({})),
  },
  triggerHaptic: vi.fn(),
  onRealtimeStatus: () => () => {},
}));
vi.mock('../useListRealtime', () => ({ useListRealtime: () => {} }));

import { SharedListsView } from '../SharedListsView';

async function setup() {
  render(<SharedListsView onRefreshGlobal={() => {}} currentUser={null} />);
  const input = (await screen.findByPlaceholderText(/Was soll auf „Einkauf“/)) as HTMLInputElement;
  await act(async () => {});
  return input;
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value, selectionStart: value.length } });
}

describe('SharedListsView: suggestions while typing a new item', () => {
  beforeEach(() => {
    createListItem.mockClear();
    getListSuggestions.mockClear();
  });

  it('shows earlier items after two letters, without the ones open on the list', async () => {
    const input = await setup();
    expect(getListSuggestions).toHaveBeenCalledWith('lst_1');
    type(input, 'M');
    expect(screen.queryByRole('listbox', { name: 'Vorschläge' })).toBeNull();
    type(input, 'Mi');
    const box = screen.getByRole('listbox', { name: 'Vorschläge' });
    const options = within(box).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Milch#Kühlregal', 'Mineralwasser#Getränke']);
    expect(within(box).queryByText('Hafermilch')).toBeNull(); // open already
  });

  it('adds the suggestion chosen with the arrow keys and Enter, with its category', async () => {
    const input = await setup();
    type(input, 'mi');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(createListItem).toHaveBeenCalledWith('lst_1', 'Milch', 'Kühlregal', '');
    expect(input.value).toBe('');
  });

  it('Enter without choosing adds what was typed, as before', async () => {
    const input = await setup();
    type(input, 'Mi');
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });
    expect(createListItem).toHaveBeenCalledWith('lst_1', 'Mi', undefined, '');
  });

  it('a click adds it; a hashtag typed in the field wins over the remembered category', async () => {
    const input = await setup();
    type(input, '#Getränke mi');
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole('option', { name: /Milch/ }));
    });
    expect(createListItem).toHaveBeenCalledWith('lst_1', 'Milch', 'Getränke', '');
  });

  it('hashtag suggestions win while a #word is typed, and Escape closes the item suggestions', async () => {
    const input = await setup();
    type(input, 'Milch #Kü');
    expect(screen.queryByRole('listbox', { name: 'Vorschläge' })).toBeNull();
    expect(screen.getByText('Hashtags')).toBeTruthy();
    type(input, 'Bro');
    expect(screen.getByRole('listbox', { name: 'Vorschläge' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Vorschläge' })).toBeNull();
    // Typing on shows them again
    type(input, 'Brot');
    expect(screen.getByRole('option', { name: /Brot/ })).toBeTruthy();
  });
});

describe('SharedListsView: quantity typed into the item', () => {
  beforeEach(() => {
    createListItem.mockClear();
  });

  const submit = async (input: HTMLInputElement) => {
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });
  };

  it('shows the quantity as a chip, marks it and saves it into its own field', async () => {
    const input = await setup();
    type(input, '2x Milch #Kühlregal');
    expect(screen.getByTestId('quantity-chip').textContent).toBe('2x');
    expect(screen.getByTestId('quantity-mark').textContent).toBe('2x');
    await submit(input);
    expect(createListItem).toHaveBeenCalledWith('lst_1', 'Milch', 'Kühlregal', '2x');
    expect(screen.queryByTestId('quantity-chip')).toBeNull();
  });

  it('× keeps the text as typed', async () => {
    const input = await setup();
    type(input, '500g Pasta');
    fireEvent.click(screen.getByRole('button', { name: 'Menge nicht übernehmen' }));
    expect(screen.queryByTestId('quantity-chip')).toBeNull();
    await submit(input);
    expect(createListItem).toHaveBeenCalledWith('lst_1', '500g Pasta', undefined, '');
  });

  it('a quantity in its own field wins, units included', async () => {
    const input = await setup();
    type(input, '3 Äpfel');
    expect(screen.getByTestId('quantity-chip').textContent).toBe('3');
    const qty = screen.getByLabelText('Menge (optional)') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '500 g' } });
    expect(qty.value).toBe('500 g');
    expect(screen.queryByTestId('quantity-chip')).toBeNull();
    await submit(input);
    expect(createListItem).toHaveBeenCalledWith('lst_1', '3 Äpfel', undefined, '500 g');
  });

  it('suggests by the name without the quantity and keeps the quantity for the suggestion', async () => {
    const input = await setup();
    type(input, '2x Mi');
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole('option', { name: /^Milch/ }));
    });
    expect(createListItem).toHaveBeenCalledWith('lst_1', 'Milch', 'Kühlregal', '2x');
  });
});
