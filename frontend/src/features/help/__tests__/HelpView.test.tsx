import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpView } from '../HelpView';
import { actAsDesktopApp, actAsServer } from '../../../test/desktop';
import { setCapabilities } from '../../../lib/capabilities';

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
  afterEach(() => actAsServer());

  it('shows the collaboration category and its cards in the browser', async () => {
    render(<HelpView />);
    expect(screen.getByRole('button', { name: 'Gruppen & Freigaben' })).toBeTruthy();
    expect(await screen.findByText('Organisationen, Gruppen & Freigaben')).toBeTruthy();
    expect(screen.getByText('Echtzeit-Zusammenarbeit, Sperren & Konflikte')).toBeTruthy();
  });

  it('leaves out the collaboration category and the cards about working with others', async () => {
    actAsDesktopApp();
    render(<HelpView />);
    expect(await screen.findByText('API: curl & KI-Agenten (MCP)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gruppen & Freigaben' })).toBeNull();
    expect(screen.queryByText('Organisationen, Gruppen & Freigaben')).toBeNull();
    expect(screen.queryByText('Echtzeit-Zusammenarbeit, Sperren & Konflikte')).toBeNull();
  });

  it('words the cards for one person on one computer: no collaboration, no mail, no sign-in, no installing', async () => {
    actAsDesktopApp();
    render(<HelpView />);
    expect(await screen.findByText('Hierarchischer Outliner')).toBeTruthy();
    // the card's desktop title replaces the one for servers, so nothing about collaborative sync or offline sync is left
    expect(screen.queryByText('Hierarchischer Outliner & Offline-Sync')).toBeNull();
    expect(screen.queryByText(/kollaborativem Echtzeit-Abgleich/)).toBeNull();
    expect(screen.queryByText('Offline, Backups & Passwort')).toBeNull();
    expect(screen.getByText('Backups')).toBeTruthy();
    expect(screen.queryByText(/Als App installiert/)).toBeNull();
    expect(screen.queryByText('Passkeys:')).toBeNull();
    expect(screen.queryByText('Kalender-Abo:')).toBeNull();
    expect(screen.queryByText('Zuweisen:')).toBeNull();
    expect(screen.getByText('Für lokale Programme erreichbar', { exact: false })).toBeTruthy();
  });

  it('keeps the wording for servers in the browser', async () => {
    render(<HelpView />);
    expect(await screen.findByText('Hierarchischer Outliner & Offline-Sync')).toBeTruthy();
    expect(screen.getByText('Offline, Backups & Passwort')).toBeTruthy();
    expect(screen.getByText(/Als App installiert/)).toBeTruthy();
    expect(screen.getByText('Passkeys:')).toBeTruthy();
  });

  it('on a server with sharing off: no collaboration, the rest worded for servers', async () => {
    setCapabilities({ sharing: false });
    render(<HelpView />);
    expect(await screen.findByText('Hierarchischer Outliner & Offline-Sync')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gruppen & Freigaben' })).toBeNull();
    expect(screen.queryByText('Organisationen, Gruppen & Freigaben')).toBeNull();
    expect(screen.queryByText('Zuweisen:')).toBeNull();
    expect(screen.getByText('Passkeys:')).toBeTruthy();
  });
});
