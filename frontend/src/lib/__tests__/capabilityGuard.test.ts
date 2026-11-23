import { describe, expect, it } from 'vitest';
import deTexts from '../../locales/de';
import en from '../../locales/en';
import es from '../../locales/es';
import fr from '../../locales/fr';
import itLocale from '../../locales/it';

// What the instance offers is a capability (lib/capabilities.ts), decided by the server; "am I the desktop
// app?" is only for the app's own shell. These files may ask it, nobody else: a new check elsewhere is
// almost always a capability (sharing, accounts, sign-in, mail, push …) and belongs there, and a text that
// differs in the desktop app is almost always one neutral text (Doku/architecture.md, Desktop mode).
const SHELL_FILES = new Set([
  'lib/api/client.ts', // defines it
  'lib/api/index.ts', // exports it
  'lib/api/realtime.ts', // the window's realtime transport (SSE or polling, no WebSocket)
  'App.tsx', // the desktop app's own setup wizard
  'app/useSessionBootstrap.ts', // a new session from the app instead of the sign-in page
  'app/ProfileMenus.tsx', // "switch instance" back to the app's start view instead of signing out
  'features/settings/ApiKeysPanel.tsx', // the local API on 127.0.0.1
  'features/settings/BackupAdminCard.tsx', // the backup folder and how to restore an instance
  'features/settings/admin/DataSettingsSection.tsx', // taking over an account from a server's snapshot
  'features/settings/admin/UpdateStatusCard.tsx', // updating means installing the app's new version
  'features/help/content/desktop.tsx', // InDesktop / NotInDesktop for the help texts above
  'lib/leaveGuard.ts', // no beforeunload question in the app's window (closing it, switching instance)
]);

const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Each file's path below src/ and its code without line comments (they may name the functions)
const files = Object.entries(sources).map(([file, code]) => ({
  path: new URL(file, import.meta.url).pathname.replace(/^.*?\/src\//, ''),
  code: code.replace(/\/\/.*$/gm, ''),
}));
const ASKS = /\b(isDesktopApp|getDesktop)\(/;

describe('desktop checks', () => {
  it('ask isDesktopApp() / getDesktop() only in the shell files', () => {
    const outside = files.filter((f) => ASKS.test(f.code) && !SHELL_FILES.has(f.path)).map((f) => f.path);
    expect(outside, 'use can(…) / useCapabilities() from lib/capabilities.ts, or add a shell file here with a reason').toEqual([]);
  });

  it('lists only shell files that still ask', () => {
    const asking = new Set(files.filter((f) => ASKS.test(f.code) || /\bisDesktopApp\b/.test(f.code)).map((f) => f.path));
    expect([...SHELL_FILES].filter((f) => !asking.has(f))).toEqual([]);
  });
});

// A text kept for the desktop app (…Desktop) is a variant of its neutral text: the base key must exist in
// every language, so the variant can never be the only wording
describe('desktop text variants', () => {
  const ALL: Record<string, unknown> = { de: deTexts, en, es, fr, it: itLocale };
  const variants = (obj: unknown, prefix: string): string[] =>
    typeof obj !== 'object' || obj === null
      ? []
      : Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
          const path = `${prefix}.${k}`;
          if (typeof v === 'string' && k.endsWith('Desktop') && k !== 'Desktop') {
            return (obj as Record<string, unknown>)[k.slice(0, -'Desktop'.length)] === undefined ? [path] : [];
          }
          return variants(v, path);
        });

  it.each(Object.keys(ALL))('%s has a base key for every …Desktop key', (lang) => {
    expect(variants(ALL[lang], lang)).toEqual([]);
  });
});
