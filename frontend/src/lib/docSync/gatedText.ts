// The server's gates (internal/storage/media.go mediaGate, internal/storage/secret_gate.go secretGate) may
// rewrite references in content that comes in: a file the writer may not show becomes its caption, the
// placeholder "(file not included)" in the writer's message language or nothing; a hidden value of another
// note becomes a copy under a new id, the placeholder or nothing. Undo compares the text a step left behind
// with the text the note has now; a text the gates rewrote counts as the same.

const TOKEN_RE = /!?\[((?:[^\]\\]|\\.)*)\]\(media:med_[0-9a-f]+\)|media:med_[0-9a-f]+|\{\{secret:[A-Za-z0-9_]+\}\}/g;

// A placeholder of either gate in any language: a short text in parentheses
const PLACEHOLDER = '\\([^()\\n]{1,80}\\)';
const ANY_SECRET_REF = '\\{\\{secret:[A-Za-z0-9_]+\\}\\}';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cache = new Map<string, RegExp>();

/** A pattern for every text the gates can make of `sent`. */
function gatedPattern(sent: string): RegExp {
  const known = cache.get(sent);
  if (known) return known;
  let src = '';
  let last = 0;
  for (const m of sent.matchAll(TOKEN_RE)) {
    const token = m[0];
    src += escapeRe(sent.slice(last, m.index));
    last = m.index + token.length;
    const alts = [escapeRe(token)];
    if (token.startsWith('{{secret:')) {
      alts.push(ANY_SECRET_REF, PLACEHOLDER, '');
    } else {
      // A file with a caption becomes the caption, one without the placeholder or nothing
      const caption = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1').trim() : '';
      if (caption) alts.push(escapeRe(caption));
      else alts.push(PLACEHOLDER, '');
    }
    src += `(?:${alts.join('|')})`;
  }
  src += escapeRe(sent.slice(last));
  const re = new RegExp(`^${src}$`);
  if (cache.size > 200) cache.clear();
  cache.set(sent, re);
  return re;
}

/** `now` is `sent`, or what the server's gates make of it. */
export function sameGatedText(sent: string, now: string): boolean {
  if (sent === now) return true;
  if (!sent.includes('media:') && !sent.includes('{{secret:')) return false;
  return gatedPattern(sent).test(now);
}
