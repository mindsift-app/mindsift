// A shared shopping list on two phones, one of them without reception for a while: what was ticked, un-ticked,
// changed or deleted offline is sent once the connection is back, and meets what the other person did
// meanwhile without undoing it. Two people ticking the same entry never leave it open; the last change of a
// field wins; a reload while offline keeps the pending changes. Afterwards both phones show the server's state.
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const SHOT_DIR = process.env.SHOT_DIR || ''; // screenshots of both phones after each scenario
const SHOT_PREFIX = process.env.SHOT_PREFIX || '';
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
    await sleep(150);
  }
  return null;
}

const STAMP = Date.now();

// A phone: the account's token, German, touch, the list view open on the given list
async function phone(browser, token) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
    sessionStorage.setItem('mindsift_pwa_dismissed', '1'); // phones are offered to install the app
  }, token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.setDefaultTimeout(8000);
  return { ctx, page };
}

async function openList(p, title) {
  await p.page.goto(BASE);
  await p.page.locator('button[title="Listen"]:visible').first().click();
  await chooseList(p, title);
}

// Phones choose the list in the switcher of the bar above it
async function chooseList(p, title) {
  await p.page.locator('button[aria-haspopup="listbox"]:visible').first().click({ timeout: 30000 });
  await p.page.getByRole('option', { name: new RegExp(title) }).first().click();
}

const row = (p, content) => p.page.locator('div.cursor-pointer', { has: p.page.getByText(content, { exact: true }) }).first();
// Whether the phone shows the entry checked (true), open (false) or not at all (null)
async function shownChecked(p, content) {
  const r = row(p, content);
  if ((await r.count()) === 0) return null;
  if ((await r.locator('button[title="Als offen markieren"]').count()) > 0) return true;
  if ((await r.locator('button[title="Als erledigt abhaken"]').count()) > 0) return false;
  return null;
}
async function tick(p, content, on) {
  await row(p, content).locator(`button[title="${on ? 'Als erledigt abhaken' : 'Als offen markieren'}"]`).first().click();
}

async function goOffline(p) {
  await p.ctx.setOffline(true);
  await p.page.evaluate(() => window.dispatchEvent(new Event('offline')));
}
async function goOnline(p) {
  await p.ctx.setOffline(false);
  await p.page.evaluate(() => window.dispatchEvent(new Event('online')));
}
const outbox = (p) => p.page.evaluate(() => JSON.parse(localStorage.getItem('mindsift_outbox') || '[]').length);
const outboxEmpty = (p) => waitFor(async () => (await outbox(p)) === 0, 15000);

