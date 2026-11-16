// Reading and changing the colours of a custom theme's CSS (Kontoeinstellungen → Darstellung & Themes).
// The CSS stays the user's own text: a colour change replaces only the value of one variable, so
// comments, order and everything else survive, and an exported file looks like the imported one.

/** The colours a custom theme row offers as tiles, in this order */
export const THEME_COLOR_VARS = ['bg-app', 'bg-panel', 'bg-panel-elevated', 'text-main', 'text-muted', 'accent-primary'] as const;
/** Less important colours, behind "Weitere Farben"; without a value of their own they follow the ones above */
export const THEME_EXTRA_COLOR_VARS = ['text-faint', 'bg-panel-hover', 'bg-input', 'border-color', 'bg-code'] as const;
export type ThemeColorVar = (typeof THEME_COLOR_VARS)[number] | (typeof THEME_EXTRA_COLOR_VARS)[number];

/** How a custom theme's secondary colours follow its main ones (as in theme-template.css). A theme that does
 *  not set one gets this instead of the default theme's grey. */
export const DERIVED_THEME_VARS: Record<string, string> = {
  'accent-hover': 'color-mix(in srgb, var(--accent-primary) 80%, var(--text-main))',
  'accent-dim': 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
  'accent-border': 'color-mix(in srgb, var(--accent-hover) 45%, transparent)',
  'bg-panel-hover': 'color-mix(in srgb, var(--bg-panel-elevated) 88%, var(--text-main))',
  'bg-input': 'var(--bg-app)',
  'bg-code': 'color-mix(in srgb, var(--bg-app) 70%, #000000)',
  'text-faint': 'color-mix(in srgb, var(--text-muted) 70%, var(--bg-app))',
  'border-color': 'color-mix(in srgb, var(--text-main) 12%, transparent)',
  'border-subtle': 'color-mix(in srgb, var(--border-color) 55%, transparent)',
  'border-strong': 'color-mix(in srgb, var(--border-color) 82%, var(--text-main))',
  'scrollbar-thumb': 'color-mix(in srgb, var(--text-main) 16%, transparent)',
  'scrollbar-thumb-hover': 'color-mix(in srgb, var(--text-main) 30%, transparent)',
};

/** The main colours of the default theme (theme-dark.css), which lies underneath a custom theme on the page */
export const DEFAULT_THEME_COLORS: Record<string, string> = {
  'bg-app': '#1c1f25',
  'bg-panel': '#22262d',
  'bg-panel-elevated': '#2a2e36',
  'text-main': '#d9dde4',
  'text-muted': '#a9b0bc',
  'accent-primary': '#2563eb',
};

// Fixed greys of the template before it derived these colours: a theme made from it that still has one of
// them never chose it, so it follows the theme's own colours instead
const OLD_TEMPLATE_VALUES: Record<string, string> = {
  'bg-panel-hover': '#2a2e35',
  'bg-input': '#121316',
  'bg-code': '#0d0e11',
  'text-faint': '#71717a',
  'border-color': 'rgba(255, 255, 255, 0.09)',
  'border-subtle': 'rgba(255, 255, 255, 0.05)',
  'border-strong': 'rgba(255, 255, 255, 0.22)',
  'scrollbar-thumb': 'rgba(255, 255, 255, 0.14)',
  'scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.26)',
};

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

/** Replaces the old template's fixed greys with the derived values (see OLD_TEMPLATE_VALUES) */
export function upgradeThemeCss(css: string): string {
  let next = css;
  for (const [name, old] of Object.entries(OLD_TEMPLATE_VALUES)) {
    if (readThemeVar(next, name)?.replace(/\s+/g, '') === old.replace(/\s+/g, '')) next = setThemeVar(next, name, DERIVED_THEME_VARS[name]);
  }
  return next;
}

/** A rule with the derived values of the colours the theme does not set; goes before the theme's own CSS */
export function derivedThemeDefaults(css: string): string {
  const missing = Object.entries(DERIVED_THEME_VARS).filter(([name]) => readThemeVar(css, name) === undefined);
  if (!missing.length) return '';
  return `:root {\n${missing.map(([name, value]) => `  --${name}: ${value};`).join('\n')}\n}\n`;
}

