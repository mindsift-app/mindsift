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
  isDesktopApp: () => false,
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

  const qtyField = () => screen.getByLabelText('Menge (optional)') as HTMLInputElement;
  const bubble = () => screen.queryByTestId('quantity-bubble');
  const ignoreButton = () => screen.getByRole('button', { name: 'Nicht als Menge übernehmen' });

  it('fills the quantity field from the text, marks it, points at it and saves the name without it', async () => {
    const input = await setup();
    type(input, '2x Milch #Kühlregal');
    expect(qtyField().value).toBe('2x');
    expect(screen.getByTestId('quantity-mark').textContent).toBe('2x');
    // The bubble shows only the quantity; screen readers hear a sentence
    expect(bubble()!.textContent).toBe('2x');
    expect(screen.getByRole('status').textContent).toBe('Erkannte Menge: 2x');
    await submit(input);
    expect(createListItem).toHaveBeenCalledWith('lst_1', 'Milch', 'Kühlregal', '2x');
    expect(qtyField().value).toBe('');
    expect(bubble()).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('× on the bubble keeps the text as typed and empties the field, without taking the focus', async () => {
    const input = await setup();
    type(input, '2x Milch');
    const mouseDown = fireEvent.mouseDown(ignoreButton());
    expect(mouseDown).toBe(false); // default prevented: the item field keeps the focus
    fireEvent.click(ignoreButton());
    expect(bubble()).toBeNull();
    expect(qtyField().value).toBe('');
    expect(screen.queryByTestId('quantity-mark')).toBeNull();
    await submit(input);
    expect(createListItem).toHaveBeenCalledWith('lst_1', '2x Milch', undefined, '');
  });

  it('emptying the filled quantity field keeps the text as typed', async () => {
    const input = await setup();
    type(input, '500g Pasta');
    expect(qtyField().value).toBe('500g');
    fireEvent.change(qtyField(), { target: { value: '' } });
    expect(qtyField().value).toBe('');
    expect(screen.queryByTestId('quantity-mark')).toBeNull();
    expect(bubble()).toBeNull();
    await submit(input);
    expect(createListItem).toHaveBeenCalledWith('lst_1', '500g Pasta', undefined, '');
  });

  it('a quantity typed into its own field wins, units included, and hides the bubble', async () => {
    const input = await setup();
    type(input, '3 Äpfel');
    expect(qtyField().value).toBe('3');
    expect(bubble()!.textContent).toBe('3');
    fireEvent.change(qtyField(), { target: { value: '500 g' } });
    expect(qtyField().value).toBe('500 g');
    expect(bubble()).toBeNull();
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
