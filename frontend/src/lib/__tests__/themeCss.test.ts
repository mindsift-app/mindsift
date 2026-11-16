import { describe, it, expect } from 'vitest';
import template from '../../themes/theme-template.css?raw';
import { readThemeVar, setThemeColor, setThemeVar, themeFileName, themeNameFromFile, toHexColor } from '../themeCss';

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
});