/** The CSS that is put on the page for a custom theme: derived defaults first, then the (upgraded) theme */
export function customThemePageCss(css: string): string {
  const upgraded = upgradeThemeCss(css);
  return derivedThemeDefaults(upgraded) + upgraded;
}

type Rgba = [number, number, number, number];

// Splits at the commas that are not inside brackets
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

// A colour value as RGBA: hex, rgb()/rgba(), transparent, var() and color-mix(in srgb, …), as the template uses them
function parseColor(css: string, value: string, depth: number): Rgba | null {
  const v = value.trim();
  if (depth > 12) return null;
  if (v === 'transparent') return [0, 0, 0, 0];
  const hex = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.split('').map((c) => c + c).join('') : hex;
    const n = [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2) || 'ff', 16));
    return [n[0], n[1], n[2], n[3] / 255];
  }
  const rgb = v.match(/^rgba?\(([^)]*)\)$/i)?.[1];
  if (rgb) {
    const p = rgb.split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  const ref = v.match(/^var\(\s*--([\w-]+)\s*(?:,(.*))?\)$/);
  if (ref) return resolve(css, ref[1], depth + 1) ?? (ref[2] ? parseColor(css, ref[2], depth + 1) : null);
  const mix = v.match(/^color-mix\((.*)\)$/i)?.[1];
  if (mix) {
    const [space, a, b] = splitTopLevel(mix);
    if (!/^in\s+srgb$/i.test(space ?? '') || !a || !b) return null;
    const part = (s: string) => {
      const m = s.match(/^(.*?)\s+([\d.]+)%$/);
      return m ? { color: m[1], pct: parseFloat(m[2]) / 100 } : { color: s, pct: undefined };
    };
    const pa = part(a);
    const pb = part(b);
    const wa = pa.pct ?? (pb.pct !== undefined ? 1 - pb.pct : 0.5);
    const wb = pb.pct ?? 1 - wa;
    const ca = parseColor(css, pa.color, depth + 1);
    const cb = parseColor(css, pb.color, depth + 1);
    if (!ca || !cb) return null;
    // Premultiplied, as the browser mixes colours with transparency
    const alpha = ca[3] * wa + cb[3] * wb;
    if (alpha === 0) return [0, 0, 0, 0];
    const ch = (i: number) => (ca[i] * ca[3] * wa + cb[i] * cb[3] * wb) / alpha;
    return [ch(0), ch(1), ch(2), alpha];
  }
  return null;
}

// A theme's own value, else the derived one, else the default theme's (as on the page, where it lies underneath)
function resolve(css: string, name: string, depth: number): Rgba | null {
  const own = readThemeVar(css, name) ?? DERIVED_THEME_VARS[name];
  if (own) return parseColor(css, own, depth);
  const fallback = DEFAULT_THEME_COLORS[name];
  return fallback ? parseColor(css, fallback, depth) : null;
}

/** The colour a variable shows as #rrggbb for the colour picker, derived values worked out and transparency
 *  laid over the background; null when it cannot be read */
export function resolveThemeColor(css: string, name: string): string | null {
  const upgraded = upgradeThemeCss(css);
  const c = resolve(upgraded, name, 0);
  if (!c) return null;
  const bg = name === 'bg-app' ? null : resolve(upgraded, 'bg-app', 0);
  const over = (i: number) => (bg && c[3] < 1 ? c[i] * c[3] + bg[i] * (1 - c[3]) : c[i]);
  return '#' + [0, 1, 2].map((i) => Math.round(Math.min(255, Math.max(0, over(i)))).toString(16).padStart(2, '0')).join('');
}

/** Changes one colour of a theme; a new accent also brings its hover shade and the text on it */
export function setThemeColor(css: string, name: ThemeColorVar, hex: string): string {
  let next = setThemeVar(upgradeThemeCss(css), name, hex);
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
