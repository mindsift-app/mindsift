import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SpeechModelsInfo, SystemSettings } from '../../../lib/types';

const { api, askConfirm } = vi.hoisted(() => ({
  api: { adminSpeechModels: vi.fn(), adminDownloadSpeechModel: vi.fn(), adminDeleteSpeechModel: vi.fn() },
  askConfirm: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ api, triggerHaptic: vi.fn() }));
vi.mock('../../../components/askConfirm', () => ({ askConfirm }));

import { SpeechSettingsCard } from '../admin/SpeechSettingsCard';
import { SpeechModelPicker } from '../admin/SpeechModelPicker';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };
const models: SpeechModelsInfo = {
  model: 'Systran/faster-whisper-small',
  reachable: true,
  models: [
    { id: 'deepdml/faster-whisper-large-v3-turbo-ct2', sizeMb: 1600, downloaded: false },
    { id: 'Systran/faster-whisper-small', sizeMb: 480, downloaded: true },
    { id: 'Systran/faster-whisper-tiny', downloaded: true },
  ],
  downloads: [],
};

beforeEach(() => {
  api.adminSpeechModels.mockReset().mockResolvedValue(models);
  api.adminDownloadSpeechModel.mockReset().mockResolvedValue({ downloaded: false });
  api.adminDeleteSpeechModel.mockReset().mockResolvedValue({ deleted: true });
  askConfirm.mockReset().mockResolvedValue(true);
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

  it('shows the limits with their units and saves one when the field is left', () => {
    const onSave = vi.fn();
    render(
      <SpeechSettingsCard
        settings={{ ...base, speech: { mode: 'server', url: '', model: '', maxSeconds: 600, maxUploadMb: 25, maxParallel: 1, perUserPerHour: 60, timeoutSeconds: 120 } }}
        onSave={onSave}
        onChanged={() => {}}
      />,
    );
    const limits = document.querySelector('[data-speech-limits]')!;
    expect(limits.textContent).toContain('pro Stunde');
    expect(limits.textContent).toContain('gleichzeitig');
    expect(limits.textContent).toContain('MB');
    const field = screen.getByRole('spinbutton', { name: 'Erkennungen je Person' });
    expect(field.getAttribute('aria-valuetext')).toBe('60 pro Stunde');
    fireEvent.change(field, { target: { value: '30' } });
    fireEvent.blur(field);
    expect(onSave).toHaveBeenLastCalledWith({ speech: expect.objectContaining({ perUserPerHour: 30 }) });
  });

  it('switches the pieces while speaking off and sets their length, locked by STT_CHUNKED and STT_CHUNK_SECONDS', () => {
    const onSave = vi.fn();
    const { rerender } = render(<SpeechSettingsCard settings={{ ...base, speech: { mode: 'server', url: '', model: '' } }} onSave={onSave} onChanged={() => {}} />);
    const seconds = screen.getByRole('spinbutton', { name: 'Länge eines Stücks' }) as HTMLInputElement;
    expect(seconds.value).toBe('8');
    fireEvent.change(seconds, { target: { value: '4' } });
    fireEvent.blur(seconds);
    expect(onSave).toHaveBeenLastCalledWith({ speech: expect.objectContaining({ chunkSeconds: 4 }) });
    fireEvent.change(seconds, { target: { value: '1' } });
    fireEvent.blur(seconds);
    expect(onSave).toHaveBeenLastCalledWith({ speech: expect.objectContaining({ chunkSeconds: 2 }) });
    fireEvent.click(screen.getByTitle('Text schon beim Sprechen'));
    expect(onSave).toHaveBeenLastCalledWith({ speech: expect.objectContaining({ chunked: false }) });

    rerender(
      <SpeechSettingsCard
        settings={{ ...base, speech: { mode: 'server', url: '', model: '', chunked: true, chunkSeconds: 3, configuredViaEnv: ['chunked', 'chunkSeconds'] } }}
        onSave={onSave}
        onChanged={() => {}}
      />,
    );
    expect((screen.getByRole('spinbutton', { name: 'Länge eines Stücks' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Festgelegt per STT_CHUNKED/)).toBeTruthy();
    expect(screen.getByText(/Festgelegt per STT_CHUNK_SECONDS/)).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: /^Modell .* löschen$/ })).toBeNull();
  });

  it('deletes a downloaded model other than the one in use after asking, then reloads the list', async () => {
    render(<SpeechModelPicker locked={false} onChanged={() => {}} />);
    await screen.findByText('Systran/faster-whisper-tiny');
    // Only the downloaded one not in use: not the model in use, not one still to download
    expect(screen.getAllByRole('button', { name: /^Modell .* löschen$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Modell Systran/faster-whisper-small löschen' })).toBeNull();
    api.adminSpeechModels.mockClear();

    askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Modell Systran/faster-whisper-tiny löschen' }));
    await waitFor(() => expect(askConfirm).toHaveBeenCalledTimes(1));
    expect(askConfirm.mock.calls[0][0]).toMatchObject({ danger: true, confirmLabel: 'Löschen' });
    expect(api.adminDeleteSpeechModel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Modell Systran/faster-whisper-tiny löschen' }));
    await waitFor(() => expect(api.adminDeleteSpeechModel).toHaveBeenCalledWith('Systran/faster-whisper-tiny'));
    await waitFor(() => expect(api.adminSpeechModels).toHaveBeenCalled());
  });

  it('offers no delete while the model downloads', async () => {
    api.adminSpeechModels.mockResolvedValue({
      ...models,
      downloads: [{ model: 'Systran/faster-whisper-tiny', startedAt: new Date().toISOString(), running: true }],
    });
    render(<SpeechModelPicker locked={false} onChanged={() => {}} />);
    await screen.findByText('Systran/faster-whisper-tiny');
    expect(screen.queryByRole('button', { name: /^Modell .* löschen$/ })).toBeNull();
  });
});
