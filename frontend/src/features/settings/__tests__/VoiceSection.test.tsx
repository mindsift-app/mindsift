import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useVoiceSetting, VoiceSection } from '../user/VoiceSection';
import { User } from '../../../lib/types';

const user: User = {
  id: 'usr_1',
  email: 'anna@example.com',
  displayName: 'Anna',
  role: 'member',
  isActive: true,
  createdAt: '2026-11-10T08:00:00Z',
  voiceInput: 'browser',
};

const voice = { instant: {}, voiceSaving: false, handleChangeVoiceInput: vi.fn(), handleChangeVoiceLanguage: vi.fn() } as unknown as ReturnType<typeof useVoiceSetting>;

afterEach(() => {
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  Reflect.deleteProperty(window, 'SpeechRecognition');
});

describe('VoiceSection: browser recognition', () => {
  it('disables the browser option with a note where the browser has no recognition, and shows Whisper as chosen', () => {
    render(<VoiceSection voice={voice} currentUser={user} choice mode="server" />);
    const browser = screen.getByRole('radio', { name: /^Browser/ }) as HTMLButtonElement;
    expect(browser.disabled).toBe(true);
    expect(browser.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: /^Whisper-Server/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Hier nicht verfügbar: Dieses Fenster hat keine eingebaute Spracherkennung/)).toBeTruthy();
  });

  it('keeps the browser option selectable where the browser has recognition', () => {
    Object.assign(window, { webkitSpeechRecognition: function () {} });
    render(<VoiceSection voice={voice} currentUser={user} choice mode="browser" />);
    const browser = screen.getByRole('radio', { name: /^Browser/ }) as HTMLButtonElement;
    expect(browser.disabled).toBe(false);
    expect(browser.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/Hier nicht verfügbar/)).toBeNull();
  });
});
