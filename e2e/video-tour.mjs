// A walk through the demo for a screen recording (YouTube): triage, tasks, shopping list, notes with zoom,
// a linked subtask, the to-do overview. What it types explains what it is doing at that moment. Drives the visible Chrome on the desktop over its debugging
// port, with a drawn mouse pointer and typing at human speed. See e2e/video-tour.sh.
//   CDP=http://localhost:9222   connect to that Chrome (else: start a headless Chromium, for testing)
//   BASE=https://demo.mindsift.app   the instance (demo mode, account admin/admin)
//   SHOTS=/shots   headless only: a screenshot after every step
//   PACE=1   1 = normal, 0.5 = twice as fast, 2 = slower
//   TOUR_LANG=de|en   texts and labels to look for (default: the page's language)
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'https://demo.mindsift.app').replace(/\/$/, '');
const PACE = Number(process.env.PACE || 1);
const SHOTS = process.env.SHOTS || '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms * PACE));

// What the tour looks for and types, per language of the demo (TOUR_LANG, else the page's language)
const TEXTS = {
  de: {
    nav: { triage: 'Triage', tasks: 'Aufgaben', lists: 'Listen', workspace: 'Workspace' },
    triage: { task: 'Aufgabe', toList: 'Auf Liste', packingList: 'Packliste Südtirol', later: 'Später' },
    tasks: { input: 'Neue Aufgabe anlegen…', newTask: 'Aufgaben direkt hier anlegen – #tags werden zu Filtern', checkOff: 'Als erledigt abhaken', done: 'Reverse-Proxy' },
    lists: { groceries: 'Wocheneinkauf', input: /Was soll auf/, items: ['Geteilte Listen sind für alle live', 'Beim Einkaufen einfach abhaken', 'Erledigtes rutscht nach unten'] },
    notes: {
      tab: 'Notizen', todosTab: 'To-Dos', markDone: 'Als erledigt markieren', zoom: 'hineinzoomen', back: 'Zurück zum Hauptdokument',
      homelab: 'Homelab 2.0', branch: 'Checkliste Umzug', tick1: 'ZFS-Pool mit zwei SSDs anlegen', tick2: 'Gitea mit Runner',
      after: 'Home Assistant inklusive Zigbee-Stick', write1: 'Du bist in diesen Ast hineingezoomt – ein Klick auf einen Punkt fokussiert ihn',
      write2: 'Slash-Befehle machen To-dos, Überschriften, Warnungen und mehr',
      renovation: 'Hausrenovierung', personal: 'Privat', tick3: 'Gegenangebot vom zweiten Studio', tick4: 'Fußbodenheizung vorher prüfen',
      after2: 'Musterplatten liegen im Keller', write3: 'Enter macht einen neuen Punkt, Tab rückt ihn ein, alles speichert live',
      warning: 'Warnungen wie diese fallen in der Notiz sofort auf',
      secretLine: 'Verborgene Werte halten Codes unter Verschluss, z. B. den Schlüsseltresor: ', secretValue: '4719', secretSave: 'Speichern',
      backup: 'Backup-Konzept', projects: 'Projekte', subtask: 'Nächtlicher Lauf per systemd-Timer', parent: 'Backup-Konzept umsetzen',
      openTask: 'Erweiterte Aufgabe öffnen', lastSubtask: 'Wiederherstellung einmal komplett testen', addNote: 'Detailnotiz hinzufügen…',
      note: 'Häkchen in Notizen können echte Aufgaben werden – Notiz und Aufgabe bleiben dabei immer gleich.', saveNote: 'Notiz speichern', openInNote: 'In Notiz öffnen',
      todo: 'Angebot Fliesenleger',
    },
  },
  en: {
    nav: { triage: 'Triage', tasks: 'Tasks', lists: 'Lists', workspace: 'Workspace' },
    triage: { task: 'Task', toList: 'To list', packingList: 'Packing list South Tyrol', later: 'Later' },
    tasks: { input: 'Create a new task…', newTask: 'Add tasks right here – #tags turn into filters', checkOff: 'Check off', done: 'Reverse proxy' },
    lists: { groceries: 'Weekly groceries', input: /What goes on/, items: ['Shared lists update live for everyone', 'Tick things off while shopping', 'Done items move to the bottom'] },
    notes: {
      tab: 'Notes', todosTab: 'To-dos', markDone: 'Mark as done', zoom: 'zoom into', back: 'Back to the main document',
      homelab: 'Homelab 2.0', branch: 'Moving checklist', tick1: 'Create a ZFS pool with two SSDs', tick2: 'Gitea with runner',
      after: 'Home Assistant including the Zigbee stick', write1: 'You are zoomed into this branch – click any bullet to focus it',
      write2: 'Slash commands make to-dos, headings, warnings and more',
      renovation: 'House renovation', personal: 'Personal', tick3: 'Get a counter-offer from a second studio', tick4: 'Have the underfloor heating checked',
      after2: 'Sample tiles are in the basement', write3: 'Enter adds a bullet, Tab indents it, everything saves live',
      warning: 'Warnings like this one stand out in the note',
      secretLine: 'Hidden values keep codes out of sight, like the key safe: ', secretValue: '4719', secretSave: 'Save',
      backup: 'Backup plan', projects: 'Projects', subtask: 'Nightly run with a systemd timer', parent: 'Put the backup plan into practice',
      openTask: 'Open the extended task', lastSubtask: 'Test a full restore once', addNote: 'Add details…',
      note: 'Checkboxes in notes can become full tasks – note and task always stay in sync.', saveNote: 'Save note', openInNote: 'Open in note',
      todo: 'Quote from the tiler',
    },
  },
};

