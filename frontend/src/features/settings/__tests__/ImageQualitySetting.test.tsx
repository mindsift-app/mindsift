import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageQualitySetting } from '../admin/ImageQualitySetting';
import { SystemSettings } from '../../../lib/types';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };

describe('ImageQualitySetting (compression of new pictures for the whole server)', () => {
  it('shows high by default and saves another level', () => {
    const onSave = vi.fn();
    render(<ImageQualitySetting settings={base} onSave={onSave} />);
    const button = screen.getByRole('button', { name: 'Bildqualität' });
    expect(button.textContent).toContain('Hoch (Standard)');
    fireEvent.click(button);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('option', { name: /Sparsam/ }));
    expect(onSave).toHaveBeenCalledWith({ imageQuality: 'low' });
  });

  it('is locked when MEDIA_IMAGE_QUALITY fixes it', () => {
    render(<ImageQualitySetting settings={{ ...base, imageQuality: 'medium', imageQualityConfiguredViaEnv: true }} onSave={() => {}} />);
    const button = screen.getByRole('button', { name: 'Bildqualität' }) as HTMLButtonElement;
    expect(button.textContent).toContain('Mittel');
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Festgelegt per MEDIA_IMAGE_QUALITY/)).toBeTruthy();
  });
});
