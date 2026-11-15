// A to-do in a note linked to a task, with the note open in one browser and the task view in another:
// ticking and renaming in either one shows up in the other without reloading, and the task keeps its
// assignees. Repeated many times (ROUNDS, default 50), the JS heap of both pages stays flat (measured
// after a forced garbage collection through the Chrome DevTools Protocol) and so does the server's Go
// heap (read from /metrics when METRICS_TOKEN is set for the server and the test). Then each side goes
// offline in turn (Playwright's setOffline) while the task is changed on the other side: the offline
// changes (tick, a new subtask, reopening) and the online ones (rename, a new subtask) all stay, note and
// task end the same, and nothing keeps going back and forth.
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const METRICS_TOKEN = process.env.METRICS_TOKEN || '';
const ROUNDS = Number(process.env.ROUNDS || 50);
const SHOT_DIR = process.env.SHOT_DIR || ''; // screenshots of both pages when a round fails
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
    await sleep(100);
  }
  return null;
}

async function newPage(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.setDefaultTimeout(8000);
  await page.goto(BASE);
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}

// JS heap in use after a full garbage collection, in MB
async function heapMB(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 1048576;
}

// The server's Go heap in MB (/metrics, only with METRICS_TOKEN), null without
async function serverHeapMB() {
  if (!METRICS_TOKEN) return null;
  const res = await fetch(`${BASE}/metrics`, { headers: { Authorization: `Bearer ${METRICS_TOKEN}` } });
  if (!res.ok) return null;
  const m = (await res.text()).match(/^go_memstats\{kind="heap_alloc"\} ([0-9.e+]+)/m);
  return m ? Number(m[1]) / 1048576 : null;
}

