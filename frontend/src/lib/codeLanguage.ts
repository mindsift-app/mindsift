import codeLanguages from '../features/workspace/codeLanguages.json';

// Language names of code blocks without the editor (Prism): the ids and short names of the language menu
// (features/workspace/codeLanguages.json, which the MCP server checks too: internal/api/mcp_code.go) and
// the rule for free names. Used by the code editor, ```name in a bullet and pasted Markdown fences.

const KNOWN_IDS = new Set<string>(codeLanguages.groups.flatMap((g) => g.options.map((o) => o.id)));
const ALIASES: Record<string, string> = codeLanguages.aliases;

export function resolveLanguageId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (KNOWN_IDS.has(key)) return key;
  return ALIASES[key];
}

/**
 * Whether a name not in the list may be a code block's language: the block shows it as typed, without
 * highlighting (the same rule as for MCP code bullets, internal/api/mcp_code.go, and as ```name in a bullet)
 */
export function isCodeLanguageLabel(raw: string): boolean {
  return /^[A-Za-z0-9+\-_.#]{1,40}$/.test(raw);
}

/**
 * The language a code block gets for a name: the editor's id of a known name, a free name as written,
 * '' for none and for a name the block could not show (too long, other characters)
 */
export function codeLanguageOf(raw?: string): string {
  const name = (raw || '').trim();
  if (!name) return '';
  return resolveLanguageId(name) || (isCodeLanguageLabel(name) ? name : '');
}
