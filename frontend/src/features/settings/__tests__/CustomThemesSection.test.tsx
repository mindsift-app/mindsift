import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { UserTheme } from '../../../lib/types';
import type { ThemeId } from '../../../lib/theme';
import template from '../../../themes/theme-template.css?raw';

const { api } = vi.hoisted(() => ({
  api: { saveTheme: vi.fn(), deleteTheme: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({ api, triggerHaptic: vi.fn() }));

import { AppearanceSection } from '../user/AppearanceSection';
import { useAppearanceSettings } from '../user/useAppearanceSettings';
import { readThemeVar } from '../../../lib/themeCss';

const wald: UserTheme = {
  id: 'thm_wald',
  name: 'Wald',
  css: '/* Mein Wald */\n:root[data-theme="wald"] {\n  --bg-app: #0f1a12;\n  --bg-panel: #16241a;\n  --accent-primary: #2f855a;\n  --text-main: #e6f2e9;\n}\n',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
};

// Keeps the list and the active theme like App does
let latest: UserTheme[] = [];
function Harness({ initial, active: initialActive = 'dark' }: { initial: UserTheme[]; active?: ThemeId }) {
  const [themes, setThemes] = useState(initial);
  const [active, setActive] = useState<ThemeId>(initialActive);
  const appearance = useAppearanceSettings(active, themes, (next, activate) => {
    latest = next;
    setThemes(next);
    if (activate) setActive(activate);
  });
  return <AppearanceSection appearance={appearance} activeTheme={active} customThemes={themes} onThemeChange={setActive} />;
}

// jsdom's Blob has no text(); the app reads imported files with it
if (!Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(this);
    });
  };
}

const row = (id: string) => document.querySelector(`[data-custom-theme="${id}"]`) as HTMLElement;