const STAMP = Date.now();
const NOTE = `Verknüpfte To-Dos ${STAMP}`;
const LIST = `Haushalt ${STAMP}`;
const TODO = `lt_todo_${STAMP}`;
const INTRO = `lt_intro_${STAMP}`;

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userEntry = dir.find((u) => u.username === 'user' || u.email?.startsWith('user'));
  const me = await api(admin, 'GET', '/api/v1/auth/me');
  const adminId = me.id || me.user?.id;

  // Admin's note with the to-do, linked to a task in a list shared with "user", both assigned
  let title = `Fenster putzen ${STAMP}`;
  const doc = await api(admin, 'POST', '/api/v1/documents', {
    title: NOTE,
    blocks: [
      { id: INTRO, type: 'bullet', content: 'Diese Woche', level: 0 },
      { id: TODO, type: 'todo', content: title, level: 0 },
    ],
  });
  const list = await api(admin, 'POST', '/api/v1/task-lists', { title: LIST, icon: '🏠', color: '#3b82f6' });
  await api(admin, 'POST', `/api/v1/task-lists/${list.id}/shares`, { targetType: 'user', targetId: userEntry.id, permission: 'editor' });
  const task = await api(admin, 'POST', `/api/v1/documents/${doc.id}/blocks/${TODO}/enhanced-task`, { content: title, checked: false });
  await api(admin, 'PATCH', `/api/v1/thoughts/${task.id}`, { taskListId: list.id });
  const assigned = await api(admin, 'PATCH', `/api/v1/thoughts/${task.id}`, { assignees: [adminId, userEntry.id] });
  check(assigned.assignees?.length === 2, 'Aufgabe ist beiden zugewiesen', assigned.assignees);

  const browser = await chromium.launch();
  // A: the admin with the note open
  const A = await newPage(browser, admin);
  await A.page.getByRole('button', { name: /Workspace/ }).first().click();
  await A.page.getByText(NOTE, { exact: true }).first().click();
  const noteBlock = A.page.locator(`[data-outline-block="${TODO}"]`).first();
  await noteBlock.waitFor({ timeout: 10000 });
  // B: "user" with the shared list open in the list view
  const B = await newPage(browser, user);
  await B.page.getByRole('button', { name: /^Aufgaben/ }).locator('visible=true').first().click();
  await B.page.getByRole('button', { name: new RegExp(LIST) }).first().click();
  await B.page.getByRole('radio', { name: /^Liste/ }).first().click();

  const noteChecked = async () => (await noteBlock.locator('button[title="Als offen markieren"]').count()) > 0;
  const noteText = () => noteBlock.locator('textarea').first().inputValue();
  const row = () => B.page.locator('[data-tour="task"]', { hasText: title }).first();
  const rowShown = async () => (await row().count()) > 0;
  const rowDone = async () => (await row().locator('button[title="Als offen markieren"]').count()) > 0;
  const rowOpen = async () => (await row().locator('button[title="Als erledigt abhaken"]').count()) > 0;
  // The list view shows open and done tasks on two tabs ("Offen (n)", "Erledigt (n)")
  const showTab = (name) => B.page.locator('button[aria-pressed]', { hasText: new RegExp(`^${name} \\(`) }).first().click();
  // Both names in the avatar stack of the row ("Zugewiesen: …")
  const rowAssignees = async () => {
    const t = await row().locator('[title^="Zugewiesen:"]').first().getAttribute('title', { timeout: 2000 }).catch(() => null);
    return t ? t.split(',').length : 0;
  };
  check(!!(await waitFor(async () => (await row().count()) > 0, 10000)), 'Aufgabenansicht zeigt die verknüpfte Aufgabe');
  check((await rowAssignees()) === 2, 'Aufgabenansicht zeigt beide Zugewiesenen');

  const tickInNote = async (on) => {
    await noteBlock.locator(`button[title="${on ? 'Als erledigt markieren' : 'Als offen markieren'}"]`).first().click();
  };
  const tickInTasks = async (on) => {
    await row().locator(`button[title="${on ? 'Als erledigt abhaken' : 'Als offen markieren'}"]`).first().click();
  };
  const renameInNote = async (text) => {
    // A bullet shows its text and becomes a text field when clicked
    await noteBlock.getByText(title, { exact: true }).first().click();
    const area = noteBlock.locator('textarea:focus').first();
    await area.fill(text);
    // leave the bullet, as one does after typing (the focused bullet keeps its own text)
    await A.page.locator(`[data-outline-block="${INTRO}"]`).getByText('Diese Woche', { exact: true }).first().click();
  };
  const renameInTasks = async (text) => {
    await row().locator('p', { hasText: title }).first().click();
    await B.page.locator('[title="Klicken zum Bearbeiten des Titels"]').first().click();
    const area = B.page.locator('textarea:focus').first();
    await area.fill(text);
    await area.press('Enter');
    // Escape right after saving the title closes the dialog (it used to only close the title editor while
    // the save was on its way)
    await B.page.keyboard.press('Escape');
    const closed = await waitFor(async () => (await B.page.locator('[title="Klicken zum Bearbeiten des Titels"]').count()) === 0, 5000);
    if (!closed) throw new Error('Aufgabendialog schließt nicht');
  };

  const WAIT = 10000;
  const times = { noteToTask: [], taskToNote: [] };
  const timed = async (kind, fn) => {
    const start = Date.now();
    const ok = await waitFor(fn, WAIT);
    if (ok) times[kind].push(Date.now() - start);
    return !!ok;
  };
  let heapA0, heapB0, server0;
  const serverSamples = [];
  let roundFailures = 0;
  // A failure names what the server holds, so it is clear which side lost the change
  const serverState = async () => {
    const t = await api(admin, 'GET', `/api/v1/thoughts/${task.id}`);
    const b = (await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`)).blocks.find((x) => x.id === TODO);
    return { task: { done: t.isCompleted, title: t.content, assignees: t.assignees?.length }, note: { checked: !!b?.props?.checked, text: b?.content } };
  };
  const fail = async (round, msg, detail) => {
    roundFailures++;
    if (roundFailures <= 10) {
      check(false, `Runde ${round}: ${msg}`, { ...(detail !== undefined ? { detail } : {}), server: await serverState() });
      if (SHOT_DIR) await A.page.screenshot({ path: `${SHOT_DIR}/linked-todos-${round}-note.png` }).catch(() => {});
      if (SHOT_DIR) await B.page.screenshot({ path: `${SHOT_DIR}/linked-todos-${round}-tasks.png` }).catch(() => {});
    } else failures++;
  };

  // A step that fails ends the run (the following steps start from a state they do not expect)
  const STOP = new Error('stop');
  const step = async (ok, round, msg, detail) => {
    if (ok) return;
    await fail(round, msg, typeof detail === 'function' ? await detail() : detail);
    throw STOP;
  };
  const assignees = async (i, when) => step((await rowAssignees()) === 2, i, `${when} fehlen Zugewiesene`, rowAssignees);
  const warm = Math.min(5, ROUNDS);
  for (let i = 1; i <= ROUNDS; i++) {
    try {
      // 1. ticked in the note → done in the task view, both still assigned
      // (the task view shows the open tasks: the task leaves them and is among the done ones)
      await tickInNote(true);
      await step(await timed('noteToTask', async () => !(await rowShown())), i, 'Abhaken in der Notiz kommt in der Aufgabenansicht nicht an');
      await showTab('Erledigt');
      await step(await waitFor(rowDone, 5000), i, 'die in der Notiz abgehakte Aufgabe steht nicht bei den erledigten');
      await assignees(i, 'nach dem Abhaken in der Notiz');
      // 2. reopened in the task view → unticked in the note
      await tickInTasks(false);
      await step(await timed('taskToNote', async () => !(await noteChecked())), i, 'Wieder öffnen in der Aufgabenansicht kommt in der Notiz nicht an');
      // 3. completed in the task view → ticked in the note
      await showTab('Offen');
      await step(await waitFor(rowOpen, 5000), i, 'die wieder geöffnete Aufgabe steht nicht bei den offenen');
      await tickInTasks(true);
      await step(await timed('taskToNote', noteChecked), i, 'Erledigen in der Aufgabenansicht kommt in der Notiz nicht an');
      // 4. unticked in the note → open in the task view, both still assigned
      await tickInNote(false);
      await step(await timed('noteToTask', rowOpen), i, 'Wieder öffnen in der Notiz kommt in der Aufgabenansicht nicht an');
      await assignees(i, 'nach dem Öffnen in der Notiz');
      // 5. renamed in the note → new title in the task view
      const renamed = `Fenster putzen ${STAMP} Notiz ${i}`;
      await renameInNote(renamed);
      title = renamed;
      await step(await timed('noteToTask', async () => (await row().count()) > 0), i, 'Umbenennen in der Notiz kommt in der Aufgabenansicht nicht an');
      // 6. renamed in the task view → new text in the note
      const next = `Fenster putzen ${STAMP} Aufgabe ${i}`;
      await renameInTasks(next);
      title = next;
      await step(await timed('taskToNote', async () => (await noteText()) === next), i, 'Umbenennen in der Aufgabenansicht kommt in der Notiz nicht an', noteText);
      await assignees(i, 'nach dem Umbenennen');
    } catch (e) {
      if (e !== STOP) await fail(i, `Abbruch: ${String(e.message).split('\n')[0]}`);
      break;
    }

    if (i === warm) {
      heapA0 = await heapMB(A.cdp);
      heapB0 = await heapMB(B.cdp);
      server0 = await serverHeapMB();
    }
    if (i % 10 === 0) {
      const s = await serverHeapMB();
      if (s !== null) serverSamples.push(Math.round(s * 10) / 10);
      console.log(`     Runde ${i}: Heap Notiz ${(await heapMB(A.cdp)).toFixed(1)} MB, Aufgaben ${(await heapMB(B.cdp)).toFixed(1)} MB${s !== null ? `, Server ${s.toFixed(1)} MB` : ''}`);
    }
  }
  check(roundFailures === 0, `${ROUNDS} Runden ohne Fehler (${roundFailures} Fehler)`);

  // Task and note agree with the server at the end
  const final = await api(admin, 'GET', `/api/v1/thoughts/${task.id}`);
  const snap = await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
  const block = snap.blocks.find((b) => b.id === TODO);
  check(final.content === title && block?.content === title, 'Aufgabe und Notiz haben am Ende denselben Titel', { task: final.content, note: block?.content });
  check(final.isCompleted === false && !block?.props?.checked, 'Aufgabe und Notiz sind am Ende offen', { task: final.isCompleted, note: block?.props });
  check(final.assignees?.length === 2, 'Aufgabe ist am Ende noch beiden zugewiesen', final.assignees);

  const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const max = (a) => (a.length ? Math.max(...a) : null);
  console.log(`     Notiz → Aufgabe: Median ${median(times.noteToTask)} ms, max ${max(times.noteToTask)} ms`);
  console.log(`     Aufgabe → Notiz: Median ${median(times.taskToNote)} ms, max ${max(times.taskToNote)} ms`);

  // Memory: after the warm-up (round 5) and at the end, each after a forced GC
  const heapA1 = await heapMB(A.cdp);
  const heapB1 = await heapMB(B.cdp);
  heapA0 ??= heapA1; // stopped before the warm-up ended
  heapB0 ??= heapB1;
  console.log(`     JS-Heap Notiz: ${heapA0.toFixed(1)} → ${heapA1.toFixed(1)} MB, Aufgaben: ${heapB0.toFixed(1)} → ${heapB1.toFixed(1)} MB`);
  // What grows (about 1.5 MB per page over 45 rounds, then flat) is no app data: heap snapshots taken after
  // the warm-up and at the end differ almost only in V8's compiled code ("(code)", ~1.4-1.6 MB: functions
  // that got hot are optimized, which V8 bounds and flushes), the browser's performance timeline entries
  // (resource, long-task, layout-shift timings; capped buffers) and DevTools network records of this test's
  // CDP session. App objects grow by a few KB (the note's undo history is capped at 200 steps and the
  // engine's log tail is folded into a full save every 200 entries).
  const flat = (a, b) => b - a < Math.max(8, a * 0.25);
  check(flat(heapA0, heapA1), `JS-Heap der Notiz bleibt flach (+${(heapA1 - heapA0).toFixed(1)} MB)`);
  check(flat(heapB0, heapB1), `JS-Heap der Aufgabenansicht bleibt flach (+${(heapB1 - heapB0).toFixed(1)} MB)`);
  const server1 = await serverHeapMB();
  if (server0 != null && server1 != null) {
    console.log(`     Server-Heap (Go): ${server0.toFixed(1)} → ${server1.toFixed(1)} MB, alle 10 Runden: ${serverSamples.join(', ')}`);
    check(server1 - server0 < Math.max(32, server0), `Server-Heap wächst nicht ohne Grenze (+${(server1 - server0).toFixed(1)} MB)`);
  } else {
    console.log('     Server-Heap: ohne METRICS_TOKEN nicht gemessen');
  }

  // Offline: one side without network while the other person changes the task online, then back online.
  // Nothing may be lost or flip back, note and task end the same, and nothing keeps going back and forth.
  const subtaskTexts = async () => {
    const snap = await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
    return snap.blocks.filter((b) => !b.deleted && b.parentId === TODO && b.type === 'todo').map((b) => b.content).sort();
  };
  const goOnline = async (p) => {
    await p.ctx.setOffline(false);
    await p.page.evaluate(() => window.dispatchEvent(new Event('online')));
  };
  // Nothing changes any more on the server: the task and the note's log stay as they are for 3 s
  const settled = async () => {
    const take = async () => {
      const t = await api(admin, 'GET', `/api/v1/thoughts/${task.id}`);
      const snap = await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
      return JSON.stringify({ t: [t.content, t.isCompleted, t.subtasks], head: snap.headSeq });
    };
    const a = await take();
    await sleep(3000);
    return a === (await take());
  };
  try {
    // 1. The note offline: tick the to-do and add a subtask under it (Enter at its end, "[] ", Tab)
    await A.ctx.setOffline(true);
    await tickInNote(true);
    await noteBlock.getByText(title, { exact: true }).first().click();
    await A.page.keyboard.press('End');
    await A.page.keyboard.press('Enter');
    await sleep(200);
    await A.page.keyboard.type('[] Offline-Unteraufgabe'); // "[] " makes the new bullet a to-do
    await A.page.keyboard.press('Tab');
    await sleep(300);
    await A.page.locator(`[data-outline-block="${INTRO}"]`).getByText('Diese Woche', { exact: true }).first().click();
    await sleep(1500);
    check(!(await api(admin, 'GET', `/api/v1/thoughts/${task.id}`)).isCompleted, 'Offline abgehakt: noch nicht auf dem Server');
    // Meanwhile the other person renames the task and adds a subtask online (task view, API as the app sends it)
    const onlineTitle = `Fenster putzen ${STAMP} online`;
    const t0 = await api(user, 'GET', `/api/v1/thoughts/${task.id}`);
    await api(user, 'PATCH', `/api/v1/thoughts/${task.id}`, { content: onlineTitle });
    await api(user, 'PATCH', `/api/v1/thoughts/${task.id}`, {
      subtasks: [...(t0.subtasks || []), { id: `st_online_${STAMP}`, title: 'Online-Unteraufgabe', isCompleted: false }],
      subtasksBase: t0.subtasks || [],
    });
    title = onlineTitle;
    await goOnline(A);
    const merged = await waitFor(async () => {
      const t = await api(admin, 'GET', `/api/v1/thoughts/${task.id}`);
      const subs = (t.subtasks || []).map((s) => s.title).sort();
      const blk = (await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`)).blocks.find((b) => b.id === TODO);
      const kids = await subtaskTexts();
      return (
        t.content === onlineTitle && t.isCompleted && blk?.content === onlineTitle && blk?.props?.checked &&
        JSON.stringify(subs) === JSON.stringify(['Offline-Unteraufgabe', 'Online-Unteraufgabe']) &&
        JSON.stringify(kids) === JSON.stringify(subs)
      );
    }, 15000);
    check(!!merged, 'Notiz offline, Aufgabe online geändert: Haken, Titel und beide Unteraufgaben bleiben, Notiz und Aufgabe gleich', merged ? undefined : await serverState());
    check(!!(await waitFor(async () => (await noteText()) === onlineTitle, 8000)), 'Die Notiz zeigt nach dem Verbinden den neuen Titel', await noteText());
    check(!!(await waitFor(noteChecked, 5000)), 'Der offline gesetzte Haken bleibt in der Notiz');
    check(await settled(), 'Nach dem Verbinden geht nichts mehr hin und her');

    // 2. The task view offline: reopen the task there (the app queues it) while the to-do is renamed in the note
    await showTab('Erledigt');
    check(!!(await waitFor(rowDone, 8000)), 'Aufgabenansicht zeigt die Aufgabe bei den erledigten');
    await B.ctx.setOffline(true);
    await tickInTasks(false);
    const noteTitle = `Fenster putzen ${STAMP} in der Notiz`;
    await renameInNote(noteTitle);
    title = noteTitle;
    await sleep(1500);
    await goOnline(B);
    const merged2 = await waitFor(async () => {
      const t = await api(admin, 'GET', `/api/v1/thoughts/${task.id}`);
      const blk = (await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`)).blocks.find((b) => b.id === TODO);
      return t.content === noteTitle && !t.isCompleted && blk?.content === noteTitle && !blk?.props?.checked;
    }, 15000);
    check(!!merged2, 'Aufgabenansicht offline wieder geöffnet, Notiz online umbenannt: beides bleibt', merged2 ? undefined : await serverState());
    check(!!(await waitFor(async () => !(await noteChecked()), 8000)), 'Die Notiz zeigt die Aufgabe wieder offen');
    await showTab('Offen');
    check(!!(await waitFor(async () => (await row().count()) > 0 && (await rowOpen()), 10000)), 'Die Aufgabenansicht zeigt nach dem Verbinden den Titel aus der Notiz');
    check(await settled(), 'Auch danach geht nichts mehr hin und her');
  } catch (e) {
    check(false, `Offline-Teil abgebrochen: ${String(e.message).split('\n')[0]}`, await serverState().catch(() => undefined));
  }

  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
