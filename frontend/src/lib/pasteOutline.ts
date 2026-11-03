import type { BlockType } from './types';

// Turns pasted (Markdown) text into outline items: headings, todos, bullets, numbered items, dividers,
// fenced code and paragraphs. A blank line ends a paragraph; indentation becomes the nesting level.
// Content below a heading is nested under it (H2 below H1 one level deeper), so sections fold and zoom.

export interface PastedItem {
  type: BlockType;
  checked?: boolean;
  content: string;
  indent: number;
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

export function parsePastedLines(rawLines: string[]): PastedItem[] {
  // Indentation steps differ (2, 3 or 4 spaces, tabs): the distinct widths in use are the levels
  const widths = Array.from(
    new Set(rawLines.filter((l) => l.trim() !== '').map((l) => leadingWidth(l).width))
  ).sort((a, b) => a - b);
  const levelOf = (w: number) => Math.max(0, widths.indexOf(w));

  const items: PastedItem[] = [];
  let current: PastedItem | null = null;
  let inCode = false;
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

  for (const rawLine of rawLines) {
    if (inCode) {
      if (current) (current as PastedItem).content += '\n' + rawLine;
      if (rawLine.trim().startsWith('```')) {
        inCode = false;
        flush();
      }
      continue;
    }
    if (rawLine.trim().startsWith('```')) {
      inCode = true;
      flush();
      current = { type: 'text', content: rawLine, indent: sectionLevel() };
      afterHeading = false;
      paragraphLevel = null;
      inList = false;
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
  return items;
}
