import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AudioRecorderPicker } from '../AudioRecorderPicker';

const w = window as unknown as { MediaRecorder?: unknown; isSecureContext?: boolean };

const setRecording = (opts: { mediaRecorder: boolean; getUserMedia: (() => Promise<MediaStream>) | null; secure?: boolean }) => {
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: opts.mediaRecorder ? class {} : undefined });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: opts.getUserMedia ? { getUserMedia: opts.getUserMedia } : undefined,
  });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: opts.secure ?? true });
};

const tapStart = () => fireEvent.click(screen.getByRole('button', { name: 'Aufnahme starten' }));

describe('Sprachnotiz aufnehmen', () => {
  afterEach(() => {
    delete w.MediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  it('ohne MediaRecorder: Hinweis, dass Aufnehmen hier nicht geht, statt „kein Mikrofon“', async () => {
    const getUserMedia = vi.fn(async () => ({}) as MediaStream);
    setRecording({ mediaRecorder: false, getUserMedia });
    render(<AudioRecorderPicker docId="doc-1" onDone={() => {}} onCancel={() => {}} />);
    tapStart();
    expect(await screen.findByText('Aufnehmen wird in diesem Browser nicht unterstützt.')).toBeTruthy();
    expect(screen.queryByText(/Kein Zugriff auf das Mikrofon/)).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ohne getUserMedia über HTTPS: ebenfalls „nicht unterstützt“', async () => {
    setRecording({ mediaRecorder: true, getUserMedia: null });
    render(<AudioRecorderPicker docId="doc-1" onDone={() => {}} onCancel={() => {}} />);
    tapStart();
    expect(await screen.findByText('Aufnehmen wird in diesem Browser nicht unterstützt.')).toBeTruthy();
  });

  it('ohne HTTPS fehlt getUserMedia: der Mikrofon-Hinweis nennt HTTPS', async () => {
    setRecording({ mediaRecorder: true, getUserMedia: null, secure: false });
    render(<AudioRecorderPicker docId="doc-1" onDone={() => {}} onCancel={() => {}} />);
    tapStart();
    expect(await screen.findByText(/Kein Zugriff auf das Mikrofon/)).toBeTruthy();
  });

  it('Berechtigung verweigert: bleibt „kein Zugriff auf das Mikrofon“', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    setRecording({ mediaRecorder: true, getUserMedia });
    render(<AudioRecorderPicker docId="doc-1" onDone={() => {}} onCancel={() => {}} />);
    tapStart();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(await screen.findByText(/Kein Zugriff auf das Mikrofon/)).toBeTruthy();
    expect(screen.queryByText('Aufnehmen wird in diesem Browser nicht unterstützt.')).toBeNull();
  });
});
