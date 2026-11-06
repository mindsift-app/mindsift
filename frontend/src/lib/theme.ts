import type { UserTheme } from './types';
import i18n from '../i18n';

// Built-in themes are compiled CSS files (src/themes/); custom themes are user CSS from the server,
// injected at runtime and addressed as "custom:<id>"
export type ThemeId = string;

export interface ThemeOption {
  id: ThemeId;
  name: string;
  subtitle: string;
  file: string;
  previewBg: string;
  previewPanel: string;
  previewAccent: string;
  previewText: string;
  isRounded: boolean;
  isCustom?: boolean;
  /** Built-in themes come in families with a light and a dark variant */
  family?: string;
  mode?: 'light' | 'dark';
}

export interface ThemeFamily {
  id: string;
  name: string;
  subtitle: string;
  light: ThemeId;
  dark: ThemeId;
}

// Left light, right dark – the settings and the quick switcher show them in this order
// Names and subtitles come from common:themes.<id> in the language shown when read
const family = (id: string, light: ThemeId, dark: ThemeId): ThemeFamily => ({
  id,
  light,
  dark,
  get name() {
    return i18n.t(`common:themes.families.${id}.name`);
  },
  get subtitle() {
    return i18n.t(`common:themes.families.${id}.subtitle`);
  },
});
export const THEME_FAMILIES: ThemeFamily[] = [
  family('classic', 'light', 'dark'),
  family('fjord', 'fjord', 'fjord-night'),
  family('terracotta', 'terracotta', 'terracotta-night'),
  family('polarized', 'polarized-light', 'polarized'),
  family('suri', 'suri-light', 'suri'),
];

export const THEME_STORAGE_KEY = 'mindsift_active_theme';
// CSS of the active custom theme, so it applies on boot before the API answers (no flash)
const CUSTOM_CSS_CACHE_KEY = 'mindsift_custom_theme_css';
const CUSTOM_STYLE_ID = 'mindsift-custom-theme';
export const CUSTOM_THEME_PREFIX = 'custom:';

