// Workspace check for refactors: notes, folders, trash and the to-do
// collection by click and drag on the desktop, the resulting state from the server after each step.
// Two runs of the same code give the same file; e2e/refshots.sh ws <name> runs it on a fresh copy of the
// reference data.
//
//   OUT=/shots/name.ws.txt node refworkspace.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const OUT = process.env.OUT || '/shots/ws.txt';
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
const get = async (p) => (await fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` } })).json();

// Notes (folder, pinned, open to-dos), folders and the trash as the server has them
async function record(step) {
  const [docs, folders, trash] = await Promise.all([get('/api/v1/documents'), get('/api/v1/folders'), get('/api/v1/documents/trash')]);
  lines.push(`## ${step}`);
  const folderNames = (Array.isArray(folders) ? folders : folders.folders || []).map((f) => (typeof f === 'string' ? f : f.path || f.name)).sort();
  lines.push(`Ordner: ${folderNames.join(', ')}`);
  const rows = (Array.isArray(docs) ? docs : [])
    .map((d) => {
      const todos = (d.blocks || []).filter((b) => b.type === 'todo');
      const open = todos.filter((b) => !b.checked).length;
      return `${(d.folderPath || '/').padEnd(22)} ${String(d.title).slice(0, 40).padEnd(40)} ${d.isPinned ? 'angeheftet' : '          '} To-dos ${open}/${todos.length}`;
    })
    .sort();
  for (const r of rows) lines.push(r);
  const trashed = (Array.isArray(trash) ? trash : []).map((t) => t.title || t.name || t.path || t.id).sort();
  lines.push(`Papierkorb: ${trashed.join(', ') || '–'}`);
  lines.push('');
  console.log(`OK   ${step}`);
}

async function step(name, fn) {
  try {
    const extra = await fn(); // a line of its own for what the server state does not show (the UI)
    await sleep(1200); // saving (notes sync in the background)
    await record(name);
    if (typeof extra === 'string') lines.splice(lines.length - 1, 0, extra);
  } catch (e) {
    lines.push(`## ${name}\nFEHLGESCHLAGEN: ${e.message.split('\n')[0]}\n`);
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}

// Mouse drag with many small moves (the tree reacts to dragover after React rendered the started drag)
async function drag(page, source, target) {
  const a = await source.boundingBox();
  const box = await target.boundingBox();
  // Aim at the visible part of the target (the trash can sit right at the bottom edge of the window)
  const vh = page.viewportSize().height;
  const b = { ...box, height: Math.max(4, Math.min(box.height, vh - 4 - box.y)) };
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 20, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 20);
    await sleep(25);
  }
  await sleep(150);
  await page.mouse.up();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
const d = await ctx.newPage();
d.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await d.goto(BASE);
await d.waitForLoadState('networkidle');
await d.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
await sleep(1200);
const side = d.locator('aside').first();
await record('Ausgangslage');

