// Plain rows without text show no dot; their indent guides should not stand alone either
const PLAIN_TYPES = new Set([undefined, '', 'bullet', 'paragraph', 'text', 'h1', 'h2', 'h3']);

/**
 * How many indent guide lines each visible row shows. A row with text keeps one per level. An empty plain
 * row (its dot is hidden) shows a line only where a row further down continues it, so empty rows at the
 * end of a group or before the next part of the note stay really empty; in the middle of a list the lines
 * run through without a gap. The row being edited keeps its lines (they show where it sits).
 */
export function guideCounts(
  entries: { block: { id: string; level?: number; content?: string; type?: string }; hasChildren: boolean }[],
  levelOffset: number,
  focusedBlockId?: string | null,
): number[] {
  const out = new Array<number>(entries.length);
  let below = 0; // lines the row below carries on
  for (let i = entries.length - 1; i >= 0; i--) {
    const { block, hasChildren } = entries[i];
    const level = Math.max(0, (block.level || 0) - levelOffset);
    const blank = !hasChildren && !(block.content || '').trim() && PLAIN_TYPES.has(block.type) && block.id !== focusedBlockId;
    out[i] = blank ? Math.min(level, below) : level;
    below = out[i];
  }
  return out;
}
