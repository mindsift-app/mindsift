import { localDay } from './due';

// Due dates typed into a one-line capture ("Zahnarzt morgen 14 Uhr", "Call Anna next Tuesday at 9"):
// rule based, in the language of the app, without any AI. The result names the phrase(s) it took, so the
// field can mark them, and the title without them. Due dates are local calendar days ("YYYY-MM-DD", with a
// time "YYYY-MM-DDTHH:MM") like everywhere else in the app (lib/due.ts).
//
// Decisions:
// - A bare weekday is the next one; today's weekday means the one in a week ("Freitag" on a Friday is
//   next Friday). "nächsten Freitag" / "next Friday" is the same day as a bare "Freitag".
// - A time alone is today while it is still ahead, otherwise tomorrow (at 15:00 "um 9" means tomorrow 09:00).
// - A day and month without a year ("24.12.", "24. Dezember") is the next such day, today included.
// - Month names only count with a day number ("3. Mai"), so "Mai" alone (a month or a name) is left alone.
// - "at 9" / "um 9" is read as 09:00 (24-hour clock); "9pm" for the evening.
// - Ambiguous things are not taken: bare numbers, "um" without a number, "24.12" without the closing dot
//   (could be a price), "1/2" (could be a fraction), "Morgen" after "Guten"/"am"/"heute" (the noun).
// - When nothing would be left of the text, there is no date: the phrase is the whole text.

export interface DateSpan {
  start: number;
  end: number;
}

export interface NaturalDate {
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"
  due: string;
  // The parts of the text taken for it (with joining words like "am", "um"), in order
  spans: DateSpan[];
  // The text without them
  title: string;
}

interface Candidate extends DateSpan {
  day?: string;
  time?: string;
  // A time on its own without a day (resolved to today or tomorrow)
  kind: 'date' | 'time';
  // 1 for a time with am/pm, which wins over the same digits read without it
  strong?: number;
}

interface Vocab {
  today: string[];
  tomorrow: string[];
  dayAfter: string[];
  // Words that make the following "tomorrow" word a noun ("Guten Morgen", "la mañana")
  notTomorrowAfter: string[];
  // Index 0 = Sunday
  weekdays: string[][];
  weekdayBefore: string[];
  weekdayAfter: string[];
  inWords: string[];
  numbers: Record<string, number>;
  units: { day: string[]; week: string[]; month: string[] };
  // Index 0 = January
  months: string[][];
  // Day number suffixes: "24." "1er" "24th"
  ordinal: string;
  // Between day and month name ("de" in Spanish)
  dayMonthJoin: string;
  monthFirst: boolean;
  dottedDates: boolean;
  slashDates: boolean;
  // Time patterns with groups h, m (and ap for am/pm)
  times: string[];
  // Joining words right before a date or a time that go with it ("am Freitag", "um 14 Uhr")
  dateLead: string[];
  timeLead: string[];
}

// Word boundaries that know letters beyond ASCII (\b does not)
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
// After a number: no letter, and not the start of a decimal or another number ("um 2.5 kg")
const EN = '(?![\\p{L}\\p{N}]|[.,:]\\d)';
const H = '(?<h>[01]?\\d|2[0-3])';
const M = '(?<m>[0-5]\\d)';
const HHMM = `${B}${H}:${M}${EN}`;

const de: Vocab = {
  today: ['heute'],
  tomorrow: ['morgen'],
  dayAfter: ['ubermorgen'],
  notTomorrowAfter: ['am', 'guten', 'gute', 'jeden', 'jedem', 'den', 'der', 'des', 'dem', 'ein', 'einen', 'eines', 'heute', 'gestern', 'diesen', 'diesem', 'vom', 'zum', 'schonen', 'fruhen'],
  weekdays: [['sonntag'], ['montag'], ['dienstag'], ['mittwoch'], ['donnerstag'], ['freitag'], ['samstag', 'sonnabend']],
  weekdayBefore: ['nachsten', 'nachste', 'nachster', 'kommenden', 'kommende', 'kommender', 'diesen', 'diese', 'dieser'],
  weekdayAfter: [],
  inWords: ['in'],
  numbers: { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 },
  units: { day: ['tag', 'tage', 'tagen'], week: ['woche', 'wochen'], month: ['monat', 'monate', 'monaten'] },
  months: [
    ['januar', 'janner', 'jan'],
    ['februar', 'feb'],
    ['marz', 'mar'],
    ['april', 'apr'],
    ['mai'],
    ['juni', 'jun'],
    ['juli', 'jul'],
    ['august', 'aug'],
    ['september', 'sept', 'sep'],
    ['oktober', 'okt'],
    ['november', 'nov'],
    ['dezember', 'dez'],
  ],
  ordinal: '\\.?',
  dayMonthJoin: '\\s*',
  monthFirst: false,
  dottedDates: true,
  slashDates: false,
  times: [`${B}${H}(?:[:.]${M})?\\s*uhr${E}`, `${B}um\\s+${H}(?::${M})?${EN}`, HHMM],
  dateLead: ['am', 'bis', 'zum', 'fur'],
  timeLead: ['um', 'gegen', 'ab'],
};

