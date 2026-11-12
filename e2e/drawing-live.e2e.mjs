// Live drawing: two browsers (Chromium and Firefox) draw in the same drawing at once and see each other's
// shapes and pointers; a third browser without WebSocket (blocked like by a proxy, so the app falls back
// to SSE) watches live and gets no "Mitzeichnen". The host closes the tab, the other one becomes host and
// saves with "Fertig": the drawing is in the note, also after reloading.
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
// SHOTS=<dir> also takes screenshots of the steps (desktop; PHONE=1 for a phone-sized second browser).
import { chromium, firefox } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(200);
  }
  return null;
}

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function openNote(engine, token, title, { noWebSocket = false, phone = false } = {}) {
  const browser = await engine.launch();
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 780 }, isMobile: engine === chromium, hasTouch: true, locale: 'de-DE' }
      : { viewport: { width: 1280, height: 860 }, locale: 'de-DE' }
  );
  // Like a proxy that refuses the upgrade: the app goes on over SSE
  if (noWebSocket) await ctx.routeWebSocket(/\/api\/v1\/ws/, (ws) => ws.close({ code: 1008, reason: 'blocked by proxy' }));
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.getByRole('img', { name: /^Zeichnung/ }).first().waitFor({ timeout: 10000 });
  await sleep(2500); // realtime connection (and the fallback without WebSocket) settles
  return { browser, ctx, page };
}

const editor = (page) => page.getByRole('dialog', { name: 'Zeichnung bearbeiten' });
// Shapes in the editor's canvas: ellipses and diamonds (polygons) only come from the drawing
const count = (page, sel) => editor(page).locator(`svg ${sel}`).count();

