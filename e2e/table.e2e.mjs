// Tables in notes: /table makes a 2 × 2 table with the bullet's text in the first cell, typing with Tab and
// Enter, the + for a column, the line mode from the ⋯ menu, Backspace on an empty row, the arrows into and
// out of the table; after reloading content and line mode are still there (sync). On a phone: tapping a
// cell and the + (44 px), the page does not scroll sideways. Desktop in Chromium and Firefox, the phone in Chromium.
// Needs a server in demo mode (admin/admin).
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

async function openNote(browser, token, docId, phone = false) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' }
      : { viewport: { width: 1280, height: 900 }, locale: 'de-DE' }
  );
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:demo-hint-closed', '1');
    sessionStorage.setItem('mindsift_pwa_dismissed', '1');
  }, token);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?note=${docId}`);
  await page.waitForSelector('[data-outline-block]');
  await page.waitForTimeout(800);
  return { ctx, page };
}

// The table's cells (values, row by row) and which cell has the cursor
const cellState = (page) =>
  page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-table-block] textarea[data-table-cell]')];
    const cols = document.querySelectorAll('[data-table-block] thead th').length;
    return { cols, values: cells.map((c) => c.value), focus: cells.indexOf(document.activeElement) };
  });

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  let doc;
  for (const engine of [firefox, chromium]) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    doc = await api(admin, 'POST', '/api/v1/documents', {
      title: `Tabellen-Test ${engine.name()} ${stamp}`,
      blocks: [
        { id: `tb0_${stamp}`, type: 'text', content: 'Einkauf', level: 0 },
        { id: `tb1_${stamp}`, type: 'text', content: 'Danach', level: 0 },
      ],
    });
    const tag = (msg) => `${engine.name()}: ${msg}`;
    const engineBrowser = await engine.launch();
    const { ctx, page } = await openNote(engineBrowser, admin, doc.id);
    await page.locator('[data-outline-block]').first().locator('[data-outline-text]').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' /table');
    await page.waitForTimeout(200);
    check(await page.getByText('Tabelle mit Kopfzeile').isVisible(), tag('Slash-Menü bietet /table an'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    let s = await cellState(page);
    check(s.cols === 2 && s.values.length === 4 && s.values[0] === 'Einkauf' && s.focus === 0, tag('/table legt 2 × 2 an, Text in der ersten Zelle, Cursor dort'), s);
    check(await page.locator('[data-table-block] thead th').first().evaluate((el) => getComputedStyle(el).fontWeight === '600'), tag('Kopfzeile ist fett'));

    await page.keyboard.press('Tab');
    await page.keyboard.type('Menge');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    s = await cellState(page);
    check(s.values.length === 6 && s.focus === 2 && s.values[2] === '', tag('Enter fügt unter der Zeile eine neue ein, Cursor in deren erster Zelle'), s);
    await page.keyboard.type('Brot');
    await page.keyboard.press('Tab');
    await page.keyboard.type('2 | Stück');
    await page.keyboard.press('Tab');
    s = await cellState(page);
    check(s.focus === 4, tag('Tab springt in die nächste Zeile'), s);
    await page.keyboard.press('Shift+Tab');
    s = await cellState(page);
    check(s.focus === 3, tag('Umschalt+Tab springt zurück'), s);

    // + right of the table: a column, the cursor into its header
    await page.locator('[data-table-block]').hover();
    await page.getByRole('button', { name: 'Spalte hinzufügen' }).click();
    await page.waitForTimeout(200);
    s = await cellState(page);
    check(s.cols === 3 && s.focus === 2, tag('Plus fügt eine Spalte hinzu, Cursor in ihre Kopfzelle'), s);
    await page.keyboard.type('Notiz');

    // Line mode from the menu
    await page.getByRole('button', { name: 'Tabelle: Linien und Spalten' }).click();
    await page.getByRole('menuitemradio', { name: /Voller Rahmen/ }).click();
    await page.waitForTimeout(200);
    check((await page.locator('table.note-table').getAttribute('data-lines')) === 'grid', tag('Menü stellt „Voller Rahmen“ ein'));
    s = await cellState(page);
    check(s.focus === 2, tag('Cursor bleibt nach dem Menü in der Zelle'), s);

    // Backspace in the empty last row deletes it
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    s = await cellState(page);
    check(s.focus === 8 && s.values.slice(6).every((v) => v === ''), tag('Pfeil runter geht zur Zelle darunter'), s);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    s = await cellState(page);
    check(s.values.length === 6 && s.focus === 5, tag('Rücktaste löscht die leere Zeile'), s);

    // Arrow down in the last row leaves the table, arrow up comes back into its last cell
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    check((await page.evaluate(() => document.activeElement?.value)) === 'Danach', tag('Pfeil runter in der letzten Zeile geht zum nächsten Punkt'));
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    s = await cellState(page);
    check(s.focus === 5, tag('Pfeil hoch von unten kommt in die letzte Zelle'), s);
    await page.waitForTimeout(1200);

    const want = '| Einkauf | Menge | Notiz |\n| --- | --- | --- |\n| Brot | 2 \\| Stück |  |';
    const saved = (await api(admin, 'GET', `/api/v1/documents/${doc.id}`)).blocks.find((b) => b.type === 'table');
    check(saved?.content === want && saved?.lang === 'grid', tag('Server hat Inhalt (Markdown-Tabelle) und Linien-Modus'), saved);

    await page.reload();
    await page.waitForSelector('[data-table-block]');
    await page.waitForTimeout(800);
    s = await cellState(page);
    check(
      JSON.stringify(s.values) === JSON.stringify(['Einkauf', 'Menge', 'Notiz', 'Brot', '2 | Stück', '']) &&
        (await page.locator('table.note-table').getAttribute('data-lines')) === 'grid',
      tag('nach Neuladen sind Inhalt und Modus da'),
      s
    );
    await ctx.close();
    await engineBrowser.close();
  }

  const browser = await chromium.launch();
  // Phone: tap a cell and the +, nothing scrolls the page sideways
  {
    const { ctx, page } = await openNote(browser, admin, doc.id, true);
    const table = page.locator('[data-table-block]').first();
    const plus = table.getByRole('button', { name: 'Spalte hinzufügen' });
    const box = await plus.boundingBox();
    check(!!box && box.width >= 44 && box.height >= 44 && (await plus.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === '1', 'Plus am Handy sichtbar und mindestens 44 px', box);
    const cellBox = await table.locator('td').first().boundingBox();
    check(!!cellBox && cellBox.height >= 43.5, 'Zellen am Handy mindestens 44 px hoch', cellBox);
    await table.locator('td .nt-text').first().tap();
    await page.waitForTimeout(300);
    let s = await cellState(page);
    check(s.focus === 3, 'Antippen einer Zelle setzt den Cursor hinein', s);
    await plus.tap();
    await page.waitForTimeout(300);
    s = await cellState(page);
    check(s.cols === 4 && s.focus === 3, 'Antippen des Plus fügt eine Spalte hinzu', s);
    await page.keyboard.type('Ein langer Spaltenname');
    await page.waitForTimeout(300);
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: window.innerWidth,
      scroll: document.querySelector('.table-scroll').scrollWidth > document.querySelector('.table-scroll').clientWidth,
    }));
    check(widths.page <= widths.view && widths.scroll, 'breite Tabelle scrollt seitlich, die Seite nicht', widths);
    await ctx.close();
  }
  await browser.close();

  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
