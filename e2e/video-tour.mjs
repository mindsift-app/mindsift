// A walk through the demo for a screen recording (YouTube): triage, tasks, shopping list, notes with zoom,
// a linked subtask, the to-do overview. Drives the visible Chrome on the desktop over its debugging
// port, with a drawn mouse pointer and typing at human speed. See e2e/video-tour.sh.
//   CDP=http://localhost:9222   connect to that Chrome (else: start a headless Chromium, for testing)
//   BASE=https://demo.mindsift.app   the instance (demo mode, account admin/admin)
//   SHOTS=/shots   headless only: a screenshot after every step
//   PACE=1   1 = normal, 0.5 = twice as fast, 2 = slower
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'https://demo.mindsift.app').replace(/\/$/, '');
const PACE = Number(process.env.PACE || 1);
const SHOTS = process.env.SHOTS || '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms * PACE));

// --- Browser ---------------------------------------------------------------------------------------
let browser, page;
if (process.env.CDP) {
  browser = await chromium.connectOverCDP(process.env.CDP);
  const ctx = browser.contexts()[0];
  page = ctx.pages().find((p) => !p.url().startsWith('devtools')) || (await ctx.newPage());
} else {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'de-DE' });
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
await shot('start');

const nav = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).locator('visible=true');

// --- 1. Triage: three thoughts --------------------------------------------------------------------------
const btn = (name) => page.getByRole('button', { name, exact: true }).locator('visible=true');
await click(nav('Triage'), { settle: 1200 });
await shot('triage');
await click(btn('Aufgabe'), { settle: 1400 }); // the damp cellar becomes a task
await click(btn('Auf Liste'), { settle: 900 }); // the hut in South Tyrol goes onto the packing list
await click(page.getByRole('button', { name: /Packliste Südtirol/ }).locator('visible=true'), { settle: 1400 });
await shot('triage-list');
await click(btn('Später'), { settle: 1400 });
await shot('triage-later');

// --- 2. Tasks: a new one, one ticked off ------------------------------------------------------------------
await click(nav('Aufgaben'), { settle: 1200 });
await click(page.getByPlaceholder('Neue Aufgabe anlegen…'), { settle: 300 });
await type('Rasenmäher-Messer schleifen #garten');
await wait(300);
await press('Enter', 1400);
await shot('task-added');
// Tick off "Reverse-Proxy …": the checkbox in the row of that task
const checkboxOf = (text) =>
  page.locator(`xpath=//*[contains(text(),"${text}")]/ancestor::*[.//*[@title="Als erledigt abhaken"]][1]//*[@title="Als erledigt abhaken"]`);
await click(checkboxOf('Reverse-Proxy'), { settle: 1800 });
await shot('task-done');

// --- 3. Shopping list: three things ---------------------------------------------------------------------
await click(nav('Listen'), { settle: 1200 });
await click(page.getByRole('button', { name: /Wocheneinkauf/ }).locator('visible=true'), { settle: 1000 });
const listInput = page.getByPlaceholder(/Was soll auf/);
for (const item of ['Bananen', 'Vollkornbrot', 'Kaffeebohnen']) {
  await click(listInput, { settle: 200 });
  await type(item);
  await press('Enter', 900);
}
await shot('list-added');

// --- 4. Notes: zoom into a branch, tick and write, zoom out --------------------------------------------
const row = (text) => page.locator('[data-outline-block]', { hasText: text }).locator('visible=true').last();
const bulletOf = (text) => row(text).locator('[title*="hineinzoomen"]');
const todoOf = (text) => row(text).locator('[title="Als erledigt markieren"]');
// Into a bullet's text, cursor at its end
async function intoText(text) {
  await click(row(text).getByText(text, { exact: false }), { settle: 300, offsetX: 0 });
  await press('End', 200);
}
// A note in the sidebar, opening its folder first when it is in one
const openNote = async (title, folder) => {
  const note = page.locator('aside').getByText(title, { exact: false }).locator('visible=true');
  if (folder && !(await note.count())) await click(page.locator('aside').getByText(folder, { exact: true }), { settle: 700 });
  await click(note, { settle: 1500 });
};

await click(nav('Workspace'), { settle: 1500 });
await openNote('Homelab 2.0');
await shot('note-homelab');
await click(bulletOf('Checkliste Umzug'), { settle: 1400 });
await shot('zoomed');
await click(todoOf('ZFS-Pool mit zwei SSDs anlegen'), { settle: 900 });
await click(todoOf('Gitea mit Runner'), { settle: 900 });
await intoText('Home Assistant inklusive Zigbee-Stick');
await press('Enter', 300);
await type('Nextcloud mit eigener Datenbank');
await press('Enter', 300);
await type('Paperless für die Steuerunterlagen');
await wait(900);
await shot('zoomed-written');
await click(page.getByTitle('Zurück zum Hauptdokument').locator('visible=true'), { settle: 1500 });
await shot('zoomed-out');

// --- 5. Another note: tick two points, add a thought --------------------------------------------------
await openNote('Hausrenovierung', 'Privat');
await click(todoOf('Gegenangebot vom zweiten Studio'), { settle: 900 });
await click(todoOf('Fußbodenheizung vorher prüfen'), { settle: 900 });
await intoText('Musterplatten liegen im Keller');
await press('Enter', 300);
await type('Fugenfarbe: hellgrau, passt zu beiden Mustern');
await wait(900);
await shot('renovation');

// --- 6. A note checkbox that is a task: tick a subtask, open the task, finish it there ----------------
await openNote('Backup-Konzept', 'Projekte');
await click(todoOf('Nächtlicher Lauf per systemd-Timer'), { settle: 1200 });
await click(row('Backup-Konzept umsetzen').getByTitle('Erweiterte Aufgabe öffnen'), { settle: 1500 });
await shot('task-modal');
const dialog = page.locator('.modal-overlay, [role="dialog"]').locator('visible=true').last();
await click(dialog.getByText('Wiederherstellung einmal komplett testen', { exact: true }), { leftOf: 15, settle: 1200 });
await click(dialog.getByText('Detailnotiz hinzufügen…'), { settle: 500 });
await type('Restore auf die Test-VM geklappt, dauert rund 14 Minuten.');
await wait(500);
await click(dialog.getByRole('button', { name: 'Notiz speichern' }), { settle: 900 });
await shot('task-finished');
await click(dialog.getByRole('button', { name: 'In Notiz öffnen' }), { settle: 1800 });
await shot('back-in-note');

// --- 7. The to-dos of all notes in one place: tick one there ------------------------------------------
await click(page.getByRole('button', { name: /^To-Dos/ }).locator('visible=true'), { settle: 1500 });
await shot('todos');
await click(page.getByText('Angebot Fliesenleger', { exact: true }).locator('visible=true'), { leftOf: 15, settle: 1500 });
await shot('todos-ticked');

// --- The end: back to the note list, a moment to breathe -------------------------------------------------
await click(page.getByRole('button', { name: /^Notizen/ }).locator('visible=true'), { settle: 1200 });
await page.mouse.move(mouse.x + 300, mouse.y + 200, { steps: 30 });
await wait(2500);
await shot('end');

console.log('done');
await wait(800);
if (!process.env.CDP) await browser.close();
else await browser.close().catch(() => {});