export const AVAILABLE_THEMES: ThemeOption[] = [
  {
    id: 'dark',
    get name() {
      return i18n.t('common:themes.builtin.dark.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.dark.subtitle');
    },
    file: 'src/themes/theme-dark.css',
    previewBg: '#0a0c10',
    previewPanel: '#12161c',
    previewAccent: '#2563eb',
    previewText: '#e8ebf1',
    isRounded: true,
  },
  {
    id: 'light',
    get name() {
      return i18n.t('common:themes.builtin.light.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.light.subtitle');
    },
    file: 'src/themes/theme-light.css',
    previewBg: '#f6f7f9',
    previewPanel: '#ffffff',
    previewAccent: '#2563eb',
    previewText: '#0e131b',
    isRounded: true,
  },
  {
    id: 'terracotta',
    get name() {
      return i18n.t('common:themes.builtin.terracotta.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.terracotta.subtitle');
    },
    file: 'src/themes/theme-terracotta.css',
    previewBg: '#efe6d8',
    previewPanel: '#fbf6ee',
    previewAccent: '#c2410c',
    previewText: '#2b2118',
    isRounded: true,
  },
  {
    id: 'terracotta-night',
    get name() {
      return i18n.t('common:themes.builtin.terracotta-night.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.terracotta-night.subtitle');
    },
    file: 'src/themes/theme-terracotta-night.css',
    previewBg: '#17110d',
    previewPanel: '#211913',
    previewAccent: '#e8794a',
    previewText: '#f3e8da',
    isRounded: true,
  },
  {
    id: 'polarized',
    get name() {
      return i18n.t('common:themes.builtin.polarized.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.polarized.subtitle');
    },
    file: 'src/themes/theme-polarized.css',
    previewBg: '#090e11',
    previewPanel: '#10181c',
    previewAccent: '#14b8a6',
    previewText: '#f0fdfa',
    isRounded: false,
  },
  {
    id: 'suri',
    get name() {
      return i18n.t('common:themes.builtin.suri.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.suri.subtitle');
    },
    file: 'src/themes/theme-suri.css',
    previewBg: '#130f1a',
    previewPanel: '#1e1728',
    previewAccent: '#b86bf8',
    previewText: '#fbf7ff',
    isRounded: true,
  },
  {
    id: 'fjord',
    get name() {
      return i18n.t('common:themes.builtin.fjord.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.fjord.subtitle');
    },
    file: 'src/themes/theme-fjord.css',
    previewBg: '#e9eef5',
    previewPanel: '#f7f9fc',
    previewAccent: '#2b6cb0',
    previewText: '#14202e',
    isRounded: true,
  },
  {
    id: 'fjord-night',
    get name() {
      return i18n.t('common:themes.builtin.fjord-night.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.fjord-night.subtitle');
    },
    file: 'src/themes/theme-fjord-night.css',
    previewBg: '#0e1621',
    previewPanel: '#152131',
    previewAccent: '#5b9bdf',
    previewText: '#e6eef8',
    isRounded: true,
  },
  {
    id: 'polarized-light',
    get name() {
      return i18n.t('common:themes.builtin.polarized-light.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.polarized-light.subtitle');
    },
    file: 'src/themes/theme-polarized-light.css',
    previewBg: '#e6f0ef',
    previewPanel: '#f6fbfa',
    previewAccent: '#0f766e',
    previewText: '#0f2422',
    isRounded: false,
  },
  {
    id: 'suri-light',
    get name() {
      return i18n.t('common:themes.builtin.suri-light.name');
    },
    get subtitle() {
      return i18n.t('common:themes.builtin.suri-light.subtitle');
    },
    file: 'src/themes/theme-suri-light.css',
    previewBg: '#efe9f4',
    previewPanel: '#fbf8fd',
    previewAccent: '#8e44c9',
    previewText: '#23182e',
    isRounded: true,
  },
].map((t) => {
  const family = THEME_FAMILIES.find((f) => f.light === t.id || f.dark === t.id);
  return family ? { ...t, family: family.id, mode: family.light === t.id ? ('light' as const) : ('dark' as const) } : t;
});

/** The same family in the other mode (light ↔ dark); custom themes have none */
export function themeCounterpart(id: ThemeId): ThemeId | null {
  const f = THEME_FAMILIES.find((x) => x.light === id || x.dark === id);
  if (!f) return null;
  return f.light === id ? f.dark : f.light;
}

// Light/dark follows the system inside the chosen family (per device)
const FOLLOW_SYSTEM_KEY = 'mindsift_theme_follow_system';

export function getFollowSystem(): boolean {
  return load(FOLLOW_SYSTEM_KEY) === '1';
}

