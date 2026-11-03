// Wiki links: [[Titel]], [[Titel|Anzeigetext]] and links to a single bullet [[Titel#^blockId|Anzeigetext]].
// A missing bullet just opens the note (links are not updated when a bullet moves to another note).

export interface WikiLink {
  title: string;
  blockId?: string;
  label?: string;
}

/** Parses the inside of [[…]]. */
export function parseWikiLink(inner: string): WikiLink {
  const [target, ...rest] = inner.split('|');
  const label = rest.join('|').trim() || undefined;
  const hash = target.indexOf('#');
  const title = (hash === -1 ? target : target.slice(0, hash)).trim();
  const anchor = hash === -1 ? '' : target.slice(hash + 1).trim();
  return { title, blockId: anchor.startsWith('^') ? anchor.slice(1) || undefined : undefined, label };
}

/** Text shown for a link: its label, else the note title (with » for a bullet). */
export function wikiLinkText(link: WikiLink): string {
  if (link.label) return link.label;
  return link.blockId ? `${link.title} »` : link.title;
}

/** Link to one bullet; the label is a short excerpt of the bullet so the reader knows what it points to. */
export function buildBlockLink(title: string, blockId: string, blockContent: string): string {
  const clean = (s: string) => s.replace(/[[\]|]/g, '').replace(/\s+/g, ' ').trim();
  let excerpt = clean(blockContent);
  if (excerpt.length > 40) excerpt = `${excerpt.slice(0, 39).trimEnd()}…`;
  const label = excerpt ? `${clean(title)} › ${excerpt}` : clean(title);
  return `[[${clean(title)}#^${blockId}|${label}]]`;
}

/** A bullet that is only a link to a note (plus hashtags), as left behind when a branch became a note. */
export function isNoteLinkOnly(content: string): boolean {
  return /^\s*\[\[[^\]]+\]\](\s+#[\p{L}\p{N}_-]+)*\s*$/u.test(content);
}
