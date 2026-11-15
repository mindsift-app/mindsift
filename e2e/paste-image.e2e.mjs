// Pasting an image into a note (desktop, Chromium and Firefox): a screenshot pasted into an empty bullet turns
// it into an image bullet, pasted below a bullet with text it becomes an image bullet of its own; both load
// from the server. The cursor goes below the image: to the start of the next bullet, or into a new empty bullet
// (one Ctrl+Z step with the image). Ctrl+Z removes the pasted image again. Bullets with an image copied within MindSift and
// pasted keep the image's reference and upload nothing. The paste is a synthetic paste event with a
// DataTransfer holding a PNG made on a canvas (the system clipboard is not writable in every engine; Firefox
// empties a DataTransfer handed to the ClipboardEvent constructor, so it is set on the event instead). Needs a
// server in demo mode (account admin/admin); see e2e/README.md.
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

// Test notes go again at the end, also when a check or the run fails: to the trash and out of it
async function removeNotes(token, ids) {
  for (const id of ids) {
    await api(token, 'DELETE', `/api/v1/documents/${id}`).catch(() => {});
    await api(token, 'DELETE', `/api/v1/documents/${id}/permanent`).catch(() => {});
  }
}

const serverBlocks = async (token, id) => (await api(token, 'GET', `/api/v1/documents/${id}`)).blocks || [];

// Pastes a PNG (made on a canvas in the page) into the focused field, optionally with text and HTML
async function pasteImage(page, { text = '', html = '' } = {}) {
  await page.evaluate(
    async ({ text, html }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('Bildschirmfoto', 40, 100);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'bildschirmfoto.png', { type: 'image/png' }));
      if (text) dt.setData('text/plain', text);
      if (html) dt.setData('text/html', html);
      window.__paste(dt);
    },
    { text, html }
  );
}

