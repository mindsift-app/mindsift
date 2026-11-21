// Text dragged in from another program (desktop, Chromium, Firefox and WebKit): dropped onto a bullet's text it
// goes in where it was dropped, several lines become bullets as when pasting, dropped below the last bullet it
// becomes a new bullet at the end. The drag is synthetic (dragenter, dragover, drop with a DataTransfer holding
// text/plain and text/html, set on the event like in paste-image.e2e.mjs); in Chromium a real drag from outside
// the page (DevTools protocol, Input.dispatchDragEvent) is checked as well, into a bullet without and with the
// cursor. A file or link dropped where nothing takes it (sidebar) is refused instead of opening in place of the
// app, while a link still drops into a text field. Needs a server in demo mode (account admin/admin); see
// e2e/README.md.
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

const serverShape = async (token, id) =>
  ((await api(token, 'GET', `/api/v1/documents/${id}`)).blocks || []).map((b) => `${b.type}:${b.content}`);

// Waits until the server holds the expected bullets (saving is debounced); expected: the list, or a test
async function waitShape(token, id, expected, timeout = 6000) {
  const ok = typeof expected === 'function' ? expected : (shape) => shape.join('|') === expected.join('|');
  const end = Date.now() + timeout;
  let shape = [];
  while (Date.now() < end) {
    shape = await serverShape(token, id);
    if (ok(shape)) return shape;
    await new Promise((r) => setTimeout(r, 250));
  }
  return shape;
}

// A synthetic drag onto a point: the rendered text of bullet `row` right after its character `after`
// (whole rendered text when it is not found), or the area below the last bullet (end). Returns whether
// dragover and drop were taken (default prevented).
async function dragText(page, { row, after, end, text, html = '' }) {
  return page.evaluate(
    ({ row, after, end, text, html }) => {
      let x;
      let y;
      if (end) {
        const rows = document.querySelectorAll('[data-outline-block]');
        const last = rows[rows.length - 1].getBoundingClientRect();
        x = last.left + 120;
        y = last.bottom + 40;
      } else {
        const span = document.querySelectorAll('[data-outline-block]')[row].querySelector('[data-outline-text]');
        const node = span.firstChild;
        const at = node.textContent.indexOf(after);
        const range = document.createRange();
        range.setStart(node, at + after.length - 1);
        range.setEnd(node, at + after.length);
        const r = range.getBoundingClientRect();
        x = r.right - 0.5;
        y = r.top + r.height / 2;
      }
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      if (html) dt.setData('text/html', html);
      const el = document.elementFromPoint(x, y);
      const fire = (type) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      fire('dragenter');
      const over = fire('dragover');
      const drop = fire('drop');
      return { over, drop, target: el.tagName };
    },
    { row, after, end, text, html }
  );
}

