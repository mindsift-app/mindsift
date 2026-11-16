import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpView } from '../HelpView';

describe('HelpView footer', () => {
  it('shows the imprint link of the instance and the About button at the bottom, like the settings', () => {
    render(<HelpView legal={{ imprintUrl: 'https://example.com/impressum' }} />);
    const imprint = screen.getByRole('link', { name: 'Impressum' });
    expect(imprint.getAttribute('href')).toBe('https://example.com/impressum');
    expect(screen.getByRole('button', { name: 'Über MindSift' })).toBeTruthy();
  });

  it('opens the About window from the button', () => {
    render(<HelpView />);
    expect(screen.queryByText('Fremdsoftware')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Über MindSift' }));
    expect(screen.getByText('Fremdsoftware')).toBeTruthy();
  });
});
