// Indentation in code blocks: Enter keeps the indentation of the line, goes one step deeper after an
// opening bracket or a line ending in ":" (YAML, Python), and puts a closing bracket right after the
// caret on a line of its own. Pure functions, used by CodeBlockEditor.

const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/** One indentation step for the code: a tab if it is indented with tabs (never in YAML), else the
 *  smallest indentation in use (2 to 8 spaces), else 2 spaces (4 for Python). */
export function indentUnit(code: string, lang?: string): string {
  const yaml = /^ya?ml$/i.test(lang || '');
  let smallest = 0;
  for (const line of code.split('\n')) {
    if (!line.trim()) continue;
    if (line[0] === '\t' && !yaml) return '\t';
    const spaces = line.length - line.trimStart().length;
    if (spaces > 0 && (smallest === 0 || spaces < smallest)) smallest = spaces;
  }
  if (smallest >= 2 && smallest <= 8) return ' '.repeat(smallest);
  return /^(python|py)$/i.test(lang || '') ? '    ' : '  ';
}

/** The code after Enter at the selection start..end, and where the caret goes. */
export function enterWithIndent(code: string, start: number, end: number, lang?: string): { value: string; caret: number } {
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const before = code.slice(lineStart, start);
  const indent = before.match(/^[ \t]*/)![0];
  const unit = indentUnit(code, lang);
  const trimmed = before.trimEnd();
  const last = trimmed.slice(-1);
  // YAML block scalars ("key: |", "key: >-") also continue one step deeper
  const deeper = last === ':' || last in OPENERS || /:\s*[|>][+-]?\d*$/.test(trimmed);
  const after = code.slice(end);
  const closesRightAfter = last in OPENERS && after.trimStart().startsWith(OPENERS[last]) && !after.slice(0, after.indexOf(OPENERS[last])).includes('\n');
  if (closesRightAfter) {
    const rest = after.trimStart();
    const inner = '\n' + indent + unit;
    const value = code.slice(0, start) + inner + '\n' + indent + rest;
    return { value, caret: start + inner.length };
  }
  const insert = '\n' + indent + (deeper ? unit : '');
  return { value: code.slice(0, start) + insert + after, caret: start + insert.length };
}
