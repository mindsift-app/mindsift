// Pasted HTML with code blocks (an answer copied from ChatGPT, Claude and similar pages, documentation sites)
// as Markdown for pasteOutline.ts. Their plain text has the code without a fence (often with the header's
// language name and "Copy" around it), so only the HTML says where code starts and in which language.
// Paragraphs, headings and lists become what their plain text would give; only <pre> blocks are new.

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'UL',
]);
// Never pasted: buttons ("Copy code"), scripts, styles, icons
const SKIP_TAGS = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'TEMPLATE', 'SVG', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);

/** Whether pasted HTML has code blocks worth reading it for (everything else keeps the plain text) */
export function htmlHasCodeBlock(html: string): boolean {
  return /<pre[\s>]/i.test(html);
}

const isElement = (n: Node): n is Element => n.nodeType === 1;

// The language a code block's markup names: class language-xyz / lang-xyz (highlight.js, Prism, Markdown
// renderers), data-language / data-lang, or highlight-source-xyz (GitHub)
function languageOf(el: Element | null): string {
  for (let e = el; e; e = e.parentElement) {
    const data = e.getAttribute('data-language') || e.getAttribute('data-lang');
    if (data) return data.trim();
    for (const c of Array.from(e.classList)) {
      const m = c.match(/^(?:language|lang|highlight-source)-(.+)$/);
      if (m) return m[1];
    }
    if (e.tagName === 'PRE') break;
  }
  return '';
}

// The text of code as it is: line breaks of <br> and of elements per line (some highlighters), no buttons
function codeText(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += n.nodeValue || '';
      return;
    }
    if (!isElement(n) || SKIP_TAGS.has(n.tagName.toUpperCase())) return;
    if (n.tagName === 'BR') {
      out += '\n';
      return;
    }
    const lineBlock = n.tagName === 'DIV' || n.tagName === 'P';
    if (lineBlock && out !== '' && !out.endsWith('\n')) out += '\n';
    n.childNodes.forEach(walk);
    if (lineBlock && !out.endsWith('\n')) out += '\n';
  };
  walk(el);
  return out.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

// A <pre> as a fence; longer than any backtick run in the code, so that one closes it
function fenceLines(pre: Element, indent: string): string[] {
  // Chat pages put a header (language, "Copy") in the <pre> next to the <code>: only the <code> is code
  const code = pre.querySelector('code');
  const text = codeText(code ?? pre);
  const lang = languageOf(code) || languageOf(pre) || languageOf(pre.parentElement);
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [indent + fence + lang, ...text.split('\n').map((l) => indent + l), indent + fence];
}

// Inline markup as Markdown the notes show: bold, italics, inline code, links
function inlineText(n: Node): string {
  if (n.nodeType === 3) return (n.nodeValue || '').replace(/\s+/g, ' ');
  if (!isElement(n) || SKIP_TAGS.has(n.tagName.toUpperCase())) return '';
  if (n.tagName === 'BR') return '\n';
  if (n.tagName === 'INPUT') return '';
  const inner = Array.from(n.childNodes).map(inlineText).join('');
  const wrap = (mark: string) => {
    const t = inner.trim();
    if (!t) return inner;
    return inner.replace(t, `${mark}${t}${mark}`);
  };
  switch (n.tagName) {
    case 'STRONG':
    case 'B':
      return wrap('**');
    case 'EM':
    case 'I':
      return wrap('*');
    case 'CODE': {
      const t = (n.textContent || '').replace(/\s+/g, ' ');
      if (!t.trim()) return t;
      return t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``;
    }
    case 'A': {
      const href = n.getAttribute('href') || '';
      const t = inner.trim();
      if (!/^https?:\/\//i.test(href) || !t || t === href) return inner;
      return `[${t.replace(/[[\]]/g, '')}](${href})`;
    }
    default:
      return inner;
  }
}

// Lines of a paragraph: spaces collapsed, <br> kept as a line break
function paragraphLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

function tableLines(table: Element): string[] {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => paragraphLines(inlineText(c)).join(' ').replace(/\|/g, '\\|'))
  );
  if (rows.length === 0) return [];
  const cols = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)];
}

