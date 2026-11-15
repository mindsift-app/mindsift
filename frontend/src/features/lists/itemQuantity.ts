// Quantities typed into a new list item ("2x Milch", "500g Pasta", "Tomaten 2 Dosen"): rule based, in the
// language of the app, like the due dates of the capture bar (lib/naturalDate.ts). The result names the part
// of the text it took, so the field can mark it, and the quantity as it will be saved.
//
// Decisions:
// - At the start: a number with "x" ("2x", "2 x", "×2"), a number with a unit ("500g", "1,5 kg", "2 Dosen",
//   also "2x 500 g") or a bare whole number of up to three digits before a word ("3 Äpfel" → "3").
// - At the end: only a number with "x" ("Milch 2x", "Milch x2") or with a unit ("Cola 0,5 l"). A bare number
//   at the end belongs to the name ("iPhone 15", "Cola 0,5", "Vitamin B12").
// - Digits glued to letters are names ("7up", "3D-Drucker", "10er-Pack"), and so is a bare number before a
//   short word and another number ("2 in 1 Shampoo").
// - Units: the metric ones in every language, the packaging words of the app's language (others fall back
//   to German). A unit only counts as a whole word ("2 Glasnudeln" is "2" and "Glasnudeln").
// - One quantity per item; the one at the start wins. Hashtags around it stay where they are.
// - When nothing but hashtags would be left of the name, there is no quantity.

export interface ItemQuantity {
  // As saved: the typed text with single spaces, "x" forms written "2x"
  quantity: string;
  // The part of the text taken for it
  start: number;
  end: number;
}

const METRIC = ['mg', 'g', 'gr', 'kg', 'ml', 'cl', 'dl', 'l', 'ltr'];

const UNITS: Record<string, string[]> = {
  de: [
    'stück', 'stk', 'st', 'pck', 'pkg', 'pkt', 'pack', 'packung', 'packungen', 'päckchen', 'dose', 'dosen',
    'flasche', 'flaschen', 'fl', 'bund', 'becher', 'glas', 'gläser', 'beutel', 'tüte', 'tüten', 'kiste',
    'kisten', 'kasten', 'rolle', 'rollen', 'tafel', 'tafeln', 'netz', 'schale', 'schalen', 'scheibe',
    'scheiben', 'kopf', 'köpfe', 'liter', 'kilo', 'gramm', 'dutzend', 'tetrapack', 'karton', 'kartons',
  ],
  en: [
    'pcs', 'pc', 'piece', 'pieces', 'pack', 'packs', 'pk', 'packet', 'packets', 'can', 'cans', 'tin', 'tins',
    'bottle', 'bottles', 'bunch', 'bunches', 'jar', 'jars', 'bag', 'bags', 'box', 'boxes', 'carton', 'cartons',
    'roll', 'rolls', 'bar', 'bars', 'lb', 'lbs', 'oz', 'dozen', 'loaf', 'loaves', 'head', 'heads', 'slice',
    'slices', 'liter', 'liters', 'litre', 'litres', 'kilo', 'kilos', 'gram', 'grams', 'tub', 'tubs',
  ],
  fr: [
    'pièce', 'pièces', 'pcs', 'pc', 'paquet', 'paquets', 'boîte', 'boîtes', 'bouteille', 'bouteilles', 'botte',
    'bottes', 'pot', 'pots', 'sachet', 'sachets', 'canette', 'canettes', 'tranche', 'tranches', 'rouleau',
    'rouleaux', 'tablette', 'tablettes', 'brique', 'briques', 'douzaine', 'filet', 'filets', 'barquette',
    'barquettes', 'litre', 'litres', 'kilo', 'kilos', 'gramme', 'grammes',
  ],
  it: [
    'pz', 'pezzo', 'pezzi', 'conf', 'confezione', 'confezioni', 'pacco', 'pacchi', 'pacchetto', 'pacchetti',
    'scatola', 'scatole', 'scatoletta', 'scatolette', 'lattina', 'lattine', 'bottiglia', 'bottiglie', 'mazzo',
    'mazzi', 'barattolo', 'barattoli', 'vasetto', 'vasetti', 'busta', 'buste', 'sacchetto', 'sacchetti',
    'rotolo', 'rotoli', 'fetta', 'fette', 'tavoletta', 'tavolette', 'dozzina', 'cespo', 'cespi', 'litro',
    'litri', 'chilo', 'chili', 'grammi', 'brick',
  ],
  es: [
    'uds', 'ud', 'u', 'unidad', 'unidades', 'paquete', 'paquetes', 'lata', 'latas', 'bote', 'botes', 'botella',
    'botellas', 'manojo', 'manojos', 'tarro', 'tarros', 'bolsa', 'bolsas', 'caja', 'cajas', 'rollo', 'rollos',
    'loncha', 'lonchas', 'rebanada', 'rebanadas', 'docena', 'tableta', 'tabletas', 'brik', 'briks', 'cartón',
    'cartones', 'litro', 'litros', 'kilo', 'kilos', 'gramos', 'malla', 'mallas',
  ],
};

