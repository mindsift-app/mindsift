import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../lib/media', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/media')>();
  return { ...orig, mediaObjectURL: async () => 'blob:medien' };
});

import { ImageBlock } from '../ImageBlock';
import { AudioBlock } from '../AudioBlock';
import { MediaCaption } from '../MediaCaption';

const LONG = 'Das ist ein langes Transkript einer Sprachnotiz, das weit über zwei Zeilen hinausgeht und deshalb gekürzt wird.';

// jsdom lays nothing out: a cut-off text has a scrollHeight above its clientHeight
const fakeOverflow = () => {
  const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('line-clamp-2') ? 64 : 32;
  });
  const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(32);
  return () => {
    sh.mockRestore();
    ch.mockRestore();
  };
};

describe('Beschriftung von Bild und Sprachnotiz', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Bild', (props: Record<string, unknown>) => <ImageBlock content="![](media:med_b1)" canEdit onCaptionChange={() => {}} {...props} />],
    ['Sprachnotiz', (props: Record<string, unknown>) => <AudioBlock content="[](media:med_b2)" canEdit onCaptionChange={() => {}} {...props} />],
  ])('%s: Enter speichert die Beschriftung und legt darunter einen neuen Punkt an', (_, make) => {
    const onCaptionChange = vi.fn();
    const onExitBelow = vi.fn();
    render(make({ onCaptionChange, onExitBelow }));
    const field = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Hafen am Abend' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onCaptionChange).toHaveBeenCalledWith('Hafen am Abend');
    expect(onExitBelow).toHaveBeenCalledTimes(1);
  });

  it('Umschalt+Enter verlässt nur die Beschriftung, ohne neuen Punkt', () => {
    const onCaptionChange = vi.fn();
    const onExitBelow = vi.fn();
    render(<AudioBlock content="[](media:med_b2)" canEdit onCaptionChange={onCaptionChange} onExitBelow={onExitBelow} />);
    const field = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' }) as HTMLTextAreaElement;
    field.focus();
    fireEvent.change(field, { target: { value: 'Notiz' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onExitBelow).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
    expect(onCaptionChange).toHaveBeenCalledWith('Notiz');
  });

  it('Gesperrt: Enter legt keinen Punkt an, die Beschriftung ist nur lesbar', () => {
    const onExitBelow = vi.fn();
    render(<ImageBlock content="![Hafen](media:med_b1)" canEdit={false} locked onCaptionChange={() => {}} onExitBelow={onExitBelow} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Hafen')).toBeTruthy();
  });

  it('Zeilenumbrüche (auch eingefügte) werden zu Leerzeichen, die Beschriftung bleibt eine Zeile Text', () => {
    const onChange = vi.fn();
    render(<MediaCaption value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Erste\nZweite' } });
    expect(onChange).toHaveBeenCalledWith('Erste Zweite');
  });

  it('Lange Beschriftung: auf zwei Zeilen gekürzt, „mehr“ zeigt sie ganz, „weniger“ kürzt wieder', () => {
    const restore = fakeOverflow();
    render(<MediaCaption value={LONG} />);
    const text = screen.getByText(LONG);
    expect(text.className).toContain('line-clamp-2');
    expect(text.className).toContain('whitespace-pre-wrap');
    fireEvent.click(screen.getByRole('button', { name: 'mehr' }));
    expect(text.className).not.toContain('line-clamp-2');
    fireEvent.click(screen.getByRole('button', { name: 'weniger' }));
    expect(text.className).toContain('line-clamp-2');
    restore();
  });

  it('Kurze Beschriftung: kein „mehr“', () => {
    render(<MediaCaption value="Kurz" />);
    expect(screen.queryByRole('button', { name: 'mehr' })).toBeNull();
  });

  it('Bearbeitbar: ein Klick in die gekürzte Beschriftung öffnet das Feld mit dem ganzen Text', () => {
    const restore = fakeOverflow();
    const onCommit = vi.fn();
    render(<MediaCaption value={LONG} onChange={() => {}} onCommit={onCommit} />);
    const shown = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' });
    expect(shown.tagName).toBe('DIV');
    fireEvent.focus(shown);
    const field = screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' }) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe(LONG);
    expect(document.activeElement).toBe(field);
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Beschriftung hinzufügen…' }).tagName).toBe('DIV');
    restore();
  });
});
