// A click into the text of a bullet without the cursor puts the cursor where it was clicked (desktop, Chromium,
// Firefox and WebKit): in the middle of a short bullet, behind rendered markdown, on the second line of a
// wrapped bullet and in a bullet far down a long note (rows out of view are skipped by the browser,
// content-visibility in index.css; WebKit's hit test then stops at the row instead of the text); the same for
// table cells (right after opening, also right after a page load of the note's address, between cells and
// bullets, far down). Real mouse
// clicks; the cursor is read from the bullet's text field. Needs a server in demo mode (account admin/admin);
// see e2e/README.md.
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
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

async function removeNotes(token, ids) {
  for (const id of ids) {
    await api(token, 'DELETE', `/api/v1/documents/${id}`).catch(() => {});
    await api(token, 'DELETE', `/api/v1/documents/${id}/permanent`).catch(() => {});
  }
}

// Cells row by row: Artikel, Menge, Brot und Butter, **zwei** Stück
const TABLE = '| Artikel | Menge |\n| --- | --- |\n| Brot und Butter | **zwei** Stück |';

const LONG =
  'Ein langer Punkt, der über mehrere Zeilen umbricht, damit der Klick auf die zweite Zeile geprüft wird. ' +
  'Hier steht noch mehr Text, der die Zeile füllt und weiter umbricht, bis die Notiz breit genug belegt ist. ' +
  'Und noch ein Satz für die dritte Zeile, falls das Fenster sehr breit ist und alles andere auf zwei passt.';

