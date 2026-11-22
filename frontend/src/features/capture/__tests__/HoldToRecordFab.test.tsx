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

  it('names a recognised date after saving and takes it back with Rückgängig', async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    const undo = vi.fn().mockResolvedValue(undefined);
    const onTranscript = vi.fn().mockResolvedValue({ due: '2026-11-17T14:00', undo });

    render(<HoldToRecordFab onTap={vi.fn()} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', { name: /gedrückt halten zum Sprechen/i });
    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const rec = FakeSpeechRecognition.instances[0];
    act(() => {
      rec.emitResult('Zahnarzt morgen um 14 Uhr');
    });
    await act(async () => {
      fireEvent.pointerUp(btn, { clientY: 600 });
      fireEvent.click(btn);
    });

    expect(onTranscript).toHaveBeenCalledWith('Zahnarzt morgen um 14 Uhr');
    expect(screen.getByRole('status').textContent).toContain('Im Quick Dump gespeichert · Fällig: Morgen, 14:00');
    // Longer than the plain hint, so there is time to take it back
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the plain hint without Rückgängig when no date was recognised', async () => {
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    render(<HoldToRecordFab onTap={vi.fn()} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', { name: /gedrückt halten zum Sprechen/i });
    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    act(() => {
      FakeSpeechRecognition.instances[0].emitResult('Milch kaufen');
    });
    await act(async () => {
      fireEvent.pointerUp(btn, { clientY: 600 });
      fireEvent.click(btn);
    });
    expect(screen.getByRole('status').textContent).toBe('Im Quick Dump gespeichert');
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
  });

  it('locks when slid up while held: keeps recording after release, a tap stops and saves', async () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', { name: /gedrückt halten zum Sprechen/i });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const rec = FakeSpeechRecognition.instances[0];
    expect(screen.getByTestId('dictation-lock-hint').textContent).toContain('Nach oben ziehen zum Feststellen');
    expect(btn.getAttribute('data-dictation')).toBe('recording');

    act(() => {
      rec.emitResult('Paket zur Post bringen');
    });
    fireEvent.pointerMove(btn, { clientY: 520, pointerType: 'touch' });
    expect(btn.getAttribute('data-locked')).toBe('true');
    expect(screen.getByText('Aufnahme läuft – tippen beendet')).toBeTruthy();
    expect(screen.queryByTestId('dictation-lock-hint')).toBeNull();

    fireEvent.pointerUp(btn, { clientY: 520, pointerType: 'touch' });
    fireEvent.click(btn);
    expect(rec.stopped).toBe(false);
    expect(rec.aborted).toBe(false);
    expect(onTap).not.toHaveBeenCalled();

    // A tap on the red button (now named "Aufnahme beenden") stops and saves
    const stopBtn = screen.getByRole('button', { name: 'Aufnahme beenden' });
    await act(async () => {
      fireEvent.pointerDown(stopBtn, { clientY: 600, button: 0, pointerType: 'touch' });
      fireEvent.pointerUp(stopBtn, { clientY: 600, pointerType: 'touch' });
      fireEvent.click(stopBtn);
    });
    expect(rec.stopped).toBe(true);
    expect(onTranscript).toHaveBeenCalledWith('Paket zur Post bringen');
    expect(onTap).not.toHaveBeenCalled();
  });

  it('keeps recording and saves on release when slid up only a little', async () => {
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    render(<HoldToRecordFab onTap={vi.fn()} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', { name: /gedrückt halten zum Sprechen/i });
    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const rec = FakeSpeechRecognition.instances[0];
    act(() => {
      rec.emitResult('Doch behalten');
    });
    fireEvent.pointerMove(btn, { clientY: 570 });
    expect(btn.getAttribute('data-locked')).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(btn, { clientY: 570 });
      fireEvent.click(btn);
    });
    expect(rec.aborted).toBe(false);
    expect(onTranscript).toHaveBeenCalledWith('Doch behalten');
  });

  it('throws the recording away with the small × without asking, held or locked', () => {
    const onTap = vi.fn();
    const onTranscript = vi.fn();
    render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
    const btn = screen.getByRole('button', { name: /gedrückt halten zum Sprechen/i });

    fireEvent.pointerDown(btn, { clientY: 600, button: 0 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const rec = FakeSpeechRecognition.instances[0];
    act(() => {
      rec.emitResult('Verwerfen Test');
    });
    fireEvent.pointerMove(btn, { clientY: 500 });
    fireEvent.pointerUp(btn, { clientY: 500 });

    const cancel = screen.getByRole('button', { name: 'Aufnahme verwerfen' });
    // 44 px to tap on the phone
    expect(cancel.className).toContain('w-11');
    expect(cancel.className).toContain('h-11');
    fireEvent.click(cancel);

    expect(rec.aborted).toBe(true);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
    expect(btn.getAttribute('data-dictation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aufnahme verwerfen' })).toBeNull();
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
    expect(screen.getByRole('status').textContent).toContain('Spracheingabe ist hier nicht verfügbar');
    expect(screen.getByRole('status').textContent).toContain('Whisper-Server');
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
