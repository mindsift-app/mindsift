import { describe, expect, it } from 'vitest';
import { describeDevice } from '../SessionsPanel';

describe('describeDevice', () => {
  it('names browser and system', () => {
    expect(
      describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')
    ).toEqual({ label: 'Firefox auf Linux', mobile: false });
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toEqual({ label: 'Safari auf iOS', mobile: true });
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'
      ).label
    ).toBe('Edge auf Windows');
  });

  it('falls back for empty agents', () => {
    expect(describeDevice('').label).toBe('Unbekanntes Gerät');
  });
});
