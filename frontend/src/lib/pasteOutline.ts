import type { BlockType } from './types';
import { DRAWING_FENCE, parseDrawing } from './drawing/model';
import { isTableStart, parseMarkdownTable, serializeMarkdownTable } from './markdownTable';
import { codeLanguageOf } from './codeLanguage';

// Turns pasted (Markdown) text into outline items: headings, todos, bullets, numbered items, dividers,
// fenced code (a code block with the fence's language; drawings among them), Markdown tables and paragraphs. A blank line ends a paragraph; indentation becomes the nesting level.
// Content below a heading is nested under it (H2 below H1 one level deeper), so sections fold and zoom.

export interface PastedItem {
  type: BlockType;
  checked?: boolean;
  content: string;
  indent: number;
  /** A code block's language (the editor's id, or a free name as written) */
  lang?: string;
}

function leadingWidth(line: string): { width: number; rest: string } {
  let width = 0;
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    width += line[i] === '\t' ? 4 : 1;
    i++;
  }
  return { width, rest: line.slice(i) };
}

// A fence opens with three or more backticks or tildes, then the info string (language first); it closes with a
// line of at least as many of the same character (CommonMark), so code may hold a shorter fence
const FENCE_OPEN = /^(`{3,}|~{3,})\s*([^`]*)$/;

function fenceCloses(line: string, marker: string): boolean {
  const t = line.trim();
  return t.length >= marker.length && t.startsWith(marker) && t.split('').every((ch) => ch === marker[0]);
}

// The lines inside fences (not the fences themselves): their own indentation is code, not nesting
function fenceBodyLines(rawLines: string[]): Set<number> {
  const body = new Set<number>();
  let marker: string | null = null;
  rawLines.forEach((line, i) => {
    if (marker) {
      if (fenceCloses(line, marker)) marker = null;
      else body.add(i);
      return;
    }
    const open = line.trim().match(FENCE_OPEN);
    if (open) marker = open[1];
  });
  return body;
}

