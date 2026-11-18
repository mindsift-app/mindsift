import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageSettings } from '../admin/ImageSettings';
import { MediaQuotaSetting } from '../admin/MediaQuotaSetting';
import { SystemSettings } from '../../../lib/types';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };

describe('ImageSettings (images in notes for the whole server)', () => {
  it('shows high by default and saves another level, off included', () => {
    const onSave = vi.fn();
    render(<ImageSettings settings={base} onSave={onSave} />);
    const button = screen.getByRole('button', { name: 'Bildqualität' });
    expect(button.textContent).toContain('Hoch (Standard)');
    fireEvent.click(button);
    expect(screen.getAllByRole('option')).toHaveLength(4);
    fireEvent.click(screen.getByRole('option', { name: /Sparsam/ }));
    expect(onSave).toHaveBeenCalledWith({ imageQuality: 'low' });
  });

  it('switches images and images from other addresses off, and saves the largest image', () => {
    const onSave = vi.fn();
    render(<ImageSettings settings={base} onSave={onSave} />);
    fireEvent.click(screen.getByTitle('Bilder von fremden Adressen'));
    expect(onSave).toHaveBeenCalledWith({ externalImages: false });
    const input = screen.getByRole('spinbutton', { name: 'Größtes Bild' }) as HTMLInputElement;
    expect(input.value).toBe('15');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith({ imageLimitMB: 30 });
    fireEvent.click(screen.getByTitle('Bilder in Notizen'));
    expect(onSave).toHaveBeenCalledWith({ images: false });
  });

  it('greys out the rest while images are off', () => {
    render(<ImageSettings settings={{ ...base, images: false }} onSave={() => {}} />);
    const quality = screen.getByRole('button', { name: 'Bildqualität' }) as HTMLButtonElement;
    expect(quality.disabled).toBe(true);
    expect(quality.closest('[data-admin-image-quality]')?.className).toContain('opacity-50');
    expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTitle('Bilder von fremden Adressen') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is locked part by part when MEDIA_* fixes it', () => {
    render(
      <ImageSettings
        settings={{ ...base, imageQuality: 'medium', imageQualityConfiguredViaEnv: true, imageLimitMBConfiguredViaEnv: true, externalImagesConfiguredViaEnv: true }}
        onSave={() => {}}
      />,
    );
    const quality = screen.getByRole('button', { name: 'Bildqualität' }) as HTMLButtonElement;
    expect(quality.textContent).toContain('Mittel');
    expect(quality.disabled).toBe(true);
    expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTitle('Bilder in Notizen') as HTMLButtonElement).disabled).toBe(false);
    for (const env of ['MEDIA_IMAGE_QUALITY', 'MEDIA_MAX_IMAGE_MB', 'MEDIA_EXTERNAL_IMAGES']) {
      expect(screen.getByText(new RegExp(`Festgelegt per ${env}`))).toBeTruthy();
    }
  });
});

describe('ImageSettings in the demo', () => {
  it('names the demo, not a variable, as what fixes images from other addresses', () => {
    render(<ImageSettings settings={{ ...base, externalImages: false, externalImagesConfiguredViaEnv: true }} demoMode onSave={() => {}} />);
    expect(screen.getByText(/Festgelegt per MINDSIFT_DEMO/)).toBeTruthy();
  });
});

describe('MediaQuotaSetting (storage per person)', () => {
  it('saves 0 for unlimited and is locked by MEDIA_QUOTA_MB', () => {
    const onSave = vi.fn();
    const { rerender } = render(<MediaQuotaSetting settings={{ ...base, mediaQuotaMB: 500 }} onSave={onSave} />);
    const input = screen.getByRole('spinbutton', { name: 'Speicher pro Person' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith({ mediaQuotaMB: 0 });
    rerender(<MediaQuotaSetting settings={{ ...base, mediaQuotaMB: 500, mediaQuotaMBConfiguredViaEnv: true }} onSave={onSave} />);
    expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Festgelegt per MEDIA_QUOTA_MB/)).toBeTruthy();
  });
});