const en: Vocab = {
  today: ['today'],
  tomorrow: ['tomorrow'],
  dayAfter: ['the day after tomorrow', 'day after tomorrow'],
  notTomorrowAfter: [],
  weekdays: [['sunday'], ['monday'], ['tuesday'], ['wednesday'], ['thursday'], ['friday'], ['saturday']],
  weekdayBefore: ['next', 'this', 'coming', 'this coming'],
  weekdayAfter: [],
  inWords: ['in'],
  numbers: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 },
  units: { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'] },
  months: [
    ['january', 'jan'],
    ['february', 'feb'],
    ['march', 'mar'],
    ['april', 'apr'],
    ['may'],
    ['june', 'jun'],
    ['july', 'jul'],
    ['august', 'aug'],
    ['september', 'sept', 'sep'],
    ['october', 'oct'],
    ['november', 'nov'],
    ['december', 'dec'],
  ],
  ordinal: '(?:st|nd|rd|th)?',
  dayMonthJoin: '\\s*(?:of\\s+)?',
  monthFirst: true,
  dottedDates: false,
  slashDates: false,
  times: [
    `${B}(?<h>1[0-2]|0?[1-9])(?::${M})?\\s*(?<ap>[ap])\\.?m\\.?(?![\\p{L}\\p{N}])`,
    `${B}at\\s+${H}(?::${M})?${EN}`,
    HHMM,
  ],
  dateLead: ['on', 'by', 'until', 'till', 'due'],
  timeLead: ['at', 'by', 'around'],
};

const fr: Vocab = {
  today: ["aujourd'hui"],
  tomorrow: ['demain'],
  dayAfter: ['apres-demain', 'apres demain'],
  notTomorrowAfter: [],
  weekdays: [['dimanche'], ['lundi'], ['mardi'], ['mercredi'], ['jeudi'], ['vendredi'], ['samedi']],
  weekdayBefore: ['ce'],
  weekdayAfter: ['prochain'],
  inWords: ['dans'],
  numbers: { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 },
  units: { day: ['jour', 'jours'], week: ['semaine', 'semaines'], month: ['mois'] },
  months: [
    ['janvier', 'janv'],
    ['fevrier', 'fevr'],
    ['mars'],
    ['avril', 'avr'],
    ['mai'],
    ['juin'],
    ['juillet', 'juil'],
    ['aout'],
    ['septembre', 'sept'],
    ['octobre', 'oct'],
    ['novembre', 'nov'],
    ['decembre', 'dec'],
  ],
  ordinal: '(?:er)?',
  dayMonthJoin: '\\s*',
  monthFirst: false,
  dottedDates: true,
  slashDates: true,
  times: [`${B}${H}\\s*h(?:\\s*${M})?${E}`, HHMM],
  dateLead: ['le', 'pour'],
  timeLead: ['a', 'vers'],
};

const it: Vocab = {
  today: ['oggi'],
  tomorrow: ['domani'],
  dayAfter: ['dopodomani'],
  notTomorrowAfter: [],
  weekdays: [['domenica'], ['lunedi'], ['martedi'], ['mercoledi'], ['giovedi'], ['venerdi'], ['sabato']],
  weekdayBefore: ['questo', 'questa', 'prossimo', 'prossima'],
  weekdayAfter: ['prossimo', 'prossima'],
  inWords: ['tra', 'fra'],
  numbers: { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 },
  units: { day: ['giorno', 'giorni'], week: ['settimana', 'settimane'], month: ['mese', 'mesi'] },
  months: [
    ['gennaio'],
    ['febbraio'],
    ['marzo'],
    ['aprile'],
    ['maggio'],
    ['giugno'],
    ['luglio'],
    ['agosto'],
    ['settembre'],
    ['ottobre'],
    ['novembre'],
    ['dicembre'],
  ],
  ordinal: '',
  dayMonthJoin: '\\s*',
  monthFirst: false,
  dottedDates: true,
  slashDates: true,
  times: [`${B}(?:alle\\s+(?:ore\\s+)?|ore\\s+)${H}(?:[:.]${M})?${EN}`, HHMM],
  dateLead: ['il', 'per', 'entro'],
  timeLead: ['alle', 'ore', 'verso'],
};

