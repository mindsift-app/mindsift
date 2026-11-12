// Tasks and shopping lists update live behind (simulated) proxies: another device (here the API) adds
// a task, moves it to another column and adds a list item; the browser has to show each change without
// reloading or switching tabs. Covers the app-wide realtime fallbacks WebSocket -> SSE -> long polling.
// Needs a server in demo mode (account admin/admin); see e2e/README.md.
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

// Waits until the page shows `text` (inside `scope` if given), at most `ms`; returns the time it took
async function shows(page, text, ms, scope) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const root = scope ? page.locator(scope) : page;
    if ((await root.getByText(text, { exact: false }).count()) > 0) return Date.now() - start;
    await sleep(200);
  }
  return null;
}

const MODES = [
  { name: 'nichts blockiert', block: {} },
  { name: 'WebSocket abgelehnt, SSE hängt ohne Antwort', block: { ws: 'reject', sse: 'hang' } },
  { name: 'WebSocket abgelehnt, SSE abgewiesen', block: { ws: 'reject', sse: 'abort' } },
];
const MAX_MS = 8000;

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const lists = await api(admin, 'GET', '/api/v1/lists');
  const list = lists[0];
  const browser = await chromium.launch();

  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    if (mode.block.ws === 'reject') await ctx.routeWebSocket(/\/api\/v1\/ws/, (ws) => ws.close({ code: 1008, reason: 'blocked by proxy' }));
    if (mode.block.sse === 'abort') await ctx.route(/\/api\/v1\/events(\?|$)/, (r) => r.abort());
    if (mode.block.sse === 'hang') await ctx.route(/\/api\/v1\/events(\?|$)/, () => {}); // never answered
    await ctx.addInitScript((t) => {
      localStorage.setItem('mindsift_jwt_token', t);
      localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
    }, admin);
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByRole('button', { name: /^Aufgaben/ }).locator('visible=true').first().click();
    await page.getByRole('radio', { name: /^Kanban/ }).first().click();
    await sleep(8000); // time for the fallbacks to settle

    const stamp = Date.now();
    const title = `Live ${stamp}`;
    const task = await api(admin, 'POST', '/api/v1/inbox', { content: title, priority: 'normal', source: 'manual', target: 'task' });
    const added = await shows(page, title, MAX_MS);
    check(added !== null, `${mode.name}: neue Aufgabe kommt an${added !== null ? ` (${added} ms)` : ''}`);

    // Moved to another column on the other device
    const columns = await page.$$eval('[data-kanban-col]', (els) => els.map((e) => e.getAttribute("data-kanban-col")));
    const target = columns.find((c) => c && c !== 'todo') || 'in_progress';
    await api(admin, 'PATCH', `/api/v1/thoughts/${task.id}`, { kanbanStatus: target });
    const moved = await shows(page, title, MAX_MS, `[data-kanban-col="${target}"]`);
    check(moved !== null, `${mode.name}: Spaltenwechsel kommt an${moved !== null ? ` (${moved} ms)` : ''}`);

    // A new item in a shopping list
    await page.getByRole('button', { name: /^Listen/ }).locator('visible=true').first().click();
    await page.getByText(list.title, { exact: false }).first().click();
    await sleep(1500);
    const item = `Milch ${stamp}`;
    await api(admin, 'POST', `/api/v1/lists/${list.id}/items`, { content: item, category: '', quantity: '' });
    const listed = await shows(page, item, MAX_MS);
    check(listed !== null, `${mode.name}: neuer Listeneintrag kommt an${listed !== null ? ` (${listed} ms)` : ''}`);

    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
