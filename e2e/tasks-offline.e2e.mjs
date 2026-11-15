// A task list shared by two people, one of them without connection for a while: what was ticked or
// un-ticked offline is sent once the connection is back, with when it was done, and meets what the other
// person did meanwhile without undoing it. An older tick does not undo a newer change, two people ticking
// the same task leave it ticked (a repeating task repeats once), and a task ticked and un-ticked again
// offline goes back to its column ("In Bearbeitung") and sends nothing. Afterwards the page shows the
// server's state.
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const SHOT_DIR = process.env.SHOT_DIR || ''; // a screenshot of the offline page after each scenario
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
const LIST = `Haushalt offline ${STAMP}`;

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userEntry = dir.find((u) => u.username === 'user' || u.email?.startsWith('user'));

  const list = await api(admin, 'POST', '/api/v1/task-lists', { title: LIST, icon: '🏠' });
  await api(admin, 'POST', `/api/v1/task-lists/${list.id}/shares`, { targetType: 'user', targetId: userEntry.id, permission: 'editor' });
  const newTask = async (content, patch) => {
    const t = await api(admin, 'POST', '/api/v1/inbox', { content, target: 'task', taskListId: list.id });
    if (patch) await api(admin, 'PATCH', `/api/v1/thoughts/${t.id}`, patch);
    return t;
  };
  const serverTask = (t) => api(admin, 'GET', `/api/v1/thoughts/${t.id}`);
  // "user" changes the task from their own (online) app
  const userSets = (t, patch) => api(user, 'PATCH', `/api/v1/thoughts/${t.id}`, patch);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, admin);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.setDefaultTimeout(8000);

  const openList = async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: /^Aufgaben/ }).locator('visible=true').first().click();
    await page.getByRole('button', { name: new RegExp(LIST) }).first().click();
    await page.getByRole('radio', { name: /^Liste/ }).first().click();
  };
  const row = (title) => page.locator('[data-tour="task"]', { hasText: title }).first();
  // The list view shows open and done tasks on two tabs ("Offen (n)", "Erledigt (n)")
  const showTab = (name) => page.locator('button[aria-pressed]', { hasText: new RegExp(`^${name} \\(`) }).first().click();
  const shownDone = async (title) => {
    const r = row(title);
    if ((await r.count()) === 0) return null;
    if ((await r.locator('button[title="Als offen markieren"]').count()) > 0) return true;
    if ((await r.locator('button[title="Als erledigt abhaken"]').count()) > 0) return false;
    return null;
  };
  const tick = async (title, on) => {
    await showTab(on ? 'Offen' : 'Erledigt');
    await row(title).locator(`button[title="${on ? 'Als erledigt abhaken' : 'Als offen markieren'}"]`).first().click();
    await sleep(400);
  };
  const shownColumn = (title) => row(title).getByRole('button', { name: 'Status / Zustand ändern' }).first().innerText();
  const goOffline = async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  };
  const goOnline = async () => {
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  };
  const outbox = () => page.evaluate(() => JSON.parse(localStorage.getItem('mindsift_outbox') || '[]'));
  const outboxEmpty = () => waitFor(async () => (await outbox()).length === 0, 15000);
  const shot = async (name) => {
    if (!SHOT_DIR) return;
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/tasks-offline-${name}.png` });
  };
  // After sending, the page shows what the server has
  const agree = async (t, label) => {
    const srv = await serverTask(t);
    const tab = srv.isCompleted ? 'Erledigt' : 'Offen';
    const ok = await waitFor(async () => {
      await showTab(tab);
      return (await shownDone(t.content)) === srv.isCompleted;
    }, 15000);
    check(!!ok, `${label}: die Seite zeigt den Stand des Servers (${srv.isCompleted ? 'erledigt' : 'offen'})`, await shownDone(t.content));
  };

  try {
    // 1. Ticked offline; the other person ticks and opens it again afterwards: stays open
    const dishes = await newTask(`Abwasch ${STAMP}`);
    await openList();
    check(!!(await waitFor(async () => (await shownDone(dishes.content)) === false, 10000)), 'Die Seite zeigt die geteilte Aufgabe offen');
    await goOffline();
    await tick(dishes.content, true);
    check((await outbox()).length === 1 && typeof (await outbox())[0].body.changedAt === 'number', 'Offline abgehakt: wartet mit der Zeit des Antippens', await outbox());
    await sleep(300);
    await userSets(dishes, { isCompleted: true, kanbanStatus: 'done' });
    await userSets(dishes, { isCompleted: false, kanbanStatus: 'todo' });
    await goOnline();
    check(!!(await outboxEmpty()), 'Nach dem Verbinden ist nichts mehr offen');
    check(!(await serverTask(dishes)).isCompleted, 'Älteres Abhaken macht das spätere Wieder-Öffnen der anderen nicht rückgängig', await serverTask(dishes));
    await agree(dishes, 'Abwasch');
    await shot('1-aelter');

    // 2. In "In Bearbeitung", ticked and un-ticked offline: back in its column, nothing sent; the other
    //    person's tick meanwhile stays
    const windows = await newTask(`Fenster putzen ${STAMP}`, { kanbanStatus: 'in_progress', isCompleted: false });
    await openList();
    check(!!(await waitFor(async () => (await shownColumn(windows.content)) === 'In Bearbeitung', 10000)), 'Die Aufgabe steht in „In Bearbeitung“');
    await goOffline();
    await tick(windows.content, true);
    await tick(windows.content, false);
    await showTab('Offen');
    check((await outbox()).length === 0, 'Offline abgehakt und wieder geöffnet: nichts zu senden', await outbox());
    check((await shownColumn(windows.content).catch(() => '')) === 'In Bearbeitung', 'Sie steht wieder in „In Bearbeitung“', await shownColumn(windows.content).catch(() => ''));
    await userSets(windows, { isCompleted: true, kanbanStatus: 'done' });
    await goOnline();
    await sleep(1500);
    check((await serverTask(windows)).isCompleted, 'Das Abhaken der anderen bleibt', await serverTask(windows));
    await openList();
    await agree(windows, 'Fenster putzen');
    await shot('2-zurueck');

    // 3. Both tick the same task: ticked, and a repeating task gets one successor
    const paper = await newTask(`Altpapier ${STAMP}`);
    await api(admin, 'PATCH', `/api/v1/thoughts/${paper.id}`, { recurrence: 'weekly' });
    await openList();
    check(!!(await waitFor(async () => (await shownDone(paper.content)) === false, 10000)), 'Die wiederkehrende Aufgabe ist offen');
    await goOffline();
    await tick(paper.content, true);
    await userSets(paper, { isCompleted: true, kanbanStatus: 'done' });
    await goOnline();
    check(!!(await outboxEmpty()), 'Das eigene Abhaken ist gesendet');
    check((await serverTask(paper)).isCompleted, 'Beide haben abgehakt: bleibt erledigt');
    const copies = (await api(admin, 'GET', `/api/v1/tasks?taskListId=${list.id}&status=all`)).filter((t) => t.content === paper.content);
    check(copies.length === 2, 'Zweimal abgehakt: genau eine nächste Wiederholung', copies.map((t) => [t.isCompleted, t.dueDate]));
    await shot('3-beide');

    // 4. Opened offline, nobody touched it since: open once sent
    const bins = await newTask(`Mülltonnen ${STAMP}`, { isCompleted: true, kanbanStatus: 'done' });
    await openList();
    await showTab('Erledigt');
    check(!!(await waitFor(async () => (await shownDone(bins.content)) === true, 10000)), 'Die Aufgabe ist erledigt');
    await goOffline();
    await tick(bins.content, false);
    await sleep(500);
    await goOnline();
    check(!!(await outboxEmpty()), 'Das Wieder-Öffnen ist gesendet');
    check(!(await serverTask(bins)).isCompleted, 'Offline wieder geöffnet, sonst keine Änderung: offen', await serverTask(bins));
    await agree(bins, 'Mülltonnen');
    await shot('4-offen');
  } catch (e) {
    check(false, `Abgebrochen: ${String(e.message).split('\n')[0]}`);
    await shot('abbruch').catch(() => {});
  }

  await browser.close();
  await api(admin, 'DELETE', `/api/v1/task-lists/${list.id}`).catch(() => {});
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
