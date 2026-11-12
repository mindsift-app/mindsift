// Offline work in notes with real browsers: opening a note without connection, changes in a note that was
// left offline, a conflict with someone editing the same bullet live, unsent changes surviving a browser
// restart, the note tree after starting offline, and merging with someone who worked on the note meanwhile.
// Needs a server in demo mode (accounts admin/admin and user/user); see e2e/README.md.
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
  // In the order of the note (all test notes are flat)
  const byOrder = (a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.id < b.id ? -1 : 1);
  return snap.blocks.filter((b) => !b.deleted).sort(byOrder);
};
const serverTexts = async (token, docId) => (await serverBlocks(token, docId)).map((b) => b.content);

async function newNote(token, title, bullets) {
  return api(token, 'POST', '/api/v1/documents', {
    title,
    blocks: bullets.map((content, i) => ({ id: `off_${Date.now()}_${i}`, type: 'bullet', content, level: 0 })),
  });
}

async function setup(ctx, token) {
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1'); // the demo asks every browser about the tour once
  }, token);
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

  // 5. The note tree offline: after starting the browser without connection all folders and notes are in the
  //    tree; the notes opened on this device open with their text, one never opened here says so
  {
    const folder = `Offline Baum ${stamp}`;
    const sub = `Unterordner ${stamp}`;
    await api(admin, 'POST', '/api/v1/folders', { path: folder });
    await api(admin, 'POST', '/api/v1/folders', { path: `${folder}/${sub}` });
    const notes = [
      { title: `Baum oben ${stamp}`, path: '', bullet: 'Text oben' },
      { title: `Baum Ordner ${stamp}`, path: folder, bullet: 'Text im Ordner' },
      { title: `Baum tief ${stamp}`, path: `${folder}/${sub}`, bullet: 'Text im Unterordner' },
      { title: `Baum nie ${stamp}`, path: `${folder}/${sub}`, bullet: 'Nie hier geöffnet' },
    ];
    for (const n of notes) {
      await api(admin, 'POST', '/api/v1/documents', {
        title: n.title,
        folderPath: n.path,
        blocks: [{ id: `off_${Date.now()}_${n.bullet.length}`, type: 'bullet', content: n.bullet, level: 0 }],
      });
    }
    // Opens the folders on the way (the tree remembers them), then the note
    const showInTree = async (page, n) => {
      for (const name of [folder, sub].slice(0, n.path ? n.path.split('/').length : 0)) {
        if ((await page.getByText(n.title, { exact: true }).count()) === 0) {
          await page.getByRole('button', { name, exact: true }).first().click();
          await sleep(300);
        }
      }
      return (await page.getByText(n.title, { exact: true }).count()) > 0;
    };
    const profile = mkdtempSync(join(tmpdir(), 'mindsift-offline-'));
    try {
      let ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      let page = await setup(ctx, admin);
      await page.goto(BASE);
      await page.getByRole('button', { name: /Workspace/ }).first().click();
      for (const n of notes.slice(0, 3)) {
        await showInTree(page, n);
        await page.getByText(n.title, { exact: true }).first().click();
        await page.getByText(n.bullet, { exact: true }).first().waitFor({ timeout: 10000 });
        await sleep(800);
      }
      await sleep(1500);
      await ctx.close();

      ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE', offline: true });
      page = await setup(ctx, admin);
      await page.goto(BASE).catch(() => {});
      await page.getByRole('button', { name: /Workspace/ }).first().click({ timeout: 10000 }).catch(() => {});
      await waitFor(async () => (await page.getByText(notes[0].title, { exact: true }).count()) > 0, 8000);
      const inTree = [];
      for (const n of notes) inTree.push(await showInTree(page, n).catch(() => false));
      check(inTree.every(Boolean), `Started offline: every note is in the tree, also in folders and subfolders (${inTree})`);
      for (const n of notes.slice(0, 3)) {
        await page.getByText(n.title, { exact: true }).first().click().catch(() => {});
        const opened = await waitFor(async () => (await page.getByText(n.bullet, { exact: true }).count()) > 0, 5000);
        check(!!opened, `Started offline: "${n.title.replace(` ${stamp}`, '')}", opened here before, opens with its text`);
      }
      await page.getByText(notes[3].title, { exact: true }).first().click().catch(() => {});
      const hint = await waitFor(async () => (await page.locator('body').innerText()).includes('noch nicht offline verfügbar'), 4000);
      check(!!hint && (await page.getByText(notes[3].bullet, { exact: true }).count()) === 0, 'Started offline: a note never opened here says it is not available offline');
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/offline-tree.png` });
      await ctx.close();
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }

  // 6. Someone else works on the note while I am offline: they change another bullet, add one and delete the
  //    bullet I am typing in. My browser is restarted offline in between (the text is still there). Back
  //    online everything is merged: no conflict copy, my text brings the deleted bullet back, and both
  //    browsers show what the server has
  {
    const title = `Offline Zusammenführen ${stamp}`;
    const doc = await newNote(admin, title, ['Eins', 'Zwei', 'Drei', 'Vier']);
    await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId, permission: 'write' });
    const other = await chromium.launch();
    const ctxB = await other.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const B = await setup(ctxB, user);
    const profile = mkdtempSync(join(tmpdir(), 'mindsift-offline-'));
    try {
      let ctxA = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      let A = await setup(ctxA, admin);
      await A.goto(BASE);
      await B.goto(BASE);
      await openNote(A, title, 'Eins');
      await openNote(B, title, 'Eins');
      await sleep(1500);

      await goOffline(ctxA, A);
      await typeAtEnd(A, 'Zwei', ' – A offline');
      await A.keyboard.press('Enter');
      await A.keyboard.type('Neu von A');
      await typeAtEnd(A, 'Drei', ' – A offline');
      await A.getByText('Vier', { exact: true }).first().click();
      await sleep(1000);

      await typeAtEnd(B, 'Eins', ' – B');
      await typeAtEnd(B, 'Vier', '');
      await B.keyboard.press('Enter');
      await B.keyboard.type('Neu von B');
      await B.getByText('Eins – B', { exact: true }).first().click();
      const row = B.getByText('Drei', { exact: true }).first().locator('xpath=ancestor::div[.//button[@title="Block löschen"]][1]');
      await row.hover();
      await row.getByTitle('Block löschen').first().click({ force: true });
      // Deleting puts the cursor into the bullet above (Zwei), which holds it like typing would; leave it and
      // let its 7 s of grace run out, otherwise my offline text for Zwei rightly becomes a conflict copy
      await B.getByText('Neu von B', { exact: true }).first().click();
      const othersDone = await waitFor(async () => {
        const t = await serverTexts(admin, doc.id);
        return t.includes('Eins – B') && t.includes('Neu von B') && !t.includes('Drei') ? t : null;
      }, 8000);
      check(!!othersDone, `The other person's changes are on the server: ${JSON.stringify(othersDone || (await serverTexts(admin, doc.id)))}`);
      check(!(await serverTexts(admin, doc.id)).some((t) => t.includes('A offline')), 'Nothing of the offline changes is on the server yet');

      await sleep(9000);
      await ctxA.close(); // laptop shut down
      ctxA = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE', offline: true });
      A = await setup(ctxA, admin);
      await A.goto(BASE).catch(() => {});
      await openNote(A, title, 'Zwei – A offline').catch(() => {});
      const kept = (await A.locator('body').innerText().catch(() => '')).match(/Zwei – A offline|Neu von A|Drei – A offline/g) || [];
      check(new Set(kept).size === 3, `Restarted offline: my three changes are still there (${[...new Set(kept)]})`);

      await goOnline(ctxA, A);
      const want = ['Eins – B', 'Zwei – A offline', 'Neu von A', 'Drei – A offline', 'Vier', 'Neu von B'];
      const merged = await waitFor(async () => {
        const t = await serverTexts(admin, doc.id);
        return want.every((w) => t.includes(w)) ? t : null;
      }, 15000);
      const final = merged || (await serverTexts(admin, doc.id));
      check(JSON.stringify(final) === JSON.stringify(want), `Back online, both sides are merged in order: ${JSON.stringify(final)}`);
      check(!(await serverBlocks(admin, doc.id)).some((b) => b.props?.conflictOf), 'Different bullets: no conflict copy');
      const shows = async (page) => {
        // The bullet with the cursor is a text field, which innerText leaves out
        const body = await page.evaluate(
          () => document.body.innerText + '\n' + [...document.querySelectorAll('textarea, input')].map((e) => e.value).join('\n')
        );
        return want.every((w) => body.includes(w)) && (await page.getByText('Drei', { exact: true }).count()) === 0;
      };
      check(!!(await waitFor(() => shows(A), 10000)), 'My browser shows the merged note');
      check(!!(await waitFor(() => shows(B), 10000)), "The other person's browser shows the merged note");
      if (process.env.SHOT_DIR) await B.screenshot({ path: `${process.env.SHOT_DIR}/offline-merge.png` });
      await ctxA.close();
    } finally {
      await other.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }

  // 7. After the very first visit the whole app works offline: the service worker loads every file of the
  //    build when it installs. Offline every file of the app that the service worker does not answer is
  //    refused (routing also switches the browser's HTTP cache off), so only what it keeps counts; then
  //    every view opens, and so do the parts that load on demand and were never opened online: the help
  //    (one chunk per language) and the emoji picker of a note (the note itself was opened online once)
  {
    const iconNote = `Offline Icon ${stamp}`;
    await newNote(admin, iconNote, ['Punkt mit Icon']);
    const profile = mkdtempSync(join(tmpdir(), 'mindsift-offline-'));
    try {
      let ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      let page = await setup(ctx, admin);
      await page.goto(BASE);
      await page.getByTitle('Benutzermenü öffnen').first().waitFor({ timeout: 10000 });
      await openNote(page, iconNote, 'Punkt mit Icon');
      await sleep(1000);
      const files = ((await (await fetch(`${BASE}/sw.js`)).text()).match(/"\/assets\/[^"]+"/g) || []).length;
      const cached = await waitFor(
        () =>
          page.evaluate(async (n) => {
            const keys = await caches.keys();
            let count = 0;
            for (const k of keys.filter((k) => k.startsWith('mindsift-assets-'))) count += (await (await caches.open(k)).keys()).length;
            return count >= n && n > 0 ? count : 0;
          }, files),
        20000
      );
      check(!!cached, `The service worker keeps every file of the build after the first visit (${cached || 0} of ${files})`);
      await ctx.close();

      ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 }, locale: 'de-DE', offline: true });
      await ctx.route('**/assets/**', (route) => route.abort());
      page = await setup(ctx, admin);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE).catch(() => {});
      const started = await waitFor(async () => (await page.getByTitle('Benutzermenü öffnen').count()) > 0, 10000);
      check(!!started, 'Started offline after one visit: the app opens signed in');
      const broken = async () => {
        const body = await page.locator('body').innerText().catch(() => '');
        return body.includes('Ansicht konnte nicht geladen werden') || body.includes('konnte nicht vollständig geladen werden');
      };
      const opened = [];
      for (const name of ['Workspace', 'Aufgaben', 'Listen', 'Triage']) {
        await page.getByRole('button', { name: new RegExp(`^${name}`) }).locator('visible=true').first().click().catch(() => {});
        await sleep(800);
        if (!(await broken())) opened.push(name);
      }
      for (const item of ['Kontoeinstellungen', 'Gruppen', 'Administration']) {
        await page.getByTitle('Benutzermenü öffnen').first().click().catch(() => {});
        await page.getByRole('button', { name: item }).first().click({ timeout: 3000 }).catch(() => {});
        await sleep(800);
        if (!(await broken())) opened.push(item);
      }
      await page.locator('[data-tour="help-entry"]').locator('visible=true').first().click().catch(() => {});
      const helpShown = await waitFor(async () => (await page.getByText('Tastaturbedienung im Notizen-Editor').count()) > 0, 5000);
      if (!(await broken()) && helpShown) opened.push('Hilfe');
      await page.keyboard.press('Control+k');
      const palette = await waitFor(async () => (await page.getByPlaceholder('Globale Suche in Notizen, Aufgaben und Listen…').count()) > 0, 3000);
      if (palette) opened.push('Suche');
      await page.keyboard.press('Escape');
      check(opened.length === 9, `Started offline: every view opens (${opened.join(', ')})`);
      await openNote(page, iconNote, 'Punkt mit Icon').catch(() => {});
      await page.getByTitle('Icon ändern').first().click().catch(() => {});
      const picker = await waitFor(async () => (await page.getByPlaceholder('Emoji suchen…').count()) > 0, 5000);
      check(!!picker, 'Started offline: the emoji picker of a note opens');
      await page.keyboard.press('Escape');
      const chunkErrors = errors.filter((e) => /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(e));
      check(chunkErrors.length === 0, `No part of the app is missing offline ${chunkErrors.join(' | ')}`);
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/offline-first-visit.png` });
      await ctx.close();
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }

  // 8. A conflict copy right under its original: I change "Zwei" offline and add a bullet under it while the
  //    other person has the cursor in "Zwei". Back online my text becomes a copy right under "Zwei" (before
  //    my new bullet); replacing waits, greyed out with the reason, while "Zwei" is held; "Keep both" keeps it
  {
    const title = `Offline Kopie ${stamp}`;
    const doc = await newNote(admin, title, ['Eins', 'Zwei', 'Drei']);
    await api(admin, 'POST', `/api/v1/documents/${doc.id}/shares`, { userId, permission: 'write' });
    const b2 = await chromium.launch();
    try {
      const ctxA = await b2.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      const ctxB = await b2.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      const A = await setup(ctxA, admin);
      const B = await setup(ctxB, user);
      await A.goto(BASE);
      await B.goto(BASE);
      await openNote(A, title, 'Zwei');
      await openNote(B, title, 'Zwei');
      await sleep(1500);
      await goOffline(ctxA, A);
      await typeAtEnd(A, 'Zwei', ' – A offline');
      await A.keyboard.press('Enter');
      await A.keyboard.type('Neu von A');
      await A.getByText('Eins', { exact: true }).first().click();
      await sleep(800);
      await B.getByText('Zwei', { exact: true }).first().click(); // holds "Zwei" from now on
      await sleep(2500);
      await goOnline(ctxA, A);
      const placed = await waitFor(async () => {
        const blocks = await serverBlocks(admin, doc.id);
        return blocks.some((b) => b.props?.conflictOf) && blocks.some((b) => b.content === 'Neu von A') ? blocks : null;
      }, 12000);
      const order = (placed || (await serverBlocks(admin, doc.id))).map((b) => (b.props?.conflictOf ? `[Kopie] ${b.content}` : b.content));
      check(
        JSON.stringify(order) === JSON.stringify(['Eins', 'Zwei', '[Kopie] Zwei – A offline', 'Neu von A', 'Drei']),
        `The conflict copy sits right under its original, before the bullet added after it: ${JSON.stringify(order)}`
      );
      const take = A.getByRole('button', { name: 'Übernehmen' }).first();
      const waits = await waitFor(async () => (await take.isDisabled()) && (await A.getByText(/bearbeitet gerade den ursprünglichen Punkt/).count()) > 0, 10000);
      check(!!waits, 'While the other person holds the original, "Übernehmen" is greyed out and a line says who holds it');
      check((await take.getAttribute('title'))?.includes('bearbeitet gerade den ursprünglichen Punkt'), 'The greyed-out button says why on hover');
      check(await A.getByRole('button', { name: 'Beide behalten' }).first().isEnabled(), '"Beide behalten" stays usable while the original is held');
      if (process.env.SHOT_DIR) await A.screenshot({ path: `${process.env.SHOT_DIR}/conflict-original-locked.png` });
      await B.getByText('Drei', { exact: true }).first().click(); // leaves "Zwei"
      const free = await waitFor(async () => !(await take.isDisabled()), 15000);
      check(!!free, 'Once the original is free, "Übernehmen" can be used');
      // The copy sticks to its original: Enter at the end of "Zwei" adds the bullet below the copy, Tab
      // indents the copy along
      await typeAtEnd(A, 'Zwei', '');
      await A.keyboard.press('Enter');
      await A.keyboard.type('Nach Enter');
      const entered = await waitFor(async () => {
        const t = (await serverBlocks(admin, doc.id)).map((b) => (b.props?.conflictOf ? '[Kopie]' : b.content));
        return t.includes('Nach Enter') ? t : null;
      }, 8000);
      check(
        JSON.stringify(entered) === JSON.stringify(['Eins', 'Zwei', '[Kopie]', 'Nach Enter', 'Neu von A', 'Drei']),
        `Enter in the original adds the new bullet below its conflict copy: ${JSON.stringify(entered)}`
      );
      await A.getByText('Zwei', { exact: true }).first().click();
      await A.keyboard.press('Home');
      await A.keyboard.press('Tab');
      const eins = (await serverBlocks(admin, doc.id)).find((b) => b.content === 'Eins');
      const indented = await waitFor(async () => {
        const blocks = await serverBlocks(admin, doc.id);
        const zwei = blocks.find((b) => b.content === 'Zwei');
        const copy = blocks.find((b) => b.props?.conflictOf);
        return zwei?.parentId === eins.id && copy?.parentId === eins.id;
      }, 8000);
      check(!!indented, 'Tab on the original indents its conflict copy along');
      await A.keyboard.press('Shift+Tab');
      await waitFor(async () => (await serverBlocks(admin, doc.id)).every((b) => !b.parentId), 8000);
      await A.getByRole('button', { name: 'Beide behalten' }).first().click();
      const kept = await waitFor(async () => {
        const blocks = await serverBlocks(admin, doc.id);
        return !blocks.some((b) => b.props?.conflictOf) ? blocks.map((b) => b.content) : null;
      }, 8000);
      check(
        JSON.stringify(kept) === JSON.stringify(['Eins', 'Zwei', 'Zwei – A offline', 'Nach Enter', 'Neu von A', 'Drei']),
        `"Beide behalten": both texts stay, the copy as a normal bullet under the original: ${JSON.stringify(kept)}`
      );
      const unmarked = await waitFor(async () => (await B.getByText(/Version von/).count()) === 0 && (await B.getByText('Zwei – A offline', { exact: true }).count()) > 0, 8000);
      check(!!unmarked, 'The other browser shows it unmarked too');
    } finally {
      await b2.close();
    }
  }

  console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
