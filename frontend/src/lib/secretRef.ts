import { messageText } from '../i18n';

// A hidden value in a bullet's text: only the reference {{secret:<id>}} is stored with the note, the
// value itself lives encrypted on the server (internal/storage/secrets.go) and is revealed on request.
export const SECRET_REF_SOURCE = '\\{\\{secret:[A-Za-z0-9_]+\\}\\}';

export const SECRET_MASK = '••••';

export function secretRef(id: string): string {
  return `{{secret:${id}}}`;
}

export function secretIdOf(token: string): string | null {
  const m = token.match(/^\{\{secret:([A-Za-z0-9_]+)\}\}$/);
  return m ? m[1] : null;
}

export function maskSecrets(text: string, mask = SECRET_MASK): string {
  return text.includes('{{secret:') ? text.replace(new RegExp(SECRET_REF_SOURCE, 'g'), () => mask) : text;
}

// A reference with the id format of a stored value (NewSecretID in internal/storage/secrets.go, older ids
// with "_" after "sec"); "{{secret:id}}" written to explain the syntax is not one.
const SECRET_VALUE_REF_RE = /\{\{secret:sec_?[0-9a-f]{24}\}\}/g;

/** The placeholder the server writes for a hidden value not taken over, in the same (message) language. */
export function secretPlaceholder(): string {
  return messageText('workspace:secret.notIncluded');
}

/**
 * A code block shows its text as it is and cannot show a hidden value, so it keeps no reference to one
 * (internal/storage/secrets.go): every reference to a value becomes the placeholder (nothing where that is
 * longer than the reference, as on the server). The editor applies it in the same step as the change that
 * brings the reference in (lib/docSync/diff.ts), so undo brings the reference back with the bullet.
 */
export function codeBlockText(content: string, placeholder?: string): string {
  if (!content.includes('{{secret:')) return content;
  const p = placeholder ?? secretPlaceholder();
  return content.replace(SECRET_VALUE_REF_RE, (ref) => (p.length <= ref.length ? p : ''));
}
