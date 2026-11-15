import type { DocumentBlock } from './types';
import { formatDate } from './format';

// Note templates (Doku/modules/workspace.md, "Templates"): a template is a note the person marked as one of
// theirs; /vorlage (or /template) and "Neue Notiz" copy its bullets. The copy is a paste of the bullets:
// types, code languages, tables, drawings, pictures and hidden values come along (the server checks pictures
// and hidden values like any pasted bullet: mediaGate, secretGate), but to-dos start open and belong to no
// task, and a few placeholders are filled in.

export interface TemplateFill {
  /** Title of the note the copy goes into, for {{titel}} / {{title}} */
  title: string;
  /** Today, for {{datum}} / {{date}} */
  now?: Date;
}

// {{datum}} and {{date}}, {{titel}} and {{title}}, in any case and with spaces inside the braces. A hidden
// value's reference ({{secret:…}}) is no placeholder and stays.
const PLACEHOLDER = /\{\{\s*(datum|date|titel|title)\s*\}\}/gi;

/** The text with its placeholders filled in: the date in the app's language, the title as given. */
export function fillTemplatePlaceholders(text: string, fill: TemplateFill): string {
  if (!text.includes('{{')) return text;
  const date = formatDate(fill.now ?? new Date());
  return text.replace(PLACEHOLDER, (_, name: string) => {
    const n = name.toLowerCase();
    return n === 'datum' || n === 'date' ? date : fill.title;
  });
}

// Code and drawings keep their text as it is: in code, {{date}} may be part of the code (a template
// language), and a drawing's text is its model
const KEEPS_TEXT = new Set(['code', 'drawing']);

let counter = 0;
function newBlockId(): string {
  counter = (counter + 1) % 1_000_000;
  return `blk_${Date.now().toString(36)}_t${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Copies of a template's bullets for another note: new ids, levels counted from baseLevel (the template's
 * shallowest bullet goes there), to-dos open and without task, nothing collapsed, placeholders filled in.
 * Conflict copies and deleted bullets of the template are left out.
 */
export function templateBlocks(
  source: DocumentBlock[],
  { docId, baseLevel = 0, ...fill }: TemplateFill & { docId: string; baseLevel?: number }
): DocumentBlock[] {
  const blocks = source.filter((b) => !b.conflictOf);
  if (blocks.length === 0) return [];
  const minLevel = Math.min(...blocks.map((b) => Math.max(0, b.level || 0)));
  return blocks.map((b, i) => {
    const copy: DocumentBlock = {
      id: newBlockId(),
      documentId: docId,
      type: b.type,
      content: KEEPS_TEXT.has(b.type) ? b.content || '' : fillTemplatePlaceholders(b.content || '', fill),
      level: baseLevel + Math.max(0, (b.level || 0) - minLevel),
      checked: false,
      collapsed: false,
      position: (i + 1) * 1000,
    };
    if (b.lang !== undefined) copy.lang = b.lang;
    return copy;
  });
}
