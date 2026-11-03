// Runs before the first paint: the loading screen takes the colours of the theme used last on this
// device (stored by the app in lib/theme.ts), so a light or orange theme does not start in blue.
// A file instead of an inline script so the CSP can stay at script-src 'self'.
(function () {
  try {
    var colors = JSON.parse(localStorage.getItem('mindsift_boot_colors') || 'null');
    if (!colors || typeof colors.bg !== 'string' || typeof colors.accent !== 'string') return;
    var root = document.documentElement;
    root.style.setProperty('--boot-bg', colors.bg);
    root.style.setProperty('--boot-accent', colors.accent);
    if (typeof colors.onAccent === 'string') root.style.setProperty('--boot-on-accent', colors.onAccent);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors.bg);
  } catch (e) {
    // no storage: the loading screen stays blue
  }
})();