// Clicks with the mouse into the formatted text of cell n (row by row) of the table with the id, between rendered
// characters at-1 and at; returns where the cursor is then and whether it is in that cell.
async function clickCell(page, id, n, at, scroll = true) {
  if (scroll) {
    await page.locator(`[data-outline-block="${id}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
  }
  const p = await page.evaluate(
    ({ id, n, at }) => {
      const view = document.querySelectorAll(`[data-outline-block="${id}"] .nt-text`)[n];
      const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
      const chars = [];
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        for (let i = 0; i < t.textContent.length; i++) chars.push([t, i]);
      }
      const range = document.createRange();
      range.setStart(chars[at - 1][0], chars[at - 1][1]);
      range.setEnd(chars[at - 1][0], chars[at - 1][1] + 1);
      const r = range.getClientRects()[0];
      return { x: r.right - 1, y: r.top + r.height / 2 };
    },
    { id, n, at }
  );
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
  return page.evaluate(
    ({ id, n }) => {
      const ta = document.querySelectorAll(`[data-outline-block="${id}"] textarea[data-table-cell]`)[n];
      const a = document.activeElement;
      return { inCell: a === ta, start: a?.selectionStart, end: a?.selectionEnd, value: a?.value };
    },
    { id, n }
  );
}

// Clicks with the mouse into the rendered text of the bullet with the id, between rendered characters at-1 and at
// (at: index in the rendered text, or 'secondLine': the middle of the text's second line); returns where the
// cursor is then. scroll: brings the bullet into view first.
async function clickAt(page, id, at, scroll = true) {
  if (scroll) {
    await page.locator(`[data-outline-block="${id}"]`).scrollIntoViewIfNeeded();
    // Rows scrolled into view get laid out on the next frames
    await page.waitForTimeout(200);
  }
  const p = await page.evaluate(
    ({ id, at }) => {
      const span = document.querySelector(`[data-outline-block="${id}"] [data-outline-text]`);
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const chars = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let i = 0; i < n.textContent.length; i++) chars.push([n, i]);
      }
      const rectOf = (k) => {
        const range = document.createRange();
        range.setStart(chars[k][0], chars[k][1]);
        range.setEnd(chars[k][0], chars[k][1] + 1);
        return range.getClientRects()[0];
      };
      let k = at;
      if (at === 'secondLine') {
        // The middle character of the second line box
        const top0 = rectOf(0).top;
        const line2 = [];
        for (let i = 0; i < chars.length; i++) {
          const r = rectOf(i);
          if (!r) continue;
          if (r.top > top0 + 4 && (!line2.length || Math.abs(r.top - rectOf(line2[0]).top) < 4)) line2.push(i);
        }
        k = line2[Math.floor(line2.length / 2)];
        // Not between a space and a word
        while (chars[k - 1][0].textContent[chars[k - 1][1]] === ' ') k++;
      }
      const r = rectOf(k - 1);
      return { x: r.right - 1, y: r.top + r.height / 2, k, rendered: span.textContent };
    },
    { id, at }
  );
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(
    (id) => document.activeElement?.closest?.(`[data-outline-block="${id}"]`) && document.activeElement.tagName === 'TEXTAREA',
    id,
    { timeout: 5000 }
  );
  const caret = await page.evaluate(() => ({ start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }));
  return { ...caret, k: p.k, rendered: p.rendered };
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const created = [];
  try {
    const engines = [chromium, firefox, webkit].filter((e) => !process.env.ENGINES || process.env.ENGINES.split(',').includes(e.name()));
    for (const engine of engines) {
      const browser = await engine.launch();
      const tag = engine.name();
      const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const title = `Cursor-Klick ${tag} ${stamp}`;
      const blocks = [
        { id: `ck0_${stamp}`, type: 'text', content: 'Hallo schöne Welt', level: 0 },
        { id: `ck1_${stamp}`, type: 'text', content: 'Mit **fettem** Wort und Rest', level: 0 },
        { id: `ck2_${stamp}`, type: 'text', content: LONG, level: 0 },
        { id: `ckt_${stamp}`, type: 'table', content: TABLE, level: 0 },
      ];
      for (let i = 0; i < 150; i++) blocks.push({ id: `ckf${i}_${stamp}`, type: 'text', content: `Füllpunkt Nummer ${i}`, level: 0 });
      blocks.push({ id: `ckend_${stamp}`, type: 'text', content: 'Weit unten in der Notiz', level: 0 });
      blocks.push({ id: `ckwrap_${stamp}`, type: 'text', content: LONG, level: 1 });
      blocks.push({ id: `cktend_${stamp}`, type: 'table', content: TABLE, level: 0 });
      const doc = await api(admin, 'POST', '/api/v1/documents', { title, blocks });
      created.push(doc.id);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      await ctx.addInitScript((t) => {
        localStorage.setItem('mindsift_jwt_token', t);
        localStorage.setItem('mindsift:tour-offered', '1');
      }, admin);
      const page = await ctx.newPage();
      const openNote = async () => {
        await page.goto(BASE);
        await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
        await page.getByText(title, { exact: true }).first().click();
        await page.waitForFunction((n) => document.querySelectorAll('[data-outline-block]').length === n, blocks.length, { timeout: 10000 });
      };
      await openNote();

      // Middle of a short bullet right after opening the note: behind "Hallo"
      let c = await clickAt(page, `ck0_${stamp}`, 5, false);
      check(c.start === 5 && c.end === 5, `${tag}: Klick in die Mitte eines Punkts setzt den Cursor dorthin`, c);

      // A bullet the cursor just left: into its text, and its buttons are hit (WebKit took it for skipped)
      c = await clickAt(page, `ck1_${stamp}`, 3, false);
      check(c.start === 3, `${tag}: Klick in den nächsten Punkt`, c);
      await page.waitForTimeout(500);
      const hit = await page.evaluate((id) => {
        const row = document.querySelector(`[data-outline-block="${id}"]`);
        const btn = row.querySelector('button');
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { button: !!el && btn.contains(el), got: el?.tagName };
      }, `ck0_${stamp}`);
      check(hit.button, `${tag}: der Knopf eines eben verlassenen Punkts nimmt Klicks an`, hit);
      c = await clickAt(page, `ck0_${stamp}`, 8, false);
      check(c.start === 8, `${tag}: Klick in einen eben verlassenen Punkt setzt den Cursor an die Stelle`, c);

      // Behind rendered markdown: "Mit fettem Wort" (rendered index 15) is raw index 19
      c = await clickAt(page, `ck1_${stamp}`, 15);
      check(c.start === 19, `${tag}: Klick hinter Markdown landet an der richtigen Stelle im Rohtext`, c);

      // Second line of a wrapped bullet
      c = await clickAt(page, `ck2_${stamp}`, 'secondLine');
      check(c.start === c.k && c.k > 20, `${tag}: Klick in die zweite Zeile eines umbrochenen Punkts`, c);

      // Far down the long note
      c = await clickAt(page, `ckend_${stamp}`, 4);
      check(c.start === 4, `${tag}: Klick in einen Punkt weit unten in einer langen Notiz`, c);
      c = await clickAt(page, `ckwrap_${stamp}`, 'secondLine');
      check(c.start === c.k && c.k > 20, `${tag}: Klick in die zweite Zeile eines eingerückten Punkts weit unten`, c);

      // Back up: a row that was skipped while out of view
      c = await clickAt(page, `ck0_${stamp}`, 12);
      check(c.start === 12, `${tag}: Klick nach dem Zurückscrollen`, c);

      // Long notes stay fast: the far rows are skipped, also the one with the cursor before
      const rows = await page.evaluate(() => {
        const all = document.querySelectorAll('[data-outline-block]');
        return {
          total: all.length,
          near: document.querySelectorAll('[data-outline-block][data-outline-near]').length,
          last: getComputedStyle(all[all.length - 1]).contentVisibility,
        };
      });
      check(rows.near >= 1 && rows.near < rows.total / 2 && rows.last === 'auto', `${tag}: weit entfernte Punkte werden übersprungen`, rows);

      // Table cells, in a freshly opened note: a cell right after opening, another cell of the same table, a cell
      // right after leaving a bullet, a bullet right after leaving a cell, cells far down
      await openNote();
      const cellAt = async (id, n, at, scroll, want, msg) => {
        const got = await clickCell(page, id, n, at, scroll);
        check(got.inCell && got.start === want && got.end === want, `${tag}: ${msg}`, got);
      };
      await cellAt(`ckt_${stamp}`, 2, 4, false, 4, 'Klick in eine Tabellenzelle gleich nach dem Öffnen');
      // Behind "zwei St" of the rendered "zwei Stück": raw "**zwei** St"
      await cellAt(`ckt_${stamp}`, 3, 7, false, 11, 'Klick in eine andere Zelle hinter Markdown');
      c = await clickAt(page, `ck0_${stamp}`, 5, false);
      await page.waitForTimeout(500);
      await cellAt(`ckt_${stamp}`, 2, 9, false, 9, 'Klick in eine Zelle gleich nach dem Verlassen eines Punkts');
      await page.waitForTimeout(500);
      c = await clickAt(page, `ck1_${stamp}`, 3, false);
      check(c.start === 3, `${tag}: Klick in einen Punkt gleich nach dem Verlassen einer Zelle`, c);
      await page.waitForTimeout(500);
      await cellAt(`ckt_${stamp}`, 1, 3, false, 3, 'Klick zurück in die eben verlassene Tabelle');
      await cellAt(`cktend_${stamp}`, 1, 3, true, 3, 'Klick in eine Zelle weit unten in einer langen Notiz');
      c = await clickAt(page, `ckend_${stamp}`, 4);
      await page.waitForTimeout(500);
      await cellAt(`cktend_${stamp}`, 2, 9, false, 9, 'Klick in eine Zelle weit unten nach dem Verlassen eines Punkts');

      // A fresh page load of the note's address and a click at once: the rows on screen are laid out before the
      // first IntersectionObserver report (WebKit took most of a second for it; until then a table row measured
      // one line and a click landed on the wrong bullet)
      // (back at the top first: the note opens where it was left)
      await clickAt(page, `ck0_${stamp}`, 2);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      await page.goto(`${BASE}/?note=${doc.id}`);
      await page.waitForFunction((n) => document.querySelectorAll('[data-outline-block]').length === n, blocks.length, { timeout: 10000 });
      const early = await page.evaluate((id) => {
        const row = document.querySelector(`[data-outline-block="${id}"]`);
        return { near: row.hasAttribute('data-outline-near'), visibility: getComputedStyle(row).contentVisibility, height: row.getBoundingClientRect().height };
      }, `ckt_${stamp}`);
      check(early.near && early.height > 40, `${tag}: Tabelle gleich nach dem Laden der Seite voll ausgemessen`, early);
      await cellAt(`ckt_${stamp}`, 2, 4, false, 4, 'Klick in eine Tabellenzelle gleich nach dem Laden der Seite');
      await page.keyboard.press('Escape');

      // A selection dragged from one bullet into the next ends where the mouse is let go
      await page.keyboard.press('Escape');
      await page.locator(`[data-outline-block="ck0_${stamp}"]`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const pointOf = (id, at) =>
        page.evaluate(
          ({ id, at }) => {
            const span = document.querySelector(`[data-outline-block="${id}"] [data-outline-text]`);
            const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
            let n = walker.nextNode();
            let k = at - 1;
            while (n && k >= n.textContent.length) {
              k -= n.textContent.length;
              n = walker.nextNode();
            }
            const range = document.createRange();
            range.setStart(n, k);
            range.setEnd(n, k + 1);
            const r = range.getClientRects()[0];
            return { x: r.right - 1, y: r.top + r.height / 2 };
          },
          { id, at }
        );
      const from = await pointOf(`ck0_${stamp}`, 3);
      const to = await pointOf(`ck1_${stamp}`, 8);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const end = await page.evaluate((id) => {
        const span = document.querySelector(`[data-outline-block="${id}"] [data-outline-text]`);
        if (typeof CSS === 'undefined' || !CSS.highlights) return 'no highlights';
        for (const h of CSS.highlights.values()) {
          for (const r of h) {
            if (!r.intersectsNode(span)) continue;
            const upto = document.createRange();
            upto.setStart(span, 0);
            upto.setEnd(r.endContainer, r.endOffset);
            return upto.toString().length;
          }
        }
        return null;
      }, `ck1_${stamp}`);
      check(end === 8 || end === 'no highlights', `${tag}: eine Auswahl über zwei Punkte endet, wo die Maus losgelassen wird`, end);


      await browser.close();
    }
  } finally {
    await removeNotes(admin, created);
  }
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll caret click checks passed');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