function listLines(list: Element, depth: number, out: string[]) {
  const ordered = list.tagName === 'OL';
  const indent = '\t'.repeat(depth);
  for (const li of Array.from(list.children)) {
    if (li.tagName !== 'LI') continue;
    const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
    const marker = box ? `- [${box.checked || box.hasAttribute('checked') ? 'x' : ' '}] ` : ordered ? '1. ' : '- ';
    // The item's own text (also from its <p>s), then what is nested in it: lists and code
    const text: string[] = [];
    const nested: string[] = [];
    const collect = (n: Node) => {
      if (isElement(n) && (n.tagName === 'UL' || n.tagName === 'OL')) listLines(n, depth + 1, nested);
      else if (isElement(n) && n.tagName === 'PRE') nested.push(...fenceLines(n, '\t'.repeat(depth + 1)));
      else if (isElement(n) && n.tagName === 'TABLE') nested.push('', ...tableLines(n).map((l) => '\t'.repeat(depth + 1) + l), '');
      else if (isElement(n) && BLOCK_TAGS.has(n.tagName) && !n.querySelector('pre, ul, ol, table')) text.push(inlineText(n), ' ');
      else if (isElement(n) && BLOCK_TAGS.has(n.tagName)) n.childNodes.forEach(collect);
      else text.push(inlineText(n));
    };
    li.childNodes.forEach(collect);
    out.push(indent + marker + paragraphLines(text.join('')).join(' '), ...nested);
  }
}

// Block elements one after another; text between them is a paragraph
function blockLines(parent: Node, out: string[]) {
  let inline = '';
  // Some pages show the language above the code, outside its <pre> (Claude): that label is no paragraph
  const pres = isElement(parent) ? parent.querySelectorAll('pre') : [];
  const label = pres.length === 1 ? (languageOf(pres[0].querySelector('code')) || languageOf(pres[0])).toLowerCase() : '';
  const isLabel = (el: Element) =>
    label !== '' && (el.tagName === 'DIV' || el.tagName === 'SPAN') && !el.querySelector('pre') && (el.textContent || '').trim().toLowerCase() === label;
  const flush = () => {
    const lines = paragraphLines(inline);
    if (lines.length) out.push('', ...lines, '');
    inline = '';
  };
  parent.childNodes.forEach((n) => {
    if (!isElement(n)) {
      if (n.nodeType === 3) inline += inlineText(n);
      return;
    }
    const tag = n.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag) || isLabel(n)) return;
    if (!BLOCK_TAGS.has(tag)) {
      // An inline element holding a block (a <span> around a <pre>) counts as that block
      if (n.querySelector('pre, p, ul, ol, table, h1, h2, h3, h4, h5, h6')) {
        flush();
        blockLines(n, out);
      } else inline += inlineText(n);
      return;
    }
    flush();
    const heading = tag.match(/^H([1-6])$/);
    if (heading) {
      const text = paragraphLines(inlineText(n)).join(' ');
      // The notes have three heading levels
      if (text) out.push('', `${'#'.repeat(Math.min(3, Number(heading[1])))} ${text}`, '');
    } else if (tag === 'PRE') {
      out.push('', ...fenceLines(n, ''), '');
    } else if (tag === 'UL' || tag === 'OL') {
      out.push('');
      listLines(n, 0, out);
      out.push('');
    } else if (tag === 'TABLE') {
      out.push('', ...tableLines(n), '');
    } else if (tag === 'HR') {
      out.push('', '---', '');
    } else if (tag === 'P' && !n.querySelector('pre, ul, ol, table')) {
      inline = inlineText(n);
      flush();
    } else {
      blockLines(n, out);
    }
  });
  flush();
}

/** Pasted HTML as Markdown with fenced code blocks ('' when nothing readable is in it) */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  blockLines(doc.body, out);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}
