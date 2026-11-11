// Wiki links. A link carries the id of the note, so renaming the note or a second note with the same title
// does not break it; the title in the link is only the fallback (export, no access, deleted note):
//   [[Titel#doc_id]]                 note, shows its current title
//   [[Titel#doc_id|Text]]            note, shows "Text"
//   [[Titel#doc_id^blk_id]]          one bullet, shows "current title › start of the bullet"
//   [[Titel#doc_id^blk_id|Text]]     one bullet, shows "Text"
// Older forms stay readable: [[Titel]], [[Titel|Text]], [[Titel#Abschnitt]] (by title) and
// [[Titel#^blk_id|Text]] (bullet, note found by the bullet's id or the title).

export interface WikiLink {
  title: string;
  docId?: string;
  blockId?: string;
  label?: string;
}

const DOC_ID_RE = /^doc_[\w-]+$/;

/** Parses the inside of [[…]]. In a table the pipe before the text is written "\|" (lib/markdownTable.ts). */
export function parseWikiLink(inner: string): WikiLink {
  const [rawTarget, ...rest] = inner.split('|');
  const target = rawTarget.endsWith('\\') ? rawTarget.slice(0, -1) : rawTarget;
  const label = rest.join('|').trim() || undefined;
  const hash = target.indexOf('#');
  const title = (hash === -1 ? target : target.slice(0, hash)).trim();
  const anchor = hash === -1 ? '' : target.slice(hash + 1).trim();
  const caret = anchor.indexOf('^');
  const head = caret === -1 ? anchor : anchor.slice(0, caret);
  const blockId = caret === -1 ? undefined : anchor.slice(caret + 1).trim() || undefined;
  const docId = DOC_ID_RE.test(head) ? head : undefined;
  return { title, docId, blockId, label };
}

// What a link points to right now, from the notes the app has loaded
export interface WikiLinkTarget {
  title: string;
  // Text of the linked bullet (links to one bullet)
  blockContent?: string;
}
export type WikiLinkResolver = (link: WikiLink) => WikiLinkTarget | null;

const clean = (s: string) => s.replace(/[[\]|#^]/g, '').replace(/\s+/g, ' ').trim();

function excerpt(content: string): string {
  const text = content.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => parseWikiLink(inner).label || parseWikiLink(inner).title);
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 40 ? `${one.slice(0, 39).trimEnd()}…` : one;
}

/** Text shown for a link: its own text, else the note's current title (and the start of the bullet). */
export function wikiLinkText(link: WikiLink, target?: WikiLinkTarget | null): string {
  if (link.label) return link.label;
  const title = target?.title?.trim() || link.title;
  if (!link.blockId) return title;
  const start = target?.blockContent ? excerpt(target.blockContent) : '';
  return start ? `${title} › ${start}` : `${title} »`;
}

/** Link to a note; without a label it shows the note's current title. */
export function buildNoteLink(title: string, docId: string, label?: string): string {
  const text = label ? clean(label) : '';
  return `[[${clean(title)}#${docId}${text ? `|${text}` : ''}]]`;
}

/** Link to one bullet of a note; without a label it shows "title › start of the bullet". */
export function buildBlockLink(title: string, docId: string, blockId: string, label?: string): string {
  const text = label ? clean(label) : '';
  return `[[${clean(title)}#${docId}^${blockId}${text ? `|${text}` : ''}]]`;
}

const TAG_TAIL = String.raw`(\s+#[\p{L}\p{N}_-]+)*\s*$`;
const LINK_ONLY_RE = new RegExp(String.raw`^\s*\[\[([^\]]+)\]\]` + TAG_TAIL, 'u');

/** A bullet that is only a link to a note (plus hashtags), as left behind when a branch became a note. */
export function isNoteLinkOnly(content: string): boolean {
  const m = content.match(LINK_ONLY_RE);
  // A link to a single bullet does not count: bringing it back would take the whole note
  return Boolean(m) && !parseWikiLink(m![1]).blockId;
}

/** Whether two links point to the same note: by id when both have one, else by title. */
export function sameNote(a: WikiLink, b: WikiLink): boolean {
  if (a.docId && b.docId) return a.docId === b.docId;
  return a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
}

/** Turns every link to that note into its plain text (a link to a note that no longer exists). */
export function unlinkWikiLinks(content: string, target: WikiLink): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (token, inner: string) => {
    const link = parseWikiLink(inner);
    return sameNote(link, target) ? link.label || link.title : token;
  });
}

/** Points every link to that note at another note (a missing note that was created after all). */
export function retargetWikiLinks(content: string, target: WikiLink, docId: string, title: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (token, inner: string) => {
    const link = parseWikiLink(inner);
    if (!sameNote(link, target)) return token;
    if (link.blockId) return token;
    // A link in a table keeps its escaped pipe
    const next = buildNoteLink(title, docId, link.label);
    return inner.includes('\\|') ? next.replace(/\|/g, '\\|') : next;
  });
}

// What a click on a link may do to the bullet it stands in (a link to a note that does not exist)
export interface WikiLinkActions {
  remove: () => void;
  retarget: (docId: string, title: string) => void;
}
export type WikiLinkClickHandler = (link: WikiLink, actions?: WikiLinkActions) => void;