export function setFollowSystem(on: boolean): void {
  store(FOLLOW_SYSTEM_KEY, on ? '1' : null);
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** With "follow system": the family's variant that matches the system; otherwise the theme itself */
export function resolveTheme(id: ThemeId): ThemeId {
  if (!getFollowSystem()) return id;
  const f = THEME_FAMILIES.find((x) => x.light === id || x.dark === id);
  if (!f) return id;
  return systemPrefersDark() ? f.dark : f.light;
}

/** Switches the theme when the system changes between light and dark; returns the unsubscribe */
export function watchSystemScheme(onChange: (id: ThemeId) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (!getFollowSystem()) return;
    const next = resolveTheme(getActiveTheme());
    if (next !== getActiveTheme()) {
      setActiveTheme(next);
      onChange(next);
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

// Buttons with or without frames (per device): "off" removes the border of the regular buttons
export type ButtonBorders = 'on' | 'off';
const BUTTON_BORDERS_KEY = 'mindsift_button_borders';

export function getButtonBorders(): ButtonBorders {
  return load(BUTTON_BORDERS_KEY) === 'off' ? 'off' : 'on';
}

export function setButtonBorders(value: ButtonBorders): void {
  store(BUTTON_BORDERS_KEY, value === 'off' ? 'off' : null);
  applyButtonBorders(value);
}

function applyButtonBorders(value: ButtonBorders): void {
  if (typeof document === 'undefined') return;
  if (value === 'off') document.documentElement.setAttribute('data-button-borders', 'off');
  else document.documentElement.removeAttribute('data-button-borders');
}

// Own accent colour on top of any theme (per device); null = the theme's accent
const ACCENT_KEY = 'mindsift_accent';
const ACCENT_VARS = ['--accent-primary', '--accent-hover', '--accent-dim', '--accent-border', '--text-on-accent'];

export function getAccentColor(): string | null {
  const v = load(ACCENT_KEY);
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
}

export function setAccentColor(hex: string | null): void {
  store(ACCENT_KEY, hex);
  applyAccent(hex);
  syncThemeColorMeta(); // keeps the loading screen's colours current
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function applyAccent(hex: string | null): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  if (!hex) {
    ACCENT_VARS.forEach((v) => style.removeProperty(v));
    return;
  }
  const [r, g, b] = hexToRgb(hex);
  // Hover goes towards the text colour: darker on light themes, lighter on dark ones
  const dark = document.documentElement.classList.contains('dark');
  const mix = (c: number) => Math.round(dark ? c + (255 - c) * 0.2 : c * 0.82);
  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  style.setProperty('--accent-primary', hex);
  style.setProperty('--accent-hover', `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`);
  style.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, ${dark ? 0.16 : 0.1})`);
  style.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.38)`);
  style.setProperty('--text-on-accent', 0.2126 * r + 0.7152 * g + 0.0722 * b > 160 ? '#111111' : '#ffffff');
}

// Corners: follow the theme, or force round / square for every theme (per device)
export type CornerStyle = 'theme' | 'round' | 'square';
const CORNERS_STORAGE_KEY = 'mindsift_corners';

export function getCornerStyle(): CornerStyle {
  const v = load(CORNERS_STORAGE_KEY);
  return v === 'round' || v === 'square' ? v : 'theme';
}

export function setCornerStyle(style: CornerStyle): void {
  store(CORNERS_STORAGE_KEY, style === 'theme' ? null : style);
  applyCorners(style);
}

function applyCorners(style: CornerStyle): void {
  if (typeof document === 'undefined') return;
  if (style === 'theme') document.documentElement.removeAttribute('data-corners');
  else document.documentElement.setAttribute('data-corners', style);
}

export const isCustomThemeId = (id: ThemeId) => id.startsWith(CUSTOM_THEME_PREFIX);
export const customThemeId = (t: UserTheme): ThemeId => CUSTOM_THEME_PREFIX + t.id;

// Comments are ignored when reading the CSS (the template mentions [data-theme="mein-theme"] in one)
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const readCssVar = (css: string, name: string): string | undefined =>
  stripComments(css).match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1].trim();