// All image bullets of the page have loaded their picture
const imagesLoaded = (page, count) =>
  page.waitForFunction(
    (n) => {
      const imgs = Array.from(document.querySelectorAll('[data-outline-block] figure img'));
      return imgs.length === n && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    count,
    { timeout: 15000 }
  );

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const created = [];
  try {
    for (const engine of [chromium, firefox]) {
      const browser = await engine.launch();
      const tag = engine.name();
      const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const title = `Bild-Einfügen ${tag} ${stamp}`;
      const doc = await api(admin, 'POST', '/api/v1/documents', {
        title,
        blocks: [
          { id: `pi0_${stamp}`, type: 'text', content: 'Vor dem Bild', level: 0 },
          { id: `pi1_${stamp}`, type: 'text', content: '', level: 0 },
          { id: `pi2_${stamp}`, type: 'text', content: 'Danach', level: 0 },
        ],
      });
      created.push(doc.id);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
      await ctx.addInitScript((t) => {
        localStorage.setItem('mindsift_jwt_token', t);
        localStorage.setItem('mindsift:tour-offered', '1');
        // A paste event with this clipboard into the focused field
        window.__paste = (dt) => {
          const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'clipboardData', { value: dt });
          document.activeElement.dispatchEvent(ev);
        };
      }, admin);
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
      await page.getByText(title, { exact: true }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('[data-outline-block]').length === 3, null, { timeout: 10000 });
      const row = (i) => page.locator('[data-outline-block]').nth(i);
      // Into a bullet's text, at its end (an empty bullet has no rendered text to click on)
      const focusRow = async (i) => {
        const b = await row(i).boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 12));
        await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 5000 });
        await page.keyboard.press('End');
      };

      // Empty bullet: becomes the image
      await focusRow(1);
      await pasteImage(page);
      await imagesLoaded(page, 1);
      await page.waitForTimeout(1200); // synced
      let blocks = await serverBlocks(admin, doc.id);
      check(
        blocks.length === 3 && blocks[1].type === 'image' && /^!\[\]\(media:med_[0-9a-f]+\)$/.test(blocks[1].content),
        `${tag}: Screenshot in leeren Punkt wird zum Bild-Punkt`,
        blocks.map((b) => `${b.type}:${b.content}`)
      );
      const firstMedia = blocks[1]?.content;
      // The bullet below follows right away: the cursor goes to its start, no empty bullet is added
      const cursor = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.tagName === 'TEXTAREA' ? { value: el.value, at: el.selectionStart } : null;
      });
      check(cursor?.value === 'Danach' && cursor.at === 0, `${tag}: Cursor steht danach am Anfang des folgenden Punkts`, cursor);

      // Bullet with text: the image goes below it, the text stays
      await focusRow(0);
      await page.keyboard.press('End');
      await pasteImage(page);
      await imagesLoaded(page, 2);
      await page.waitForTimeout(1200);
      blocks = await serverBlocks(admin, doc.id);
      check(
        blocks.map((b) => b.type).join(',') === 'text,image,image,text' && blocks[0].content === 'Vor dem Bild' && blocks[2].content === firstMedia,
        `${tag}: Screenshot in Punkt mit Text kommt als eigener Bild-Punkt darunter`,
        blocks.map((b) => `${b.type}:${b.content}`)
      );

      // Ctrl+Z removes the pasted image again
      await focusRow(0);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(1500);
      blocks = await serverBlocks(admin, doc.id);
      check(
        blocks.map((b) => b.type).join(',') === 'text,image,text',
        `${tag}: Strg+Z entfernt den eingefügten Bild-Punkt`,
        blocks.map((b) => `${b.type}:${b.content}`)
      );

      // A new empty bullet at the end (Enter after "Danach"): becomes the image, a new empty bullet below it
      // takes the cursor; Ctrl+Z takes both back in one step
      const before = (await serverBlocks(admin, doc.id)).map((b) => `${b.type}:${b.content}`);
      const count = before.length;
      await focusRow(2);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForFunction((n) => document.querySelectorAll('[data-outline-block]').length === n, count + 1, { timeout: 5000 });
      await page.waitForTimeout(1200);
      await pasteImage(page);
      await page.waitForFunction((n) => document.querySelectorAll('[data-outline-block]').length === n, count + 2, { timeout: 15000 });
      await page.waitForTimeout(1200);
      blocks = await serverBlocks(admin, doc.id);
      const tail = blocks.slice(-2).map((b) => `${b.type}:${b.content}`);
      const inNew = await page.evaluate(() => {
        const el = document.activeElement;
        const row = el?.closest('[data-outline-block]');
        const rows = Array.from(document.querySelectorAll('[data-outline-block]'));
        return el?.tagName === 'TEXTAREA' && el.value === '' && rows.indexOf(row) === rows.length - 1;
      });
      check(
        blocks.length === count + 2 && /^image:!\[\]\(media:med_[0-9a-f]+\)$/.test(tail[0]) && tail[1] === 'text:' && inNew,
        `${tag}: Bild im leeren letzten Punkt bekommt einen leeren Punkt mit Cursor darunter`,
        { tail, inNew }
      );
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(1500);
      blocks = await serverBlocks(admin, doc.id);
      const afterUndo = blocks.map((b) => `${b.type}:${b.content}`);
      check(
        afterUndo.length === count + 1 && afterUndo.slice(0, count).join('|') === before.join('|') && afterUndo[count] === 'text:',
        `${tag}: Strg+Z nimmt Bild und neuen Punkt in einem Schritt zurück`,
        afterUndo
      );

      // Bullets with an image copied within MindSift (Ctrl+C) and pasted below the last bullet: the copied text
      // holds the image's reference, nothing is uploaded
      let uploads = 0;
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/media(\/fetch)?$/.test(new URL(r.url()).pathname)) uploads++;
      });
      await page.evaluate(() => {
        window.__clipAll = {};
        const orig = DataTransfer.prototype.setData;
        DataTransfer.prototype.setData = function (type, v) {
          window.__clipAll[type] = v;
          return orig.call(this, type, v);
        };
      });
      const bar = await page.locator('.seg-track').locator('visible=true').first().boundingBox();
      await page.mouse.click(bar.x + bar.width + 200, bar.y + bar.height / 2);
      await page.waitForTimeout(150);
      const textBox = await row(0).locator('[data-outline-text], textarea').first().boundingBox();
      const imgBox = await row(1).boundingBox();
      await page.mouse.move(textBox.x + 1, textBox.y + textBox.height / 2);
      await page.waitForTimeout(250);
      await page.mouse.down();
      await page.mouse.move(imgBox.x + imgBox.width - 5, imgBox.y + imgBox.height - 5, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+c');
      await page.waitForTimeout(300);
      const clip = await page.evaluate(() => window.__clipAll);
      await focusRow(2);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      await page.evaluate((data) => {
        const dt = new DataTransfer();
        for (const [type, v] of Object.entries(data)) dt.setData(type, v);
        window.__paste(dt);
      }, clip);
      await page.waitForTimeout(1500);
      blocks = await serverBlocks(admin, doc.id);
      // (The pasted copy keeps the reference; which block type it gets is the text paste's business, not this one's)
      const copies = blocks.filter((b) => b.content === firstMedia).length;
      check(copies === 2 && uploads === 0, `${tag}: kopierter Bild-Punkt wird ohne neues Hochladen eingefügt`, {
        clip,
        blocks: blocks.map((b) => `${b.type}:${b.content}`),
        uploads,
      });

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
