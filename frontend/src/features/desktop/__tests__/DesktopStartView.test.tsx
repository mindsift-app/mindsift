import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopStartView } from '../DesktopStartView';

type Call = { op: string; body: Record<string, string>; headers: Record<string, string> };

const baseState = {
  base: '/home/anna/.local/share/MindSift',
  entries: [
    { id: 'a', kind: 'local', name: 'Privat', path: '/home/anna/.local/share/MindSift/instances/Privat' },
    { id: 's', kind: 'server', name: 'Demo', url: 'https://demo.mindsift.app/' },
  ],
  found: [{ name: 'Kopie', path: '/home/anna/.local/share/MindSift/instances/Kopie' }],
  current: 'a',
};

let calls: Call[];
let answers: Record<string, unknown>;
const replace = vi.fn();

beforeEach(() => {
  calls = [];
  answers = { state: baseState };
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const op = url.replace('/__desktop/api/', '');
      calls.push({ op, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(answers[op] ?? { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace, pathname: '/__desktop/start' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe('DesktopStartView', () => {
  it('lists recent entries, found instances and the base folder', async () => {
    render(<DesktopStartView />);
    expect(await screen.findByText('Privat')).toBeTruthy();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('https://demo.mindsift.app/')).toBeTruthy();
    expect(screen.getByText('Kopie')).toBeTruthy();
    expect(screen.getByText('Geöffnet')).toBeTruthy();
    expect(screen.getByText(baseState.base)).toBeTruthy();
    // Every call carries the shell's header
    expect(calls[0].headers['X-MindSift-Desktop']).toBe('1');
  });

  it('opens a local instance and clears the storage of another one', async () => {
    localStorage.setItem('mindsift:desktop-instance', 'other');
    localStorage.setItem('mindsift_jwt_token', 'old');
    answers.open = { url: '/', id: 'a', local: true };
    render(<DesktopStartView />);
    fireEvent.click(await screen.findByText('Privat'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(calls.find((c) => c.op === 'open')?.body).toEqual({ id: 'a' });
    expect(localStorage.getItem('mindsift_jwt_token')).toBeNull();
    expect(localStorage.getItem('mindsift:desktop-instance')).toBe('a');
  });

  it('keeps the session when the same instance opens again', async () => {
    localStorage.setItem('mindsift:desktop-instance', 'a');
    localStorage.setItem('mindsift_jwt_token', 'kept');
    answers.open = { url: '/', id: 'a', local: true };
    render(<DesktopStartView />);
    fireEvent.click(await screen.findByText('Privat'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(localStorage.getItem('mindsift_jwt_token')).toBe('kept');
  });

  it('shows the lock message in the person’s language', async () => {
    answers.open = { error: { code: 'locked' } };
    render(<DesktopStartView />);
    fireEvent.click(await screen.findByText('Privat'));
    expect(await screen.findByText(/schon in einem anderen MindSift-Fenster geöffnet/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('creates a new instance from a name', async () => {
    answers.state = { base: '/b', entries: [], found: [] };
    answers.create = { url: '/', id: 'n', local: true };
    render(<DesktopStartView />);
    // Nothing listed: the first start's choice, no form yet
    fireEvent.click(await screen.findByText('Lokale Instanz anlegen'));
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'Arbeit' } });
    fireEvent.click(screen.getByText('Anlegen'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(calls.find((c) => c.op === 'create')?.body).toEqual({ name: 'Arbeit' });
  });

  it('connects to a server', async () => {
    answers['add-server'] = { url: 'https://demo.mindsift.app/', id: 's2' };
    render(<DesktopStartView />);
    fireEvent.click(await screen.findByText('Mit Server verbinden…'));
    fireEvent.change(screen.getByLabelText('Adresse'), { target: { value: 'demo.mindsift.app' } });
    fireEvent.click(screen.getByText('Verbinden'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://demo.mindsift.app/'));
    expect(calls.find((c) => c.op === 'add-server')?.body).toEqual({ name: '', url: 'demo.mindsift.app' });
  });

  it('offers a local instance and a server as equals on the first start', async () => {
    answers.state = { base: '/b', entries: [], found: [] };
    answers['add-server'] = { url: 'https://demo.mindsift.app/', id: 's2' };
    render(<DesktopStartView />);
    expect(await screen.findByText('Lokale Instanz anlegen')).toBeTruthy();
    // No form is open and nothing is created before the person chose
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByLabelText('Adresse')).toBeNull();
    expect(calls.map((c) => c.op)).toEqual(['state']);
    // Cancelling a form goes back to the choice
    fireEvent.click(screen.getByText('Lokale Instanz anlegen'));
    fireEvent.click(screen.getByText('Abbrechen'));
    fireEvent.click(screen.getByText('Mit Server verbinden'));
    fireEvent.change(screen.getByLabelText('Adresse'), { target: { value: 'demo.mindsift.app' } });
    fireEvent.click(screen.getByText('Verbinden'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://demo.mindsift.app/'));
    expect(calls.some((c) => c.op === 'create')).toBe(false);
  });

  it('warns when the base folder is synced', async () => {
    answers.state = { ...baseState, sync: 'Nextcloud' };
    render(<DesktopStartView />);
    expect(await screen.findByText('Dieser Ordner wird synchronisiert (Nextcloud)')).toBeTruthy();
  });
});
