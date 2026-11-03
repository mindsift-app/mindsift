import i18n from '../i18n';
import { api } from './api';

// Web push in this browser: the service worker shows the notifications, the server sends them over the
// browser's push service (VAPID). iPhones and iPads need MindSift added to the home screen first.

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS/iPadOS outside the installed home screen app: push is not offered there */
export function needsHomeScreenInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export function deviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} auf ${os}` : browser;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

/** The subscription of this browser, if push is switched on here. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error(i18n.t('common:push.unsupported'));
  if (needsHomeScreenInstall()) throw new Error(i18n.t('common:push.homeScreen'));
  const key = await api.getPushKey();
  if (!key.enabled || !key.publicKey) throw new Error(i18n.t('common:push.unavailable'));
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(i18n.t('common:push.denied'));
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey) as BufferSource,
      });
    } catch {
      // e.g. "Registration failed – permission denied": blocked for the site or no push service reachable
      throw new Error(i18n.t('common:push.rejected'));
    }
  }
  // The address this browser registered before is dead once it has a new one (e.g. after reinstalling
  // the app): the server drops it right away instead of counting it as another device
  const previous = readStoredEndpoint();
  await api.subscribePush(sub.toJSON(), deviceName(), previous && previous !== sub.endpoint ? previous : undefined);
  storeEndpoint(sub.endpoint);
}

const ENDPOINT_KEY = 'mindsift_push_endpoint';

function readStoredEndpoint(): string | null {
  try {
    return localStorage.getItem(ENDPOINT_KEY);
  } catch {
    return null;
  }
}

function storeEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    // storage blocked: the dead device is removed on the next push instead
  }
}

/** Removes one of the own devices (e.g. an old installation) on the server. */
export async function removePushDevice(endpoint: string): Promise<void> {
  const here = await currentPushSubscription();
  if (here?.endpoint === endpoint) {
    await disablePush();
    return;
  }
  await api.unsubscribePush(endpoint);
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await api.unsubscribePush(endpoint).catch(() => {});
  storeEndpoint(null);
}
