// End-to-end test of collaborative note editing with two real browsers (owner and editor).
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
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

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await sleep(250);
  }
  return null;
}

const serverBlocks = async (token, docId) => {
  const snap = await api(token, 'GET', `/api/v1/docs/${docId}/snapshot`);
  return snap.blocks.filter((b) => !b.deleted).map((b) => b.content);
};

// Outliner text fields of a page (without the title field)
const editorValues = (page) =>
  page.$$eval('textarea', (els) => els.filter((e) => !e.placeholder?.startsWith('Titel')).map((e) => e.value));

async function openDoc(browser, token, title) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('textarea').length > 1, null, { timeout: 10000 });
  return { ctx, page };
}

const TITLE = `E2E Notiz ${Date.now()}`;
const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userId = dir.find((u) => u.username === 'user' || u.email?.startsWith('user')).id;
  const doc = await api(admin, 'POST', '/api/v1/documents', {
    title: TITLE,
    blocks: [{ id: 'e2e_1', type: 'bullet', content: 'Erster Punkt', level: 0 }],
  });
  await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId, permission: 'write' });

  const browser = await chromium.launch();
  const A = await openDoc(browser, admin, TITLE);
  const B = await openDoc(browser, user, TITLE);
  check((await editorValues(A.page)).includes('Erster Punkt'), 'Admin sees the note');
  check((await editorValues(B.page)).includes('Erster Punkt'), 'Editor sees the note');

  // 1. Admin types at the end of the first bullet
  await A.page.getByText('Erster Punkt', { exact: true }).first().click();
  await A.page.keyboard.press('End');
  await A.page.keyboard.type(' + A');
  const saved = await waitFor(async () => (await serverBlocks(admin, doc.id)).includes('Erster Punkt + A'), 5000);
  check(!!saved, 'Typed text is on the server');
  const seenByB = await waitFor(async () => (await editorValues(B.page)).includes('Erster Punkt + A'), 8000);
  check(!!seenByB, 'Editor sees the change without reloading');

  // 2. Admin creates a new bullet with Enter
  await A.page.keyboard.press('Enter');
  await sleep(150); // a human does not type within the same frame as Enter
  await A.page.keyboard.type('Zweiter von A');
  const second = await waitFor(async () => (await editorValues(B.page)).includes('Zweiter von A'), 8000);
  check(!!second, 'Neuer Bullet erscheint beim Bearbeiter');

  // 3. Bearbeiter adds his own bullet at the end
  await B.page.getByText('Zweiter von A', { exact: true }).first().click();
  await B.page.keyboard.press('End');
  await B.page.keyboard.press('Enter');
  await sleep(150);
  await B.page.keyboard.type('Von B');
  const fromB = await waitFor(async () => (await editorValues(A.page)).includes('Von B'), 8000);
  check(!!fromB, 'Bullet des Bearbeiters erscheint beim Admin');

  // 4. Offline phase on the admin side
  await A.ctx.setOffline(true);
  await A.page.getByText('Erster Punkt + A', { exact: true }).first().click();
  await A.page.keyboard.press('End');
  await A.page.keyboard.type(' offline');
  await sleep(1500);
  check(!(await serverBlocks(admin, doc.id)).includes('Erster Punkt + A offline'), 'Typed offline: not on the server yet');
  await A.ctx.setOffline(false);
  await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
  const afterOnline = await waitFor(async () => (await serverBlocks(admin, doc.id)).includes('Erster Punkt + A offline'), 8000);
  check(!!afterOnline, 'Back online, the offline text is sent');

  // 5. Both converge and a reload shows the same state
  await sleep(4000);
  const final = await serverBlocks(admin, doc.id);
  const a = await editorValues(A.page);
  const b = await editorValues(B.page);
  check(JSON.stringify(a) === JSON.stringify(b), `Beide Browser zeigen dasselbe: ${JSON.stringify(a)}`);
  check(final.every((c) => a.includes(c)), `Server state is visible: ${JSON.stringify(final)}`);
  await A.page.reload();
  await A.page.getByRole('button', { name: /Workspace/ }).first().click();
  await A.page.getByText(TITLE, { exact: true }).first().click();
  const reloaded = await waitFor(async () => {
    const v = await editorValues(A.page);
    return JSON.stringify(v) === JSON.stringify(a) ? v : null;
  }, 8000);
  check(!!reloaded, 'Everything is still there after reloading');

  // 6. Structure: indent with Tab, merge with Backspace, both survive a reload. B leaves first, so none of
  // its block leases are active (with B's cursor in a block the server rightly rejects moving it).
  await B.ctx.close();
  // Closing a context abruptly may drop B's "leave" request; its leases then expire after 20 s
  const freed = await waitFor(async () => {
    const probe = await api(admin, 'POST', `/api/v1/docs/${doc.id}/sync`, { clientId: 'probe', lastSeq: 0 });
    return probe.leases.others.length === 0;
  }, 25000);
  check(!!freed, 'Locks of a closed browser expire after 20 s at most');
  await sleep(3500); // the admin's browser learns about it with its next sync (every 3 s in shared notes)
  await A.page.getByText('Von B', { exact: true }).first().click();
  await A.page.keyboard.press('Home');
  await A.page.keyboard.press('Tab');
  await sleep(1500);
  const legacy = await api(admin, 'GET', `/api/v1/documents/${doc.id}`);
  const vonB = legacy.blocks.find((b) => b.content === 'Von B');
  check(vonB && vonB.level === 1, `Tab indents (level ${vonB?.level})`);
  await A.page.getByText('Zweiter von A', { exact: true }).first().click();
  await A.page.keyboard.press('Home');
  await A.page.keyboard.press('Backspace');
  const merged = await waitFor(async () => (await serverBlocks(admin, doc.id)).includes('Erster Punkt + A offlineZweiter von A'), 5000);
  check(!!merged, 'Backspace at the start of a line merges with the bullet above');
  await A.page.reload();
  await A.page.getByRole('button', { name: /Workspace/ }).first().click();
  await A.page.getByText(TITLE, { exact: true }).first().click();
  const afterStructure = await waitFor(async () => {
    const v = await editorValues(A.page);
    return v.includes('Erster Punkt + A offlineZweiter von A') && v.includes('Von B') && !v.includes('Zweiter von A') ? v : null;
  }, 8000);
  check(!!afterStructure, `Struktur nach Neuladen erhalten: ${JSON.stringify(afterStructure)}`);
  const B2 = await openDoc(browser, user, TITLE);
  const bSees = await waitFor(async () => {
    const v = await editorValues(B2.page);
    return v.includes('Erster Punkt + A offlineZweiter von A') && !v.includes('Zweiter von A') ? v : null;
  }, 8000);
  check(!!bSees, `Editor sees the same state after opening again: ${JSON.stringify(bSees)}`);

  const log = await api(admin, 'POST', `/api/v1/docs/${doc.id}/sync`, { clientId: 'e2e-check', lastSeq: 0 });
  const conflicts = log.ops.filter((e) => e.effect.kind === 'insert' && e.effect.props?.conflictOf).length;
  console.log(`Log: ${log.headSeq} entries, ${conflicts} conflict copies`);

  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
