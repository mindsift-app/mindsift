import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HoldToRecordFab } from '../HoldToRecordFab';

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];

  lang = '';
  interimResults = false;
  continuous = false;
  started = false;
  stopped = false;
  aborted = false;

  onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
    this.onend?.();
  }

  abort() {
    this.aborted = true;
    this.onend?.();
  }

  emitResult(transcript: string) {
    this.onresult?.({
      results: [[{ transcript }]],
    });
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

describe('HoldToRecordFab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSpeechRecognition.instances = [];
    Object.assign(window, { SpeechRecognition: FakeSpeechRecognition });
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  });

  it('calls onTap on a short tap (< 350 ms)', () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn();

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerUp(btn, { clientY: 600 });
    fireEvent.click(btn);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(FakeSpeechRecognition.instances).toHaveLength(0);
  });

  it('starts recording on hold (>= 350 ms) and calls onTranscript with recognized text on release', async () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn().mockResolvedValue(undefined);

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(FakeSpeechRecognition.instances).toHaveLength(1);
    const rec = FakeSpeechRecognition.instances[0];
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('de-DE');
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(true);
    expect(screen.getByText(/Ich höre zu… \(loslassen speichert\)/i)).toBeTruthy();

    act(() => {
      rec.emitResult('Milch und Kaffee einkaufen');
    });
    expect(screen.getByText('Milch und Kaffee einkaufen')).toBeTruthy();

    await act(async () => {
      fireEvent.pointerUp(btn, { clientY: 600 });
      fireEvent.click(btn);
    });

    expect(rec.stopped).toBe(true);
    expect(onTap).not.toHaveBeenCalled();
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('Milch und Kaffee einkaufen');
    expect(screen.getByRole('status').textContent).toContain('Im Quick Dump gespeichert');
  });

  it('cancels recording when dragged up by more than 60 px and released', () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn();

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const rec = FakeSpeechRecognition.instances[0];
    act(() => {
      rec.emitResult('Verwerfen Test');
    });

    // Drag up by 80px (> 60px threshold)
    fireEvent.pointerMove(btn, { clientY: 520 });
    expect(screen.getByText(/🗑️ Zum Abbrechen loslassen/i)).toBeTruthy();

    fireEvent.pointerUp(btn, { clientY: 520 });

    fireEvent.click(btn);

    expect(rec.aborted).toBe(true);
    expect(onTap).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('resumes normal recording if dragged above 60 px and then pulled back down before release', async () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn().mockResolvedValue(undefined);

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const rec = FakeSpeechRecognition.instances[0];
    act(() => {
      rec.emitResult('Doch behalten');
    });

    // Drag up into cancel zone
    fireEvent.pointerMove(btn, { clientY: 510 });
    expect(screen.getByText(/🗑️ Zum Abbrechen loslassen/i)).toBeTruthy();

    // Drag back down below threshold
    fireEvent.pointerMove(btn, { clientY: 580 });
    expect(screen.getByText(/Ich höre zu… \(loslassen speichert\)/i)).toBeTruthy();

    await act(async () => {
      fireEvent.pointerUp(btn, { clientY: 580 });
      fireEvent.click(btn);
    });

    expect(rec.aborted).toBe(false);
    expect(onTranscript).toHaveBeenCalledWith('Doch behalten');
  });

  it('shows "Nichts erkannt" and does not save when transcript is empty', async () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn();

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {
      fireEvent.pointerUp(btn, { clientY: 600 });
      fireEvent.click(btn);
    });

    expect(onTap).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Nichts erkannt');
  });

  it('falls back to onTap and shows message when microphone permission is denied', () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn();

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const rec = FakeSpeechRecognition.instances[0];
    act(() => {
      rec.emitError('not-allowed');
    });
    fireEvent.pointerUp(btn, { clientY: 600 });
    fireEvent.click(btn);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Mikrofon nicht freigegeben');
  });

  it('falls back to onTap and shows a status message when SpeechRecognition is unsupported', () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');

    const onTap = vi.fn();
    const onTranscript = vi.fn();

    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', {
      name: /Schnell erfassen – tippen zum Schreiben, gedrückt halten zum Sprechen/i,
    });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    fireEvent.pointerUp(btn, { clientY: 600 });
    fireEvent.click(btn);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(
      'Spracheingabe wird von diesem Browser nicht unterstützt'
    );
  });
});

describe('HoldToRecordFab tap timing', () => {
  it('opens only on the click after the release, so that click cannot close the new sheet', () => {
    const onTap = vi.fn();
    render(<HoldToRecordFab onTap={onTap} onTranscript={vi.fn()} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    fireEvent.pointerUp(btn, { clientY: 600 });
    expect(onTap).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

describe('HoldToRecordFab keyboard access', () => {
  it('opens the capture sheet when activated without a pointer (keyboard, screen reader)', () => {
    const onTap = vi.fn();
    const { getByRole } = render(<HoldToRecordFab onTap={onTap} onTranscript={vi.fn()} />);
    fireEvent.click(getByRole('button'), { detail: 0 });
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
