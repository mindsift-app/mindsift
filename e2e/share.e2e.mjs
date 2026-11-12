// Shares a note as editor through the share dialog and checks that the editor can then edit it.
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

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(250);
  }
  return null;
}

async function openDoc(browser, token, title) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, token);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('textarea').length > 1, null, { timeout: 10000 });
  return { ctx, page };
}

const TITLE = `Freigabe-Test ${Date.now()}`;
const TODO_ID = `fr_todo_${Date.now()}`;
const TODO_TEXT = `Rollup-Aufgabe ${Date.now()}`;

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const doc = await api(admin, 'POST', '/api/v1/documents', {
    title: TITLE,
    blocks: [
      { id: `fr_${Date.now()}`, type: 'bullet', content: 'Vom Eigentümer', level: 0 },
      { id: TODO_ID, type: 'todo', content: TODO_TEXT, level: 0 },
    ],
  });

  const browser = await chromium.launch();
  const A = await openDoc(browser, admin, TITLE);

  // Share as editor through the dialog (on large screens "Teilen…" sits in the note's menu)
  await A.page.getByTitle('Weitere Aktionen').locator('visible=true').first().click();
  await A.page.getByRole('menuitem', { name: 'Teilen…' }).click();
  await A.page.getByRole('button', { name: 'Benutzer', exact: true }).click();
  const search = A.page.getByPlaceholder(/Benutzer suchen/);
  await search.click();
  await search.type('user');
  await sleep(300);
  await search.press('Enter'); // the first match is preselected
  const roleSelect = A.page.getByRole('button', { name: 'Berechtigung' }).last();
  check((await roleSelect.isEnabled()) && (await roleSelect.isVisible()), 'Role choice is available in the dialog');
  await roleSelect.click();
  await A.page.getByRole('listbox').getByRole('option', { name: 'Bearbeiten' }).click();
  await A.page.getByRole('button', { name: /Benutzer hinzufügen/ }).click();
  const shares = await waitFor(async () => {
    const list = await api(admin, 'GET', `/api/v1/documents/${doc.id}/shares`);
    return list.length > 0 ? list : null;
  }, 5000);
  check(shares && shares[0].permission === 'write', `Freigabe gespeichert als ${shares?.[0]?.permission}`);
  const badge = await A.page
    .getByText('Bearbeiter', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(badge, 'Dialog shows the role “Bearbeiter”');

  // The editor can edit
  const snap = await api(user, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
  check(snap.role === 'editor', `Recipient has the role ${snap.role}`);
  const B = await openDoc(browser, user, TITLE);
  check(!(await B.page.getByText('schreibgeschützt mit dir geteilt', { exact: false }).first().isVisible().catch(() => false)), 'Kein Nur-Lesen-Hinweis beim Bearbeiter');
  await B.page.getByText('Vom Eigentümer', { exact: true }).first().click();
  await B.page.keyboard.press('End');
  await B.page.keyboard.type(' und vom Bearbeiter');
  const saved = await waitFor(async () => {
    const s = await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
    return s.blocks.some((b) => b.content === 'Vom Eigentümer und vom Bearbeiter');
  }, 6000);
  check(!!saved, 'Editor can edit the shared note');

  // Ticking a to-do in the overview goes through the sync endpoint as well
  await A.page.bringToFront();
  await A.page.getByRole('button', { name: 'Schließen', exact: true }).last().click(); // the share dialog is still open
  await A.page.locator('button:visible', { hasText: 'To-Dos' }).first().click();
  await A.page.getByTitle('Alle To-Dos als einfache Liste').click();
  await A.page.locator('div', { hasText: TODO_TEXT }).last().locator('button').first().click();
  const ticked = await waitFor(async () => {
    const s = await api(admin, 'GET', `/api/v1/docs/${doc.id}/snapshot`);
    return s.blocks.find((b) => b.id === TODO_ID)?.props?.checked === true;
  }, 5000);
  check(!!ticked, 'Ticking off in the to-do overview is saved');

  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
