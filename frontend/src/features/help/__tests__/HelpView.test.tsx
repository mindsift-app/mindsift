import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpView } from '../HelpView';
import { setCurrentDesktop } from '../../../lib/api/client';

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

describe('HelpView in the desktop app', () => {
  afterEach(() => setCurrentDesktop(null));

  it('shows the collaboration category and its cards in the browser', async () => {
    render(<HelpView />);
    expect(screen.getByRole('button', { name: 'Gruppen & Freigaben' })).toBeTruthy();
    expect(await screen.findByText('Organisationen, Gruppen & Freigaben')).toBeTruthy();
    expect(screen.getByText('Echtzeit-Zusammenarbeit, Sperren & Konflikte')).toBeTruthy();
  });

  it('leaves out the collaboration category and the cards about working with others', async () => {
    setCurrentDesktop({ platform: 'linux', realtime: 'sse' });
    render(<HelpView />);
    expect(await screen.findByText('API: curl, Smart Home & KI-Agenten (MCP)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gruppen & Freigaben' })).toBeNull();
    expect(screen.queryByText('Organisationen, Gruppen & Freigaben')).toBeNull();
    expect(screen.queryByText('Echtzeit-Zusammenarbeit, Sperren & Konflikte')).toBeNull();
  });
});
