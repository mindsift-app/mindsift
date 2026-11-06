import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PublicNoteView } from './features/public/PublicNoteView';
import { applyLanguage, resolveLanguage } from './i18n';
import { MobileActionProvider } from './context/MobileActionContext';
// Texts of the app in the person's language (i18n/index.ts)
import './i18n';
// Inter ships with the app (no external font service); the variable font covers all weights
import '@fontsource-variable/inter';
import './index.css';

// A note shared by public link (/p/<token>) opens without the app around it and without login,
// in the visitor's browser language
const publicToken = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/)?.[1];
if (publicToken) void applyLanguage(resolveLanguage());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileActionProvider>{publicToken ? <PublicNoteView token={publicToken} /> : <App />}</MobileActionProvider>
  </React.StrictMode>
);


// Service worker for the app shell (offline start, see public/sw.js)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
