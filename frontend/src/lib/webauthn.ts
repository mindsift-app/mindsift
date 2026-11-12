// Passkeys in the browser (navigator.credentials): the server sends the options of create() and get() as
// JSON with base64url strings for the binary fields (challenge, user.id, credential ids), and expects the
// browser's PublicKeyCredential back in the same form. The newer static helpers
// (PublicKeyCredential.parseCreationOptionsFromJSON, credential.toJSON) are used where the browser has
// them, the small conversion below everywhere else.

export type PasskeyJSON = Record<string, unknown>;

export function toBase64url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// The browser can do passkeys at all (secure context with WebAuthn)
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.get;
}

// The browser offers passkeys in the autofill of the login field (mediation "conditional")
export async function conditionalPasskeysAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const pkc = window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> };
  try {
    return typeof pkc.isConditionalMediationAvailable === 'function' && (await pkc.isConditionalMediationAvailable());
  } catch {
    return false;
  }
}

// The person closed the browser's dialog, it timed out, or another request replaced it: no error to show
export function passkeyCancelled(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

type Descriptor = { id: string; type: string; transports?: string[] };

const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] | undefined =>
  Array.isArray(list)
    ? (list as Descriptor[]).map((d) => ({
        type: d.type as PublicKeyCredentialType,
        id: fromBase64url(d.id),
        transports: d.transports as AuthenticatorTransport[] | undefined,
      }))
    : undefined;

type JSONParsers = {
  parseCreationOptionsFromJSON?: (o: unknown) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: unknown) => PublicKeyCredentialRequestOptions;
};

export function creationOptions(json: PasskeyJSON): PublicKeyCredentialCreationOptions {
  const pkc = window.PublicKeyCredential as unknown as JSONParsers;
  if (typeof pkc.parseCreationOptionsFromJSON === 'function') {
    try {
      return pkc.parseCreationOptionsFromJSON(json);
    } catch {
      // Older implementations refuse members they do not know yet: the own conversion below
    }
  }
  const user = json.user as { id: string; name: string; displayName: string };
  return {
    ...(json as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromBase64url(json.challenge as string),
    user: { ...user, id: fromBase64url(user.id) },
    excludeCredentials: descriptors(json.excludeCredentials),
  };
}

export function requestOptions(json: PasskeyJSON): PublicKeyCredentialRequestOptions {
  const pkc = window.PublicKeyCredential as unknown as JSONParsers;
  if (typeof pkc.parseRequestOptionsFromJSON === 'function') {
    try {
      return pkc.parseRequestOptionsFromJSON(json);
    } catch {
      // see creationOptions
    }
  }
  return {
    ...(json as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromBase64url(json.challenge as string),
    allowCredentials: descriptors(json.allowCredentials),
  };
}

// credentialJSON: the answer of the authenticator as the server reads it
export function credentialJSON(cred: PublicKeyCredential): PasskeyJSON {
  const withJSON = cred as PublicKeyCredential & { toJSON?: () => PasskeyJSON };
  if (typeof withJSON.toJSON === 'function') {
    try {
      return withJSON.toJSON();
    } catch {
      // Some password managers hand out credentials whose toJSON throws: the own conversion below
    }
  }
  const r = cred.response as AuthenticatorResponse & {
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    getTransports?: () => string[];
  };
  const response: Record<string, unknown> = { clientDataJSON: toBase64url(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = toBase64url(r.attestationObject);
    response.transports = typeof r.getTransports === 'function' ? r.getTransports() : [];
  } else {
    if (r.authenticatorData) response.authenticatorData = toBase64url(r.authenticatorData);
    if (r.signature) response.signature = toBase64url(r.signature);
    if (r.userHandle) response.userHandle = toBase64url(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: toBase64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: (cred as PublicKeyCredential & { authenticatorAttachment?: string | null }).authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response,
  };
}

// createPasskey: navigator.credentials.create() with the server's options; throws NotAllowedError when
// the person cancels (passkeyCancelled)
export async function createPasskey(options: PasskeyJSON): Promise<PasskeyJSON> {
  const cred = (await navigator.credentials.create({ publicKey: creationOptions(options) })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('No passkey', 'NotAllowedError');
  return credentialJSON(cred);
}

// getPasskey: navigator.credentials.get(); conditional for the autofill of the login field
export async function getPasskey(options: PasskeyJSON, opts: { conditional?: boolean; signal?: AbortSignal } = {}): Promise<PasskeyJSON> {
  const request: CredentialRequestOptions = { publicKey: requestOptions(options), signal: opts.signal };
  if (opts.conditional) (request as CredentialRequestOptions & { mediation: string }).mediation = 'conditional';
  const cred = (await navigator.credentials.get(request)) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('No passkey', 'NotAllowedError');
  return credentialJSON(cred);
}
