// Uploading a backup to restore it (moving to a new server): in chunks, resumable, so a reverse proxy with
// a body limit or a dropped connection does not break a file of several GB (internal/api/backup_upload.go).
// A chunk carries its SHA-256 (X-Chunk-SHA256); the whole file's checksum is SHA-256 over the SHA-256 of
// each 32 MiB block, which the server computes the same way before it restores.
import { authHeaders } from './api/client';
import { sha256, toHex } from './sha256';

export const HASH_BLOCK = 32 * 1024 * 1024;
const MIN_CHUNK = 1024 * 1024;
const RESUME_KEY = 'mindsift:backup-upload';
const BASE = '/api/v1/admin/backups/uploads';

export interface UploadProgress {
  phase: 'upload' | 'check';
  done: number;
  total: number;
}

export interface FinishedUpload {
  id: string;
  name: string;
  size: number;
  sha256: string;
}

interface UploadState {
  id: string;
  name: string;
  size: number;
  offset: number;
  chunkSize: number;
}

// The upload of this very file started before (another visit, a reload): resumed where it stopped
interface ResumeEntry {
  id: string;
  name: string;
  size: number;
  lastModified: number;
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(path, { cache: 'no-store', ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string>) } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no JSON
  }
  return { status: res.status, body: body as T };
}

function errorText(body: unknown, status: number): string {
  const msg = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return typeof msg === 'string' ? msg : `HTTP ${status}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// blockChecksum: SHA-256 over the SHA-256 of each 32 MiB block of the file, hex
export async function blockChecksum(file: Blob, onProgress?: (done: number) => void): Promise<string> {
  const parts: Uint8Array[] = [];
  for (let off = 0; off < file.size; off += HASH_BLOCK) {
    const block = new Uint8Array(await file.slice(off, off + HASH_BLOCK).arrayBuffer());
    parts.push(await sha256(block));
    onProgress?.(Math.min(file.size, off + HASH_BLOCK));
  }
  const all = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => all.set(p, i * 32));
  return toHex(await sha256(all));
}

function readResume(file: File): ResumeEntry | null {
  try {
    const e = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null') as ResumeEntry | null;
    if (e && e.name === file.name && e.size === file.size && e.lastModified === file.lastModified) return e;
  } catch {
    // ignore
  }
  return null;
}

export function forgetUpload() {
  localStorage.removeItem(RESUME_KEY);
}

async function begin(file: File): Promise<UploadState> {
  const resume = readResume(file);
  if (resume) {
    const { status, body } = await call<{ name: string; offset: number; chunkSize: number; size: number }>(`${BASE}/${encodeURIComponent(resume.id)}`);
    if (status === 200 && body.size === file.size) {
      return { id: resume.id, name: body.name, size: file.size, offset: body.offset, chunkSize: body.chunkSize };
    }
  }
  const { status, body } = await call<{ id: string; name: string; chunkSize: number; error?: string }>(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size }),
  });
  if (status !== 200) throw new UploadError(errorText(body, status), status);
  localStorage.setItem(RESUME_KEY, JSON.stringify({ id: body.id, name: file.name, size: file.size, lastModified: file.lastModified }));
  return { id: body.id, name: body.name, size: file.size, offset: 0, chunkSize: body.chunkSize };
}

// uploadBackup sends the file in chunks and computes its checksum; resolves with what the restore needs.
export async function uploadBackup(file: File, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<FinishedUpload> {
  const st = await begin(file);
  let failures = 0;
  onProgress({ phase: 'upload', done: st.offset, total: st.size });
  while (st.offset < st.size) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const chunk = new Uint8Array(await file.slice(st.offset, st.offset + st.chunkSize).arrayBuffer());
    let res: { status: number; body: { offset?: number; error?: string } };
    try {
      res = await call(`${BASE}/${encodeURIComponent(st.id)}?offset=${st.offset}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-SHA256': toHex(await sha256(chunk)) },
        body: chunk as BodyInit,
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      res = { status: 0, body: {} }; // no answer: connection dropped
    }
    if (res.status === 200 || res.status === 409) {
      // 409: the server has a different end; continue from there
      if (typeof res.body.offset === 'number') st.offset = res.body.offset;
      if (res.status === 200) failures = 0;
      onProgress({ phase: 'upload', done: st.offset, total: st.size });
      continue;
    }
    if (res.status === 413 && st.chunkSize > MIN_CHUNK) {
      st.chunkSize = Math.max(MIN_CHUNK, Math.floor(st.chunkSize / 2)); // a proxy with a smaller body limit
      continue;
    }
    if (res.status === 404 || res.status === 401 || res.status === 403 || res.status === 413 || ++failures > 5) {
      if (res.status === 404) forgetUpload();
      throw new UploadError(errorText(res.body, res.status), res.status);
    }
    await wait(Math.min(30_000, 1000 * 2 ** failures));
  }
  onProgress({ phase: 'check', done: 0, total: st.size });
  const sum = await blockChecksum(file, (done) => onProgress({ phase: 'check', done, total: st.size }));
  return { id: st.id, name: st.name, size: st.size, sha256: sum };
}