await step('New note through the button, title typed', async () => {
  await d.getByTitle('Neue Notiz anlegen').locator('visible=true').first().click();
  await sleep(800);
  await d.keyboard.press('Control+a');
  await d.keyboard.type('Prüfnotiz');
  await d.keyboard.press('Enter');
  await sleep(600); // focus moves into the first bullet
  await d.keyboard.type('Erster Punkt');
});
await step('New folder through the button', async () => {
  await d.getByTitle('Neuer Ordner').locator('visible=true').first().click();
  await d.getByPlaceholder('Ordnername').fill('Prüfordner');
  await d.keyboard.press('Enter');
});
await step('Notiz in den Ordner ziehen', async () => {
  await drag(d, side.getByText('Prüfnotiz', { exact: true }).first(), side.getByText('Prüfordner', { exact: true }).first());
});
await step('Notiz in den Papierkorb ziehen', async () => {
  // Open the folder if the note is not visible yet (it may have opened on the drop)
  if (!(await side.getByText('Prüfnotiz', { exact: true }).first().isVisible().catch(() => false))) {
    await side.getByText('Prüfordner', { exact: true }).first().click();
    await sleep(400);
  }
  await drag(d, side.getByText('Prüfnotiz', { exact: true }).first(), d.getByTitle(/^Papierkorb – Notizen hierher ziehen/).first());
});
await step('Restore a note from the trash', async () => {
  await d.getByTitle(/^Papierkorb – Notizen hierher ziehen/).first().click();
  await sleep(600);
  await d.getByRole('button', { name: /Wiederherstellen/ }).locator('visible=true').first().click();
});
await step('Tick off a to-do in the collection', async () => {
  await d.getByRole('button', { name: /^To-Dos/ }).locator('visible=true').first().click();
  await sleep(800);
  // The checkbox in front of the to-do
  await d
    .getByText('ZFS-Pool mit zwei SSDs anlegen', { exact: true })
    .first()
    .locator('xpath=(ancestor::div[contains(@class,"group")][1]//button)[1]')
    .click();
});
await step('Delete a folder after confirming', async () => {
  await d.getByRole('button', { name: /^Notizen/ }).locator('visible=true').first().click();
  await sleep(600);
  const row = side.getByText('Prüfordner', { exact: true }).first();
  await row.hover();
  await row.locator('xpath=ancestor::div[.//button[@title="Ordner löschen"]][1]').getByTitle('Ordner löschen').click({ force: true });
  await d.getByRole('button', { name: 'In den Papierkorb' }).click();
});
await step('Drag a note to the trash, undo in the notice', async () => {
  await drag(d, side.getByText(/^Homelab 2\.0/).first(), d.getByTitle(/^Papierkorb – Notizen hierher ziehen/).first());
  await d.getByRole('status').getByRole('button', { name: 'Rückgängig' }).click();
});
await step('Select two notes with Ctrl+click and drag them into a folder together', async () => {
  await side.getByText('Ideen-Sammlung', { exact: true }).first().click();
  await sleep(400);
  await side.getByText(/^Uptime-Monitoring/).first().click({ modifiers: ['Control'] });
  await drag(d, side.getByText('Ideen-Sammlung', { exact: true }).first(), side.getByText('Privat', { exact: true }).first());
});
await step('Drag a note to the top level', async () => {
  // While dragging, a drop target for the top level appears below the tree
  const a = await side.getByText('Ideen-Sammlung', { exact: true }).first().boundingBox();
  await d.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await d.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await d.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + i * 4);
    await sleep(40);
  }
  const target = side.getByText('Auf Hauptebene verschieben', { exact: true });
  await target.waitFor({ timeout: 3000 });
  const b = await target.boundingBox();
  for (let i = 1; i <= 15; i++) {
    await d.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 15, a.y + a.height / 2 + 20 + ((b.y + b.height / 2 - a.y - a.height / 2 - 20) * i) / 15);
    await sleep(25);
  }
  await sleep(150);
  await d.mouse.up();
});
// Realtime: notes changed elsewhere (here: the API with the same account) show up in the sidebar
const send = async (method, p, body) =>
  (await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json().catch(() => null);
const inSidebar = async (title) => (await side.getByText(title, { exact: true }).count()) > 0;
let outsideId = '';
await step('Realtime: note created from outside', async () => {
  outsideId = (await send('POST', '/api/v1/documents', { title: 'Von außen', folderPath: '' })).id;
  await sleep(1500);
  return `Sidebar shows “Von außen”: ${await inSidebar('Von außen')}`;
});
await step('Realtime: note renamed from outside', async () => {
  await send('PUT', `/api/v1/documents/${outsideId}`, { title: 'Von außen umbenannt' });
  await sleep(1500);
  return `Sidebar shows “Von außen umbenannt”: ${await inSidebar('Von außen umbenannt')}`;
});
await step('Realtime: note deleted from outside', async () => {
  await send('DELETE', `/api/v1/documents/${outsideId}`);
  await sleep(1500);
  return `Sidebar shows “Von außen umbenannt”: ${await inSidebar('Von außen umbenannt')}`;
});
// The counter at the Triage tab follows realtime events (a thought captured elsewhere)
const triageCount = async () => (await d.locator('nav button.tab-btn').first().innerText()).replace(/\s+/g, ' ');
await step('Realtime: thought captured from outside, triage counter', async () => {
  const before = await triageCount();
  await send('POST', '/api/v1/inbox', { content: 'Von außen erfasst', priority: 'normal', source: 'manual', dueDate: '', target: 'inbox' });
  await sleep(2000);
  return `Triage-Reiter vorher „${before}“, nachher „${await triageCount()}“`;
});

// --- Phone: a new note asks for name and emoji first ---
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
await mctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
const m = await mctx.newPage();
m.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await m.goto(BASE);
await m.waitForLoadState('networkidle');
await m.getByText('Später im Browser weiter nutzen').click({ timeout: 3000 }).catch(() => {});
await m.locator('[data-mobile-nav]').getByRole('button', { name: /Workspace/ }).first().click();
await sleep(1000);
await step('Phone: new note with a name through the plus', async () => {
  await m.getByTitle('Schnell erfassen (+)').tap();
  await m.getByPlaceholder('Name der Notiz').fill('Handynotiz');
  await m.keyboard.press('Enter');
});

await browser.close();
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`Zustand nach jedem Schritt in ${OUT}`);
