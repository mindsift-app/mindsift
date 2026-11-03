// View state for this browser tab that survives switching between the app's tabs (the views
// remount), like the workspace's open note: which list was open, list or Kanban view
const PREFIX = 'mindsift_view:';

export function readViewSession<T extends object>(view: string): Partial<T> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PREFIX + view) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function writeViewSession<T extends object>(view: string, state: T) {
  try {
    sessionStorage.setItem(PREFIX + view, JSON.stringify(state));
  } catch {
    // storage blocked: the view simply starts fresh
  }
}

// Remembered per device as well (localStorage): a new tab or a restart of the installed app opens the
// same list again. This tab's own state wins, so two tabs can show different lists.
const DEVICE_PREFIX = 'mindsift_view_device:';

export function readViewMemory<T extends object>(view: string): Partial<T> {
  let device: Partial<T> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_PREFIX + view) || '{}');
    if (raw && typeof raw === 'object') device = raw;
  } catch {
    // storage blocked or broken: the tab state alone
  }
  return { ...device, ...readViewSession<T>(view) };
}

export function writeViewMemory<T extends object>(view: string, state: T) {
  writeViewSession(view, state);
  try {
    localStorage.setItem(DEVICE_PREFIX + view, JSON.stringify(state));
  } catch {
    // only a convenience
  }
}
