import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SmtpFields } from '../admin/SmtpFields';

const value = { smtpHost: 'mail.beispiel.de', smtpPort: '587', smtpUser: 'bot', smtpPass: '', smtpTls: true };

// The password input is the one masked field; it has no label of its own besides the caption
const passwordField = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('input')).find((i) => i.getAttribute('autocomplete') === 'new-password') as HTMLInputElement;

describe('SmtpFields', () => {
  it('locks the password while SMTP_PASS applies and says so', () => {
    const { container } = render(<SmtpFields value={{ ...value, smtpPass: 'alt' }} onChange={vi.fn()} passwordSet passwordViaEnv />);
    const field = passwordField(container);
    expect(field.disabled).toBe(true);
    expect(field.value).toBe('');
    expect(screen.getByText('Festgelegt per SMTP_PASS.')).toBeTruthy();
  });

  it('takes a password otherwise, keeping a stored one when left empty', () => {
    const { container } = render(<SmtpFields value={value} onChange={vi.fn()} passwordSet />);
    const field = passwordField(container);
    expect(field.disabled).toBe(false);
    expect(field.placeholder).toBe('Gespeichert – leer lassen für keine Änderung');
    expect(screen.queryByText(/Festgelegt per/)).toBeNull();
  });
});
