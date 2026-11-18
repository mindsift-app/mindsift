import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SpeechModelsInfo, SystemSettings } from '../../../lib/types';

const { api } = vi.hoisted(() => ({
  api: { adminSpeechModels: vi.fn(), adminDownloadSpeechModel: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({ api, triggerHaptic: vi.fn() }));

import { SpeechSettingsCard } from '../admin/SpeechSettingsCard';
import { SpeechModelPicker } from '../admin/SpeechModelPicker';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };
const models: SpeechModelsInfo = {
  model: 'Systran/faster-whisper-small',
  reachable: true,
  models: [
    { id: 'deepdml/faster-whisper-large-v3-turbo-ct2', sizeMb: 1600, downloaded: false },
    { id: 'Systran/faster-whisper-small', sizeMb: 480, downloaded: true },
  ],
  downloads: [],
};

beforeEach(() => {
  api.adminSpeechModels.mockReset().mockResolvedValue(models);
  api.adminDownloadSpeechModel.mockReset().mockResolvedValue({ downloaded: false });
});

describe('SpeechSettingsCard (voice input of the server)', () => {
  it('saves the mode and the Whisper server, the key only when typed', () => {
    const onSave = vi.fn();
    render(<SpeechSettingsCard settings={{ ...base, speech: { mode: 'browser', url: '', model: '' } }} onSave={onSave} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Spracherkennung' }));
    fireEvent.click(screen.getByRole('option', { name: 'Eigener Whisper-Server' }));
    expect(onSave).toHaveBeenLastCalledWith({ speech: expect.objectContaining({ mode: 'server' }) });
    fireEvent.change(screen.getByLabelText('Adresse des Whisper-Servers'), { target: { value: 'http://whisper:8000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const sent = onSave.mock.calls[onSave.mock.calls.length - 1][0].speech;
    expect(sent.url).toBe('http://whisper:8000');
    expect(sent.apiKey).toBeUndefined();
  });

  it('locks what STT_* fixes and names the variable', () => {
    render(
      <SpeechSettingsCard
        settings={{ ...base, speech: { mode: 'off', url: 'http://w:8000', model: 'm', maxSeconds: 30, configuredViaEnv: ['mode', 'url', 'maxSeconds'] } }}
        onSave={() => {}}
        onChanged={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: 'Spracherkennung' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Adresse des Whisper-Servers') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('spinbutton', { name: 'Längste Aufnahme' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Festgelegt per STT_DISABLED/)).toBeTruthy();
    expect(screen.getByText(/Festgelegt per STT_MAX_SECONDS/)).toBeTruthy();
  });
});

describe('SpeechModelPicker (models of the Whisper server)', () => {
  it('marks downloaded models and downloads a grey one with a click', async () => {
    render(<SpeechModelPicker locked={false} onChanged={() => {}} />);
    const turbo = await screen.findByText('deepdml/faster-whisper-large-v3-turbo-ct2');
    const small = screen.getByText('Systran/faster-whisper-small').closest('button')!;
    expect(small.getAttribute('data-downloaded')).toBe('true');
    expect(small.textContent).toContain('In Verwendung');
    const turboButton = turbo.closest('button')!;
    expect(turboButton.getAttribute('data-downloaded')).toBe('false');
    expect(turboButton.textContent).toContain('Herunterladen');
    api.adminSpeechModels.mockResolvedValue({
      ...models,
      downloads: [{ model: 'deepdml/faster-whisper-large-v3-turbo-ct2', startedAt: new Date().toISOString(), running: true }],
    });
    fireEvent.click(turboButton);
    await waitFor(() => expect(api.adminDownloadSpeechModel).toHaveBeenCalledWith('deepdml/faster-whisper-large-v3-turbo-ct2', true));
    expect(await screen.findByText(/Wird heruntergeladen/)).toBeTruthy();
  });

  it('only shows the models when STT_MODEL fixes the model', async () => {
    render(<SpeechModelPicker locked onChanged={() => {}} />);
    const small = (await screen.findByText('Systran/faster-whisper-small')).closest('button')!;
    expect(small.disabled).toBe(true);
    expect(screen.queryByLabelText('Anderes Modell')).toBeNull();
  });
});
