import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../lib/media', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/media')>();
  return { ...orig, mediaObjectURL: async () => 'blob:bild' };
});

import { ImageBlock } from '../ImageBlock';

const setHover = (hover: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('hover: hover') ? hover : false, addEventListener() {}, removeEventListener() {} }),
  });
};

const RESET = 'Standardgröße';
const HANDLE = 'Ziehen, um die Größe zu ändern';

// The image box is 200 px wide, the note column 600 px
const layout = () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600);
};

const drag = (handle: HTMLElement, dx: number) => {
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + dx, clientY: 120 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 + dx, clientY: 120 });
};

describe('Bildgröße ändern', () => {
  beforeEach(() => setHover(true));
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('ohne geänderte Größe: kein Knopf zum Zurücksetzen, Bild in Standardgröße', async () => {
    render(<ImageBlock content="![Hafen](media:med_a1)" canEdit onCaptionChange={() => {}} onWidthChange={() => {}} />);
    await screen.findByTitle('Vergrößern');
    expect(screen.queryByRole('button', { name: RESET })).toBeNull();
    expect(screen.getByTitle(HANDLE)).toBeTruthy();
    const img = screen.getByRole('img', { name: 'Hafen' });
    expect(img.className).toContain('max-h-112');
    expect((img.closest('figure')!.firstElementChild as HTMLElement).style.width).toBe('');
  });

  it('mit geänderter Größe: Breite aus dem Inhalt, Höhe folgt (Seitenverhältnis bleibt), Zurücksetzen oben rechts', async () => {
    const onWidthChange = vi.fn();
    render(<ImageBlock content="![Hafen|320](media:med_a1)" canEdit onCaptionChange={() => {}} onWidthChange={onWidthChange} />);
    await screen.findByTitle('Vergrößern');
    const img = screen.getByRole('img', { name: 'Hafen' });
    expect((img.closest('figure')!.firstElementChild as HTMLElement).style.width).toBe('320px');
    expect(img.className).toContain('w-full');
    expect(img.className).toContain('h-auto');
    expect(img.className).not.toContain('max-h-112');
    // The caption field shows the caption without the width
    expect(screen.getByRole('textbox').textContent).toBe('Hafen');

    const reset = screen.getByRole('button', { name: RESET });
    expect(reset.parentElement!.className).toContain('right-1.5');
    expect(reset.parentElement!.className).toContain('top-1.5');
    fireEvent.click(reset);
    expect(onWidthChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ziehen an der Ecke ändert die Breite, mindestens 48 px, höchstens so breit wie die Notiz', async () => {
    const onWidthChange = vi.fn();
    render(<ImageBlock content="![](media:med_a1)" canEdit onCaptionChange={() => {}} onWidthChange={onWidthChange} />);
    await screen.findByTitle('Vergrößern');
    layout();
    const handle = screen.getByTitle(HANDLE);

    drag(handle, 120.4);
    expect(onWidthChange).toHaveBeenLastCalledWith(320);
    drag(handle, -500);
    expect(onWidthChange).toHaveBeenLastCalledWith(48);
    drag(handle, 2000);
    expect(onWidthChange).toHaveBeenLastCalledWith(600);
    // A click without moving changes nothing and does not open the picture
    onWidthChange.mockClear();
    drag(handle, 0);
    fireEvent.click(handle);
    expect(onWidthChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('während des Ziehens folgt die Breite dem Zeiger', async () => {
    render(<ImageBlock content="![](media:med_a1)" canEdit onCaptionChange={() => {}} onWidthChange={() => {}} />);
    await screen.findByTitle('Vergrößern');
    layout();
    const handle = screen.getByTitle(HANDLE);
    const box = handle.closest('figure')!.firstElementChild as HTMLElement;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 100 });
    expect(box.style.width).toBe('250px');
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150, clientY: 100 });
  });

  it('gesperrt (jemand anderes bearbeitet): keine Ecke zum Ziehen, Zurücksetzen grau', async () => {
    const onWidthChange = vi.fn();
    render(
      <ImageBlock content="![Hafen|320](media:med_a1)" canEdit={false} locked onCaptionChange={() => {}} onWidthChange={onWidthChange} />
    );
    await screen.findByTitle('Vergrößern');
    expect(screen.queryByTitle(HANDLE)).toBeNull();
    const reset = screen.getByRole('button', { name: RESET }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.click(reset);
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it('nur zum Lesen: Bild in der gespeicherten Größe, ohne Bedienelemente', async () => {
    render(<ImageBlock content="![Hafen|320](media:med_a1)" canEdit={false} onCaptionChange={() => {}} onWidthChange={() => {}} />);
    await screen.findByTitle('Vergrößern');
    expect((screen.getByRole('img', { name: 'Hafen' }).closest('figure')!.firstElementChild as HTMLElement).style.width).toBe('320px');
    expect(screen.queryByTitle(HANDLE)).toBeNull();
    expect(screen.queryByRole('button', { name: RESET })).toBeNull();
  });

  it('am Handy zeigen sich Ecke und Zurücksetzen erst nach dem Antippen', async () => {
    setHover(false);
    render(<ImageBlock content="![Hafen|320](media:med_a1)" canEdit onCaptionChange={() => {}} onWidthChange={() => {}} />);
    await screen.findByTitle('Vergrößern');
    const reset = screen.getByRole('button', { name: RESET });
    const handle = screen.getByTitle(HANDLE);
    expect(reset.parentElement!.className).toContain('opacity-0');
    expect(handle.parentElement!.className).toContain('opacity-0');
    fireEvent.click(screen.getByTitle('Vergrößern'));
    expect(reset.parentElement!.className).not.toContain('pointer-events-none');
    expect(handle.parentElement!.className).not.toContain('pointer-events-none');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('am Handy: ein Tippen neben das Bild hebt die Auswahl auf und erreicht trotzdem sein Ziel', async () => {
    setHover(false);
    const daneben = vi.fn();
    render(
      <>
        <ImageBlock content="![Hafen|320](media:med_a1)" canEdit onCaptionChange={() => {}} onWidthChange={() => {}} />
        <button type="button" onClick={daneben}>
          Daneben
        </button>
      </>
    );
    await screen.findByTitle('Vergrößern');
    const handle = screen.getByTitle(HANDLE);
    fireEvent.click(screen.getByTitle('Vergrößern'));
    expect(handle.parentElement!.className).not.toContain('pointer-events-none');

    // Escape bleibt der Notiz überlassen
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handle.parentElement!.className).not.toContain('pointer-events-none');

    const button = screen.getByRole('button', { name: 'Daneben' });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(handle.parentElement!.className).toContain('pointer-events-none');
    expect(daneben).toHaveBeenCalledTimes(1);
  });
});
