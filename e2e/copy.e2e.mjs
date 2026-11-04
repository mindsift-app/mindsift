// Selection over several bullets and Ctrl+C as Markdown, in Chromium and Firefox. Needs a server in demo
// mode (account admin/admin); see e2e/README.md.
import { chromium, firefox } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
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

const EXPECTED = '## Überschrift\n\nErster Punkt mit **fett**\n- Kind\n\n> Ein Hinweis im Callout\n\n- [ ] Aufgabe\n\nLetzter Punkt';

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;

  for (const engine of [chromium, firefox]) {
    const title = `Kopier-Test ${engine.name()} ${Date.now()}`;
    await api(admin, 'POST', '/api/v1/documents', {
      title,
      blocks: [
        { id: `cp1_${Date.now()}`, type: 'h2', content: 'Überschrift', level: 0 },
        { id: `cp2_${Date.now()}`, type: 'bullet', content: 'Erster Punkt mit **fett**', level: 0 },
        { id: `cp3_${Date.now()}`, type: 'bullet', content: 'Kind', level: 1 },
        { id: `cp4_${Date.now()}`, type: 'callout', content: 'Ein Hinweis im Callout', level: 0 },
        { id: `cp5_${Date.now()}`, type: 'todo', content: 'Aufgabe', level: 0 },
        { id: `cp6_${Date.now()}`, type: 'bullet', content: 'Letzter Punkt', level: 0 },
      ],
    });

    const browser = await engine.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    await ctx.addInitScript((t) => localStorage.setItem('mindsift_jwt_token', t), admin);
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();
    await page.getByText(title, { exact: true }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('textarea').length > 3, null, { timeout: 10000 });

    // What Ctrl+C puts on the clipboard (the system clipboard is not readable in every engine)
    await page.evaluate(() => {
      const orig = DataTransfer.prototype.setData;
      DataTransfer.prototype.setData = function (type, v) {
        if (type === 'text/plain') window.__clip = v;
        return orig.call(this, type, v);
      };
    });
    const copy = async () => {
      await page.evaluate(() => (window.__clip = null));
      await page.keyboard.press('Control+c');
      await page.waitForTimeout(300);
      return page.evaluate(() => window.__clip);
    };
    const box = (t) => page.locator('[data-outline-text]', { hasText: t }).first().boundingBox();
    const drag = async (from, to) => {
      const a = await box(from);
      const b = await box(to);
      await page.mouse.move(a.x + 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width + 20, b.y + b.height / 2, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    };
    const name = engine.name();

    await drag('Überschrift', 'Letzter Punkt');
    check((await copy()) === EXPECTED, `${name}: dragging over the callout copies Markdown`);

    await page.evaluate(() => [...document.querySelectorAll('textarea')].find((e) => e.value === 'Ein Hinweis im Callout').focus());
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    const calloutMarked = await page.evaluate(() => {
      const ta = [...document.querySelectorAll('textarea')].find((e) => e.value === 'Ein Hinweis im Callout');
      return /accent/.test(ta.closest('[data-outline-block]').className);
    });
    check(calloutMarked, `${name}: Ctrl+A twice marks the callout as selected`);
    check((await copy()) === EXPECTED, `${name}: Ctrl+A twice in the callout copies the whole note as Markdown`);

    // Pressing on the still selected text must start a new selection, not drag that text
    await drag('Überschrift', 'Letzter Punkt');
    check((await copy()) === EXPECTED, `${name}: a drag right after Ctrl+A twice copies Markdown`);

    await browser.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
