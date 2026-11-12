import { describe, it, expect, afterEach } from 'vitest';
import { credentialJSON, fromBase64url, passkeyCancelled, requestOptions, creationOptions, toBase64url } from '../webauthn';

const bytes = (b: ArrayBuffer) => Array.from(new Uint8Array(b));

describe('webauthn: base64url and the options of the server', () => {
  afterEach(() => {
    delete (window as any).PublicKeyCredential;
  });

  it('converts base64url both ways, without padding', () => {
    const data = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const text = toBase64url(data);
    expect(text).toBe('AAH6-_z9_v8');
    expect(bytes(fromBase64url(text))).toEqual(Array.from(data));
    expect(bytes(fromBase64url('YQ'))).toEqual([97]);
  });

  it('turns the JSON options into what navigator.credentials expects', () => {
    (window as any).PublicKeyCredential = function () {};
    const get = requestOptions({
      challenge: 'AQID',
      rpId: 'notizen.example.org',
      userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: 'BAU', transports: ['internal'] }],
    });
    expect(bytes(get.challenge as ArrayBuffer)).toEqual([1, 2, 3]);
    expect(get.rpId).toBe('notizen.example.org');
    expect(bytes(get.allowCredentials![0].id as ArrayBuffer)).toEqual([4, 5]);
    const create = creationOptions({
      challenge: 'AQID',
      rp: { id: 'notizen.example.org', name: 'MindSift' },
      user: { id: 'dXNyXzE', name: 'ada@example.com', displayName: 'Ada' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    expect(new TextDecoder().decode(create.user.id as ArrayBuffer)).toBe('usr_1');
    expect(create.excludeCredentials).toBeUndefined();
    expect(create.authenticatorSelection?.residentKey).toBe('required');
  });

  it('uses the browser’s own parser when there is one', () => {
    const parsed = { challenge: new ArrayBuffer(1) };
    (window as any).PublicKeyCredential = { parseRequestOptionsFromJSON: () => parsed };
    expect(requestOptions({ challenge: 'AA' })).toBe(parsed);
  });

  it('writes the answer of the authenticator as JSON when toJSON is missing', () => {
    const cred = {
      id: 'BAU',
      rawId: new Uint8Array([4, 5]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: new Uint8Array([123, 125]).buffer,
        authenticatorData: new Uint8Array([1]).buffer,
        signature: new Uint8Array([2]).buffer,
        userHandle: new TextEncoder().encode('usr_1').buffer,
      },
    } as unknown as PublicKeyCredential;
    expect(credentialJSON(cred)).toEqual({
      id: 'BAU',
      rawId: 'BAU',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: 'e30', authenticatorData: 'AQ', signature: 'Ag', userHandle: 'dXNyXzE' },
    });
  });

  it('treats a closed dialog as no error', () => {
    expect(passkeyCancelled(new DOMException('x', 'NotAllowedError'))).toBe(true);
    expect(passkeyCancelled(new DOMException('x', 'AbortError'))).toBe(true);
    expect(passkeyCancelled(new DOMException('x', 'InvalidStateError'))).toBe(false);
    expect(passkeyCancelled(new Error('Der Passkey wurde nicht angenommen'))).toBe(false);
  });
});
