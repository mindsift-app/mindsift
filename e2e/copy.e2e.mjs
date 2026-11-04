// Selection over several bullets with the mouse and Ctrl+A, copied with Ctrl+C as Markdown and deleted with
// Backspace, in Chromium and Firefox. Covers both directions, different start points in the row (text, empty
// space, the action bubble on the right), callouts at the top and the bottom, an empty indented last bullet
// and a drag past the first/last bullet. Needs a server in demo mode (account admin/admin); see e2e/README.md.
import { chromium, firefox } from 'playwright';

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

// Notes to test with and the Markdown of the whole note
const NOTES = {
  'Callout oben': {
    blocks: [['callout', 'Ein Hinweis oben', 0], ['h2', 'Überschrift', 0], ['bullet', 'Erster Punkt mit **fett**', 0], ['bullet', 'Kind', 1], ['todo', 'Aufgabe', 0]],
    markdown: '> Ein Hinweis oben\n\n## Überschrift\n\nErster Punkt mit **fett**\n- Kind\n\n- [ ] Aufgabe',
  },
  'Callout unten, leerer eingerückter Bullet am Ende': {
    blocks: [['bullet', 'Erster Punkt', 0], ['bullet', 'Kind', 1], ['callout', 'Ein Hinweis unten', 0], ['bullet', 'Letzter', 0], ['bullet', '', 1]],
    markdown: 'Erster Punkt\n- Kind\n\n> Ein Hinweis unten\n\nLetzter\n-',
  },
};

async function openNote(browser, token, title) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), token);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-outline-block]').length > 3, null, { timeout: 10000 });
  // What Ctrl+C puts on the clipboard (the system clipboard is not readable in every engine)
  await page.evaluate(() => {
    const orig = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (type, v) {
      if (type === 'text/plain') window.__clip = v;
      return orig.call(this, type, v);
    };
  });
  return { ctx, page };
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;

  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    for (const [noteName, note] of Object.entries(NOTES)) {
      const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const title = `Kopier-Test ${engine.name()} ${stamp}`;
      await api(admin, 'POST', '/api/v1/documents', {
        title,
        blocks: note.blocks.map(([type, content, level], i) => ({ id: `cp${i}_${stamp}`, type, content, level })),
      });
      const { ctx, page } = await openNote(browser, admin, title);
      const tag = `${engine.name()}, ${noteName}`;

      const copy = async () => {
        await page.evaluate(() => (window.__clip = null));
        await page.keyboard.press('Control+c');
        await page.waitForTimeout(300);
        return page.evaluate(() => window.__clip);
      };
      const rows = await page.$$eval('[data-outline-block]', (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })
      );
      const first = rows[0];
      const last = rows[rows.length - 1];
      // The rendered text (callouts have none, there it is the text field)
      const textBox = (row) => row.locator('[data-outline-text], textarea').first().boundingBox();
      const firstText = await textBox(page.locator('[data-outline-block]').first());
      const lastText = await textBox(page.locator('[data-outline-block]').last());
      const drag = async (from, to) => {
        await page.mouse.click(1250, 880); // outside the note
        await page.waitForTimeout(150);
        await page.mouse.move(from.x, from.y);
        await page.waitForTimeout(250); // hover shows the action bubble
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 20 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      };
      const above = { x: first.x + 5, y: first.y - 40 };
      const below = { x: last.x + last.w - 5, y: last.y + last.h + 40 };
      const starts = {
        'am Textanfang': (r, t) => ({ x: t.x + 1, y: r.y + r.h / 2 }),
        'am Textende': (r, t) => ({ x: t.x + t.width + 2, y: r.y + r.h / 2 }),
        'in der Zeilenmitte': (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }),
        'auf der Knopfleiste': (r) => ({ x: r.x + r.w - 40, y: r.y + r.h / 2 }),
        'ganz rechts': (r) => ({ x: r.x + r.w - 5, y: r.y + r.h / 2 }),
        'im Leeren unter dem letzten Bullet': (r) => ({ x: r.x + r.w / 2, y: r.y + r.h + 30 }),
      };

      // Upwards from the start of the last bullet's text leaves that text out, as in a text editor
      for (const [startName, at] of Object.entries(starts).filter(([n]) => n !== 'am Textanfang')) {
        await drag(at(last, lastText), above);
        const up = await copy();
        check(up === note.markdown, `${tag}: von unten nach oben (Start ${startName}) gibt Markdown`, up);
      }
      await drag(starts['am Textanfang'](first, firstText), below);
      const down = await copy();
      check(down === note.markdown, `${tag}: von oben nach unten gibt Markdown`, down);

      // Ctrl+A twice, then a new drag right away (the selected text must not be dragged)
      await page.locator('[data-outline-block]').nth(1).locator('textarea, [data-outline-text]').first().click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(300);
      const all = await copy();
      check(all === note.markdown, `${tag}: zweimal Strg+A gibt Markdown`, all);
      const calloutMarked = await page.evaluate(() => {
        const row = [...document.querySelectorAll('[data-outline-block]')].find((r) => r.querySelector('.border-l-2.border-accent'));
        return !!row && /accent/.test(row.className);
      });
      check(calloutMarked, `${tag}: zweimal Strg+A markiert auch den Callout`);
      await drag(starts['am Textanfang'](first, firstText), below);
      const again = await copy();
      check(again === note.markdown, `${tag}: neues Ziehen direkt nach Strg+A gibt Markdown`, again);

      // The browser's own selection over several bullets is copied as Markdown, too
      const native = await page.evaluate(() => {
        const spans = document.querySelectorAll('[data-outline-text]');
        const s = document.getSelection();
        s.removeAllRanges();
        const r = document.createRange();
        r.setStartBefore(document.querySelector('[data-outline-block]'));
        r.setEndAfter(spans[spans.length - 1]);
        s.addRange(r);
        window.__clip = null;
        document.execCommand('copy');
        return window.__clip;
      });
      check(!!native && !native.includes('\n\n\n') && native.startsWith(note.markdown.split('\n')[0]), `${tag}: Browser-Markierung wird als Markdown kopiert`, native);

      // A click outside the note ends the selection: Ctrl+C then copies nothing of it
      await drag(starts['am Textanfang'](last, lastText), above);
      await page.mouse.click(1250, 880);
      const afterOutside = await copy();
      check(afterOutside !== note.markdown, `${tag}: Klick außerhalb hebt die Markierung auf`, afterOutside);

      // Delete everything from the bottom up, started in the empty space below the last bullet
      await drag(starts['im Leeren unter dem letzten Bullet'](last), above);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(800);
      const left = await page.$$eval('[data-outline-block] textarea', (els) => els.map((e) => e.value));
      check(left.length === 1 && left[0] === '', `${tag}: Rücktaste löscht die ganze Markierung`, left);

      await ctx.close();
    }
    await browser.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
