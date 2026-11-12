import { describe, it, expect, beforeEach } from 'vitest';
import { forgetTrust, rememberTrust, trustedDeviceId, trustTokens } from '../trustedDevice';

describe('trusted device tokens', () => {
  beforeEach(() => localStorage.clear());

  it('keeps one token per account and sends them all, newest first', () => {
    expect(trustTokens()).toEqual([]);
    rememberTrust('u1', 'tdv_a', 'tdv_a.geheim1');
    rememberTrust('u2', 'tdv_b', 'tdv_b.geheim2');
    rememberTrust('u1', 'tdv_c', 'tdv_c.geheim3');
    expect(trustTokens()).toEqual(['tdv_c.geheim3', 'tdv_b.geheim2']);
    expect(trustedDeviceId('u1')).toBe('tdv_c');
    forgetTrust('u1');
    expect(trustTokens()).toEqual(['tdv_b.geheim2']);
    expect(trustedDeviceId('u1')).toBeUndefined();
  });

  it('survives broken storage', () => {
    localStorage.setItem('mindsift_trusted_devices', '{kaputt');
    expect(trustTokens()).toEqual([]);
    rememberTrust('u1', 'tdv_a', 'tdv_a.x');
    expect(trustTokens()).toEqual(['tdv_a.x']);
  });

  it('keeps at most ten accounts', () => {
    for (let i = 0; i < 12; i++) rememberTrust(`u${i}`, `tdv_${i}`, `tdv_${i}.s`);
    expect(trustTokens()).toHaveLength(10);
    expect(trustedDeviceId('u0')).toBeUndefined();
    expect(trustedDeviceId('u11')).toBe('tdv_11');
  });
});
