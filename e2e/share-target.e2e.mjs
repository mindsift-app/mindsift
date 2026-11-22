// The share target (/share-target, handled by the service worker): a form on another site that posts there
// must not put its text into the inbox of whoever is signed in (audit 2026-11-22 N1); a share the app's own
// origin posts still arrives. The system's share sheet itself (a navigation the browser starts, no page as
// its client) cannot be started from Playwright.
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md. The foreign site is
// the same server under 127.0.0.1, another origin than localhost.
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const FOREIGN = BASE.replace('//localhost', '//127.0.0.1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const token = (
  await (
    await fetch(BASE + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'user', password: 'user' }),
    })
  ).json()
).token;
const inbox = async () =>
  JSON.stringify(await (await fetch(BASE + '/api/v1/thoughts?status=inbox', { headers: { Authorization: 'Bearer ' + token } })).json());

const form = (action, text, noReferrer) =>
  `<!doctype html><meta charset="utf-8">${noReferrer ? '<meta name="referrer" content="no-referrer">' : ''}` +
  `<form id="f" method="POST" action="${action}" enctype="multipart/form-data">` +
  `<input name="title" value="Rechnung offen"><input name="text" value="${text}"></form>` +
  `<script>document.getElementById('f').submit()</script>`;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
  const app = await ctx.newPage();
  await app.goto(BASE + '/');
  await app.evaluate(() => navigator.serviceWorker.ready);
  await app.reload();
  check(await app.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker controls the app');

  // Foreign sites: a plain form, one without referrer (Origin "null") and one from a data: page
  const marker = `fremd-${Date.now()}`;
  for (const [name, noRef] of [['Formular einer fremden Seite', false], ['ohne Referrer', true]]) {
    const evil = await ctx.newPage();
    await evil.route(FOREIGN + '/evil.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: form(BASE + '/share-target', `${marker} ${name}`, noRef) })
    );
    await evil.goto(FOREIGN + '/evil.html');
    await evil.waitForURL((u) => u.origin === BASE && u.pathname === '/', { timeout: 10000 }).catch(() => {});
    check(!evil.url().includes('shared=pending'), `${name}: nicht als Teilen angenommen (${evil.url()})`);
    await sleep(2500);
    await evil.close();
  }
  // A sandboxed frame of the foreign site navigating the whole tab (Origin "null", no referrer)
  const framed = await ctx.newPage();
  await framed.route(FOREIGN + '/frame.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<!doctype html><meta name="referrer" content="no-referrer"><iframe sandbox="allow-forms allow-scripts allow-top-navigation" srcdoc="' +
        form(BASE + '/share-target', `${marker} Rahmen`, true).replace(/"/g, '&quot;').replace('method=', 'target=&quot;_top&quot; method=') +
        '"></iframe>',
    })
  );
  await framed.goto(FOREIGN + '/frame.html');
  await sleep(3000);
  check(!framed.url().includes('shared=pending'), `Rahmen mit sandbox: nicht als Teilen angenommen (${framed.url()})`);
  await framed.close();
  await sleep(1000);
  check(!(await inbox()).includes(marker), 'kein Eintrag einer fremden Seite im Eingang');

  // The app's own origin: taken and turned into an inbox entry when the app opens (a form the app's page
  // submits; the system's share sheet has no page at all)
  const own = `eigen-${Date.now()}`;
  await app.evaluate((text) => {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = '/share-target';
    f.enctype = 'multipart/form-data';
    for (const [name, value] of [['title', 'Geteilt'], ['text', text]]) {
      const input = document.createElement('input');
      input.name = name;
      input.value = value;
      f.appendChild(input);
    }
    document.body.appendChild(f);
    f.submit();
  }, own);
  await app.waitForURL(/shared=pending/, { timeout: 10000 }).catch(() => {});
  check(app.url().includes('shared=pending'), `Teilen vom eigenen Ursprung angenommen (${app.url()})`);
  let arrived = false;
  for (let i = 0; i < 40 && !arrived; i++) {
    arrived = (await inbox()).includes(own);
    if (!arrived) await sleep(250);
  }
  check(arrived, 'geteilter Text vom eigenen Ursprung im Eingang');
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
