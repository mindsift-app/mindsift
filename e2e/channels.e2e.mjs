// How fast changes arrive behind different (simulated) proxies. The admin edits with a normal connection;
// the editor's browser blocks WebSocket, SSE and/or long polling. Needs a server in demo mode.
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
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
    await sleep(100);
  }
  return null;
}

const editorValues = (page) =>
  page.$$eval('textarea', (els) => els.filter((e) => !e.placeholder?.startsWith('Titel')).map((e) => e.value));
const channelOf = (page) => page.getAttribute('[data-sync-channel]', 'data-sync-channel');

async function openDoc(browser, token, title, block = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // A blocking proxy refuses the connection (policy violation); a clean close would just mean "reconnect"
  if (block.ws === 'reject') await ctx.routeWebSocket(/\/api\/v1\/ws/, (ws) => ws.close({ code: 1008, reason: 'blocked by proxy' }));
  if (block.ws === 'silent') await ctx.routeWebSocket(/\/api\/v1\/ws/, () => {}); // accepted, nothing forwarded
  if (block.sse === 'abort') await ctx.route('**/api/v1/events**', (r) => r.abort());
  if (block.sse === 'hang') await ctx.route('**/api/v1/events**', () => {}); // never answered
  if (block.longpoll) {
    // Every request the server holds open: the note's own long polling and the app-wide one
    await ctx.route('**/changes**', (r) => r.abort());
    await ctx.route(/\/api\/v1\/events\/poll\//, (r) => r.abort());
  }
  await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('textarea').length > 1, null, { timeout: 10000 });
  return { ctx, page };
}

async function typeAtEnd(page, text) {
  await page.bringToFront();
  // Place the cursor via script: Playwright's actionability checks wait for animation frames, which
  // pages in the background do not get while the other browser window is in front
  const ok = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('textarea')).find((e) => e.value.startsWith('Live-Test'));
    if (!el) return false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    return true;
  });
  if (!ok) throw new Error('Live-Test field not found');
  await page.keyboard.type(text);
}

const TITLE = `Kanal-Test ${Date.now()}`;

const MODES = [
  { name: 'nichts blockiert', block: {}, channel: 'ws', maxMs: 2500 },
  { name: 'WebSocket-Handshake abgelehnt', block: { ws: 'reject' }, channel: 'sse', maxMs: 2500 },
  { name: 'WebSocket angenommen, leitet nichts weiter', block: { ws: 'silent' }, channel: 'sse', maxMs: 2500, switchMs: 60000 },
  { name: 'WebSocket and SSE blocked', block: { ws: 'reject', sse: 'abort' }, channel: 'longpoll', maxMs: 2500 },
  { name: 'SSE connection hangs', block: { ws: 'reject', sse: 'hang' }, channel: 'longpoll', maxMs: 2500 },
  { name: 'only plain requests possible', block: { ws: 'reject', sse: 'abort', longpoll: true }, channel: 'interval', maxMs: 6000, switchMs: 15000 },
];

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userId = dir.find((u) => u.username === 'user' || u.email?.startsWith('user')).id;
  const doc = await api(admin, 'POST', '/api/v1/documents', {
    title: TITLE,
    blocks: [{ id: `ch_${Date.now()}`, type: 'bullet', content: 'Live-Test', level: 0 }],
  });
  await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId, permission: 'write' });

  const browser = await chromium.launch();
  const A = await openDoc(browser, admin, TITLE);

  for (const [i, mode] of MODES.entries()) {
    const B = await openDoc(browser, user, TITLE, mode.block);
    const channel = await waitFor(async () => ((await channelOf(B.page)) === mode.channel ? mode.channel : null), mode.switchMs || 10000);
    check(channel === mode.channel, `${mode.name}: Weg ${(await channelOf(B.page)) || '?'} (erwartet ${mode.channel})`);

    const marker = ` r${i}`;
    const start = Date.now();
    await typeAtEnd(A.page, marker);
    const arrived = await waitFor(async () => (await editorValues(B.page)).some((v) => v.endsWith(marker)), mode.maxMs + 4000);
    const ms = Date.now() - start;
    check(!!arrived && ms <= mode.maxMs, `${mode.name}: change arrived after ${arrived ? ms : '–'} ms (target ≤ ${mode.maxMs} ms)`);
    await B.ctx.close();
  }

  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
