import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LegalSettingsCard } from '../admin/LegalSettingsCard';
import { SystemSettings } from '../../../lib/types';

const base: SystemSettings = { sharingMode: 'organizations', allowRegistration: false, instanceName: 'MindSift' };
const empty = { imprintUrl: '', imprintContent: '', privacyUrl: '', privacyContent: '', customLinkLabel: '', customLinkUrl: '' };

describe('LegalSettingsCard (imprint and privacy notice)', () => {
  it('saves what was typed with the button', () => {
    const onSave = vi.fn();
    render(<LegalSettingsCard settings={{ ...base, legal: empty }} onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Link zum Impressum'), { target: { value: 'https://example.com/impressum' } });
    fireEvent.change(screen.getByLabelText('Text der Datenschutzerklärung (Markdown)'), { target: { value: '# Datenschutz' } });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ legal: expect.objectContaining({ imprintUrl: 'https://example.com/impressum', privacyContent: '# Datenschutz' }) });
  });

  it('locks the fields LEGAL_* fixes', () => {
    render(<LegalSettingsCard settings={{ ...base, legal: { ...empty, imprintUrl: 'https://p.example', configuredViaEnv: ['imprintUrl'] } }} onSave={() => {}} />);
    expect((screen.getByLabelText('Link zum Impressum') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Link zur Datenschutzerklärung') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/Festgelegt per LEGAL_IMPRINT_URL/)).toBeTruthy();
  });
});
