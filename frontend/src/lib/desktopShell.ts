// The desktop app's shell (desktop/internal/shell): its start view lists local instances and servers and
// opens one. The shell answers these calls only on the window's own origin and only with the header below
// (a page of another origin cannot send it without a CORS preflight, which the shell never allows).
import { clearToken } from './api/client';
import { clearOfflineData } from './offline';
import { clearStoredNotes } from './docSync/persist';

export interface DesktopEntry {
  id: string;
  kind: 'local' | 'server';
  name: string;
  path?: string;
  url?: string;
  lastOpened?: string;
}

export interface DesktopFound {
  name: string;
  path: string;
}

// An error of the shell: code names the text (desktop:errors.<code>), detail is shown as it is
export interface DesktopProblem {
  code: string;
  detail?: string;
}

export interface DesktopState {
  base: string;
  sync?: string;
  entries: DesktopEntry[];
  found: DesktopFound[];
  current?: string;
  problem?: DesktopProblem;
  version?: string;
}

// "Make reachable for local programs" of the open local instance (desktop/internal/shell/localapi.go):
// port stays stored while it is off; listening is false while off or when the port could not be taken
export interface DesktopLocalApi {
  enabled: boolean;
  port?: number;
  listening: boolean;
  problem?: DesktopProblem;
}

interface OpenAnswer {
  url: string;
  id: string;
  local?: boolean;
}

export class DesktopShellError extends Error {
  constructor(readonly problem: DesktopProblem) {
    super(problem.code);
    this.name = 'DesktopShellError';
  }
}

async function call<T>(op: string, body: Record<string, string | number | boolean> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/__desktop/api/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MindSift-Desktop': '1' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (e) {
    throw new DesktopShellError({ code: 'shellUnreachable', detail: String(e) });
  }
  if (!res.ok) throw new DesktopShellError({ code: 'failed', detail: `HTTP ${res.status}` });
  const data = (await res.json()) as T & { error?: DesktopProblem };
  if (data.error) throw new DesktopShellError(data.error);
  return data;
}

export const desktopShell = {
  state: () => call<DesktopState>('state'),
  create: (name: string) => call<OpenAnswer>('create', { name }),
  open: (id: string) => call<OpenAnswer>('open', { id }),
  openFound: (path: string) => call<OpenAnswer>('open-found', { path }),
  addServer: (name: string, url: string) => call<OpenAnswer>('add-server', { name, url }),
  rename: (id: string, name: string) => call<{ ok: boolean }>('rename', { id, name }),
  remove: (id: string) => call<{ ok: boolean }>('remove', { id }),
  showBase: () => call<{ ok: boolean }>('show-base'),
  // The system's folder dialog (opened at path when it exists); '' when cancelled. path is the folder to
  // store, shown the same folder as the person knows it (under Flatpak path is the document portal's)
  pickFolder: (path: string) => call<{ path: string; shown?: string }>('pick-folder', { path }),
  localApi: () => call<DesktopLocalApi>('local-api'),
  // port 0: keep the instance's port, or let the shell choose one when switched on for the first time
  setLocalApi: (enabled: boolean, port = 0) => call<DesktopLocalApi>('local-api-set', { enabled, port }),
};

// Which local instance the window's storage belongs to. All local instances share the window's origin, so
// the session, the offline cache and stored notes of one must not reach the next.
const INSTANCE_KEY = 'mindsift:desktop-instance';

// Goes where the shell says; before a local instance other than the last one, the window's storage of the
// previous instance is cleared (the new one signs itself in)
export async function goTo(answer: OpenAnswer): Promise<void> {
  if (answer.local) {
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(INSTANCE_KEY);
    } catch {
      // storage blocked: nothing kept either
    }
    if (previous !== answer.id) {
      clearToken();
      await Promise.all([clearOfflineData().catch(() => {}), clearStoredNotes()]);
      try {
        localStorage.setItem(INSTANCE_KEY, answer.id);
      } catch {
        // storage blocked
      }
    }
  }
  window.location.replace(answer.url);
}
