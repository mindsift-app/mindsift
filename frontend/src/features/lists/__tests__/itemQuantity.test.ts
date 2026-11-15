import { describe, it, expect } from 'vitest';
import { parseItemQuantity, withoutQuantity } from '../itemQuantity';
import { parseListItemInput } from '../listItems';

// [typed text, quantity or null, name left over]
const read = (text: string, lang = 'de') => {
  const q = parseItemQuantity(text, lang);
  return q ? [q.quantity, withoutQuantity(text, q)] : null;
};

describe('quantities typed into a new list item', () => {
  it('reads a leading count with x', () => {
    expect(read('2x Bio-Milch')).toEqual(['2x', 'Bio-Milch']);
    expect(read('2 x Milch')).toEqual(['2x', 'Milch']);
    expect(read('3X Joghurt')).toEqual(['3x', 'Joghurt']);
    expect(read('×2 Brot')).toEqual(['2x', 'Brot']);
  });

  it('reads a leading amount with a unit', () => {
    expect(read('500g Pasta')).toEqual(['500g', 'Pasta']);
    expect(read('500 g Pasta')).toEqual(['500 g', 'Pasta']);
    expect(read('1,5 kg Mehl')).toEqual(['1,5 kg', 'Mehl']);
    expect(read('2 l Milch')).toEqual(['2 l', 'Milch']);
    expect(read('250 ml Sahne')).toEqual(['250 ml', 'Sahne']);
    expect(read('1 Pck Hefe')).toEqual(['1 Pck', 'Hefe']);
    expect(read('1 Pck. Hefe')).toEqual(['1 Pck.', 'Hefe']);
    expect(read('2 Dosen Tomaten')).toEqual(['2 Dosen', 'Tomaten']);
    expect(read('1 Bund Petersilie')).toEqual(['1 Bund', 'Petersilie']);
    expect(read('2 Stück Kuchen')).toEqual(['2 Stück', 'Kuchen']);
    expect(read('2x 500 g Quark')).toEqual(['2x 500 g', 'Quark']);
    expect(read('6x0,5l Wasser')).toEqual(['6x0,5l', 'Wasser']);
    expect(read('½ kg Kirschen')).toEqual(['½ kg', 'Kirschen']);
  });

  it('reads a bare leading number as the count', () => {
    expect(read('3 Äpfel')).toEqual(['3', 'Äpfel']);
    expect(read('12 Eier')).toEqual(['12', 'Eier']);
    // A unit only as a whole word
    expect(read('2 Glasnudeln')).toEqual(['2', 'Glasnudeln']);
  });

  it('reads a trailing count or amount, not a bare trailing number', () => {
    expect(read('Milch 2x')).toEqual(['2x', 'Milch']);
    expect(read('Milch x2')).toEqual(['2x', 'Milch']);
    expect(read('Pasta 500g')).toEqual(['500g', 'Pasta']);
    expect(read('Cola 0,5 l')).toEqual(['0,5 l', 'Cola']);
    expect(read('Tomaten 2 Dosen')).toEqual(['2 Dosen', 'Tomaten']);
    expect(read('Cola 0,5')).toBeNull();
    expect(read('iPhone 15')).toBeNull();
    expect(read('Vitamin B12')).toBeNull();
  });

  it('leaves names with numbers alone', () => {
    expect(read('7up')).toBeNull();
    expect(read('3D-Drucker Filament')).toBeNull();
    expect(read('10er Eier')).toBeNull();
    expect(read('1000 Teile Puzzle')).toBeNull();
    expect(read('2 in 1 Shampoo')).toBeNull();
    expect(read('1,5% Milch')).toBeNull();
    expect(read('3,5 % Milch')).toBeNull();
    expect(read('Milch')).toBeNull();
    expect(read('')).toBeNull();
  });

  it('needs a name besides the quantity and hashtags', () => {
    expect(read('500g')).toBeNull();
    expect(read('2x')).toBeNull();
    expect(read('2x #Kühlregal')).toBeNull();
    expect(read('3 #Obst')).toBeNull();
  });

  it('keeps hashtags around it', () => {
    expect(read('2x Milch #Kühlregal')).toEqual(['2x', 'Milch #Kühlregal']);
    expect(read('Milch 2x #Kühlregal')).toEqual(['2x', 'Milch #Kühlregal']);
    expect(read('Milch 2x #Kühlregal #Frühstück')).toEqual(['2x', 'Milch #Kühlregal #Frühstück']);
    expect(read('#Kühlregal 2x Milch')).toEqual(['2x', '#Kühlregal Milch']);
    expect(read('Milch #2x')).toBeNull();
  });

  it('takes the one at the start when there are two', () => {
    expect(read('2x Pasta 500g')).toEqual(['2x', 'Pasta 500g']);
  });

  it('knows the packaging words of each language', () => {
    expect(read('2 cans tomatoes', 'en')).toEqual(['2 cans', 'tomatoes']);
    expect(read('3 pcs croissant', 'en')).toEqual(['3 pcs', 'croissant']);
    expect(read('milk 2 bottles', 'en')).toEqual(['2 bottles', 'milk']);
    expect(read('2 boîtes thon', 'fr')).toEqual(['2 boîtes', 'thon']);
    expect(read('4 pièces croissant', 'fr')).toEqual(['4 pièces', 'croissant']);
    expect(read('2 pz brioche', 'it')).toEqual(['2 pz', 'brioche']);
    expect(read('1 confezione uova', 'it')).toEqual(['1 confezione', 'uova']);
    expect(read('2 latas atún', 'es')).toEqual(['2 latas', 'atún']);
    expect(read('6 uds huevos', 'es')).toEqual(['6 uds', 'huevos']);
    // Metric units everywhere, packaging words only in their language: "2 Dosen" in English is a count
    expect(read('500 g pasta', 'en')).toEqual(['500 g', 'pasta']);
    expect(read('2 Dosen Mais', 'en')).toEqual(['2', 'Dosen Mais']);
    // The examples of the help
    expect(read('tomatoes 2 cans', 'en')).toEqual(['2 cans', 'tomatoes']);
    expect(read('cola 0.5', 'en')).toBeNull();
    expect(read('tomates 2 boîtes', 'fr')).toEqual(['2 boîtes', 'tomates']);
    expect(read('pomodori 2 lattine', 'it')).toEqual(['2 lattine', 'pomodori']);
    expect(read('tomates 2 latas', 'es')).toEqual(['2 latas', 'tomates']);
    expect(read('3 manzanas', 'es')).toEqual(['3', 'manzanas']);
    // Other languages read like German
    expect(read('2 Dosen Mais', 'nl')).toEqual(['2 Dosen', 'Mais']);
  });

  it('puts it into the quantity on saving unless the field has one', () => {
    const text = '2x Milch #Kühlregal';
    const q = parseItemQuantity(text, 'de');
    expect(parseListItemInput(text, '', q)).toEqual({ content: 'Milch', quantity: '2x', category: 'Kühlregal' });
    // The field wins, the text stays as typed
    expect(parseListItemInput(text, '3', q)).toEqual({ content: '2x Milch', quantity: '3', category: 'Kühlregal' });
    // Dismissed (no quantity passed): as typed
    expect(parseListItemInput(text, '', null)).toEqual({ content: '2x Milch', quantity: '', category: 'Kühlregal' });
  });
});
