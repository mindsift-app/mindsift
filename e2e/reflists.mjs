// Shopping list check for refactors: adding, hashtag suggestions,
// ticking, quantities, deleting, dragging within and between categories and onto another list's tab,
// clearing done entries, a new list, realtime from outside and the add sheet on a phone. After each step
// the lists as the server has them. Two runs of the same code give the same file; e2e/refshots.sh lists
// <name> runs it on a fresh copy of the reference data.
//
//   OUT=/shots/name.lists.txt node reflists.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const OUT = process.env.OUT || '/shots/lists.txt';
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
// The run copy is not in demo mode: the offer of the guided tour comes from the account and would cover the
// bottom right of the page, so it counts as answered
await fetch(`${BASE}/api/v1/auth/settings`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ tourOffered: true }),
});
const send = async (method, p, body) =>
  (
    await fetch(BASE + p, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    })
  )
    .json()
    .catch(() => null);

// Every list with its entries in their order: category, quantity, done
async function record(step) {
  const lists = (await send('GET', '/api/v1/lists')) || [];
  lines.push(`## ${step}`);
  for (const l of [...lists].sort((a, b) => a.title.localeCompare(b.title))) {
    lines.push(`${l.icon} ${l.title}`);
    const items = [...(l.items || [])].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.sortOrder - b.sortOrder);
    for (const i of items) {
      lines.push(`  ${i.isCompleted ? '[x]' : '[ ]'} ${(i.category || '-').padEnd(14)} ${i.content.padEnd(40)} ${i.quantity || ''}`.trimEnd());
    }
  }
  lines.push('');
  console.log(`OK   ${step}`);
}

async function step(name, fn) {
  try {
    const extra = await fn(); // a line of its own for what the server state does not show (the UI)
    await sleep(1200);
    await record(name);
    if (typeof extra === 'string') lines.splice(lines.length - 1, 0, extra);
  } catch (e) {
    lines.push(`## ${name}\nFEHLGESCHLAGEN: ${e.message.split('\n')[0]}\n`);
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}

// Mouse drag with many small moves (HTML5 drag and drop reacts to dragover after React rendered the drag)
async function drag(page, source, target, dy = 0) {
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 20, a.y + a.height / 2 + ((b.y + b.height / 2 + dy - a.y - a.height / 2) * i) / 20);
    await sleep(25);
  }
  await sleep(150);
  await page.mouse.up();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
await ctx.addInitScript((t) => {
  localStorage.setItem('mindsift_jwt_token', t);
  localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
}, token);
const d = await ctx.newPage();
d.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await d.goto(BASE);
await d.waitForLoadState('networkidle');
await d.getByTitle('Benutzermenü öffnen').first().waitFor();
await d.getByRole('button', { name: /^Listen/ }).locator('visible=true').first().click();
await sleep(1000);
await d.locator('button', { hasText: 'Wocheneinkauf' }).first().click();
await sleep(600);
const input = d.getByPlaceholder(/^Was soll auf/);
const row = (text) => d.getByText(text, { exact: true }).first().locator('xpath=ancestor::*[@draggable="true"][1]');
await record('Ausgangslage');

await step('Item with quantity and hashtag', async () => {
  await input.fill('Butter #Kühlregal');
  await d.getByPlaceholder('Menge').first().fill('250 g');
  // Enter would take the open hashtag suggestion first
  await d.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
});
await step('Accept a hashtag suggestion', async () => {
  await input.fill('');
  await input.type('Joghurt #Kü');
  await sleep(300);
  const suggestions = await d.getByText('#Kühlregal').count();
  await input.press('Tab');
  const value = await input.inputValue();
  await input.press('Enter');
  return `Suggestions visible: ${suggestions > 0}, field after accepting: “${value}”`;
});
await step('Eintrag abhaken', async () => {
  await row('Spülmaschinentabs').locator('button').first().click();
});
await step('Menge bearbeiten', async () => {
  await row('Bergkäse').getByTitle('Menge bearbeiten').click();
  const qty = row('Bergkäse').getByPlaceholder('Menge');
  await qty.fill('300 g');
  await qty.press('Enter');
});
await step('Delete an item', async () => {
  await row('Avocados').hover();
  await row('Avocados').getByTitle('Eintrag löschen').click({ force: true });
});
await step('Drag an item up within its category', async () => {
  await drag(d, row('Cherrytomaten'), row('Äpfel (Elstar)'), -10);
});
await step('Eintrag in eine andere Kategorie ziehen', async () => {
  await drag(d, row('Bergkäse'), row('Cherrytomaten'), -10);
});
await step('Drag an item onto the tab of another list', async () => {
  await drag(d, row('Espressobohnen (100 % Arabica)'), d.locator('button', { hasText: 'Packliste Südtirol' }).first());
});
await step('Reopen a done item', async () => {
  await d.getByText('Bauernbrot', { exact: true }).first().locator('xpath=ancestor::div[.//button[@title="Als offen markieren"]][1]').getByTitle('Als offen markieren').click();
});
await step('Clear checked items', async () => {
  await d.getByRole('button', { name: /^Erledigte aufräumen/ }).click();
  await sleep(300);
  // A confirmation, if there is one
  await d.getByRole('button', { name: /^(Aufräumen|Löschen|Entfernen)$/ }).first().click({ timeout: 1000 }).catch(() => {});
});
await step('New list through the dialog', async () => {
  await d.getByTitle('Neue Liste anlegen').first().click();
  await d.getByPlaceholder('z.B. Supermarkt, Baumarkt, Drogerie').fill('Baumarkt');
  await d.getByPlaceholder('z.B. Supermarkt, Baumarkt, Drogerie').press('Enter');
});

// Realtime: entries changed elsewhere (here: the API with the same account) show up in the open list
const lists = (await send('GET', '/api/v1/lists')) || [];
const weekly = lists.find((l) => l.title === 'Wocheneinkauf');
await d.locator('button', { hasText: 'Wocheneinkauf' }).first().click();
await sleep(600);
let outsideId = '';
await step('Realtime: item created from outside', async () => {
  outsideId = (await send('POST', `/api/v1/lists/${weekly.id}/items`, { content: 'Von außen', category: '', quantity: '' }))?.id;
  await sleep(1500);
  return `Liste zeigt „Von außen“: ${(await d.getByText('Von außen', { exact: true }).count()) > 0}`;
});
await step('Realtime: item ticked from outside', async () => {
  await send('PATCH', `/api/v1/lists/${weekly.id}/items/${outsideId}`, { isCompleted: true });
  await sleep(1500);
  const done = await d.getByText('Von außen', { exact: true }).first().locator('xpath=ancestor::div[.//button[@title="Als offen markieren"]][1]').count();
  return `“Von außen” shows as done: ${done > 0}`;
});

// --- Phone: "+" opens the add sheet ---
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
await mctx.addInitScript((t) => {
  localStorage.setItem('mindsift_jwt_token', t);
  localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
}, token);
const m = await mctx.newPage();
m.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await m.goto(BASE);
await m.waitForLoadState('networkidle');
await m.getByText('Später im Browser weiter nutzen').click({ timeout: 3000 }).catch(() => {});
await m.locator('[data-mobile-nav]').getByRole('button', { name: /Listen/ }).first().click();
await sleep(1000);
await step('Phone: item through the plus', async () => {
  await m.getByTitle('Schnell erfassen (+)').tap();
  const field = m.getByPlaceholder(/^Was soll auf/);
  await field.fill('Brötchen');
  await field.press('Enter');
});

await browser.close();
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`Zustand nach jedem Schritt in ${OUT}`);
