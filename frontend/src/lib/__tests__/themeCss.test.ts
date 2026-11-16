import { describe, it, expect } from 'vitest';
import template from '../../themes/theme-template.css?raw';
import dark from '../../themes/theme-dark.css?raw';
import {
  customThemePageCss,
  DEFAULT_THEME_COLORS,
  derivedThemeDefaults,
  readThemeVar,
  resolveThemeColor,
  setThemeColor,
  setThemeVar,
  themeFileName,
  themeNameFromFile,
  toHexColor,
  upgradeThemeCss,
} from '../themeCss';

describe('colours of a custom theme', () => {
  it('reads the colours of the template', () => {
    expect(readThemeVar(template, 'bg-app')).toBe('#121316');
    expect(readThemeVar(template, 'bg-panel')).toBe('#1a1c20');
    expect(readThemeVar(template, 'bg-panel-elevated')).toBe('#22252a');
    expect(readThemeVar(template, 'accent-primary')).toBe('#2563eb');
    expect(readThemeVar(template, 'nope')).toBeUndefined();
  });

  it('changes only the value of the one variable', () => {
    const next = setThemeColor(template, 'bg-panel', '#335577');
    expect(readThemeVar(next, 'bg-panel')).toBe('#335577');
    expect(readThemeVar(next, 'bg-panel-elevated')).toBe('#22252a');
    // Same text apart from that one value: comments and the rest stay as written
    expect(next.replace('#335577', '#1a1c20')).toBe(template);
  });

  it('brings hover and the text on the accent along with a new accent', () => {
    const next = setThemeColor(template, 'accent-primary', '#ffd700');
    expect(readThemeVar(next, 'accent-primary')).toBe('#ffd700');
    expect(readThemeVar(next, 'accent-hover')).not.toBe('#3b82f6');
    expect(readThemeVar(next, 'text-on-accent')).toBe('#111111');
    // The tints that refer to the accent stay references
    expect(next).toContain('color-mix(in srgb, var(--accent-primary) 14%, transparent)');
  });

  it('leaves variables in comments alone and adds a missing one to the first rule', () => {
    const css = '/* --bg-app: #000000; */\n:root[data-theme="wald"] {\n  --text-main: #eeeeee;\n}\n';
    const next = setThemeVar(css, 'bg-app', '#123456');
    expect(next).toContain('/* --bg-app: #000000; */');
    expect(next).toBe('/* --bg-app: #000000; */\n:root[data-theme="wald"] {\n  --text-main: #eeeeee;\n  --bg-app: #123456;\n}\n');
    expect(readThemeVar(next, 'bg-app')).toBe('#123456');
  });

  it('gives the colour picker only plain hex colours', () => {
    expect(toHexColor('#AbC')).toBe('#aabbcc');
    expect(toHexColor(' #1a1c20 ')).toBe('#1a1c20');
    expect(toHexColor('rgba(0, 0, 0, 0.5)')).toBeNull();
    expect(toHexColor(undefined)).toBeNull();
  });

  it('names the exported file so the import reads the name back', () => {
    for (const name of ['Wald', 'Mein Theme', 'Nacht über dem See']) expect(themeNameFromFile(themeFileName(name))).toBe(name);
    expect(themeFileName('a/b:c')).toBe('theme-a-b-c.css');
    expect(themeFileName('template')).toBe('theme-template.css');
  });

  it('lets the template derive faint text, hover, input and lines from the main colours', () => {
    let css = setThemeColor(template, 'text-muted', '#ff8800');
    css = setThemeColor(css, 'text-main', '#ffcc00');
    css = setThemeColor(css, 'bg-app', '#101010');
    // Faint text lies between the secondary text and the background, not on a fixed grey
    expect(resolveThemeColor(css, 'text-faint')).toBe('#b76405');
    expect(resolveThemeColor(css, 'bg-input')).toBe('#101010');
    // Lines are a little of the text colour, laid over the background for the picker
    expect(resolveThemeColor(css, 'border-color')).toBe('#2d270e');
    expect(resolveThemeColor(css, 'accent-primary')).toBe('#2563eb');
  });

  it('turns the old template greys into derived colours, but keeps colours the user chose', () => {
    const old =
      ':root[data-theme="custom-template"] {\n  --bg-app: #000000;\n  --text-muted: #ff8800;\n  --text-faint: #71717a;\n  --border-color: rgba(255, 255, 255, 0.09);\n  --bg-panel-hover: #123456;\n}\n';
    const next = upgradeThemeCss(old);
    expect(readThemeVar(next, 'text-faint')).toBe('color-mix(in srgb, var(--text-muted) 70%, var(--bg-app))');
    expect(readThemeVar(next, 'border-color')).toBe('color-mix(in srgb, var(--text-main) 12%, transparent)');
    expect(readThemeVar(next, 'bg-panel-hover')).toBe('#123456');
    expect(resolveThemeColor(old, 'text-faint')).toBe('#b35f00');
    // A colour change stores the upgrade along with it
    expect(readThemeVar(setThemeColor(old, 'bg-panel', '#111111'), 'text-faint')).toContain('color-mix');
  });

  it('fills in the colours a theme leaves out before the theme itself', () => {
    const css = ':root[data-theme="wald"] {\n  --text-muted: #ff8800;\n  --border-color: #333333;\n}\n';
    const defaults = derivedThemeDefaults(css);
    expect(defaults).toContain('--text-faint: color-mix(in srgb, var(--text-muted) 70%, var(--bg-app));');
    expect(defaults).toContain('--bg-panel-hover:');
    expect(defaults).not.toContain('--border-color:');
    expect(customThemePageCss(css)).toBe(defaults + css);
    expect(derivedThemeDefaults(template)).toBe('');
  });

  it('knows the main colours of the default theme that lies underneath', () => {
    for (const [name, value] of Object.entries(DEFAULT_THEME_COLORS)) expect(readThemeVar(dark, name)).toBe(value);
  });
});
