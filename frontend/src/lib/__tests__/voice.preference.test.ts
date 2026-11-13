import { afterEach, describe, expect, it, vi } from 'vitest';

const getAuthStatus = vi.fn();
vi.mock('../api', () => ({ api: { getAuthStatus: (...a: unknown[]) => getAuthStatus(...a) } }));

import { loadVoiceConfig, resetVoiceConfig, setVoicePreference, voiceChoiceAvailable } from '../voice';

// Recording and recognition as far as jsdom needs them to count as available
Object.assign(window, { MediaRecorder: function () {} });
Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
Object.assign(window, { webkitSpeechRecognition: function () {} });

afterEach(() => {
  resetVoiceConfig();
  getAuthStatus.mockReset();
});

describe('voice input: Whisper or browser per account', () => {
  it('uses the browser when the account picked it and the server allows it', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600, browserAllowed: true } });
    expect((await loadVoiceConfig()).mode).toBe('server');
    expect(voiceChoiceAvailable()).toBe(true);
    setVoicePreference('browser');
    expect((await loadVoiceConfig()).mode).toBe('browser');
    setVoicePreference('');
    expect((await loadVoiceConfig()).mode).toBe('server');
  });

  it('keeps Whisper when the server forbids the browser (STT_ALLOW_BROWSER=false)', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600, browserAllowed: false } });
    setVoicePreference('browser');
    expect((await loadVoiceConfig()).mode).toBe('server');
    expect(voiceChoiceAvailable()).toBe(false);
  });

  it('offers no choice without a Whisper server', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'browser', maxSeconds: 600, browserAllowed: true } });
    await loadVoiceConfig();
    expect(voiceChoiceAvailable()).toBe(false);
  });
});
