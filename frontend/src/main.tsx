import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PublicNote } from './app/PublicNote';
import { loadMainViews } from './app/useMainViews';
import { resolveLanguage, startI18n, startLanguage } from './i18n';
import { getToken } from './lib/api';
import { prefetchAuthStatus } from './app/useSessionBootstrap';
import { MobileActionProvider } from './context/MobileActionContext';
import { installDropGuard } from './lib/dropGuard';
import { isDesktopStart } from './lib/desktopStart';
// Inter ships with the app (no external font service); the variable font covers all weights
import '@fontsource-variable/inter';
import './index.css';

// A file or link dropped where nothing takes it must not replace the app (lib/dropGuard.ts)
installDropGuard();

// A note shared by public link (/p/<token>) opens without the app around it and without login,
// in the visitor's browser language
const publicToken = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/)?.[1];
// The desktop app's start view (served by its shell, features/desktop): no server behind it, so no sign-in
// check, no app chunk and no service worker; in the system's language
const desktopStart = isDesktopStart();
const DesktopStartView = React.lazy(() => import('./features/desktop/DesktopStartView'));

// Texts of the app (i18n/index.ts): the first render waits for the start language and German, its fallback;
// until then the logo of index.html stays. The app's first request to the server goes out at the same time.
if (!publicToken && !desktopStart) prefetchAuthStatus();
// With a stored session the app's chunk is fetched now, next to the texts, but only run by loadMainViews()
// after the first render (the meta tag comes from vite.config.ts, nameMainChunk; not there in development)
if (!publicToken && !desktopStart && getToken()) {
  for (const href of document.querySelector<HTMLMetaElement>('meta[name="mindsift-main-chunk"]')?.content.split(' ') ?? []) {
    if (!href) continue;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.crossOrigin = '';
    link.href = href;
    document.head.appendChild(link);
  }
}
const lang =
  publicToken || desktopStart ? resolveLanguage(undefined, document.documentElement.lang) : startLanguage(Boolean(getToken()));
void startI18n(lang).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {desktopStart ? (
        <React.Suspense fallback={null}>
          <DesktopStartView />
        </React.Suspense>
      ) : (
        <MobileActionProvider>{publicToken ? <PublicNote token={publicToken} /> : <App />}</MobileActionProvider>
      )}
    </React.StrictMode>
  );
  // With a stored session the app's chunk starts loading right away, next to the sign-in check. Not before
  // the texts: evaluating the large chunk first would hold up the first render.
  if (!desktopStart && getToken()) loadMainViews().catch(() => {});
});

// Service worker for the app shell (offline start, see public/sw.js)
if ('serviceWorker' in navigator && !desktopStart) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
