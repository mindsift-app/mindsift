import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkPreviewSetting } from '../admin/LinkPreviewSetting';
import { SystemSettings } from '../../../lib/types';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };

describe('LinkPreviewSetting (link previews for the whole server)', () => {
  it('is on by default and switches previews off for everyone', () => {
    const onSave = vi.fn();
    render(<LinkPreviewSetting settings={base} demoMode={false} onSave={onSave} />);
    expect(screen.getByText('Link-Vorschauen')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: 'Link-Vorschauen' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onSave).toHaveBeenCalledWith({ linkPreviews: false });
  });

  it('switches them on again', () => {
    const onSave = vi.fn();
    render(<LinkPreviewSetting settings={{ ...base, linkPreviews: false }} demoMode={false} onSave={onSave} />);
    const toggle = screen.getByRole('switch', { name: 'Link-Vorschauen' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(onSave).toHaveBeenCalledWith({ linkPreviews: true });
  });

  it('cannot be changed in the demo, which sends nothing out', () => {
    const onSave = vi.fn();
    render(<LinkPreviewSetting settings={{ ...base, linkPreviews: true }} demoMode onSave={onSave} />);
    const toggle = screen.getByRole('switch', { name: 'Link-Vorschauen' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Festgelegt per MINDSIFT_DEMO/)).toBeTruthy();
  });
});
