import { describe, it, expect, beforeEach } from 'vitest';
import {
  setActiveTheme,
  initThemeOnBoot,
  customThemeOption,
  getActiveTheme,
  themeCounterpart,
  setCornerStyle,
  getCornerStyle,
  THEME_FAMILIES,
  AVAILABLE_THEMES,
  setFollowSystem,
  resolveTheme,
  setAccentColor,
  setButtonBorders,
} from '../theme';

const lightCss = `:root[data-theme="papier"] { --bg-app: #fafafa; --accent-primary: #15803d; --radius-card: 8px; }`;

describe('custom themes', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById('mindsift-custom-theme')?.remove();
  });

  it('injects the CSS live and uses its data-theme', () => {
    setActiveTheme('custom:thm_1', lightCss);
    const style = document.getElementById('mindsift-custom-theme');
    expect(style?.textContent).toBe(lightCss);
    expect(document.documentElement.getAttribute('data-theme')).toBe('papier');
    // light background -> no Tailwind dark class
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores data-theme mentioned in comments (like in the template)', () => {
    setActiveTheme('custom:thm_2', `/* benenne [data-theme="mein-theme"] um */\n:root[data-theme="wald"] { --bg-app: #0b1a10; }`);
    expect(document.documentElement.getAttribute('data-theme')).toBe('wald');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('restores the active custom theme on boot from the cache', () => {
    setActiveTheme('custom:thm_1', lightCss);
    document.getElementById('mindsift-custom-theme')?.remove();
    expect(initThemeOnBoot()).toBe('custom:thm_1');
    expect(document.getElementById('mindsift-custom-theme')?.textContent).toBe(lightCss);
  });

  it('removes the custom CSS when switching back to a built-in theme', () => {
    setActiveTheme('custom:thm_1', lightCss);
    setActiveTheme('dark');
    expect(document.getElementById('mindsift-custom-theme')).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(getActiveTheme()).toBe('dark');
  });

  it('falls back to dark when a custom theme has no CSS', () => {
    setActiveTheme('custom:gone');
    expect(getActiveTheme()).toBe('dark');
  });

  it('builds gallery previews from the CSS variables', () => {
    const opt = customThemeOption({ id: 'thm_1', name: 'Papier', css: lightCss, createdAt: '', updatedAt: '' });
    expect(opt.id).toBe('custom:thm_1');
    expect(opt.previewBg).toBe('#fafafa');
    expect(opt.previewAccent).toBe('#15803d');
    expect(opt.isRounded).toBe(true);
  });

  it('supports polarized and suri built-in dark themes', () => {
    setActiveTheme('polarized');
    expect(getActiveTheme()).toBe('polarized');
    expect(document.documentElement.getAttribute('data-theme')).toBe('polarized');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    setActiveTheme('suri');
    expect(getActiveTheme()).toBe('suri');
    expect(document.documentElement.getAttribute('data-theme')).toBe('suri');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('built-in themes', () => {
  beforeEach(() => localStorage.clear());

  it('moves removed themes to their successors', () => {
    localStorage.setItem('mindsift_active_theme', 'soft');
    expect(getActiveTheme()).toBe('terracotta-night');
    localStorage.setItem('mindsift_active_theme', 'high-contrast');
    expect(getActiveTheme()).toBe('dark');
  });

  it('treats Terrakotta as a light theme and Terrakotta Nacht as dark', () => {
    setActiveTheme('terracotta');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    setActiveTheme('terracotta-night');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('theme families and corners', () => {
  beforeEach(() => localStorage.clear());

  it('pairs every family with an existing light and dark theme', () => {
    for (const f of THEME_FAMILIES) {
      expect(AVAILABLE_THEMES.find((t) => t.id === f.light)?.mode).toBe('light');
      expect(AVAILABLE_THEMES.find((t) => t.id === f.dark)?.mode).toBe('dark');
    }
    expect(themeCounterpart('fjord')).toBe('fjord-night');
    expect(themeCounterpart('polarized')).toBe('polarized-light');
    expect(themeCounterpart('custom:x')).toBeNull();
  });

  it('forces round or square corners and keeps the choice', () => {
    setCornerStyle('square');
    expect(document.documentElement.getAttribute('data-corners')).toBe('square');
    expect(getCornerStyle()).toBe('square');
    setCornerStyle('theme');
    expect(document.documentElement.hasAttribute('data-corners')).toBe(false);
    expect(getCornerStyle()).toBe('theme');
  });
});

describe('follow system, accent and button frames', () => {
  beforeEach(() => localStorage.clear());

  it('picks the family variant that matches the system when following it', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      expect(resolveTheme('fjord')).toBe('fjord');
      setFollowSystem(true);
      expect(resolveTheme('fjord')).toBe('fjord-night');
      expect(resolveTheme('suri-light')).toBe('suri');
      expect(resolveTheme('custom:x')).toBe('custom:x');
    } finally {
      window.matchMedia = original;
    }
  });

  it('sets the accent variables and removes them again', () => {
    setActiveTheme('dark');
    setAccentColor('#c2410c');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--accent-primary')).toBe('#c2410c');
    expect(style.getPropertyValue('--text-on-accent')).toBe('#ffffff');
    expect(style.getPropertyValue('--accent-dim')).toBe('rgba(194, 65, 12, 0.16)');
    setAccentColor(null);
    expect(style.getPropertyValue('--accent-primary')).toBe('');
  });

  it('switches button frames off and on', () => {
    setButtonBorders('off');
    expect(document.documentElement.getAttribute('data-button-borders')).toBe('off');
    setButtonBorders('on');
    expect(document.documentElement.hasAttribute('data-button-borders')).toBe(false);
  });
});
