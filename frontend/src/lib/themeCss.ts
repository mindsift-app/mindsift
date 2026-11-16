// Reading and changing the colours of a custom theme's CSS (Kontoeinstellungen → Darstellung & Themes).
// The CSS stays the user's own text: a colour change replaces only the value of one variable, so
// comments, order and everything else survive, and an exported file looks like the imported one.

/** The colours a custom theme row offers as tiles, in this order */
export const THEME_COLOR_VARS = ['bg-app', 'bg-panel', 'bg-panel-elevated', 'text-main', 'text-muted', 'accent-primary'] as const;
export type ThemeColorVar = (typeof THEME_COLOR_VARS)[number];

// Splits the CSS into code and comments, so variables named inside a comment are left alone
function segments(css: string): { text: string; comment: boolean }[] {
  const out: { text: string; comment: boolean }[] = [];
  const re = /\/\*[\s\S]*?(?:\*\/|$)/g;
  let last = 0;
  for (const m of css.matchAll(re)) {
    if (m.index! > last) out.push({ text: css.slice(last, m.index), comment: false });
    out.push({ text: m[0], comment: true });
    last = m.index! + m[0].length;
  }
  if (last < css.length) out.push({ text: css.slice(last), comment: false });
  return out;
}

const declaration = (name: string) => new RegExp(`(^|[;{\\s])(--${name}\\s*:\\s*)([^;}]+?)(\\s*[;}])`);

/** The raw value of a variable (first declaration outside comments), or undefined */
export function readThemeVar(css: string, name: string): string | undefined {
  for (const s of segments(css)) {
    if (s.comment) continue;
    const m = s.text.match(declaration(name));
    if (m) return m[3].trim();
  }
  return undefined;
}

/** A value as #rrggbb for the colour picker, or null when it is no plain hex colour (rgba(), var() …) */
export function toHexColor(value?: string): string | null {
  const hex = value?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return null;
  return '#' + (hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex).toLowerCase();
}

/** Sets a variable: replaces its first value, or adds it at the end of the first rule when it is missing */
export function setThemeVar(css: string, name: string, value: string): string {
  const parts = segments(css);
  const re = declaration(name);
  for (const s of parts) {
    if (s.comment || !re.test(s.text)) continue;
    s.text = s.text.replace(re, (_all, before, head, _old, end) => `${before}${head}${value}${end}`);
    return parts.map((p) => p.text).join('');
  }
  for (const s of parts) {
    if (s.comment) continue;
    const close = s.text.indexOf('}');
    if (close < 0) continue;
    s.text = `${s.text.slice(0, close)}  --${name}: ${value};\n${s.text.slice(close)}`;
    return parts.map((p) => p.text).join('');
  }
  return `${css}${css && !css.endsWith('\n') ? '\n' : ''}:root {\n  --${name}: ${value};\n}\n`;
}

// Light background -> hover goes darker, otherwise lighter (as with the accent colour of the device)
function isLight(hex: string | null): boolean {
  if (!hex) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/** Changes one colour of a theme; a new accent also brings its hover shade and the text on it */
export function setThemeColor(css: string, name: ThemeColorVar, hex: string): string {
  let next = setThemeVar(css, name, hex);
  if (name !== 'accent-primary') return next;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dark = !isLight(toHexColor(readThemeVar(css, 'bg-app')));
  const mix = (c: number) => Math.round(dark ? c + (255 - c) * 0.2 : c * 0.82);
  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  if (toHexColor(readThemeVar(css, 'accent-hover'))) next = setThemeVar(next, 'accent-hover', `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`);
  if (toHexColor(readThemeVar(css, 'text-on-accent'))) {
    next = setThemeVar(next, 'text-on-accent', 0.2126 * r + 0.7152 * g + 0.0722 * b > 160 ? '#111111' : '#ffffff');
  }
  return next;
}

/** File name of an exported theme; the import reads the name back from it (themeNameFromFile) */
export function themeFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'theme';
  return `theme-${safe}.css`;
}

/** Theme name from an imported file name ("theme-Wald.css" → "Wald"), at most 60 characters */
export function themeNameFromFile(fileName: string): string {
  return Array.from(fileName.replace(/\.css$/i, '').replace(/^theme-/, '').trim()).slice(0, 60).join('');
}

/** Offers the CSS as a download, in exactly the form an import takes */
export function downloadThemeCss(name: string, css: string): void {
  const url = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = themeFileName(name);
  a.click();
  URL.revokeObjectURL(url);
}