const NUM = String.raw`\d+(?:[.,]\d+)?|\d*[½¼¾]`;
const TIMES = String.raw`[x×]`;
const TAG = String.raw`#[\p{L}\p{N}_-]+`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Patterns {
  lead: RegExp;
  trail: RegExp;
}

const cache = new Map<string, Patterns>();

function patternsFor(lang: string): Patterns {
  const key = UNITS[lang] ? lang : 'de';
  let p = cache.get(key);
  if (p) return p;
  // Longer units first, so "kg" is not read as "k" plus "g" and "dosen" not as "dose"
  const units = [...METRIC, ...UNITS[key]].sort((a, b) => b.length - a.length).map(escape).join('|');
  // "2x 500 g", "6 x 0,5 l": a count in front of an amount with a unit
  const amount = String.raw`(?:(?:\d+)\s?${TIMES}\s?)?(?:${NUM})\s?(?:${units})\.?`;
  const times = String.raw`(?:\d+)\s?${TIMES}|${TIMES}\s?\d+`;
  // A word boundary that also holds after letters like "ü" (\b only knows ASCII)
  const after = String.raw`(?![\p{L}\p{N}])`;
  p = {
    // Leading hashtags may come first ("#Kühlregal 2x Milch"); after the quantity a space and the name
    lead: new RegExp(String.raw`^((?:${TAG}\s+)*)(${amount}|${times}|\d{1,3})${after}(?=\s+\S)`, 'iu'),
    // Trailing hashtags may follow ("Milch 2x #Kühlregal")
    trail: new RegExp(String.raw`(?<=\S\s+)(${amount}|${times})${after}(?=(?:\s+${TAG})*\s*$)`, 'iu'),
  };
  cache.set(key, p);
  return p;
}

const BARE = /^\d{1,3}$/;
const TIMES_FORM = new RegExp(String.raw`^(?:(\d+)\s?${TIMES}|${TIMES}\s?(\d+))$`, 'iu');

// What is left of the name without the quantity and hashtags
function nameLeft(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ${text.slice(end)}`.replace(new RegExp(TAG, 'gu'), '').trim();
}

function written(raw: string): string {
  const m = TIMES_FORM.exec(raw);
  if (m) return `${m[1] ?? m[2]}x`;
  return raw.replace(/\s+/g, ' ');
}

/** The quantity in a new list item's text, read in the given language (de, en, fr, it, es; others: de). */
export function parseItemQuantity(text: string, lang: string): ItemQuantity | null {
  if (!text.trim()) return null;
  const { lead, trail } = patternsFor(lang);

  const m = lead.exec(text);
  if (m) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    const rest = text.slice(end);
    // "2 in 1 Shampoo", "4 for 3": the number belongs to the name
    const partOfName = BARE.test(m[2]) && /^\s+\p{L}{1,3}\s+\d/u.test(rest);
    if (!partOfName && nameLeft(text, start, end)) return { quantity: written(m[2]), start, end };
  }

  const t = trail.exec(text);
  if (t && nameLeft(text, t.index, t.index + t[1].length)) {
    return { quantity: written(t[1]), start: t.index, end: t.index + t[1].length };
  }
  return null;
}

// Longest quantity the fields take ("2 Packungen à 500 g" still fits)
export const QUANTITY_MAX_LENGTH = 32;

/** The text without the quantity's part, spaces tidied. */
export function withoutQuantity(text: string, q: ItemQuantity): string {
  return `${text.slice(0, q.start)} ${text.slice(q.end)}`.replace(/\s{2,}/g, ' ').trim();
}
