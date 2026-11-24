import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow, SettingsCard } from '../SettingsCard';

describe('SettingsCard and SettingRow', () => {
  it('shows title, hint, action and content, and passes data attributes on', () => {
    const { container } = render(
      <SettingsCard data-card-x title="Titel" hint="Kurzer Hinweis" action={<button type="button">Aktion</button>}>
        <p>Inhalt</p>
      </SettingsCard>,
    );
    expect(screen.getByRole('heading', { name: 'Titel' })).toBeTruthy();
    expect(screen.getByText('Kurzer Hinweis')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aktion' })).toBeTruthy();
    expect(screen.getByText('Inhalt')).toBeTruthy();
    const card = container.querySelector('[data-card-x]') as HTMLElement;
    expect(card.className).toContain('p-4');
    expect(card.className).toContain('border-border');
  });

  it('frames the card in the accent colour while active and leaves an empty hint out', () => {
    const { container } = render(<SettingsCard active title="Kanal" hint={false} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-accent');
    expect(card.className).not.toContain('border-border');
    expect(card.querySelectorAll('p')).toHaveLength(0);
  });

  it('puts the control next to the text; plain rows have no frame', () => {
    const { container } = render(
      <SettingRow plain title="Schalter" hint="Hinweis">
        <input aria-label="Feld" />
      </SettingRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).not.toContain('border');
    expect(row.className).toContain('min-h-[44px]');
    expect(screen.getByRole('textbox', { name: 'Feld' }).parentElement).toBe(row);
  });
});
