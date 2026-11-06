// Offline work in notes with real browsers: opening a note without connection, changes in a note that was
// left offline, a conflict with someone editing the same bullet live, and unsent changes surviving a
// browser restart. Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const serverBlocks = async (token, docId) => {
  const snap = await api(token, 'GET', `/api/v1/docs/${docId}/snapshot`);
  return snap.blocks.filter((b) => !b.deleted);
};
const serverTexts = async (token, docId) => (await serverBlocks(token, docId)).map((b) => b.content);

async function newNote(token, title, bullets) {
  return api(token, 'POST', '/api/v1/documents', {
    title,
    blocks: bullets.map((content, i) => ({ id: `off_${Date.now()}_${i}`, type: 'bullet', content, level: 0 })),
  });
}

async function setup(ctx, token) {
  await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  return page;
}

async function openNote(page, title, firstBullet) {
  await page.getByRole('button', { name: /Workspace/ }).first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.getByText(firstBullet, { exact: true }).first().waitFor({ timeout: 10000 });
}

async function goOffline(ctx, page) {
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}

async function goOnline(ctx, page) {
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

async function typeAtEnd(page, text, extra) {
  await page.getByText(text, { exact: true }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(extra);
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const user = (await api(null, 'POST', '/api/v1/auth/login', { login: 'user', password: 'user' })).token;
  const dir = await api(admin, 'GET', '/api/v1/users/directory');
  const userId = dir.find((u) => u.username === 'user' || u.email?.startsWith('user')).id;
  const stamp = Date.now();
  const browser = await chromium.launch();

  // 1. A note whose REST answer is not cached opens offline from the stored copy and stays editable;
  //    the change is sent after the note was left, once the connection is back
  {
    const first = await newNote(admin, `Offline A ${stamp}`, ['Punkt in A']);
    await newNote(admin, `Offline B ${stamp}`, ['Punkt in B']);
    await newNote(admin, `Offline nie ${stamp}`, ['Nie geöffnet']);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const page = await setup(ctx, admin);
    await page.goto(BASE);
    await openNote(page, `Offline A ${stamp}`, 'Punkt in A');
    await sleep(1500);
    await openNote(page, `Offline B ${stamp}`, 'Punkt in B');
    await page.evaluate((id) => new Promise((res) => {
      const r = indexedDB.open('mindsift-offline', 1);
      r.onsuccess = () => {
        const tx = r.result.transaction('responses', 'readwrite');
        tx.objectStore('responses').openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return;
          if (String(c.key).endsWith('/documents/' + id)) c.delete();
          c.continue();
        };
        tx.oncomplete = res;
      };
    }), first.id);
    await goOffline(ctx, page);
    await page.getByText(`Offline A ${stamp}`, { exact: true }).first().click();
    await sleep(2000);
    const body = await page.locator('body').innerText();
    check(body.includes('Punkt in A') && !body.includes('Keine Verbindung zum Server'), 'Offline: the note opens from the stored copy');
    await typeAtEnd(page, 'Punkt in A', ' offline');
    await sleep(800);
    await page.getByText(`Offline nie ${stamp}`, { exact: true }).first().click();
    const hint = await waitFor(async () => (await page.locator('body').innerText()).includes('noch nicht offline verfügbar'), 4000);
    check(!!hint, 'A note never opened on this device says so');
    check(!(await serverTexts(admin, first.id)).includes('Punkt in A offline'), 'Offline: the change is not on the server yet');
    await goOnline(ctx, page);
    const sent = await waitFor(async () => (await serverTexts(admin, first.id)).includes('Punkt in A offline'), 10000);
    check(!!sent, 'Back online, the change of the note left offline is sent');
    await ctx.close();
  }

  // 2. Conflict: the owner edits a bullet offline while the editor changes the same bullet live
  {
    const title = `Offline Konflikt ${stamp}`;
    const doc = await newNote(admin, title, ['Gemeinsamer Punkt', 'Zweiter Punkt']);
    await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId, permission: 'write' });
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const A = await setup(ctxA, admin);
    const B = await setup(ctxB, user);
    await A.goto(BASE);
    await B.goto(BASE);
    await openNote(A, title, 'Gemeinsamer Punkt');
    await openNote(B, title, 'Gemeinsamer Punkt');
    await sleep(1000);
    await goOffline(ctxA, A);
    await typeAtEnd(A, 'Gemeinsamer Punkt', ' – A offline');
    await A.getByText('Zweiter Punkt', { exact: true }).first().click(); // leaves the bullet, like a person would
    await typeAtEnd(B, 'Gemeinsamer Punkt', ' – B live');
    const live = await waitFor(async () => (await serverTexts(admin, doc.id)).includes('Gemeinsamer Punkt – B live'), 6000);
    check(!!live, "The editor's live change is on the server");
    await B.getByText('Zweiter Punkt', { exact: true }).first().click();
    await sleep(500);
    await goOnline(ctxA, A);
    const both = await waitFor(async () => {
      const t = await serverTexts(admin, doc.id);
      return t.includes('Gemeinsamer Punkt – B live') && t.includes('Gemeinsamer Punkt – A offline') ? t : null;
    }, 12000);
    check(!!both, `Nothing is lost, both versions are on the server: ${JSON.stringify(both || (await serverTexts(admin, doc.id)))}`);
    const blocks = await serverBlocks(admin, doc.id);
    const copy = blocks.find((b) => b.props?.conflictOf);
    check(!!copy && copy.content === 'Gemeinsamer Punkt – A offline', 'The offline text becomes the conflict copy, the live text stays');
    const markedA = await waitFor(async () => (await A.getByText(/Version von/).count()) > 0, 8000);
    const markedB = await waitFor(async () => (await B.getByText(/Version von/).count()) > 0, 8000);
    check(!!markedA && !!markedB, 'Both browsers show the conflict copy marked');
    if (process.env.SHOT_DIR) await A.screenshot({ path: `${process.env.SHOT_DIR}/offline-conflict.png` });
    await ctxA.close();
    await ctxB.close();
  }

  // 4. Unsent text is counted in the notice at the bottom, which explains where it is kept; signing out asks
  //    first and then deletes the stored notes (own session: signing out ends it on the server)
  {
    const title = `Offline Abmelden ${stamp}`;
    await newNote(admin, title, ['Noch nicht gesendet']);
    const session = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const page = await setup(ctx, session);
    await page.goto(BASE);
    await openNote(page, title, 'Noch nicht gesendet');
    await sleep(1000);
    await goOffline(ctx, page);
    await typeAtEnd(page, 'Noch nicht gesendet', ' – offline');
    const notice = await waitFor(async () => (await page.locator('body').innerText()).includes('Text in 1 Notiz wartet auf Verbindung'), 4000);
    check(!!notice, 'The notice at the bottom counts the note with unsent text');
    await page.getByText('Text in 1 Notiz wartet auf Verbindung').click();
    check((await page.getByText(/liegt nur in diesem Browser/).count()) > 0, 'Tapping the notice explains where unsent changes are kept');
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/offline-notice.png` });
    const logout = async () => {
      const item = page.getByRole('button', { name: 'Abmelden' }).first();
      if (!(await item.isVisible())) await page.getByRole('button', { name: /Admin/ }).first().click();
      await item.click();
    };
    await logout();
    const asked = await waitFor(async () => (await page.getByText(/noch nicht gesendet und liegt nur in diesem Browser/).count()) > 0, 3000);
    check(!!asked, 'Signing out with unsent changes asks first');
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/offline-logout.png` });
    await page.keyboard.press('Escape');
    await sleep(500);
    const stored = () => page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('mindsift-sync', 1);
      r.onsuccess = () => {
        const q = r.result.transaction('docs', 'readonly').objectStore('docs').count();
        q.onsuccess = () => res(q.result);
      };
    }));
    check((await stored()) > 0 && (await page.getByText('Noch nicht gesendet – offline').count()) > 0, 'Cancelled: still signed in, the text is kept');
    await logout();
    await page.getByText(/noch nicht gesendet und liegt nur in diesem Browser/).waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: 'Abmelden' }).last().click();
    const cleared = await waitFor(async () => (await stored()) === 0, 5000);
    check(cleared !== null, 'Signed out: the stored notes are deleted from the browser');
    await ctx.close();
  }

  await browser.close();

  // 3. Unsent changes survive closing the browser: typed offline, browser closed, reopened offline (still
  //    there and shown), then reopened online without opening the note (sent at app start)
  {
    const title = `Offline Neustart ${stamp}`;
    const doc = await newNote(admin, title, ['Vor dem Flug']);
    const profile = mkdtempSync(join(tmpdir(), 'mindsift-offline-'));
    try {
      let ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      let page = await setup(ctx, admin);
      await page.goto(BASE);
      await openNote(page, title, 'Vor dem Flug');
      await sleep(1500); // the service worker caches the app for the offline start
      await goOffline(ctx, page);
      await typeAtEnd(page, 'Vor dem Flug', ' – im Flugzeug geschrieben');
      await sleep(1000);
      await ctx.close(); // laptop shut down

      ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE', offline: true });
      page = await setup(ctx, admin);
      await page.goto(BASE).catch(() => {});
      await openNote(page, title, 'Vor dem Flug – im Flugzeug geschrieben').catch(() => {});
      const shown = (await page.locator('body').innerText().catch(() => '')).includes('Vor dem Flug – im Flugzeug geschrieben');
      check(shown, 'Restarted offline: the unsent text is still there');
      check(!(await serverTexts(admin, doc.id)).includes('Vor dem Flug – im Flugzeug geschrieben'), 'Not on the server while offline');
      await ctx.close();

      ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      page = await setup(ctx, admin);
      await page.goto(BASE);
      const sent = await waitFor(async () => (await serverTexts(admin, doc.id)).includes('Vor dem Flug – im Flugzeug geschrieben'), 10000);
      check(!!sent, 'Restarted online: sent at app start without opening the note');
      await ctx.close();
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }

  console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
