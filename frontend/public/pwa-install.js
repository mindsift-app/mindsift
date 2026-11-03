// Runs before the app: browsers fire beforeinstallprompt early, the app picks it up later
// ("App installieren"). A file instead of an inline script so the CSP can stay at script-src 'self'.
window.__deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__deferredPwaPrompt = e;
  window.dispatchEvent(new CustomEvent('mindsift:pwa-ready'));
});
