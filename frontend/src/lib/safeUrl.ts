// Links from user content (notes, task notes, Markdown) may only point to web pages or mail addresses.
// Anything else – javascript:, data:, vbscript:, file: and friends – would run or load in the app's
// context when clicked, so it is shown as plain text instead (FLAW-28).
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    // Browsers ignore control characters and whitespace inside the scheme ("java\tscript:"); URL does the same
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null; // relative or broken: not a link
  }
}