// --- Browser ---------------------------------------------------------------------------------------
let browser, page;
if (process.env.CDP) {
  browser = await chromium.connectOverCDP(process.env.CDP);
  const ctx = browser.contexts()[0];
  page = ctx.pages().find((p) => !p.url().startsWith('devtools')) || (await ctx.newPage());
} else {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: process.env.TOUR_LANG === 'de' ? 'de-DE' : 'en-US' });
  page = await ctx.newPage();
}
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

// A drawn pointer that follows the (synthetic) mouse and pulses on a click
const POINTER = () => {
  if (window.__tourPointer) return;
  window.__tourPointer = true;
  const add = () => {
    const dot = document.createElement('div');
    dot.id = 'tour-pointer';
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(255,255,255,.35);border:2px solid rgba(20,20,20,.75);box-shadow:0 0 0 2px rgba(255,255,255,.6);' +
      'pointer-events:none;z-index:2147483647;transition:transform .12s ease;transform:translate(-100px,-100px)';
    document.documentElement.appendChild(dot);
    let x = -100, y = -100;
    window.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px,${y}px)`; }, true);
    window.addEventListener('mousedown', () => { dot.style.transform = `translate(${x}px,${y}px) scale(.7)`; }, true);
    window.addEventListener('mouseup', () => { dot.style.transform = `translate(${x}px,${y}px)`; }, true);
  };
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
};

let mouse = { x: 800, y: 450 };
let step = 0;
async function shot(name) {
  if (!SHOTS) return;
  step += 1;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png` });
}

// Glide to the middle of an element and click it
// leftOf: click that many pixels left of the element instead (the checkbox in front of a text)
async function click(locator, { settle = 500, offsetX = 0, leftOf = 0 } = {}) {
  const el = locator.first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  const x = leftOf ? box.x - leftOf : box.x + box.width / 2 + offsetX;
  const y = box.y + box.height / 2;
  const dist = Math.hypot(x - mouse.x, y - mouse.y);
  await page.mouse.move(x, y, { steps: Math.max(12, Math.round(dist / 18 / PACE)) });
  mouse = { x, y };
  await wait(180);
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
  await wait(settle);
}

async function type(text, { perChar = 65 } = {}) {
  await page.keyboard.type(text, { delay: perChar * PACE });
}

async function press(key, settle = 400) {
  await page.keyboard.press(key);
  await wait(settle);
}

// --- Start: logged in, fresh page ---------------------------------------------------------------------
const res = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: 'admin', password: 'admin' }),
});
const { token } = await res.json();
await page.goto(BASE);
await page.evaluate(([t]) => {
  localStorage.setItem('mindsift_jwt_token', t);
  localStorage.setItem('mindsift_pwa_prompt_dismissed', '1');
  sessionStorage.clear();
}, [token]);
await page.addInitScript(POINTER);
await page.goto(BASE);
await page.evaluate(POINTER);
await page.waitForLoadState('networkidle').catch(() => {});
await wait(1500);
const lang = process.env.TOUR_LANG || (await page.evaluate(() => document.documentElement.lang || 'en')).slice(0, 2);
const T = TEXTS[lang] || TEXTS.en;
console.log('Tour language:', TEXTS[lang] ? lang : 'en');
await shot('start');

const nav = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).locator('visible=true');
const btn = (name) => page.getByRole('button', { name, exact: true }).locator('visible=true');

// --- 1. Triage: three thoughts --------------------------------------------------------------------------
await click(nav(T.nav.triage), { settle: 1200 });
await shot('triage');
await click(btn(T.triage.task), { settle: 1400 }); // the damp basement becomes a task
await click(btn(T.triage.toList), { settle: 900 }); // the mountain hut goes onto the packing list
await click(page.getByRole('button', { name: new RegExp(T.triage.packingList) }).locator('visible=true'), { settle: 1400 });
await shot('triage-list');
await click(btn(T.triage.later), { settle: 1400 });
await shot('triage-later');

// --- 2. Tasks: a new one, one ticked off ------------------------------------------------------------------
await click(nav(T.nav.tasks), { settle: 1200 });
await click(page.getByPlaceholder(T.tasks.input), { settle: 300 });
await type(T.tasks.newTask);
await wait(300);
await press('Enter', 1400);
await shot('task-added');
// The checkbox in the row of a task
const checkboxOf = (text) =>
  page.locator(`xpath=//*[contains(text(),"${text}")]/ancestor::*[.//*[@title="${T.tasks.checkOff}"]][1]//*[@title="${T.tasks.checkOff}"]`);
