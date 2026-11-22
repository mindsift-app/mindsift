import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sha256Fallback, toHex } from '../sha256';
import { blockChecksum, HASH_BLOCK, uploadBackup } from '../backupUpload';

const webSha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
const text = (s: string) => new TextEncoder().encode(s);

describe('sha256 fallback (plain http, no WebCrypto)', () => {
  it('gives the standard test vectors', () => {
    expect(toHex(sha256Fallback(text('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256Fallback(text('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256Fallback(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(toHex(sha256Fallback(text('a'.repeat(1_000_000))))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('matches WebCrypto for lengths around the block boundaries', async () => {
    for (const n of [1, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(toHex(sha256Fallback(data))).toBe(toHex(await webSha(data)));
    }
  });
});

describe('blockChecksum', () => {
  it('is SHA-256 over the SHA-256 of each 32 MiB block, as the server computes it', async () => {
    const data = new Uint8Array(HASH_BLOCK + 10).map((_, i) => i & 0xff);
    const inner = new Uint8Array(64);
    inner.set(await webSha(data.subarray(0, HASH_BLOCK)), 0);
    inner.set(await webSha(data.subarray(HASH_BLOCK)), 32);
    expect(await blockChecksum(new Blob([data]))).toBe(toHex(await webSha(inner)));
  });
});

describe('uploadBackup', () => {
  let server: { data: number[]; puts: number[] };
  beforeEach(() => {
    localStorage.clear();
    server = { data: [], puts: [] };
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends the file in chunks and resyncs on a wrong offset', async () => {
    let resynced = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.method === 'POST') return json(200, { id: 'up1', name: 'umzug.tar', size: 10, offset: 0, chunkSize: 4 });
        const body = new Uint8Array(init.body as ArrayBuffer);
        const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
        if (!resynced && offset === 4) {
          resynced = true; // the server got this chunk, the answer was lost
          server.data.push(...body);
          return json(409, { error: 'offset', offset: 8 });
        }
        expect(offset).toBe(server.data.length);
        server.data.push(...body);
        return json(200, { offset: server.data.length });
      }),
    );
    const content = new Uint8Array(10).map((_, i) => i + 1);
    const file = new File([content], 'umzug.tar', { lastModified: 1 });
    const progress: number[] = [];
    const up = await uploadBackup(file, (p) => {
      if (p.phase === 'upload') progress.push(p.done);
    });
    expect(up).toMatchObject({ id: 'up1', name: 'umzug.tar', size: 10 });
    expect(up.sha256).toBe(await blockChecksum(file));
    expect(progress).toEqual([0, 4, 8, 10]);
    expect(server.data).toEqual(Array.from(content));
    expect(JSON.parse(localStorage.getItem('mindsift:backup-upload') || '{}').id).toBe('up1');
  });

  it('halves the chunks when a proxy refuses them as too large', async () => {
    const MiB = 1024 * 1024;
    const sizes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.method === 'POST') return json(200, { id: 'up2', name: 'gross.tar', size: 3 * MiB, offset: 0, chunkSize: 4 * MiB });
        const body = new Uint8Array(init.body as ArrayBuffer);
        sizes.push(body.length);
        if (body.length > 2 * MiB) return json(413, { error: 'too large' });
        server.data.length += body.length;
        return json(200, { offset: server.data.length });
      }),
    );
    await uploadBackup(new File([new Uint8Array(3 * MiB)], 'gross.tar'), () => {});
    expect(sizes).toEqual([3 * MiB, 2 * MiB, MiB]);
  });

  it('resumes an upload of the same file where the server stopped', async () => {
    localStorage.setItem('mindsift:backup-upload', JSON.stringify({ id: 'up9', name: 'umzug.tar', size: 6, lastModified: 5 }));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? 'GET'} ${url}`);
        if (!init.method) return json(200, { id: 'up9', name: 'umzug.tar', size: 6, offset: 4, chunkSize: 1024 });
        return json(200, { offset: 6 });
      }),
    );
    await uploadBackup(new File([new Uint8Array(6)], 'umzug.tar', { lastModified: 5 }), () => {});
    expect(calls).toEqual(['GET /api/v1/admin/backups/uploads/up9', 'PUT /api/v1/admin/backups/uploads/up9?offset=4']);
  });
});