const es: Vocab = {
  today: ['hoy'],
  tomorrow: ['manana'],
  dayAfter: ['pasado manana'],
  notTomorrowAfter: ['la', 'esta', 'por', 'cada', 'de', 'una', 'toda'],
  weekdays: [['domingo'], ['lunes'], ['martes'], ['miercoles'], ['jueves'], ['viernes'], ['sabado']],
  weekdayBefore: ['proximo', 'este'],
  weekdayAfter: ['que viene', 'proximo'],
  inWords: ['en'],
  numbers: { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 },
  units: { day: ['dia', 'dias'], week: ['semana', 'semanas'], month: ['mes', 'meses'] },
  months: [
    ['enero'],
    ['febrero'],
    ['marzo'],
    ['abril'],
    ['mayo'],
    ['junio'],
    ['julio'],
    ['agosto'],
    ['septiembre', 'setiembre'],
    ['octubre'],
    ['noviembre'],
    ['diciembre'],
  ],
  ordinal: '',
  dayMonthJoin: '\\s*(?:de\\s+)?',
  monthFirst: false,
  dottedDates: true,
  slashDates: true,
  times: [`${B}a\\s+las?\\s+${H}(?::${M})?${EN}`, HHMM],
  dateLead: ['el', 'para', 'hasta'],
  timeLead: ['a', 'las', 'la', 'sobre', 'hacia'],
};

const VOCABS: Record<string, Vocab> = { de, en, fr, it, es };