// Downloads go through an <a download>; the test keeps the blob and the file name
let downloads: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  latest = [];
  downloads = [];
  api.saveTheme.mockReset().mockImplementation(async (t: { id?: string; name: string; css: string }) => ({
    id: t.id || 'thm_neu',
    name: t.name,
    css: t.css,
    createdAt: '2026-11-16T10:00:00Z',
    updatedAt: '2026-11-16T10:00:00Z',
  }));
  api.deleteTheme.mockReset().mockResolvedValue(undefined);
  let pending: Blob | null = null;
  URL.createObjectURL = vi.fn((b: Blob) => {
    pending = b;
    return 'blob:x';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: pending! });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Eigene Themes', () => {
  it('shows the heading and the "+" even without own themes', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText('Eigene Themes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Neues Theme' })).toBeTruthy();
  });

  it('adds a theme from the template and uses it', async () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Neues Theme' }));
    const name = screen.getByPlaceholderText('Name des neuen Themes, z. B. Wald');
    fireEvent.change(name, { target: { value: 'Herbst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(row('thm_neu')).toBeTruthy());
    expect(api.saveTheme).toHaveBeenCalledWith({ name: 'Herbst', css: template });
    expect(within(row('thm_neu')).getByRole('button', { name: 'Aktiv' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(row('thm_neu')).getByRole('textbox', { name: 'Name des Themes' }) as HTMLInputElement).value).toBe('Herbst');
  });

  it('renames a theme in its row', async () => {
    render(<Harness initial={[wald]} />);
    const input = within(row('thm_wald')).getByRole('textbox', { name: 'Name des Themes' });
    fireEvent.change(input, { target: { value: 'Tannenwald' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    await waitFor(() => expect(api.saveTheme).toHaveBeenCalledWith({ id: 'thm_wald', name: 'Tannenwald', css: wald.css }));
    expect(latest[0].name).toBe('Tannenwald');
  });

  it('changes a colour live and saves it a moment later', async () => {
    render(<Harness initial={[wald]} active="custom:thm_wald" />);
    const tile = within(row('thm_wald')).getByLabelText('Fläche von Wald') as HTMLInputElement;
    expect(tile.value).toBe('#16241a');
    fireEvent.change(tile, { target: { value: '#445566' } });

    // Right away in the list (App applies the active theme's CSS from there)
    expect(readThemeVar(latest[0].css, 'bg-panel')).toBe('#445566');
    expect(latest[0].css).toContain('/* Mein Wald */');
    expect(api.saveTheme).not.toHaveBeenCalled();
    await waitFor(() => expect(api.saveTheme).toHaveBeenCalledTimes(1));
    expect(api.saveTheme.mock.calls[0][0]).toEqual({ id: 'thm_wald', name: 'Wald', css: wald.css.replace('#16241a', '#445566') });
  });

  it('folds the less important colours away and shows what they follow', async () => {
    render(<Harness initial={[wald]} active="custom:thm_wald" />);
    expect(within(row('thm_wald')).queryByLabelText('Dezenter Text von Wald')).toBeNull();
    const more = within(row('thm_wald')).getByRole('button', { name: 'Weitere Farben' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(within(row('thm_wald')).getByText('Ohne eigene Farbe richten sie sich nach den Farben oben.')).toBeTruthy();
    for (const label of ['Fläche beim Überfahren', 'Eingabefeld', 'Rahmen', 'Codeblock']) {
      expect(within(row('thm_wald')).getByLabelText(`${label} von Wald`)).toBeTruthy();
    }

    // Wald sets no faint text: the tile shows the colour it gets from the secondary text and the background
    const faint = within(row('thm_wald')).getByLabelText('Dezenter Text von Wald') as HTMLInputElement;
    expect(faint.value).toMatch(/^#[0-9a-f]{6}$/);
    expect(faint.value).not.toBe('#808080');
    // Wald's input field follows its background
    expect((within(row('thm_wald')).getByLabelText('Eingabefeld von Wald') as HTMLInputElement).value).toBe('#0f1a12');

    fireEvent.change(faint, { target: { value: '#ff4400' } });
    expect(readThemeVar(latest[0].css, 'text-faint')).toBe('#ff4400');
    await waitFor(() => expect(api.saveTheme).toHaveBeenCalledTimes(1));
  });

  it('exports the CSS so that importing the file gives the same theme', async () => {
    render(<Harness initial={[wald]} />);
    fireEvent.click(within(row('thm_wald')).getByRole('button', { name: 'Als CSS-Datei exportieren' }));
    expect(downloads).toHaveLength(1);
    const { name, blob } = downloads[0];
    expect(name).toBe('theme-Wald.css');
    const text = await blob.text();
    expect(text).toBe(wald.css);

    const fileInput = document.querySelector('[data-theme-import]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([text], name, { type: 'text/css' })] } });
    await waitFor(() => expect(api.saveTheme).toHaveBeenCalledWith({ name: 'Wald', css: wald.css }));
    await screen.findByText('Theme „Wald“ importiert und aktiviert.');
  });

  it('downloads the unchanged template', async () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage herunterladen' }));
    expect(downloads[0].name).toBe('theme-template.css');
    expect(await downloads[0].blob.text()).toBe(template);
  });

  it('deletes a theme only after the question', async () => {
    render(<Harness initial={[wald]} active="custom:thm_wald" />);
    fireEvent.click(within(row('thm_wald')).getByRole('button', { name: 'Theme löschen' }), { clientX: 100, clientY: 100 });
    expect(screen.getByText('Theme „Wald“ löschen? Das lässt sich nicht rückgängig machen.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(api.deleteTheme).not.toHaveBeenCalled();
    expect(row('thm_wald')).toBeTruthy();

    fireEvent.click(within(row('thm_wald')).getByRole('button', { name: 'Theme löschen' }), { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(row('thm_wald')).toBeNull());
    expect(api.deleteTheme).toHaveBeenCalledWith('thm_wald');
  });
});
