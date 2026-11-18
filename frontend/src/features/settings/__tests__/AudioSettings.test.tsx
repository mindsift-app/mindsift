import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioSettings } from '../admin/AudioSettings';
import { SystemSettings } from '../../../lib/types';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift', audioMaxMB: 50 };

describe('AudioSettings (audio in notes for the whole server)', () => {
  it('shows the defaults and saves compression and bitrate', () => {
    const onSave = vi.fn();
    render(<AudioSettings settings={base} onSave={onSave} />);
    const compression = screen.getByRole('button', { name: 'Audio-Komprimierung' });
    expect(compression.textContent).toContain('Nur Aufnahmen (Standard)');
    const bitrate = screen.getByRole('button', { name: 'Bitrate der Aufnahmen' });
    expect(bitrate.textContent).toContain('32 kbit/s (Standard)');
    fireEvent.click(bitrate);
    fireEvent.click(screen.getByRole('option', { name: '64 kbit/s' }));
    expect(onSave).toHaveBeenCalledWith({ audioBitrate: 64 });
    fireEvent.click(compression);
    fireEvent.click(screen.getByRole('option', { name: 'Aus' }));
    expect(onSave).toHaveBeenCalledWith({ audioCompression: 'off' });
  });

  it('hides the bitrate when compression is off', () => {
    render(<AudioSettings settings={{ ...base, audioCompression: 'off' }} onSave={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Bitrate der Aufnahmen' })).toBeNull();
  });

  it('saves the upload limit when the field is left, within 1 and MEDIA_MAX_AUDIO_MB', () => {
    const onSave = vi.fn();
    render(<AudioSettings settings={base} onSave={onSave} />);
    const input = screen.getByRole('spinbutton', { name: 'Größte hochgeladene Audiodatei' }) as HTMLInputElement;
    expect(input.value).toBe('7');
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe('7');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith({ audioUploadMaxMB: 20 });
  });

  it('is locked part by part when MEDIA_AUDIO_* fixes it', () => {
    render(
      <AudioSettings
        settings={{ ...base, audioBitrate: 40, audioBitrateConfiguredViaEnv: true, audioUploadMaxMBConfiguredViaEnv: true }}
        onSave={() => {}}
      />,
    );
    const bitrate = screen.getByRole('button', { name: 'Bitrate der Aufnahmen' }) as HTMLButtonElement;
    expect(bitrate.disabled).toBe(true);
    expect(bitrate.textContent).toContain('40 kbit/s');
    expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Audio-Komprimierung' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Festgelegt per MEDIA_AUDIO_BITRATE/)).toBeTruthy();
    expect(screen.getByText(/Festgelegt per MEDIA_AUDIO_UPLOAD_MAX_MB/)).toBeTruthy();
  });
});
