// Drag & drop check for refactors: screenshots do not show dragging.
// Moves tasks with the mouse (Kanban columns, list order, onto a list tab) and with a finger on the phone
// board, and writes the resulting task state from the server, one step at a time. Two runs of the same
// code give the same file; e2e/refshots.sh drag <name> runs it on a fresh copy of the reference data.
//
//   OUT=/shots/name.drag.txt node refdrag.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const OUT = process.env.OUT || '/shots/drag.txt';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];

const token = (
  await (
    await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'admin' }),
    })
  ).json()
).token;

// Task state as the server has it: list, column, done, and the order within each list
async function record(step) {
  const [tasks, lists] = await Promise.all(
    ['/api/v1/tasks', '/api/v1/task-lists'].map(async (p) => (await fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` } })).json())
  );
  const listName = (id) => (id ? lists.find((l) => l.id === id)?.title || id : 'personal');
  const rows = tasks
    .map((t) => ({ list: listName(t.taskListId), order: t.sortOrder ?? 0, line: `${t.content.slice(0, 40).padEnd(40)} | ${String(t.kanbanStatus || '-').padEnd(12)} | ${t.isCompleted ? 'erledigt' : 'offen   '}` }))
    .sort((a, b) => a.list.localeCompare(b.list) || a.order - b.order);
  lines.push(`## ${step}`);
  lines.push(`Listen: ${lists.map((l) => l.title).join(', ')}`);
  rows.forEach((r, i) => lines.push(`${r.list.padEnd(14)} ${String(i).padStart(2)} ${r.line}`));
  lines.push('');
  console.log(`OK   ${step}`);
}

async function open(options) {
  const ctx = await browser.newContext({ ...options, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.getByText('Später im Browser weiter nutzen').click({ timeout: 2000 }).catch(() => {});
  return page;
}

// Mouse drag with many small moves like a hand: the board reacts to dragover only after React has
// rendered the started drag, which a single jump does not give it
async function drag(page, source, target, pos) {
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  const to = { x: b.x + (pos?.x ?? b.width / 2), y: b.y + (pos?.y ?? b.height / 2) };
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(20, a.height / 2));
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((to.x - a.x - a.width / 2) * i) / 20, a.y + 20 + ((to.y - a.y - 20) * i) / 20);
    await sleep(25);
  }
  await sleep(150);
  await page.mouse.up();
}

async function step(name, fn) {
  try {
    await fn();
    await sleep(900); // save on the server
    await record(name);
  } catch (e) {
    lines.push(`## ${name}\nFEHLGESCHLAGEN: ${e.message.split('\n')[0]}\n`);
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}

const browser = await chromium.launch();
await record('Ausgangslage');

// --- Desktop: HTML5 drag & drop with the mouse ---
const d = await open({ viewport: { width: 1440, height: 900 } });
const card = (text) => d.locator('[data-kanban-task]', { hasText: text }).first();
// Columns by ID ("Alle Aufgaben": name:<name>); a text match would also hit cards with a "Erledigt →" button
const column = (name) => d.locator(`[data-kanban-col="name:${name.toLowerCase()}"]`);
await d.getByRole('button', { name: /^Aufgaben/ }).locator('visible=true').first().click();
await d.getByRole('button', { name: /^Alle Aufgaben/ }).first().click();
await d.getByRole('radio', { name: 'Kanban', exact: true }).locator('visible=true').first().click();
await sleep(800);

await step('Kanban: card before the second card of another column', async () => {
  const target = column('In Bearbeitung').locator('[data-kanban-task]').nth(1);
  const box = await target.boundingBox();
  await drag(d, card('USV-Batterie'), target, { x: box.width / 2, y: 6 });
});
await step('Kanban: card into the empty part of the done column', async () => {
  const col = column('Erledigt');
  const box = await col.boundingBox();
  await drag(d, card('Wartet auf Lieferung'), col, { x: box.width / 2, y: box.height - 120 });
});
await step('Kanban: card down within the column', async () => {
  const col = column('Zu erledigen');
  const last = col.locator('[data-kanban-task]').last();
  const box = await last.boundingBox();
  await drag(d, col.locator('[data-kanban-task]').first(), last, { x: box.width / 2, y: box.height - 4 });
});

await step('Kanban: Ctrl+Z undoes the last move', async () => {
  await d.mouse.click(5, 5); // focus on the page, not in a text field
  await d.keyboard.press('Control+z');
});

await step('Kanban: “add task” opens the task window, title typed', async () => {
  await column('Zu erledigen').getByRole('button', { name: /Aufgabe hinzufügen/ }).click();
  await sleep(800);
  await d.keyboard.type('Aus der Spalte angelegt'); // the placeholder title is selected
  await d.keyboard.press('Enter');
  await sleep(500);
  await d.keyboard.press('Escape'); // close the dialog
});
await step('Kanban: “add task” closed without a title – the draft disappears', async () => {
  await column('Zu erledigen').getByRole('button', { name: /Aufgabe hinzufügen/ }).click();
  await sleep(800);
  await d.keyboard.press('Escape'); // leave title editing
  await d.keyboard.press('Escape'); // close the dialog
});
{
  const trash = await (await fetch(`${BASE}/api/v1/tasks/trash`, { headers: { Authorization: `Bearer ${token}` } })).json();
  lines.push(`Trash contains “Neue Aufgabe”: ${trash.some((t) => t.content === 'Neue Aufgabe') ? 'yes' : 'no'}\n`);
}

await d.getByRole('radio', { name: 'Liste', exact: true }).locator('visible=true').first().click();
await sleep(800);
const row = (text) => d.locator('[draggable="true"]', { hasText: text }).first();
await step('Liste: Zeile ganz nach oben ziehen', async () => {
  await drag(d, row('Uptime-Monitoring'), d.locator('[draggable="true"]').first(), { x: 40, y: 3 });
});
await step('List: Homelab row onto the “Haus & Garten” tab', async () => {
  const tab = d.locator('div.group', { hasText: 'Haus & Garten' }).first();
  await drag(d, row('Reverse-Proxy'), tab);
});

// --- Actions by click in the list view ---
await step('Liste: Aufgabe per Klick abhaken', () => row('Heizungswartung').getByTitle('Als erledigt abhaken').click());
await step('Liste: Aufgabe per Knopf löschen', () => row('Steuerunterlagen').getByTitle('Aufgabe löschen').click());
await step('Trash: restore a task', async () => {
  await d.getByRole('button', { name: /^Papierkorb \(/ }).locator('visible=true').first().click();
  await d.getByRole('button', { name: /Zurück/ }).locator('visible=true').first().click();
  await sleep(600);
  await d.getByRole('button', { name: /^Offen \(/ }).locator('visible=true').first().click();
});

await step('Quick add: new task with Enter', async () => {
  await d.getByPlaceholder('Neue Aufgabe anlegen…').fill('Per Schnelleingabe angelegt');
  await d.keyboard.press('Enter');
});

// --- Realtime: changes from elsewhere show up without reloading (the desktop page stays open) ---
async function live(name, change, text, expectVisible) {
  try {
    await change();
    await sleep(1500);
    const visible = (await d.getByText(text).count()) > 0;
    lines.push(`## ${name}\nsichtbar: ${visible ? 'ja' : 'nein'} (erwartet: ${expectVisible ? 'ja' : 'nein'})\n`);
    console.log(`${visible === expectVisible ? 'OK  ' : 'DIFF'} ${name}`);
  } catch (e) {
    lines.push(`## ${name}\nFEHLGESCHLAGEN: ${e.message.split('\n')[0]}\n`);
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}
const api = (method, path, body) =>
  fetch(BASE + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json().catch(() => ({})));
const backup = (await api('GET', '/api/v1/tasks')).find((t) => t.content.startsWith('Backup-Konzept'));
await live('Realtime: task renamed from outside', () => api('PATCH', `/api/v1/thoughts/${backup.id}`, { content: 'Backup-Konzept live geändert #backup' }), 'Backup-Konzept live geändert', true);
let created;
await live('Realtime: task created from outside', async () => {
  created = await api('POST', '/api/v1/inbox', { content: 'Von außen angelegt', target: 'task' });
}, 'Von außen angelegt', true);
await live('Realtime: task deleted from outside', () => api('DELETE', `/api/v1/thoughts/${created.id}`), 'Von außen angelegt', false);
await record('nach den Echtzeit-Schritten');
await step('New task list through the dialog', async () => {
  await d.getByRole('button', { name: /Neue Liste/ }).locator('visible=true').first().click();
  await d.getByPlaceholder('z.B. Homelab, Einkäufe, Steuern').fill('Testliste');
  await d.keyboard.press('Enter');
});

// --- Phone: hold a card with a finger and drag it ---
const m = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await m.locator('[data-mobile-nav]').getByRole('button', { name: /Aufgaben/ }).first().click();
await m.getByTitle('Menü & Ansichts-Optionen öffnen').first().click();
await m.getByRole('button', { name: /Kanban-Board Ansicht/ }).locator('visible=true').first().click();
await sleep(900);
const cdp = await m.context().newCDPSession(m);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await step('Phone: card down the column with a finger', async () => {
  const cards = m.locator('[data-kanban-col]').first().locator('[data-kanban-task]');
  const a = await cards.nth(0).boundingBox();
  const b = await cards.nth(2).boundingBox();
  const x = a.x + a.width / 2;
  await touch('touchStart', x, a.y + 20);
  await sleep(500); // hold until the card lifts
  const toY = b.y + b.height - 6;
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', x, a.y + 20 + ((toY - a.y - 20) * i) / 12);
    await sleep(30);
  }
  await sleep(200);
  await touch('touchEnd', x, toY);
});

await browser.close();
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`Zustand nach jedem Schritt in ${OUT}`);
