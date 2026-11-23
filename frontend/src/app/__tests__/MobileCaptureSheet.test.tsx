import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MobileCaptureSheet } from '../MobileCaptureSheet';
import type { useMobileCapture } from '../useMobileCapture';

const askChoice = vi.hoisted(() => vi.fn());
vi.mock('../../components/askConfirm', () => ({ askChoice }));

type Capture = ReturnType<typeof useMobileCapture>;

// The Quick Dump sheet on phones with the voice input in a given state
function capture(state: 'idle' | 'listening' | 'transcribing', setShowMobileCapture = vi.fn()): Capture {
  return {
    showMobileCapture: true,
    setShowMobileCapture,
    mobileTriageContent: 'Milch kaufen',
    setMobileTriageContent: vi.fn(),
    mobileTriagePriority: 'normal',
    setMobileTriagePriority: vi.fn(),
    mobileTriageDueDate: '',
    setMobileTriageDueDate: vi.fn(),
    mobileVoiceError: null,
    mobileVoice: { mode: 'browser', available: true, state, pendingChunks: 0, start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), toggle: vi.fn(), level: () => null },
    mobileVoiceActive: state === 'listening',
    toggleMobileVoice: vi.fn(),
    handleMobileCreateTriage: vi.fn(),
    openMobileTriageCapture: vi.fn(),
    natural: { parsed: null, dismiss: vi.fn(), reset: vi.fn() },
  } as unknown as Capture;
}

describe('MobileCaptureSheet', () => {
  beforeEach(() => askChoice.mockReset());

  it('closes right away without a dictation', () => {
    const setShow = vi.fn();
    render(<MobileCaptureSheet capture={capture('idle', setShow)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(setShow).toHaveBeenCalledWith(false);
    expect(askChoice).not.toHaveBeenCalled();
  });

  it('asks before closing while a dictation runs: "Bleiben" keeps it, "Trotzdem schließen" closes', async () => {
    const setShow = vi.fn();
    render(<MobileCaptureSheet capture={capture('listening', setShow)} />);

    askChoice.mockResolvedValueOnce('alt');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    });
    expect(askChoice).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Beim Schließen'), confirmLabel: 'Trotzdem schließen' }));
    expect(setShow).not.toHaveBeenCalled();

    askChoice.mockResolvedValueOnce('confirm');
    // A tap on the dimmed page behind the sheet
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }).closest('.modal-overlay') as HTMLElement);
    });
    expect(setShow).toHaveBeenCalledWith(false);
  });
});
