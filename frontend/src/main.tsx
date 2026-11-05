import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MobileActionProvider } from './context/MobileActionContext';
// Texts of the app in the person's language (i18n/index.ts)
import './i18n';
// Inter ships with the app (no external font service); the variable font covers all weights
import '@fontsource-variable/inter';
import './index.css';
import { applyBulletGuides } from './lib/bulletGuides';

// Guide lines in notes, as last chosen in this browser
applyBulletGuides();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileActionProvider>
      <App />
    </MobileActionProvider>
  </React.StrictMode>
);


// Service worker for the app shell (offline start, see public/sw.js)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
