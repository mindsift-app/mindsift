import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../lib/media', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/media')>();
  return { ...orig, mediaObjectURL: async () => 'blob:bild' };
});

import { ImageBlock } from '../ImageBlock';
import { DrawingBlock } from '../drawing/DrawingBlock';
import { CodeBlockEditor } from '../CodeBlockEditor';
import type { DocumentBlock } from '../../../lib/types';

const setHover = (hover: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('hover: hover') ? hover : false, addEventListener() {}, removeEventListener() {} }),
  });
};

const DRAWING = JSON.stringify({ v: 1, els: [{ id: 'a', ver: 1, t: 'rect', x: 0, y: 0, w: 120, h: 60, s: 'main', f: 'none', sw: 2 }] });

const codeBlock = (lang = 'yaml'): DocumentBlock => ({ id: 'code-1', type: 'code', content: 'name: mindsift', lang, level: 0, position: 1 });

describe('Pfeile zum Ein- und Ausrücken an Bild, Zeichnung und Code', () => {
  beforeEach(() => setHover(true));
  afterEach(() => {
    // jsdom has no matchMedia of its own
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('Bild: die Pfeile rücken den Punkt ein und aus und öffnen das Bild nicht', async () => {
    const onIndent = vi.fn();
    const onOutdent = vi.fn();
    render(
      <ImageBlock content="![](media:med_a1)" canEdit onCaptionChange={() => {}} onIndent={onIndent} onOutdent={onOutdent} canIndent canOutdent />
    );
    await screen.findByTitle('Vergrößern');
    fireEvent.click(screen.getByRole('button', { name: 'Einrücken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ausrücken' }));
    expect(onIndent).toHaveBeenCalledTimes(1);
    expect(onOutdent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Bild: eine leere Beschriftung zeigt sich erst über dem Bild, eine vorhandene immer', async () => {
    const { unmount } = render(<ImageBlock content="![](media:med_a1)" canEdit onCaptionChange={() => {}} />);
    await screen.findByTitle('Vergrößern');
    const empty = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' });
    expect(empty.className).toContain('opacity-0');
    expect(empty.className).toContain('group-hover/image:opacity-100');
    unmount();

    render(<ImageBlock content="![Hafen am Abend](media:med_a1)" canEdit onCaptionChange={() => {}} />);
    const filled = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' }) as HTMLInputElement;
    expect(filled.value).toBe('Hafen am Abend');
    expect(filled.className).not.toContain('opacity-0');
  });

  it('Bild am Handy: der erste Tipp zeigt Pfeile und Beschriftung, der zweite öffnet das Bild', async () => {
    setHover(false);
    render(<ImageBlock content="![](media:med_a1)" canEdit onCaptionChange={() => {}} onIndent={() => {}} canIndent />);
    await screen.findByTitle('Vergrößern');
    const caption = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' });
    const image = screen.getByRole('button', { name: 'Vergrößern' });

    fireEvent.click(image);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(caption.className).not.toContain('opacity-0');
    expect(screen.getByRole('button', { name: 'Einrücken' }).parentElement!.className).toContain('opacity-100');

    fireEvent.click(image);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Bild in Bearbeitung durch jemand anderen: Pfeile bleiben grau und gesperrt, die Beschriftung nur lesbar', async () => {
    const onIndent = vi.fn();
    render(
      <ImageBlock content="![Hafen](media:med_a1)" canEdit={false} locked onCaptionChange={() => {}} onIndent={onIndent} onOutdent={() => {}} canIndent canOutdent />
    );
    await screen.findByTitle('Vergrößern');
    const indent = screen.getByRole('button', { name: 'Einrücken' }) as HTMLButtonElement;
    expect(indent.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ausrücken' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(indent);
    expect(onIndent).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLInputElement).readOnly).toBe(true);
  });

  it('Bild nur zum Lesen: keine Pfeile und kein Beschriftungsfeld', async () => {
    render(<ImageBlock content="![](media:med_a1)" canEdit={false} onCaptionChange={() => {}} onIndent={() => {}} />);
    await screen.findByTitle('Vergrößern');
    expect(screen.queryByRole('button', { name: 'Einrücken' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Zeichnung: Pfeile oben links, unsichtbar bis zum Darüberfahren oder Antippen', () => {
    const onIndent = vi.fn();
    render(
      <DrawingBlock docId="d1" blockId="b1" content={DRAWING} canEdit onChange={() => {}} onIndent={onIndent} onOutdent={() => {}} canIndent />
    );
    const indent = screen.getByRole('button', { name: 'Einrücken' });
    const box = indent.parentElement!;
    expect(box.className).toContain('opacity-0');
    expect(box.className).toContain('group-hover/drawing:opacity-100');
    expect((screen.getByRole('button', { name: 'Ausrücken' }) as HTMLButtonElement).disabled).toBe(true);

    // A press on an arrow does not start moving the drawing
    fireEvent.pointerDown(indent);
    fireEvent.click(indent);
    expect(onIndent).toHaveBeenCalledTimes(1);
    expect(box.className).toContain('opacity-0');

    // Tapping the drawing shows them
    fireEvent.pointerDown(screen.getByRole('img'));
    expect(box.className).not.toContain('opacity-0');
  });

  it('Zeichnung in Bearbeitung durch jemand anderen: Pfeile grau und gesperrt', () => {
    const onIndent = vi.fn();
    render(
      <DrawingBlock docId="d1" blockId="b1" content={DRAWING} canEdit={false} onChange={() => {}} onIndent={onIndent} canIndent indentLocked />
    );
    const indent = screen.getByRole('button', { name: 'Einrücken' }) as HTMLButtonElement;
    expect(indent.disabled).toBe(true);
    fireEvent.click(indent);
    expect(onIndent).not.toHaveBeenCalled();
  });

  it('Code am Handy ohne Pfeile (die Leiste über der Tastatur rückt ein), ab sm wie bisher', () => {
    render(<CodeBlockEditor block={codeBlock()} canEdit onIndent={() => {}} onOutdent={() => {}} canIndent />);
    const indent = screen.getByRole('button', { name: 'Einrücken' });
    expect(indent.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'sm:flex']));
  });

  it('Code in Bearbeitung durch jemand anderen: Pfeile und Sprache bleiben an ihrem Platz, grau und gesperrt', () => {
    const onIndent = vi.fn();
    render(<CodeBlockEditor block={codeBlock()} canEdit={false} locked onIndent={onIndent} onOutdent={() => {}} canIndent canOutdent />);
    const indent = screen.getByRole('button', { name: 'Einrücken' }) as HTMLButtonElement;
    expect(indent.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ausrücken' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(indent);
    expect(onIndent).not.toHaveBeenCalled();
    const language = screen.getByRole('button', { name: 'Sprache auswählen' }) as HTMLButtonElement;
    expect(language.disabled).toBe(true);
    expect(language.textContent).toContain('YAML');
  });
});
