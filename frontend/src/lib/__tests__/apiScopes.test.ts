import { describe, it, expect } from 'vitest';
import { toggleScopeIn } from '../apiScopes';

describe('API key rights', () => {
  it('switches the read right on together with a write right', () => {
    expect(toggleScopeIn(['webhook:triage'], 'notes:write')).toEqual(['webhook:triage', 'notes:write', 'notes:read']);
    expect(toggleScopeIn(['notes:read'], 'notes:write')).toEqual(['notes:read', 'notes:write']);
    expect(toggleScopeIn(['webhook:triage'], 'inbox:write')).toEqual(['webhook:triage', 'inbox:write', 'inbox:read']);
    // create rights stand alone (webhooks only drop things in)
    expect(toggleScopeIn(['webhook:triage'], 'notes:create')).toEqual(['webhook:triage', 'notes:create']);
  });

  it('switches off single rights but keeps at least one', () => {
    expect(toggleScopeIn(['notes:read', 'notes:write'], 'notes:write')).toEqual(['notes:read']);
    expect(toggleScopeIn(['notes:read'], 'notes:read')).toEqual(['notes:read']);
  });
});