// A drag carrying the given types onto the element matching selector itself (not a child); whether dragover was refused
// (default prevented, drop effect none) and the drop prevented
async function dragOnto(page, selector, types) {
  return page.evaluate(
    async ({ selector, types }) => {
      const el = document.querySelector(selector);
      const rect = el.getBoundingClientRect();
      const x = rect.left + Math.min(20, rect.width / 2);
      const y = rect.top + rect.height / 2;
      const dt = new DataTransfer();
      if (types.includes('Files')) dt.items.add(new File(['x'], 'bild.png', { type: 'image/png' }));
      if (types.includes('text/uri-list')) dt.setData('text/uri-list', 'https://example.org/');
      dt.setData('text/plain', 'https://example.org/');
      const target = el;
      const fire = (type) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        target.dispatchEvent(ev);
        return ev;
      };
      const over = fire('dragover');
      const drop = fire('drop');
      return { over: over.defaultPrevented, effect: dt.dropEffect, drop: drop.defaultPrevented, target: target.tagName };
    },
    { selector, types }
  );
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
      const title = `Text-Ziehen ${tag} ${stamp}`;
      const doc = await api(admin, 'POST', '/api/v1/documents', {
        title,
        blocks: [
          { id: `dt0_${stamp}`, type: 'text', content: 'Hallo Welt', level: 0 },
          { id: `dt1_${stamp}`, type: 'text', content: 'Zweiter Punkt', level: 0 },
        ],
      });
      created.push(doc.id);
      // A folder in the sidebar for the folder checks at the end
      const folder = `Ablage ${tag} ${stamp}`;
      created.push((await api(admin, 'POST', '/api/v1/documents', { title: `Im Ordner ${stamp}`, folderPath: folder, blocks: [] })).id);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      await ctx.addInitScript((t) => {
        localStorage.setItem('mindsift_jwt_token', t);
        localStorage.setItem('mindsift:tour-offered', '1');
      }, admin);
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
      await page.getByText(title, { exact: true }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('[data-outline-block]').length === 2, null, { timeout: 10000 });

      // Onto a bullet without the cursor, right after "Hallo"
      let r = await dragText(page, { row: 0, after: 'Hallo', text: ' schöne', html: '<b> schöne</b>' });
      let shape = await waitShape(admin, doc.id, ['text:Hallo schöne Welt', 'text:Zweiter Punkt']);
      check(r.over && r.drop && shape[0] === 'text:Hallo schöne Welt', `${tag}: Text auf einen Punkt gezogen landet an der Stelle`, { r, shape });

      // Several lines: the first goes in at the point, the others become bullets below (as when pasting)
      r = await dragText(page, { row: 1, after: 'Zweiter', text: ': eins\n\nNeue Zeile\n\nNoch eine,' });
      shape = await waitShape(admin, doc.id, [
        'text:Hallo schöne Welt',
        'text:Zweiter: eins',
        'text:Neue Zeile',
        'text:Noch eine, Punkt',
      ]);
      check(
        r.drop && shape.join('|') === 'text:Hallo schöne Welt|text:Zweiter: eins|text:Neue Zeile|text:Noch eine, Punkt',
        `${tag}: mehrere gezogene Zeilen werden zu Punkten wie beim Einfügen`,
        shape
      );

      // Below the last bullet: a new bullet at the end
      r = await dragText(page, { end: true, text: 'Ganz unten' });
      shape = await waitShape(admin, doc.id, [
        'text:Hallo schöne Welt',
        'text:Zweiter: eins',
        'text:Neue Zeile',
        'text:Noch eine, Punkt',
        'text:Ganz unten',
      ]);
      check(r.drop && shape[shape.length - 1] === 'text:Ganz unten' && shape.length === 5, `${tag}: Text unter den letzten Punkt gezogen wird ein neuer Punkt`, { r, shape });

      // A real drag from outside the page (Chromium only: the DevTools protocol can start one)
      if (tag === 'chromium') {
        const cdp = await ctx.newCDPSession(page);
        const realDrag = async (x, y, text) => {
          const data = { items: [{ mimeType: 'text/plain', data: text }], dragOperationsMask: 1 };
          await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
          await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
          await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
        };
        const pointAfter = (row, after) =>
          page.evaluate(
            ({ row, after }) => {
              const rowEl = document.querySelectorAll('[data-outline-block]')[row];
              const ta = rowEl.querySelector('textarea');
              const span = rowEl.querySelector('[data-outline-text]');
              const node = span.firstChild;
              const at = node.textContent.indexOf(after);
              const range = document.createRange();
              range.setStart(node, at + after.length - 1);
              range.setEnd(node, at + after.length);
              const rr = range.getBoundingClientRect();
              return { x: rr.right - 0.5, y: rr.top + rr.height / 2, focused: document.activeElement === ta };
            },
            { row, after }
          );
        // Bullet without the cursor
        let p = await pointAfter(0, 'Hallo');
        await realDrag(p.x, p.y, ' liebe');
        shape = await waitShape(admin, doc.id, (sh) => sh[0] === 'text:Hallo liebe schöne Welt');
        check(shape[0] === 'text:Hallo liebe schöne Welt', `${tag}: echter Drag von außen in einen Punkt ohne Cursor`, shape);
        // Bullet with the cursor: the browser puts the text in itself
        const box = await page.locator('[data-outline-block]').nth(1).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + 12);
        await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 5000 });
        p = await page.evaluate(() => {
          const ta = document.activeElement;
          const r = ta.getBoundingClientRect();
          return { x: r.left + 2, y: r.top + r.height / 2 };
        });
        await realDrag(p.x, p.y, 'Ganz ');
        shape = await waitShape(admin, doc.id, (sh) => sh[1] === 'text:Ganz Zweiter: eins');
        check(shape[1] === 'text:Ganz Zweiter: eins', `${tag}: echter Drag von außen in den Punkt mit Cursor`, shape);
        await page.keyboard.press('Escape');
      }

      // A real mouse drag (Chromium, Firefox; Playwright's WebKit starts no drag from the marked text in the app):
      // text marked on the page, dragged into the bullet with the cursor; the browser puts it in itself, as the
      // note leaves that dragover alone (Chromium and WebKit drop nothing into a field below a taken dragover)
      if (tag !== 'webkit') {
        await page.evaluate(() => {
          const p = document.createElement('p');
          p.id = 'drag-source';
          p.textContent = 'Markiert';
          p.style.cssText = 'position:fixed;bottom:20px;right:40px;z-index:99999;font-size:20px;background:white;padding:4px';
          document.body.appendChild(p);
        });
        const lastRow = page.locator('[data-outline-block]').last();
        const lastBox = await lastRow.boundingBox();
        await page.mouse.click(lastBox.x + lastBox.width / 2, lastBox.y + 12);
        await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 5000 });
        await page.keyboard.press('End');
        await page.evaluate(() => {
          const range = document.createRange();
          range.selectNodeContents(document.getElementById('drag-source'));
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
        const src = await page.locator('#drag-source').boundingBox();
        const field = await page.evaluate(() => {
          const ta = document.querySelectorAll('[data-outline-block]');
          const r = ta[ta.length - 1].querySelector('textarea').getBoundingClientRect();
          return { x: r.right - 4, y: r.top + r.height / 2 };
        });
        await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
        await page.mouse.down();
        await page.mouse.move(src.x + src.width / 2 - 10, src.y + src.height / 2 - 5, { steps: 3 });
        await page.mouse.move(field.x, field.y, { steps: 10 });
        await page.mouse.up();
        shape = await waitShape(admin, doc.id, (sh) => sh[sh.length - 1].includes('Markiert'));
        check(shape[shape.length - 1].includes('Markiert'), `${tag}: markierter Text mit der Maus in den Punkt mit Cursor gezogen`, shape);
        await page.evaluate(() => document.getElementById('drag-source').remove());
      }

      // File and link outside any drop zone: refused, the page stays; a link into a text field still drops
      const sidebar = 'aside[data-tour="note-list"]';
      let g = await dragOnto(page, sidebar, ['Files']);
      check(g.over && g.effect === 'none' && g.drop, `${tag}: Datei neben der Notiz abgelegt wird abgewiesen`, g);
      g = await dragOnto(page, sidebar, ['text/uri-list']);
      check(g.over && g.effect === 'none' && g.drop, `${tag}: Link neben der Notiz abgelegt wird abgewiesen`, g);
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'drop-probe';
        input.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:30px;z-index:99999';
        document.body.appendChild(input);
      });
      g = await dragOnto(page, '#drop-probe', ['text/uri-list']);
      check(!g.over && !g.drop, `${tag}: Link in ein Textfeld wird nicht abgewiesen`, g);
      check(page.url().startsWith(BASE), `${tag}: die App bleibt geöffnet`, page.url());

      // A folder row takes only notes and folders of the sidebar: a file or text from outside is not allowed
      // there (the guard refuses the file, text is left to the browser), a dragged note is
      const overFolder = (types) =>
        page.evaluate(
          ({ folder, types }) => {
            const row = [...document.querySelectorAll('aside[data-tour="note-list"] div[draggable="true"]')].find(
              (el) => el.textContent.includes(folder) && !el.querySelector('div[draggable="true"]')
            );
            if (!row) return { found: false };
            const r = row.getBoundingClientRect();
            const dt = new DataTransfer();
            if (types.includes('Files')) dt.items.add(new File(['x'], 'bild.png', { type: 'image/png' }));
            for (const type of types.filter((t) => t !== 'Files')) dt.setData(type, type === 'text/plain' ? 'Hallo' : 'x');
            const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2 });
            Object.defineProperty(ev, 'dataTransfer', { value: dt });
            // Taken by the folder: it stops there; else it reaches the window's guard (lib/dropGuard.ts)
            let reachedWindow = false;
            const seen = () => (reachedWindow = true);
            window.addEventListener('dragover', seen);
            row.dispatchEvent(ev);
            window.removeEventListener('dragover', seen);
            row.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
            return { found: true, taken: !reachedWindow && ev.defaultPrevented, effect: dt.dropEffect };
          },
          { folder, types }
        );
      g = await overFolder(['Files']);
      check(g.found && !g.taken && g.effect === 'none', `${tag}: Datei über einem Ordner zeigt „nicht erlaubt“`, g);
      g = await overFolder(['text/plain']);
      check(g.found && !g.taken, `${tag}: Text von außen über einem Ordner wird nicht angenommen`, g);
      g = await overFolder(['application/mindsift-doc-id', 'application/mindsift-doc-ids', 'text/plain']);
      check(g.found && g.taken, `${tag}: eine gezogene Notiz kann in den Ordner`, g);

      await ctx.close();
      await browser.close();
    }
  } finally {
    await removeNotes(admin, created);
  }

  console.log(failures === 0 ? '\nAlle Prüfungen bestanden' : `\n${failures} Prüfung(en) fehlgeschlagen`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
