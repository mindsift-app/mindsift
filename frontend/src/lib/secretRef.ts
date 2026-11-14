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

export function maskSecrets(text: string): string {
  return text.includes('{{secret:') ? text.replace(new RegExp(SECRET_REF_SOURCE, 'g'), SECRET_MASK) : text;
}
