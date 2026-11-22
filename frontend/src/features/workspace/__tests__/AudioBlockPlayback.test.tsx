import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mediaObjectURL = vi.fn(async (id: string, _kind?: 'audio') => `blob:${id}`);
vi.mock('../../../lib/media', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/media')>();
  return { ...orig, mediaObjectURL: (id: string, kind?: 'audio') => mediaObjectURL(id, kind) };
});

import { AudioBlock } from '../AudioBlock';

const player = async (container: HTMLElement) => {
  await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
  return container.querySelector('audio')!;
};

describe('Sprachnotiz abspielen', () => {
  beforeEach(() => mediaObjectURL.mockClear());

  it('lädt die Aufnahme als abspielbare Datei (WebM mit Länge)', async () => {
    const { container } = render(<AudioBlock content="[Einkauf](media:med_a1)" canEdit onCaptionChange={() => {}} />);
    const audio = await player(container);
    expect(mediaObjectURL).toHaveBeenCalledWith('med_a1', 'audio');
    expect(audio.getAttribute('src')).toBe('blob:med_a1');
  });

  it('hält die Wiedergabe an und gibt die Datei frei, wenn die Notiz verlassen wird', async () => {
    const { container, unmount } = render(<AudioBlock content="[Einkauf](media:med_a1)" canEdit onCaptionChange={() => {}} />);
    const audio = await player(container);
    const pause = vi.spyOn(audio, 'pause');
    const load = vi.spyOn(audio, 'load');
    unmount();
    expect(pause).toHaveBeenCalled();
    expect(audio.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it('eine neue Aufnahme im selben Punkt behält ihre Datei', async () => {
    const { container, rerender } = render(<AudioBlock content="[](media:med_a1)" canEdit onCaptionChange={() => {}} />);
    const audio = await player(container);
    rerender(<AudioBlock content="[](media:med_a2)" canEdit onCaptionChange={() => {}} />);
    await waitFor(() => expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:med_a2'));
    expect(container.querySelector('audio')).toBe(audio);
  });

  it('startet eine zweite Sprachnotiz, hält die erste an', async () => {
    const first = render(<AudioBlock content="[](media:med_a1)" canEdit onCaptionChange={() => {}} />);
    const second = render(<AudioBlock content="[](media:med_a2)" canEdit onCaptionChange={() => {}} />);
    const a1 = await player(first.container);
    const a2 = await player(second.container);
    const pause1 = vi.spyOn(a1, 'pause');
    const pause2 = vi.spyOn(a2, 'pause');
    fireEvent.play(a1);
    expect(pause1).not.toHaveBeenCalled();
    fireEvent.play(a2);
    expect(pause1).toHaveBeenCalledTimes(1);
    expect(pause2).not.toHaveBeenCalled();
  });
});
