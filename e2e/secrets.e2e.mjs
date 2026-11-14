// Hidden values pasted into another note, in a real browser: the server gives the note a copy of its own
// (internal/storage/secret_gate.go) and the editor gets the bullet with the new reference back, so the chip
// reveals the value there; undo and redo of the paste work although the reference changed, and a paste made
// offline gets its copy once the connection is back. The text goes in as the clipboard would put it into the
// bullet's field; last, two bullets are copied and pasted with the keyboard in Chromium and Firefox. Needs a server in demo mode (account admin/admin); see e2e/README.md.
import { chromium, firefox } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
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
    await sleep(250);
  }
  return null;
}

const contentOf = async (token, docId, blockId) => {
  const snap = await api(token, 'GET', `/api/v1/docs/${docId}/snapshot`);
  return snap.blocks.find((b) => b.id === blockId && !b.deleted)?.content;
};
const refOf = (text) => /\{\{secret:([A-Za-z0-9_]+)\}\}/.exec(text || '')?.[1];

async function goOffline(ctx, page) {
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}

async function goOnline(ctx, page) {
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

// Puts text at the end of a bullet, as pasting it into the bullet's field does
async function pasteAtEnd(page, blockId, text) {
  await page.locator(`[data-outline-block="${blockId}"] [data-outline-text]`).click({ force: true });
  await page.keyboard.press('End');
  await page.keyboard.insertText(text);
}

const chip = (page, blockId) => page.locator(`[data-outline-block="${blockId}"] [data-secret]`).first();

async function reveals(page, blockId, value) {
  await chip(page, blockId).click();
  return !!(await waitFor(() => page.locator(`[data-outline-block="${blockId}"] [data-v="${value}"]`).count(), 5000));
}

// Two bullets selected with Ctrl+A twice and copied with Ctrl+C, pasted with Ctrl+V into another note: the
// plain text masks the value and names no reference, the app's own format carries the reference, and the
// server gives the other note its own copy, which the chip there reveals. Headless Firefox keeps only the plain
// text on its clipboard; there the paste takes the references from the tab's last copy (rememberCopied).
async function copySeveral(engine, admin) {
  const tag = engine.name();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const value = `Kopie-${stamp % 10000}`;
  const [konto, hinweis] = [`mq1_${stamp}`, `mq2_${stamp}`];
  const origin = await api(admin, 'POST', '/api/v1/documents', {
    title: `Mehrere Quelle ${tag} ${stamp}`,
    blocks: [
      { id: konto, type: 'bullet', content: 'Konto', level: 0 },
      { id: hinweis, type: 'bullet', content: 'Hinweis', level: 1 },
    ],
  });
  const { id: y } = await api(admin, 'POST', `/api/v1/documents/${origin.id}/secrets`, { value });
  await api(admin, 'POST', `/api/v1/docs/${origin.id}/sync`, {
    clientId: `e2e-m-${stamp}`, lastSeq: 0,
    ops: [{ opId: `opm_${stamp}`, kind: 'set_content', blockId: konto, baseVersion: 1, content: `Konto {{secret:${y}}}` }],
  });
  const targetTitle = `Mehrere Ziel ${tag} ${stamp}`;
  const [anfang, schluss] = [`mz1_${stamp}`, `mz2_${stamp}`];
  const target = await api(admin, 'POST', '/api/v1/documents', {
    title: targetTitle,
    blocks: [
      { id: anfang, type: 'bullet', content: 'Anfang', level: 0 },
      { id: schluss, type: 'bullet', content: 'Schluss', level: 0 },
    ],
  });

  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1');
    // What Ctrl+C puts on the clipboard, per type (the system clipboard is not readable in every engine)
    const orig = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (type, v) {
      window.__clip = { ...(window.__clip || {}), [type]: v };
      return orig.call(this, type, v);
    };
  }, admin);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();
  await page.getByText(origin.title, { exact: true }).first().click();
  await page.locator(`[data-outline-block="${hinweis}"]`).waitFor({ timeout: 10000 });

  await page.locator(`[data-outline-block="${hinweis}"] [data-outline-text]`).click({ force: true });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+a');
  await sleep(300);
  await page.evaluate(() => (window.__clip = null));
  await page.keyboard.press('Control+c');
  await sleep(300);
  const clip = (await page.evaluate(() => window.__clip)) || {};
  const plain = clip['text/plain'] || '';
  check(plain.includes('Konto ••••') && !plain.includes('secret') && !plain.includes(value), `${tag}: the copied text masks the hidden value`, plain);
  check((clip['application/x-mindsift-outline'] || '').includes(`Konto {{secret:${y}}}`), `${tag}: the app's own format carries the reference`, clip);

  await page.getByText(targetTitle, { exact: true }).first().click();
  await page.locator(`[data-outline-block="${schluss}"]`).waitFor({ timeout: 10000 });
  await page.locator(`[data-outline-block="${anfang}"] [data-outline-text]`).click({ force: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.press('Control+v');
  await sleep(500);
  await page.locator(`[data-outline-block="${schluss}"] [data-outline-text]`).click({ force: true });

  const pasted = await waitFor(async () => {
    const snap = await api(admin, 'GET', `/api/v1/docs/${target.id}/snapshot`);
    const live = snap.blocks.filter((b) => !b.deleted);
    const k = live.find((b) => /^Konto \{\{secret:/.test(b.content || ''));
    const h = live.find((b) => b.content === 'Hinweis');
    const id = refOf(k?.content);
    return k && h && id && id !== y ? { k, h, id } : null;
  }, 10000);
  check(!!pasted, `${tag}: pasted into another note, both bullets arrive and the value is copied there`);
  if (pasted) {
    check(pasted.h.parentId === pasted.k.id, `${tag}: the second bullet stays indented under the first`, pasted.h);
    await waitFor(() => chip(page, pasted.k.id).count(), 5000);
    check(await reveals(page, pasted.k.id, value), `${tag}: the chip of the pasted bullet reveals the copy`);
  }
  await browser.close();
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const stamp = Date.now();
  const value = `Tresor-${stamp % 10000}`;

  // The note of origin with a hidden value, and the note it is pasted into
  const origin = await api(admin, 'POST', '/api/v1/documents', {
    title: `Geheim Quelle ${stamp}`, blocks: [{ id: `sq_${stamp}`, type: 'bullet', content: 'Zugang', level: 0 }],
  });
  const { id: x } = await api(admin, 'POST', `/api/v1/documents/${origin.id}/secrets`, { value });
  await api(admin, 'POST', `/api/v1/docs/${origin.id}/sync`, {
    clientId: `e2e-${stamp}`, lastSeq: 0,
    ops: [{ opId: `op_${stamp}`, kind: 'set_content', blockId: `sq_${stamp}`, baseVersion: 1, content: `Zugang {{secret:${x}}}` }],
  });
  check(refOf(await contentOf(admin, origin.id, `sq_${stamp}`)) === x, 'The note of origin keeps its own reference');
  const title = `Geheim Ziel ${stamp}`;
  const [pasted, offline, rest] = [`sz1_${stamp}`, `sz2_${stamp}`, `sz3_${stamp}`];
  const target = await api(admin, 'POST', '/api/v1/documents', {
    title,
    blocks: [
      { id: pasted, type: 'bullet', content: 'Ziel', level: 0 },
      { id: offline, type: 'bullet', content: 'Offline-Ziel', level: 0 },
      { id: rest, type: 'bullet', content: 'Ende', level: 0 },
    ],
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, admin);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.getByText('Offline-Ziel', { exact: true }).first().waitFor({ timeout: 10000 });

  // 1. Pasted online: the server stores a copy in this note, the chip reveals it
  await pasteAtEnd(page, pasted, ` {{secret:${x}}}`);
  await page.locator(`[data-outline-block="${rest}"] [data-outline-text]`).click({ force: true });
  const stored = await waitFor(async () => {
    const id = refOf(await contentOf(admin, target.id, pasted));
    return id && id !== x ? id : null;
  }, 10000);
  check(!!stored, 'The pasted bullet points to a copy of the value in its own note', await contentOf(admin, target.id, pasted));
  check(await reveals(page, pasted, value), 'The chip of the pasted bullet reveals the value');
  const viaOther = await fetch(`${BASE}/api/v1/documents/${target.id}/secrets/${x}`, { headers: { Authorization: `Bearer ${admin}` } });
  check(viaOther.status === 404, 'The note does not reveal the value of the note of origin', viaOther.status);

  // 2. Undo and redo of the paste, although the server changed the reference
  await page.locator(`[data-outline-block="${rest}"] [data-outline-text]`).click({ force: true });
  await page.keyboard.press('Control+z');
  const undone = await waitFor(async () => (await contentOf(admin, target.id, pasted)) === 'Ziel', 10000);
  check(!!undone, 'Ctrl+Z takes the pasted value out again', await contentOf(admin, target.id, pasted));
  await page.keyboard.press('Control+Shift+z');
  const redone = await waitFor(async () => refOf(await contentOf(admin, target.id, pasted)) === stored, 10000);
  check(!!redone, 'Redo brings the copy back', await contentOf(admin, target.id, pasted));

  // 3. Pasted offline: sent once the connection is back, then it gets the copy the note has
  await goOffline(ctx, page);
  await pasteAtEnd(page, offline, ` {{secret:${x}}}`);
  await page.locator(`[data-outline-block="${rest}"] [data-outline-text]`).click({ force: true });
  await sleep(1500);
  check((await contentOf(admin, target.id, offline)) === 'Offline-Ziel', 'Offline: the paste is not on the server yet');
  await goOnline(ctx, page);
  const offlineRef = await waitFor(async () => refOf(await contentOf(admin, target.id, offline)), 15000);
  check(offlineRef === stored, 'Back online, the paste gets the copy the note already has', await contentOf(admin, target.id, offline));
  await waitFor(() => chip(page, offline).count(), 5000);
  check(await reveals(page, offline, value), 'The chip of the bullet pasted offline reveals the value');

  await browser.close();
  for (const engine of [chromium, firefox]) await copySeveral(engine, admin);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
