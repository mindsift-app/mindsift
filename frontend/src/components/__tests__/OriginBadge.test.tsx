import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OriginBadge, originDetails } from '../OriginBadge';

describe('OriginBadge', () => {
  it('shows nothing for entries no key touched', () => {
    expect(render(<OriginBadge origin={undefined} />).container.firstChild).toBeNull();
    expect(render(<OriginBadge origin={{}} />).container.firstChild).toBeNull();
  });

  it('names the key that created the entry, else the one that changed it', () => {
    const created = render(<OriginBadge origin={{ createdVia: 'api', createdKey: 'Home Assistant', changedVia: 'mcp', changedKey: 'Claude Code' }} />);
    expect(created.container.textContent).toBe('Home Assistant');
    const changed = render(<OriginBadge origin={{ changedVia: 'mcp', changedKey: 'Claude Code' }} />);
    expect(changed.container.textContent).toBe('Claude Code');
    const old = render(<OriginBadge origin={{ createdVia: 'mcp' }} />);
    expect(old.container.textContent).toBe('MCP');
  });

  it('opens the details on tap', () => {
    const { getByRole, queryByRole } = render(
      <OriginBadge origin={{ changedVia: 'mcp', changedKey: 'Claude Code', changedAt: '2026-11-01T09:40:00Z' }} createdAt="2026-10-31T08:00:00Z" />
    );
    expect(queryByRole('tooltip')).toBeNull();
    fireEvent.click(getByRole('button'));
    const tip = getByRole('tooltip').textContent || '';
    expect(tip).toContain('In der App angelegt');
    expect(tip).toContain('zuletzt geändert per MCP (Claude Code)');
  });

  it('describes both created and changed', () => {
    const text = originDetails({ createdVia: 'api', createdKey: 'HA', changedVia: 'mcp', changedKey: 'Claude Code' }, '2026-11-01T08:12:00Z');
    expect(text).toMatch(/^Angelegt per API \(HA\) am .* · zuletzt geändert per MCP \(Claude Code\)$/);
  });

  it('names the person who created it in shared lists', () => {
    expect(originDetails(undefined, '2026-11-01T08:12:00Z', 'Sandro')).toMatch(/^Erstellt von Sandro am /);
    expect(originDetails(undefined, '', 'Sandro')).toBe('Erstellt von Sandro');
    expect(originDetails(undefined, '2026-11-01T08:12:00Z')).toBe('');
    // Created in the app, changed later through MCP
    const text = originDetails({ changedVia: 'mcp', changedKey: 'Claude' }, '2026-11-01T08:12:00Z', 'Sandro');
    expect(text).toMatch(/^Erstellt von Sandro am .* · zuletzt geändert per MCP \(Claude\)$/);
    // An API key that created it is named instead of its owner
    expect(originDetails({ createdVia: 'mcp', createdKey: 'Claude' }, '', 'Sandro')).toBe('Angelegt per MCP (Claude)');
  });
});
