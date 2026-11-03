import { describe, it, expect } from 'vitest';
import { deviceName, urlBase64ToUint8Array } from '../push';

describe('push helpers', () => {
  it('decodes the VAPID key (base64url without padding)', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });

  it('names the device', () => {
    expect(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox auf Linux');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome auf Android');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari auf iOS');
  });
});