async function serverItem(token, listId, content) {
  const l = await api(token, 'GET', `/api/v1/lists/${listId}`);
  return (l.items || []).find((i) => i.content === content) || null;
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userEntry = dir.find((u) => u.username === 'user' || u.email?.startsWith('user'));

  // The demo's shopping list is shared with "user"
  const lists = await api(user, 'GET', '/api/v1/lists');
  check(
    lists.some((l) => l.title === 'Wocheneinkauf'),
    'Demo-Einkaufsliste „Wocheneinkauf“ ist mit user geteilt'
  );

  // A list of its own for this run, shared like the demo's
  const LIST = `Supermarkt ${STAMP}`;
  const list = await api(admin, 'POST', '/api/v1/lists', { title: LIST, icon: '🛒', listType: 'shopping' });
  await api(admin, 'POST', `/api/v1/lists/${list.id}/shares`, { targetType: 'user', targetId: userEntry.id, role: 'editor' });
  const add = async (content, quantity = '') => api(admin, 'POST', `/api/v1/lists/${list.id}/items`, { content, category: 'Kühlregal', quantity });
  const setDone = async (item, done) => api(admin, 'PATCH', `/api/v1/lists/${list.id}/items/${item.id}`, { isCompleted: done });

  const browser = await chromium.launch();
  const A = await phone(browser, admin);
  const B = await phone(browser, user);

  const shots = async (name) => {
    if (!SHOT_DIR) return;
    mkdirSync(SHOT_DIR, { recursive: true });
    await A.page.screenshot({ path: `${SHOT_DIR}/${SHOT_PREFIX}${name}-handy-a.png` });
    await B.page.screenshot({ path: `${SHOT_DIR}/${SHOT_PREFIX}${name}-handy-b.png` });
  };

  // Every scenario: fresh entries, both phones with the list open (A reloads, B too)
  const fresh = async (...items) => {
    const made = [];
    for (const it of items) made.push(await add(it.content, it.quantity));
    for (let i = 0; i < made.length; i++) if (items[i].done) await setDone(made[i], true);
    await openList(A, LIST);
    await openList(B, LIST);
    for (const it of items) {
      await waitFor(async () => (await shownChecked(A, it.content)) === !!it.done && (await shownChecked(B, it.content)) === !!it.done, 10000);
    }
    return made;
  };
  // Both phones show what the server has
  const agree = async (content, label) => {
    const srv = await serverItem(admin, list.id, content);
    const want = srv ? srv.isCompleted : null;
    const a = await waitFor(async () => (await shownChecked(A, content)) === want, 10000);
    const b = await waitFor(async () => (await shownChecked(B, content)) === want, 10000);
    check(a !== null && b !== null, `${label}: beide Handys zeigen den Stand des Servers`, { server: want, a: await shownChecked(A, content), b: await shownChecked(B, content) });
  };

  // 1. A ticks offline, B ticks online, A comes back: stays ticked
  {
    const X = `Hafermilch ${STAMP}`;
    await fresh({ content: X });
    await goOffline(A);
    await tick(A, X, true);
    await sleep(300);
    await tick(B, X, true);
    await waitFor(async () => (await serverItem(admin, list.id, X))?.isCompleted, 5000);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    const srv = await serverItem(admin, list.id, X);
    check(srv?.isCompleted === true, '1: A offline abgehakt, B online abgehakt → bleibt abgehakt', srv);
    await agree(X, '1');
    await shots('beide-abgehakt');
  }

  // 2. A ticks offline, B ticks and then un-ticks online (later than A): B's last change wins, open
  // ... A's change is older: it does not undo B's later un-tick
  {
    const X = `Joghurt ${STAMP}`;
    await fresh({ content: X });
    await goOffline(A);
    await tick(A, X, true);
    await sleep(300);
    await tick(B, X, true);
    await waitFor(async () => (await shownChecked(B, X)) === true, 3000);
    await tick(B, X, false);
    await waitFor(async () => (await serverItem(admin, list.id, X))?.isCompleted === false, 5000);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    const srv = await serverItem(admin, list.id, X);
    check(srv?.isCompleted === false, '2: A offline abgehakt, danach B abgehakt und wieder geöffnet → offen (B war später)', srv);
    await agree(X, '2');
  }

  // 3. A opens a ticked entry offline, nobody else touches it: open. Then A opens another one offline while
  // B opens and ticks it again afterwards: ticked (B's tick is the newer change)
  {
    const X = `Bergkäse ${STAMP}`;
    const Y = `Butter ${STAMP}`;
    await fresh({ content: X, done: true }, { content: Y, done: true });
    await goOffline(A);
    await tick(A, X, false);
    await tick(A, Y, false);
    await sleep(300);
    await tick(B, Y, false);
    await waitFor(async () => (await shownChecked(B, Y)) === false, 3000);
    await tick(B, Y, true);
    await waitFor(async () => (await serverItem(admin, list.id, Y))?.isCompleted === true, 5000);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    const sx = await serverItem(admin, list.id, X);
    check(sx?.isCompleted === false, '3: A offline wieder geöffnet → offen', sx);
    const sy = await serverItem(admin, list.id, Y);
    check(sy?.isCompleted === true, '3: A offline geöffnet, B danach geöffnet und wieder abgehakt → abgehakt', sy);
    await agree(X, '3');
    await agree(Y, '3');
  }

  // 4. Both offline, both tick, A comes back first, then B: ticked
  {
    const X = `Äpfel ${STAMP}`;
    await fresh({ content: X });
    await goOffline(A);
    await goOffline(B);
    await tick(A, X, true);
    await tick(B, X, true);
    await goOnline(A);
    await outboxEmpty(A);
    await goOnline(B);
    await outboxEmpty(B);
    await sleep(1500);
    const srv = await serverItem(admin, list.id, X);
    check(srv?.isCompleted === true, '4: beide offline abgehakt → abgehakt', srv);
    await agree(X, '4');
  }

  // 5. A ticks and un-ticks offline (no net change), B ticks online: stays ticked
  {
    const X = `Cherrytomaten ${STAMP}`;
    await fresh({ content: X });
    await goOffline(A);
    await tick(A, X, true);
    await waitFor(async () => (await shownChecked(A, X)) === true, 3000);
    await tick(A, X, false);
    await sleep(300);
    await tick(B, X, true);
    await waitFor(async () => (await serverItem(admin, list.id, X))?.isCompleted, 5000);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    const srv = await serverItem(admin, list.id, X);
    check(srv?.isCompleted === true, '5: A offline ab- und wieder aufgehakt, B abgehakt → abgehakt', srv);
    await agree(X, '5');
    await shots('offline-ab-und-auf-partner-abgehakt');
  }

  // 6. Reload while offline with a pending tick: the entry still shows ticked, and B's tick meanwhile stays
  {
    const X = `Avocados ${STAMP}`;
    await fresh({ content: X });
    await goOffline(A);
    await tick(A, X, true);
    await sleep(300);
    await A.page.reload();
    await A.page.locator('button[title="Listen"]:visible').first().click({ timeout: 30000 });
    await chooseList(A, LIST);
    const afterReload = await waitFor(async () => (await shownChecked(A, X)) === true, 8000);
    check(!!afterReload, '6: nach Neuladen offline zeigt A den Eintrag weiter abgehakt', await shownChecked(A, X));
    await tick(B, X, true);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    const srv = await serverItem(admin, list.id, X);
    check(srv?.isCompleted === true, '6: nach Neuladen offline und Senden → abgehakt', srv);
    await agree(X, '6');
  }

  // 7. A changes the quantity offline while B ticks the entry: both stay
  {
    const X = `Espressobohnen ${STAMP}`;
    await fresh({ content: X, quantity: '1x' });
    await goOffline(A);
    await row(A, X).locator('button[title="Menge bearbeiten"]').first().click();
    const qty = A.page.locator('input:focus');
    await qty.fill('3x');
    await qty.press('Enter');
    await waitFor(async () => (await row(A, X).getByText('3x', { exact: true }).count()) > 0, 3000);
    await tick(B, X, true);
    await waitFor(async () => (await serverItem(admin, list.id, X))?.isCompleted, 5000);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    const srv = await serverItem(admin, list.id, X);
    check(srv?.isCompleted === true && srv?.quantity === '3x', '7: Menge offline geändert, B abgehakt → abgehakt mit neuer Menge', srv);
    await agree(X, '7');
    const bQty = await waitFor(async () => (await row(B, X).locator('button[title="Menge bearbeiten"]', { hasText: '3x' }).count()) > 0, 10000);
    check(!!bQty, '7: B sieht die neue Menge');
  }

  // 8. A deletes offline, B ticks online: gone for both. A ticks offline, B deletes: gone, A's tick dropped
  {
    const X = `Pfefferminztee ${STAMP}`;
    const Y = `Spülmaschinentabs ${STAMP}`;
    const [, y] = await fresh({ content: X }, { content: Y });
    await goOffline(A);
    await row(A, X).locator('button[title="Eintrag löschen"]').first().click({ force: true });
    await waitFor(async () => (await shownChecked(A, X)) === null, 3000);
    await tick(A, Y, true);
    await tick(B, X, true);
    await api(user, 'DELETE', `/api/v1/lists/${list.id}/items/${y.id}`);
    await goOnline(A);
    await outboxEmpty(A);
    await sleep(1500);
    check((await serverItem(admin, list.id, X)) === null, '8: offline gelöscht, B abgehakt → gelöscht');
    check((await serverItem(admin, list.id, Y)) === null, '8: offline abgehakt, B gelöscht → bleibt gelöscht');
    await agree(X, '8');
    await agree(Y, '8');
  }

  await browser.close();
  if (failures) {
    console.log(`\n${failures} Prüfung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