// Lower case without accents, one character for each character of the text, so positions stay the same
// ("Übermorgen" → "ubermorgen", "lunedì" → "lunedi", ’ → ')
export function foldText(text: string): string {
  let out = '';
  for (const c of text) {
    if (c === '’' || c === 'ʼ') {
      out += "'";
      continue;
    }
    const lower = c.toLowerCase();
    const base = lower.normalize('NFD')[0];
    // Keep the length: a character that folds into more than one unit (rare) stays as it is
    out += base && base.length === c.length ? base : c.length === lower.length ? lower : c;
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
// Longest first, so "september" wins over "sep"
const alt = (words: string[]) => [...words].sort((a, b) => b.length - a.length).map(esc).join('|');

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (y: number, m: number, d: number) => localDay(new Date(y, m, d, 12));
// Noon, so a change to or from summer time never moves the day
const noon = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
const plusDays = (now: Date, n: number) => {
  const d = noon(now);
  d.setDate(d.getDate() + n);
  return localDay(d);
};
// The same day n months later; 31 January + 1 month is the last day of February
const plusMonths = (now: Date, n: number) => {
  const y = now.getFullYear();
  const m = now.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return dayOf(y, m, Math.min(now.getDate(), last));
};

// A real calendar day (no 31 February)
function validDay(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(y, m - 1, d, 12);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return undefined;
  return localDay(date);
}

// Day and month without a year: this year, or next year once the day has passed (today counts)
function nextDayMonth(now: Date, m: number, d: number): string | undefined {
  const today = localDay(now);
  const thisYear = validDay(now.getFullYear(), m, d);
  if (thisYear && thisYear >= today) return thisYear;
  // 29 February: the next year that has one
  for (let y = now.getFullYear() + 1; y <= now.getFullYear() + 8; y++) {
    const day = validDay(y, m, d);
    if (day) return day;
  }
  return undefined;
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

interface Pattern {
  re: RegExp;
  kind: 'date' | 'time';
  read: (g: Record<string, string | undefined>, now: Date) => { day?: string; time?: string; strong?: number } | undefined;
}

function timeOf(g: Record<string, string | undefined>): string | undefined {
  let h = Number(g.h);
  const m = g.m ? Number(g.m) : 0;
  if (g.ap) {
    if (h < 1 || h > 12) return undefined;
    // 12am is midnight, 12pm noon
    if (g.ap === 'a') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  }
  if (h > 23 || m > 59) return undefined;
  return `${pad(h)}:${pad(m)}`;
}

const patternCache = new Map<string, Pattern[]>();

function patternsFor(lang: string): Pattern[] {
  const cached = patternCache.get(lang);
  if (cached) return cached;
  const v = VOCABS[lang] ?? VOCABS.de;
  const re = (src: string) => new RegExp(src, 'gu');
  const list: Pattern[] = [];

  // ISO, optionally with a time: 2026-12-24, 2026-12-24T14:30, 2026-12-24 14:30
  list.push({
    kind: 'date',
    re: re(`${B}(?<y>\\d{4})-(?<mo>\\d{2})-(?<d>\\d{2})(?:[t ]${H}:${M})?${EN}`),
    read: (g) => {
      const day = validDay(Number(g.y), Number(g.mo), Number(g.d));
      if (!day) return undefined;
      return { day, time: g.h ? timeOf(g) : undefined };
    },
  });

  // Relative days; "übermorgen" before "morgen" through the longest-first rule below
  const relative: [string[], number][] = [
    [v.dayAfter, 2],
    [v.today, 0],
    [v.tomorrow, 1],
  ];
  for (const [words, offset] of relative) {
    if (words.length === 0) continue;
    const not = offset === 1 && v.notTomorrowAfter.length > 0 ? `(?<!${B}(?:${alt(v.notTomorrowAfter)})\\s+)` : '';
    list.push({ kind: 'date', re: re(`${not}${B}(?:${alt(words)})${E}`), read: (_g, now) => ({ day: plusDays(now, offset) }) });
  }

  // Weekdays: the next one, today's weekday a week later
  const before = v.weekdayBefore.length ? `(?:(?:${alt(v.weekdayBefore)})\\s+)?` : '';
  const after = v.weekdayAfter.length ? `(?:\\s+(?:${alt(v.weekdayAfter)}))?` : '';
  v.weekdays.forEach((names, wd) => {
    list.push({
      kind: 'date',
      re: re(`${B}${before}(?:${alt(names)})${after}${E}`),
      read: (_g, now) => ({ day: plusDays(now, ((wd - now.getDay() + 7) % 7) || 7) }),
    });
  });

  // "in 3 Tagen", "in einer Woche", "in 2 months"
  const numberWords = Object.keys(v.numbers);
  const unit = (name: 'day' | 'week' | 'month') => `(?<${name}>${alt(v.units[name])})`;
  list.push({
    kind: 'date',
    re: re(`${B}(?:${alt(v.inWords)})\\s+(?<n>\\d{1,3}|${alt(numberWords)})\\s+(?:${unit('day')}|${unit('week')}|${unit('month')})${E}`),
    read: (g, now) => {
      const n = /^\d/.test(g.n ?? '') ? Number(g.n) : v.numbers[g.n ?? ''];
      if (!n) return undefined;
      if (g.month) return { day: plusMonths(now, n) };
      return { day: plusDays(now, g.week ? n * 7 : n) };
    },
  });

  // Day and month name: "24. Dezember", "1er mai", "24 de diciembre", "24th December 2026"
  const monthAlt = v.months.map((names, i) => `(?<mon${i}>${alt(names)})`).join('|');
  const monthIndex = (g: Record<string, string | undefined>) => v.months.findIndex((_n, i) => g[`mon${i}`] !== undefined);
  const yearPart = `(?:,?\\s+(?:de\\s+)?(?<y>\\d{4}))?`;
  const fromNamed = (g: Record<string, string | undefined>, now: Date) => {
    const m = monthIndex(g) + 1;
    const d = Number(g.d);
    const day = g.y ? validDay(Number(g.y), m, d) : nextDayMonth(now, m, d);
    return day ? { day } : undefined;
  };
  list.push({
    kind: 'date',
    re: re(`${B}(?<d>[0-3]?\\d)${v.ordinal}${v.dayMonthJoin}(?:${monthAlt})\\.?${yearPart}(?![\\p{L}\\p{N}])`),
    read: fromNamed,
  });
  if (v.monthFirst) {
    // "Dec 24", "December 24th, 2026"
    list.push({
      kind: 'date',
      re: re(`${B}(?:${monthAlt})\\.?\\s+(?<d>[0-3]?\\d)${v.ordinal}${yearPart}(?![\\p{L}\\p{N}])`),
      read: fromNamed,
    });
  }

  // "24.12.", "24.12.2026", "24.12.26" (without the year only with the closing dot: "24.12" could be a price)
  if (v.dottedDates) {
    list.push({
      kind: 'date',
      re: re(`(?<![\\p{L}\\p{N}.])(?<d>[0-3]?\\d)\\.(?<mo>[01]?\\d)\\.(?<y>\\d{4}|\\d{2})?(?![\\p{L}\\p{N}]|\\.\\d)`),
      read: (g, now) => {
        const day = g.y ? validDay(fullYear(g.y), Number(g.mo), Number(g.d)) : nextDayMonth(now, Number(g.mo), Number(g.d));
        return day ? { day } : undefined;
      },
    });
  }
  // "24/12/2026" (only with a year: "1/2" is more often a fraction)
  if (v.slashDates) {
    list.push({
      kind: 'date',
      re: re(`(?<![\\p{L}\\p{N}/])(?<d>[0-3]?\\d)/(?<mo>[01]?\\d)/(?<y>\\d{4}|\\d{2})(?![\\p{L}\\p{N}]|/)`),
      read: (g) => {
        const day = validDay(fullYear(g.y ?? ''), Number(g.mo), Number(g.d));
        return day ? { day } : undefined;
      },
    });
  }

  for (const src of v.times) {
    list.push({
      kind: 'time',
      re: re(src),
      read: (g) => {
        const time = timeOf(g);
        return time ? { time, strong: g.ap ? 1 : 0 } : undefined;
      },
    });
  }

  patternCache.set(lang, list);
  return list;
}

// Joining words right before a span go with it ("am Freitag", "bis zum 24.12.", "um 14 Uhr", "a las")
function extendLead(folded: string, start: number, words: string[]): number {
  if (words.length === 0) return start;
  const lead = new RegExp(`(?:^|[\\s(,])(${alt(words)})\\s+$`, 'u');
  for (let i = 0; i < 2; i++) {
    const m = lead.exec(folded.slice(0, start));
    if (!m) break;
    start = m.index + m[0].search(/\p{L}/u);
  }
  return start;
}

function removeSpans(text: string, spans: DateSpan[]): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) out = `${out.slice(0, s.start)} ${out.slice(s.end)}`;
  return out
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();
}

/**
 * The first date (and time) in a one-line text, read in the given language (de, en, fr, it, es; others
 * fall back to German). now is the moment "today" and "tomorrow" are counted from.
 */
export function parseNaturalDate(text: string, lang: string, now: Date): NaturalDate | null {
  if (!text.trim()) return null;
  const v = VOCABS[lang] ?? VOCABS.de;
  const folded = foldText(text);
  const found: Candidate[] = [];
  for (const p of patternsFor(VOCABS[lang] ? lang : 'de')) {
    p.re.lastIndex = 0;
    for (const m of folded.matchAll(p.re)) {
      const value = p.read(m.groups ?? {}, now);
      if (!value) continue;
      found.push({ start: m.index, end: m.index + m[0].length, kind: p.kind, ...value });
    }
  }
  // Overlaps: two times are one ("um 9" and "9 Uhr" in "um 9 Uhr"; "at 2:30" and "2:30 pm", where the
  // one with am/pm decides); otherwise the earlier and then the longer match wins ("übermorgen" over
  // "morgen", "2026-12-24 14:30" over "14:30")
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Candidate[] = [];
  for (const c of found) {
    const k = kept.find((x) => c.start < x.end && x.start < c.end);
    if (!k) kept.push(c);
    else if (k.kind === 'time' && c.kind === 'time') {
      if ((c.strong ?? 0) > (k.strong ?? 0)) k.time = c.time;
      k.strong = Math.max(k.strong ?? 0, c.strong ?? 0);
      k.end = Math.max(k.end, c.end);
    }
  }

  const date = kept.find((c) => c.kind === 'date');
  const time = date?.time ? undefined : kept.find((c) => c.kind === 'time');
  if (!date && !time) return null;

  let due: string;
  if (date) {
    const t = date.time ?? time?.time;
    due = t ? `${date.day}T${t}` : date.day!;
  } else {
    // A time alone: today while it is still ahead, otherwise tomorrow
    const ahead = time!.time! > `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    due = `${ahead ? localDay(now) : plusDays(now, 1)}T${time!.time}`;
  }

  const spans: DateSpan[] = [];
  if (date) spans.push({ start: extendLead(folded, date.start, v.dateLead), end: date.end });
  if (time) spans.push({ start: extendLead(folded, time.start, v.timeLead), end: time.end });
  spans.sort((a, b) => a.start - b.start);

  const title = removeSpans(text, spans);
  if (!title) return null;
  return { due, spans, title };
}

/** The text of the recognised phrase(s), to tell whether it is still the one the person dismissed. */
export const phraseOf = (text: string, parsed: NaturalDate) => parsed.spans.map((s) => text.slice(s.start, s.end)).join(' ');