await click(checkboxOf(T.tasks.done), { settle: 1800 });
await shot('task-done');

// --- 3. Shopping list: three things ---------------------------------------------------------------------
await click(nav(T.nav.lists), { settle: 1200 });
await click(page.getByRole('button', { name: new RegExp(T.lists.groceries) }).locator('visible=true'), { settle: 1000 });
const listInput = page.getByPlaceholder(T.lists.input);
for (const item of T.lists.items) {
  await click(listInput, { settle: 200 });
  await type(item);
  await press('Enter', 900);
}
await shot('list-added');
// Tick the one that says so: it moves down to the done items
await click(page.getByText(T.lists.items[1], { exact: true }).locator('visible=true'), { leftOf: 18, settle: 1500 });
await shot('list-ticked');

// --- 4. Notes: zoom into a branch, tick and write, zoom out --------------------------------------------
const N = T.notes;
const row = (text) => page.locator('[data-outline-block]', { hasText: text }).locator('visible=true').last();
const bulletOf = (text) => row(text).locator(`[title*="${N.zoom}"]`);
const todoOf = (text) => row(text).locator(`[title="${N.markDone}"]`);
// Into a bullet's text, cursor at its end
async function intoText(text) {
  await click(row(text).getByText(text, { exact: false }), { settle: 300 });
  await press('End', 200);
}
// A note in the sidebar, opening its folder first when it is in one
const openNote = async (title, folder) => {
  const note = page.locator('aside').getByText(title, { exact: false }).locator('visible=true');
  if (folder && !(await note.count())) await click(page.locator('aside').getByText(folder, { exact: true }), { settle: 700 });
  await click(note, { settle: 1500 });
};

await click(nav(T.nav.workspace), { settle: 1500 });
await openNote(N.homelab);
await shot('note-homelab');
await click(bulletOf(N.branch), { settle: 1400 });
await shot('zoomed');
await click(todoOf(N.tick1), { settle: 900 });
await click(todoOf(N.tick2), { settle: 900 });
// A slash command turns the new line into a to-do; the next line stays one
async function slash(command) {
  await type(`/${command}`, { perChar: 90 });
  await wait(500);
  await press('Enter', 400);
}
await intoText(N.after);
await press('Enter', 300);
await slash('todo');
await type(N.write1);
await press('Enter', 300);
await slash('todo');
await type(N.write2);
await wait(900);
await shot('zoomed-written');
await click(page.getByTitle(N.back).locator('visible=true'), { settle: 1500 });
await shot('zoomed-out');

// --- 5. Another note: tick two points, add a thought --------------------------------------------------
await openNote(N.renovation, N.personal);
await click(todoOf(N.tick3), { settle: 900 });
await click(todoOf(N.tick4), { settle: 900 });
await intoText(N.after2);
await press('Enter', 300);
await type(N.write3);
await press('Enter', 300);
await slash('warn');
await type(N.warning);
await press('Enter', 300);
await shot('after-warning');
await slash('text');
// A code that is only needed for a few days, kept as a hidden value
await type(N.secretLine);
await slash('secret');
await wait(400);
await type(N.secretValue, { perChar: 140 });
await wait(400);
await press('Enter', 1200);
// Leave the line: the hidden value shows as a chip with a lock
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await wait(1200);
// A click shows it for a moment
await click(row(N.secretLine.trim().slice(0, 20)).locator('[data-secret]'), { settle: 2200 });
await shot('renovation');

// --- 6. A note checkbox that is a task: tick a subtask, open the task, finish it there ----------------
await openNote(N.backup, N.projects);
await click(todoOf(N.subtask), { settle: 1200 });
await click(row(N.parent).getByTitle(N.openTask), { settle: 1500 });
await shot('task-modal');
const dialog = page.locator('.modal-overlay, [role="dialog"]').locator('visible=true').last();
await click(dialog.getByText(N.lastSubtask, { exact: true }), { leftOf: 15, settle: 1200 });
await click(dialog.getByText(N.addNote), { settle: 500 });
await type(N.note);
await wait(500);
await click(dialog.getByRole('button', { name: N.saveNote }), { settle: 900 });
await shot('task-finished');
await click(dialog.getByRole('button', { name: N.openInNote }), { settle: 1800 });
await shot('back-in-note');

// --- 7. The to-dos of all notes in one place: tick one there ------------------------------------------
await click(page.getByRole('button', { name: new RegExp(`^${N.todosTab}`) }).locator('visible=true'), { settle: 1500 });
await shot('todos');
await click(page.getByText(N.todo, { exact: true }).locator('visible=true'), { leftOf: 15, settle: 1500 });
await shot('todos-ticked');

// --- The end: back to the note list, a moment to breathe -------------------------------------------------
await click(page.getByRole('button', { name: new RegExp(`^${N.tab}`) }).locator('visible=true'), { settle: 1200 });
await page.mouse.move(mouse.x + 300, mouse.y + 200, { steps: 30 });
await wait(2500);
await shot('end');

console.log('done');
await wait(800);
if (!process.env.CDP) await browser.close();
else await browser.close().catch(() => {});