export function parsePastedLines(rawLines: string[]): PastedItem[] {
  // Indentation steps differ (2, 3 or 4 spaces, tabs): the distinct widths in use are the levels
  const inFence = fenceBodyLines(rawLines);
  const widths = Array.from(
    new Set(rawLines.filter((l, i) => l.trim() !== '' && !inFence.has(i)).map((l) => leadingWidth(l).width))
  ).sort((a, b) => a - b);
  const levelOf = (w: number) => Math.max(0, widths.indexOf(w));

  const items: PastedItem[] = [];
  let current: PastedItem | null = null;
  // An open fence: its marker, the indentation of its line (taken off the code lines), language, lines so far
  let fence: { marker: string; prefix: string; info: string; lines: string[]; indent: number } | null = null;
  let afterHeading = false;
  const headings: { rank: number; level: number }[] = []; // open headings, innermost last
  // A list right after a paragraph ("Folgende Punkte:") nests under it: level of that paragraph,
  // and the extra indent of the current list run
  let paragraphLevel: number | null = null;
  let listBoost = 0;
  let inList = false;
  const sectionLevel = () => (headings.length ? headings[headings.length - 1].level + 1 : 0);

  const flush = () => {
    if (current) {
      current.content = current.content.trimEnd();
      items.push(current);
      current = null;
    }
  };

  // A fenced block: a code block with the fence's language; a drawing copied from a note (```mindsift-canvas
  // with its model) becomes a drawing again, a mindsift-canvas fence without a valid model stays text
  const closeFence = (closed: boolean) => {
    if (!fence) return;
    const { marker, info, lines, indent } = fence;
    fence = null;
    const code = lines.join('\n');
    const name = info.split(/\s+/)[0] || '';
    if (name === DRAWING_FENCE) {
      const model = code.trim();
      if (parseDrawing(model)) items.push({ type: 'drawing', content: model, indent });
      else items.push({ type: 'text', content: [marker + info, ...lines, ...(closed ? [marker] : [])].join('\n').trimEnd(), indent });
      return;
    }
    items.push({ type: 'code', content: code, lang: codeLanguageOf(name), indent });
  };

  for (let li = 0; li < rawLines.length; li++) {
    const rawLine = rawLines[li];
    if (fence) {
      if (fenceCloses(rawLine, fence.marker)) {
        closeFence(true);
      } else {
        const { prefix } = fence;
        // The code lines lose the fence's own indentation (a fence nested in a list), nothing more
        let n = 0;
        while (n < prefix.length && rawLine[n] === prefix[n]) n++;
        fence.lines.push(rawLine.slice(n));
      }
      continue;
    }
    const fenceOpen = rawLine.trim().match(FENCE_OPEN);
    if (fenceOpen) {
      flush();
      const { width } = leadingWidth(rawLine);
      // Like a table: indented in a list it belongs to the item above
      const indent = sectionLevel() + levelOf(width) + (inList && width > 0 ? listBoost : 0);
      const prefix = rawLine.slice(0, rawLine.length - rawLine.trimStart().length);
      fence = { marker: fenceOpen[1], prefix, info: fenceOpen[2].trim(), lines: [], indent };
      afterHeading = false;
      paragraphLevel = null;
      if (width === 0) inList = false;
      continue;
    }

    const { width, rest } = leadingWidth(rawLine);
    const indent = sectionLevel() + levelOf(width);
    const line = rest.trimEnd();

    // A blank line ends the paragraph or list item
    if (line === '') {
      flush();
      continue;
    }

    // A Markdown table (header, separator, rows) becomes one table block; indented in a list it belongs
    // to the item above, like the list items around it
    if (isTableStart(rawLines, li)) {
      flush();
      const tableLines = [line];
      for (li++; li < rawLines.length && rawLines[li].trim() !== '' && rawLines[li].includes('|'); li++) {
        tableLines.push(rawLines[li].trim());
      }
      li--;
      const table = serializeMarkdownTable(parseMarkdownTable(tableLines.join('\n')));
      items.push({ type: 'table', content: table, indent: indent + (inList && width > 0 ? listBoost : 0) });
      afterHeading = false;
      paragraphLevel = null;
      if (width === 0) inList = false;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flush();
      afterHeading = true;
      paragraphLevel = null;
      inList = false;
      const rank = heading[1].length;
      while (headings.length && headings[headings.length - 1].rank >= rank) headings.pop();
      const level = sectionLevel();
      headings.push({ rank, level });
      items.push({ type: (['h1', 'h2', 'h3'] as const)[rank - 1], content: heading[2], indent: level });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      afterHeading = false;
      headings.length = 0; // a divider closes the sections
      paragraphLevel = null;
      inList = false;
      items.push({ type: 'divider', content: '---', indent: 0 });
      continue;
    }

    const todo = line.match(/^[-*+]\s*\[([ xX])\]\s*(.*)$/);
    const bullet = line.match(/^[-*+•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (todo || bullet || numbered) {
      flush();
      afterHeading = false;
      if (!inList) {
        inList = true;
        listBoost = paragraphLevel !== null && indent <= paragraphLevel ? paragraphLevel + 1 - indent : 0;
      }
      const level = indent + listBoost;
      current = todo
        ? { type: 'todo', checked: todo[1].toLowerCase() === 'x', content: todo[2], indent: level }
        : numbered
        ? { type: 'numbered', content: numbered[1], indent: level }
        : { type: 'text', content: bullet![1], indent: level };
      continue;
    }

    // Plain text: continues the paragraph or list item above (a wrapped line), else starts a paragraph
    if (current && !afterHeading) {
      (current as PastedItem).content += '\n' + line;
    } else {
      flush();
      current = { type: 'text', content: line, indent };
      paragraphLevel = indent;
      inList = false;
    }
    afterHeading = false;
  }
  flush();
  // A fence without its closing line runs to the end (CommonMark), e.g. a code block copied without its last line
  closeFence(false);
  return items;
}