async function drawShape(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userInfo = dir.find((u) => u.username === 'user' || u.email?.startsWith('user'));
  const adminName = dir.find((u) => u.username === 'admin').displayName;
  const userName = userInfo.displayName;
  const stamp = Date.now();
  const title = `Live-Skizze ${stamp}`;
  const start = JSON.stringify({ v: 1, els: [{ id: 'start', ver: 1, t: 'rect', x: 0, y: 0, w: 160, h: 70, s: 'main', f: 'none', sw: 2, txt: 'Start' }] });
  const doc = await api(admin, 'POST', '/api/v1/documents', {
    title,
    blocks: [
      { id: `lv1_${stamp}`, type: 'bullet', content: 'Gemeinsam zeichnen', level: 0 },
      { id: `lv2_${stamp}`, type: 'drawing', content: start, level: 0 },
    ],
  });
  await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId: userInfo.id, permission: 'write' });

  const A = await openNote(chromium, admin, title);
  const B = await openNote(firefox, user, title, { phone: process.env.PHONE === '1' });
  const C = await openNote(chromium, admin, title, { noWebSocket: true });

  // 1. Anna (admin, Chromium) opens the drawing: with a WebSocket that starts a live session
  await A.page.getByRole('img', { name: /^Zeichnung/ }).first().dblclick();
  await editor(A.page).waitFor({ timeout: 5000 });
  // Alone in it, the editor looks like drawing alone: no host, no people
  await sleep(1000);
  check((await editor(A.page).locator('[data-live-host]').count()) === 0, 'Allein in der Zeichnung keine Gastgeber-Anzeige');
  await drawShape(A.page, 'o', [380, 300], [540, 400]);

  // 2. The others' note shows the live drawing instead of a lock
  const badge = await waitFor(async () => {
    const t = await B.page.locator('[data-live-badge]').first().textContent();
    return t?.includes('Live-Zeichnung') ? t : null;
  }, 10000);
  check(!!badge && badge.includes(adminName), 'Die Notiz zeigt „Live-Zeichnung: …“', badge);
  await shot(B.page, 'note-live-badge');

  // 3. Ben (user, Firefox) asks to join: "zeichnet gerade – Zusehen / Mitzeichnen"
  await B.page.getByRole('img', { name: /^Zeichnung/ }).first().dblclick();
  const ask = B.page.getByRole('alertdialog');
  await ask.waitFor({ timeout: 5000 });
  check((await ask.textContent()).includes('zeichnet gerade'), 'Hinweis „… zeichnet gerade“');
  const offersWatch = await waitFor(async () => (await ask.getByRole('button', { name: 'Zusehen' }).count()) === 1, 3000);
  check(!!offersWatch, 'Zusehen wird angeboten');
  await shot(B.page, 'ask-join');
  await ask.getByRole('button', { name: 'Mitzeichnen' }).click();
  await editor(B.page).waitFor({ timeout: 5000 });
  const seesEllipse = await waitFor(async () => (await count(B.page, 'ellipse')) >= 1, 5000);
  check(!!seesEllipse, 'Ben sieht die Ellipse von Anna');
  const hostShown = await waitFor(async () => (await editor(A.page).locator('[data-live-host]').textContent())?.includes('Du bist Gastgeber'), 5000);
  check(!!hostShown, 'Wer die Zeichnung geöffnet hat, ist Gastgeber, sobald jemand mitzeichnet');

  // 4. Both draw at once
  await Promise.all([drawShape(B.page, 'd', [700, 300], [860, 420]), drawShape(A.page, 'o', [380, 500], [520, 580])]);
  const aSeesDiamond = await waitFor(async () => (await count(A.page, 'polygon')) === 1, 5000);
  check(!!aSeesDiamond, 'Anna sieht die Raute von Ben');
  const bSeesBoth = await waitFor(async () => (await count(B.page, 'ellipse')) === 2, 5000);
  check(!!bSeesBoth, 'Ben sieht die zweite Ellipse, gleichzeitig gezeichnet');

  // 5. Pointers and selections of the others with their names
  await A.page.mouse.move(600, 450, { steps: 4 });
  await B.page.mouse.move(650, 380, { steps: 4 });
  await sleep(200);
  await A.page.mouse.move(610, 460, { steps: 2 });
  await B.page.mouse.move(660, 390, { steps: 2 });
  const aSeesBen = await waitFor(async () => (await editor(A.page).locator(`[data-live-cursor="${userName}"]`).count()) === 1, 5000);
  check(!!aSeesBen, 'Anna sieht den Zeiger von Ben mit Namen');
  const bSeesAnna = await waitFor(async () => (await editor(B.page).locator(`[data-live-cursor="${adminName}"]`).count()) === 1, 5000);
  check(!!bSeesAnna, 'Ben sieht den Zeiger von Anna mit Namen');
  const selection = await waitFor(async () => (await editor(A.page).locator(`[data-live-selection="${userName}"]`).count()) >= 1, 5000);
  check(!!selection, 'Anna sieht die Auswahl von Ben in seiner Farbe');
  const stack = await editor(A.page).locator('[data-live-people]').getAttribute('data-live-people');
  check(stack?.includes(userName) && stack.includes(adminName), 'Profilbild-Stapel zeigt beide', stack);
  await shot(A.page, 'two-drawing');
  await shot(B.page, 'two-drawing-ben');

  // 6. A browser without WebSocket can only watch, and sees changes live
  await C.page.getByRole('img', { name: /^Zeichnung/ }).first().dblclick();
  const askC = C.page.getByRole('alertdialog');
  await askC.waitFor({ timeout: 5000 });
  check((await askC.getByRole('button', { name: 'Mitzeichnen' }).count()) === 0, 'Ohne WebSocket kein „Mitzeichnen“');
  check((await askC.textContent()).includes('WebSocket'), 'Hinweis, dass Mitzeichnen eine WebSocket-Verbindung braucht');
  await askC.getByRole('button', { name: 'Zusehen' }).click();
  await editor(C.page).waitFor({ timeout: 5000 });
  const cSees = await waitFor(async () => (await count(C.page, 'ellipse')) >= 1 && (await count(C.page, 'polygon')) >= 1, 8000);
  check(!!cSees, 'Zuschauer sieht beide Formen');
  check((await editor(C.page).getByRole('button', { name: 'Mitzeichnen' }).count()) === 0, 'Zuschauer ohne WebSocket hat keinen Mitzeichnen-Knopf');
  check((await editor(C.page).getByRole('button', { name: /^Auswählen/ }).count()) === 0, 'Zuschauer hat keine Werkzeuge');
  const before = await count(C.page, 'ellipse');
  await drawShape(A.page, 'o', [760, 520], [880, 600]);
  const liveC = await waitFor(async () => (await count(C.page, 'ellipse')) > before, 8000);
  check(!!liveC, 'Zuschauer sieht neue Formen live (über SSE)');
  const watcherShown = await waitFor(async () => (await editor(A.page).locator('[data-live-people]').getAttribute('title'))?.includes('Sehen zu'), 5000);
  check(!!watcherShown, 'Die Zeichnenden sehen, wer zusieht');
  await sleep(300);
  await shot(C.page, 'watcher');

  // 7. Anna (host) closes her tab: Ben, longest in it, becomes host
  await A.ctx.close();
  await A.browser.close();
  const bHost = await waitFor(async () => (await editor(B.page).locator('[data-live-host]').textContent())?.includes('Du bist Gastgeber'), 8000);
  check(!!bHost, 'Ben wird Gastgeber, als Annas Tab zugeht');
  const cHost = await waitFor(async () => (await editor(C.page).locator('[data-live-host]').getAttribute('data-live-host')) === userName, 8000);
  check(!!cHost, 'Zuschauer sieht den neuen Gastgeber');
  await shot(B.page, 'new-host');

  // 8. Ben saves with "Fertig": the drawing is in the note
  await editor(B.page).getByRole('button', { name: /^Fertig/ }).click();
  const closed = await waitFor(async () => (await editor(B.page).count()) === 0, 8000);
  check(!!closed, 'Fertig schließt den Editor');
  const saved = await waitFor(async () => {
    const snap = await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
    const b = snap.blocks.find((x) => x.type === 'drawing' && !x.deleted);
    const d = b && JSON.parse(b.content);
    const kinds = d?.els?.map((e) => e.t) || [];
    return kinds.filter((k) => k === 'ellipse').length === 3 && kinds.filter((k) => k === 'diamond').length === 1 && kinds.filter((k) => k === 'rect').length === 1 ? d : null;
  }, 10000);
  check(!!saved, 'Die Zeichnung steht in der Notiz (drei Ellipsen, Raute, Rechteck)');
  check(!!saved && !JSON.stringify(saved).includes('nonce') && !JSON.stringify(saved).includes('deleted'), 'Gespeichert ohne Sitzungsdaten (nonce, Tombstones)');
  const conflictCopies = (await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`)).blocks.filter((b) => !b.deleted && b.props?.conflictOf).length;
  check(conflictCopies === 0, 'Keine Konfliktkopie beim Speichern', conflictCopies);
  const ended = await waitFor(async () => (await C.page.locator('[data-live-notice]').textContent())?.includes('gespeichert'), 8000);
  check(!!ended, 'Zuschauer sieht das Ende der Sitzung');
  await shot(C.page, 'ended');

  await B.page.reload();
  await B.page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();
  await B.page.getByText(title, { exact: true }).first().click();
  const afterReload = await waitFor(
    async () => (await B.page.locator('[role="img"][aria-label^="Zeichnung"] ellipse').count()) === 3 && (await B.page.locator('[role="img"][aria-label^="Zeichnung"] polygon').count()) === 1,
    10000
  );
  check(!!afterReload, 'Nach dem Neuladen zeigt die Notiz die Zeichnung');
  check((await B.page.locator('[data-live-badge]').count()) === 0, 'Nach Fertig keine Live-Anzeige mehr');

  await B.browser.close();
  await C.browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