// The CSS decides its own [data-theme="…"]; without one it targets plain :root
const themeAttribute = (css: string): string =>
  stripComments(css).match(/data-theme\s*=\s*["']?([\w-]+)/)?.[1] || 'custom';

// Light background -> no Tailwind dark class
function isLightColor(color?: string): boolean {
  const hex = color?.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return false;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

export function customThemeOption(t: UserTheme): ThemeOption {
  const radius = readCssVar(t.css, 'radius-card');
  return {
    id: customThemeId(t),
    name: t.name,
    get subtitle() {
      return i18n.t('common:themes.custom');
    },
    get file() {
      return i18n.t('common:themes.customFile');
    },
    previewBg: readCssVar(t.css, 'bg-app') || '#121316',
    previewPanel: readCssVar(t.css, 'bg-panel') || '#1a1c20',
    previewAccent: readCssVar(t.css, 'accent-primary') || '#2563eb',
    previewText: readCssVar(t.css, 'text-main') || '#f4f4f5',
    isRounded: !!radius && !/^0(px)?$/.test(radius),
    isCustom: true,
  };
}

function injectCustomCss(css: string | null): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
  if (css === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = CUSTOM_STYLE_ID;
  }
  el.textContent = css;
  // Last in <head>, so it wins over the compiled themes
  document.head.appendChild(el);
}

function applyToDocument(themeId: ThemeId, customCss: string | null, rememberColors = true): void {
  if (typeof document === 'undefined') return;
  injectCustomCss(customCss);
  const root = document.documentElement;
  const attr = customCss !== null ? themeAttribute(customCss) : themeId;
  root.setAttribute('data-theme', attr);
  const light =
    customCss !== null
      ? isLightColor(readCssVar(customCss, 'bg-app'))
      : isLightColor(AVAILABLE_THEMES.find((t) => t.id === themeId)?.previewBg);
  root.classList.toggle('dark', !light);
  applyAccent(rememberColors ? getAccentColor() : null); // a shared page shows the theme's own accent
  syncThemeColorMeta(rememberColors);
}

// The status bar (theme-color) starts black (like the Android navigation bar of the installed app,
// which only takes the manifest colour); once the app runs it follows the theme's background.
// The colours are also kept for the next start: public/boot-theme.js paints the loading screen in them.
function syncThemeColorMeta(remember = true): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta || typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => {
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--bg-app').trim();
    if (bg) meta.setAttribute('content', bg);
    const accent = css.getPropertyValue('--accent-primary').trim();
    const onAccent = css.getPropertyValue('--text-on-accent').trim();
    if (remember && bg && accent) store(BOOT_COLORS_KEY, JSON.stringify({ bg, accent, onAccent }));
  });
}

const BOOT_COLORS_KEY = 'mindsift_boot_colors';

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Removed themes and their successors
const RETIRED_THEMES: Record<string, ThemeId> = { soft: 'terracotta-night', 'high-contrast': 'dark' };

export function getActiveTheme(): ThemeId {
  const stored = load(THEME_STORAGE_KEY);
  const saved = stored && RETIRED_THEMES[stored] ? RETIRED_THEMES[stored] : stored;
  if (saved && AVAILABLE_THEMES.some((t) => t.id === saved)) return saved;
  if (saved && isCustomThemeId(saved) && load(CUSTOM_CSS_CACHE_KEY)) return saved;
  return 'dark';
}

// customCss is required for custom themes and ignored for built-in ones
export function setActiveTheme(themeId: ThemeId, customCss?: string): void {
  const css = isCustomThemeId(themeId) ? customCss ?? null : null;
  const effectiveId = isCustomThemeId(themeId) && css === null ? 'dark' : themeId;
  store(THEME_STORAGE_KEY, effectiveId);
  store(CUSTOM_CSS_CACHE_KEY, css);
  applyToDocument(effectiveId, css);
}

/** Shows a theme family's light or dark variant on this page only, without storing anything (a public
 *  note page must not change the visitor's own theme). */
export function showThemeOnPage(familyId: string, dark: boolean): void {
  const f = THEME_FAMILIES.find((x) => x.id === familyId) || THEME_FAMILIES[0];
  applyToDocument(dark ? f.dark : f.light, null, false);
}

export const systemIsDark = systemPrefersDark;

export function initThemeOnBoot(): ThemeId {
  applyCorners(getCornerStyle());
  applyButtonBorders(getButtonBorders());
  const saved = getActiveTheme();
  const active = resolveTheme(saved);
  if (active !== saved) store(THEME_STORAGE_KEY, active);
  applyToDocument(active, isCustomThemeId(active) ? load(CUSTOM_CSS_CACHE_KEY) : null);
  return active;
}
