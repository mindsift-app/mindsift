import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const createAPIKey = vi.fn(async () => ({ id: 'k1', userId: 'u', name: 'HA', keyPrefix: 'mindsift_sec_ab', scopes: 'webhook:triage,webhook:list', createdAt: '' }));
const updateAPIKey = vi.fn(async () => ({}));
const getAuthStatus = vi.fn(async (): Promise<{ mcpConnectorUrl?: string; mcpEnabled?: boolean; restApiKeys?: boolean }> => ({
  mcpConnectorUrl: 'https://ms.example/api/v1/mcp',
}));
vi.mock('../../../lib/api', () => ({
  api: {
    getAPIKeys: vi.fn(async () => [
      { id: 'k0', userId: 'u', name: 'Rauchmelder', keyPrefix: 'mindsift_sec_xy', scopes: 'webhook:triage,webhook:task', createdAt: '' },
      { id: 'k9', userId: 'u', name: 'Claude (OAuth)', keyPrefix: 'OAuth', scopes: 'tasks:read', createdAt: '', kind: 'oauth' },
    ]),
    getAuthStatus: (...args: unknown[]) => getAuthStatus(...(args as [])),
    getAllLists: vi.fn(async () => []),
    getTaskLists: vi.fn(async () => []),
    createAPIKey: (...args: unknown[]) => createAPIKey(...(args as [])),
    deleteAPIKey: vi.fn(),
    updateAPIKey: (...args: unknown[]) => updateAPIKey(...(args as [])),
    testWebhookIngest: vi.fn(),
  },
  triggerHaptic: vi.fn(),
}));

import { ApiKeysPanel } from '../ApiKeysPanel';

describe('ApiKeysPanel', () => {
  beforeEach(() => createAPIKey.mockClear());

  it('shows the rights of existing keys as badges', async () => {
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Rauchmelder')).toBeTruthy();
    expect(screen.getByText('Aufgaben anlegen')).toBeTruthy();
    expect(screen.getByText('Inbox')).toBeTruthy();
  });

  it('creates a key with the chosen scopes and never without one', async () => {
    render(<ApiKeysPanel />);
    const triage = screen.getByRole('switch', { name: 'Inbox' });
    fireEvent.click(triage); // last remaining scope cannot be switched off
    expect(triage.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Listeneinträge hinzufügen' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /API-Key erzeugen/ }));
    });
    expect(createAPIKey).toHaveBeenCalledWith('Home Assistant', ['webhook:triage', 'webhook:list'], undefined);
  });

  it('shows curl for scripts and, in the second tab, how to connect an MCP client', async () => {
    render(<ApiKeysPanel />);
    fireEvent.click(screen.getByRole('switch', { name: 'Aufgaben ändern' }));
    expect(screen.getByRole('switch', { name: 'Aufgaben ändern' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByText(/tasks\?due=today&status=open/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/claude mcp add/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /KI-Agenten/ }));
    // claude.ai / ChatGPT first: the connector address, no key
    expect(await screen.findByText('https://ms.example/api/v1/mcp')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
    expect(screen.getByText(/claude mcp add --transport http mindsift/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'OpenAI Codex' }));
    expect(screen.getByText(/\[mcp_servers\.mindsift\]/)).toBeTruthy();
  });

  it('hides the MCP tab when the operator switched MCP off', async () => {
    getAuthStatus.mockResolvedValueOnce({ mcpConnectorUrl: '', mcpEnabled: false });
    render(<ApiKeysPanel />);
    await act(async () => {});
    expect(screen.queryByRole('tab', { name: /KI-Agenten/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Notizen lesen' })).toBeNull();
    expect(screen.getAllByText(/tasks\?due=today&status=open/).length).toBeGreaterThan(0);
  });

  it('says keys only work for MCP when the server refuses them on REST', async () => {
    getAuthStatus.mockResolvedValueOnce({ mcpConnectorUrl: 'https://ms.example/api/v1/mcp', mcpEnabled: true, restApiKeys: false });
    render(<ApiKeysPanel />);
    expect(await screen.findByText('API-Schlüssel gelten auf diesem Server nur für MCP.')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /KI-Agenten/ })).toBeNull();
    expect(screen.queryAllByText(/tasks\?due=today&status=open/)).toHaveLength(0);
    expect(screen.getByText('https://ms.example/api/v1/mcp')).toBeTruthy();
    expect(screen.getByRole('button', { name: /API-Key erzeugen/ })).toBeTruthy();
  });

  it('offers no new key when neither REST nor MCP takes one', async () => {
    getAuthStatus.mockResolvedValueOnce({ mcpConnectorUrl: '', mcpEnabled: false, restApiKeys: false });
    render(<ApiKeysPanel />);
    expect(await screen.findByText('API-Schlüssel sind auf diesem Server ausgeschaltet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /API-Key erzeugen/ })).toBeNull();
    expect(await screen.findByText('Rauchmelder')).toBeTruthy();
  });

  it('marks OAuth connections instead of showing a key prefix', async () => {
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Claude (OAuth)')).toBeTruthy();
    expect(screen.getByTitle(/Verbunden über OAuth/)).toBeTruthy();
    expect(screen.queryByText('OAuth', { selector: '.font-mono' })).toBeNull();
  });

  it('renames a key and changes its rights', async () => {
    render(<ApiKeysPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'API-Key Rauchmelder bearbeiten' }));
    fireEvent.change(screen.getByLabelText('Name des Schlüssels'), { target: { value: 'Rauchmelder Flur' } });
    const group = screen.getByRole('group', { name: 'Berechtigungen von Rauchmelder' });
    fireEvent.click(within(group).getByRole('switch', { name: 'Aufgaben lesen' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    expect(updateAPIKey).toHaveBeenCalledWith('k0', {
      name: 'Rauchmelder Flur',
      scopes: ['webhook:triage', 'webhook:task', 'tasks:read'],
    });
  });
});
