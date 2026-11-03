// Locks, presence, undo and conflict copies with two real browsers. Needs a server in demo mode
// (accounts admin/admin and user/user); see e2e/README.md.
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

const serverBlocks = async (token, docId) =>
  (await api(token, 'GET', `/api/v1/docs/${docId}/snapshot`)).blocks.filter((b) => !b.deleted);
const editorValues = (page) =>
  page.$$eval('textarea', (els) => els.filter((e) => !e.placeholder?.startsWith('Titel')).map((e) => e.value));

// Puts the cursor at the end of the text field showing `text` (works whether or not it is focused already)
async function focusField(page, text) {
  const handle = await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('textarea')).find((e) => e.value === t) || null,
    text,
    { timeout: 5000, polling: 100 } // rAF polling stalls in background pages
  );
  const el = handle.asElement();
  await el.click();
  await page.keyboard.press('End');
}

async function openDoc(browser, token, title) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('textarea').length > 1, null, { timeout: 10000 });
  return { ctx, page };
}

const TITLE = `Sperr-Test ${Date.now()}`;
const id = (n) => `lk_${n}_${Date.now()}`;

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userId = dir.find((u) => u.username === 'user' || u.email?.startsWith('user')).id;
  const ids = { a: id('a'), b: id('b') };
  const doc = await api(admin, 'POST', '/api/v1/documents', {
    title: TITLE,
    blocks: [
      { id: ids.a, type: 'bullet', content: 'Admin schreibt hier', level: 0 },
      { id: ids.b, type: 'bullet', content: 'Darunter', level: 0 },
    ],
  });
  await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId, permission: 'write' });

  const browser = await chromium.launch();
  const A = await openDoc(browser, admin, TITLE);
  const B = await openDoc(browser, user, TITLE);

  // Presence
  // Presence is an avatar stack; its label lists who is online
  const presence = await waitFor(async () => B.page.getByLabel(/^Gerade online:/).getAttribute('aria-label'), 8000);
  check(!!presence && /Admin/i.test(presence), `Bearbeiter sieht, wer noch in der Notiz ist: ${presence}`);

  // Admin clicks into the first bullet -> user sees the lock
  await A.page.getByText('Admin schreibt hier', { exact: true }).first().click();
  const lockBadge = await waitFor(async () => (await B.page.getByTitle(/bearbeitet diesen Punkt gerade/).count()) > 0, 10000);
  check(!!lockBadge, 'Bearbeiter sieht das Schloss am gesperrten Bullet');
  const readOnly = await B.page.$$eval('textarea', (els) => els.find((e) => e.value === 'Admin schreibt hier')?.readOnly);
  check(readOnly === true, 'Gesperrter Bullet ist beim Bearbeiter schreibgeschützt');

  // User tries to merge "Darunter" into the locked bullet
  await B.page.getByText('Darunter', { exact: true }).first().click();
  await B.page.keyboard.press('Home');
  await B.page.keyboard.press('Backspace');
  const notice = await waitFor(async () => B.page.getByRole('status').filter({ hasText: /bearbeitet/ }).first().innerText(), 3000);
  check(!!notice && /bearbeitet diesen Punkt gerade/.test(notice), `Hinweis statt halber Aktion: ${notice}`);
  await sleep(1500);
  const afterMerge = (await serverBlocks(admin, doc.id)).map((b) => b.content).sort();
  check(JSON.stringify(afterMerge) === JSON.stringify(['Admin schreibt hier', 'Darunter']), `Nichts wurde teilweise ausgeführt: ${JSON.stringify(afterMerge)}`);

  // Undo on the admin side
  await focusField(A.page, 'Admin schreibt hier');
  await A.page.keyboard.type(' und noch mehr');
  await waitFor(async () => (await serverBlocks(admin, doc.id)).some((b) => b.content === 'Admin schreibt hier und noch mehr'), 5000);
  await A.page.keyboard.press('Control+z');
  const undone = await waitFor(async () => (await serverBlocks(admin, doc.id)).some((b) => b.content === 'Admin schreibt hier'), 5000);
  check(!!undone, 'Strg+Z nimmt den getippten Text zurück (auch auf dem Server)');
  const fieldUndone = await waitFor(async () => (await editorValues(A.page)).includes('Admin schreibt hier'), 3000);
  check(!!fieldUndone, 'Das fokussierte Feld zeigt den zurückgenommenen Text');
  await A.page.keyboard.press('Control+Shift+z');
  const redone = await waitFor(async () => (await serverBlocks(admin, doc.id)).some((b) => b.content === 'Admin schreibt hier und noch mehr'), 5000);
  check(!!redone, 'Strg+Umschalt+Z stellt ihn wieder her');

  // Typing right after Enter lands in the new bullet (no pause)
  await A.page.keyboard.press('End');
  await A.page.keyboard.press('Enter');
  await A.page.keyboard.type('Direkt nach Enter');
  const newBullet = await waitFor(async () => (await serverBlocks(admin, doc.id)).some((b) => b.content === 'Direkt nach Enter'), 5000);
  check(!!newBullet, 'Sofort nach Enter Getipptes landet im neuen Bullet');

  // Conflict copy: two writes on the same base version via the API
  const before = (await serverBlocks(admin, doc.id)).find((b) => b.id === ids.b);
  await api(admin, 'POST', `/api/v1/docs/${doc.id}/sync`, { clientId: 'api-1', lastSeq: 0, ops: [{ opId: `${ids.b}-x`, kind: 'set_content', blockId: ids.b, baseVersion: before.version, content: 'Gewinner-Text' }] });
  await api(user, 'POST', `/api/v1/docs/${doc.id}/sync`, { clientId: 'api-2', lastSeq: 0, ops: [{ opId: `${ids.b}-y`, kind: 'set_content', blockId: ids.b, baseVersion: before.version, content: 'Verlierer-Text' }] });
  const conflictShown = await waitFor(async () => (await A.page.getByText(/Version von/).count()) > 0, 8000);
  check(!!conflictShown, 'Konfliktkopie wird markiert angezeigt');
  // The user's cursor is still in the original bullet (it holds the lock), so the admin may not overwrite it
  await A.page.getByRole('button', { name: 'Übernehmen' }).first().click();
  const refused = await waitFor(async () => A.page.getByRole('status').filter({ hasText: /bearbeitet/ }).first().innerText(), 3000);
  check(!!refused && /bearbeitet/.test(refused), `Übernehmen in einen fremd gesperrten Punkt wird verweigert: ${refused}`);
  // The user holding the original can accept once the copy's author (here a separate API client that never
  // renews its lease) no longer holds the copy, i.e. after at most 20 s
  await waitFor(async () => (await B.page.getByText(/Version von/).count()) > 0, 8000);
  const copyId = (await serverBlocks(admin, doc.id)).find((b) => b.props?.conflictOf)?.id;
  const copyFree = await waitFor(async () => {
    const probe = await api(admin, 'POST', `/api/v1/docs/${doc.id}/sync`, { clientId: 'probe', lastSeq: 0 });
    return !probe.leases.others.some((l) => l.blockId === copyId);
  }, 25000);
  check(!!copyFree, 'Sperre der Konfliktkopie läuft ab');
  await sleep(3500); // the user's browser learns about it with its next sync
  // Both API writes became conflict copies (the user's cursor locked the original); accept the first one
  const copiesBefore = (await serverBlocks(admin, doc.id)).filter((b) => b.props?.conflictOf === ids.b);
  const firstCopyText = await B.page.$$eval(
    'textarea',
    (els, texts) => els.map((e) => e.value).find((v) => texts.includes(v)),
    copiesBefore.map((c) => c.content)
  );
  await B.page.getByRole('button', { name: 'Übernehmen' }).first().click();
  const accepted = await waitFor(async () => {
    const blocks = await serverBlocks(admin, doc.id);
    const copiesNow = blocks.filter((b) => b.props?.conflictOf === ids.b);
    return blocks.find((b) => b.id === ids.b)?.content === firstCopyText && copiesNow.length === copiesBefore.length - 1;
  }, 6000);
  check(!!accepted, `„Übernehmen“ ersetzt den ursprünglichen Text durch „${firstCopyText}“ und entfernt diese Kopie`);

  await browser.close();
  console.log(failures ? `${failures} FEHLGESCHLAGEN` : 'ALLE PRÜFUNGEN BESTANDEN');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
