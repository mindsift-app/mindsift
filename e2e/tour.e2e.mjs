// Guided tour (frontend/src/features/tour): started with "Tour starten" on the help page, every step clicked
// through on the desktop and on a phone, the card always inside the window and pointing at a control, the
// keys (→, ←, Enter, Esc; the triage's own keys must not sort a card meanwhile), clicks on the dimmed
// page doing nothing, and at the end back on the help page. No data may change: notes, tasks, inbox and
// lists are the same before and after. Desktop in Chromium and Firefox, the phone in Chromium.
// Needs a server in demo mode (admin/admin), German interface.
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

// Everything the tour could touch, reduced to what would show a change
async function snapshot(token) {
  const [stats, docs, tasks, thoughts, lists] = await Promise.all(
    ['/api/v1/stats', '/api/v1/documents', '/api/v1/tasks', '/api/v1/thoughts', '/api/v1/lists'].map((p) => api(token, 'GET', p))
  );
  return JSON.stringify({
    stats,
    docs: docs.map((d) => [d.id, d.title, d.content, d.folderPath, d.isPinned]).sort(),
    tasks: tasks.map((t) => [t.id, t.content, t.isCompleted, t.kanbanStatus, t.dueDate]).sort(),
    thoughts: thoughts.map((t) => [t.id, t.status, t.content]).sort(),
    lists: lists.map((l) => [l.id, l.title, (l.items || []).map((i) => [i.id, i.isCompleted]).sort()]).sort(),
  });
}

async function openHelp(browser, token, phone) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' }
      : { viewport: { width: 1280, height: 860 }, locale: 'de-DE' }
  );
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:demo-hint-closed', '1');
    sessionStorage.setItem('mindsift_pwa_dismissed', '1');
    sessionStorage.setItem('mindsift_view:app', JSON.stringify({ tab: 'help' }));
  }, token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-tour="tour-start"]');
  return { ctx, page, errors };
}

// The card once it stands still and can be seen; its step, progress and geometry
async function waitCard(page) {
  await page.waitForFunction(
    () => {
      const c = document.querySelector('[data-tour-card]');
      if (!c) return false;
      const s = getComputedStyle(c);
      return s.visibility === 'visible' && s.opacity === '1';
    },
    null,
    { timeout: 10000 }
  );
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const c = document.querySelector('[data-tour-card]');
    const r = c.getBoundingClientRect();
    const buttons = [...c.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height);
    return {
      id: c.getAttribute('data-tour-card'),
      progress: c.querySelector('span.text-accent')?.textContent,
      title: c.querySelector('h2')?.textContent,
      inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
      rings: document.querySelectorAll('[data-tour-ring="target"]').length,
      focused: c.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON',
      minButton: Math.min(...buttons),
    };
  });
}

const STEPS = ['triage', 'notes', 'linked', 'focus', 'tasks', 'search', 'end'];

async function clickThrough(page, tag, phone) {
  await page.click('[data-tour="tour-start"]');
  const seen = [];
  for (let guard = 0; guard < 10; guard++) {
    const card = await waitCard(page);
    seen.push(card.id);
    const n = STEPS.indexOf(card.id) + 1;
    check(card.progress === `${n} von 7`, `${tag}: Schritt ${card.id} zeigt „${n} von 7“`, card.progress);
    check(card.inside, `${tag}: Kärtchen von ${card.id} ganz im Fenster`);
    check(card.focused, `${tag}: Fokus im Kärtchen bei ${card.id}`);
    check(card.rings > 0, `${tag}: ${card.id} hebt ein Bedienelement hervor`);
    if (phone) check(card.minButton >= 44, `${tag}: Knöpfe im Kärtchen mindestens 44 px (${card.id})`, card.minButton);
    if (card.id === 'triage') {
      // A click on the dimmed page (the deck's "task" button lies below) and the triage's own keys do nothing
      const btn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('[data-tour="triage-deck"] button')].find((x) => x.getBoundingClientRect().width > 0);
        const r = b?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      });
      if (btn) await page.mouse.click(btn.x, btn.y);
      if (!phone) {
        for (const key of ['h', 'l', 'd', 't', 'c']) await page.keyboard.press(key);
      }
    }
    const last = card.id === 'end';
    await page.locator('[data-tour-card] button.btn-primary').click();
    if (last) break;
  }
  await tourEnded(page);
  return seen;
}

// The card is gone and the help page with its start button is back
async function tourEnded(page) {
  await page.waitForSelector('[data-tour-card]', { state: 'detached', timeout: 5000 });
  await page.waitForSelector('[data-tour="tour-start"]', { state: 'visible', timeout: 5000 }).catch(() => {});
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const before = await snapshot(admin);

  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    const tag = `${engine.name()} Desktop`;
    const { ctx, page, errors } = await openHelp(browser, admin, false);
    const seen = await clickThrough(page, tag, false);
    check(JSON.stringify(seen) === JSON.stringify(STEPS), `${tag}: alle sieben Schritte in der Reihenfolge`, seen);
    check(await page.locator('[data-tour="tour-start"]').isVisible(), `${tag}: am Ende wieder auf der Hilfeseite`);
    check(
      await page
        .waitForFunction(() => document.activeElement?.getAttribute('data-tour') === 'tour-start', null, { timeout: 3000 })
        .then(() => true, () => false),
      `${tag}: Fokus wieder auf „Tour starten“`
    );

    // Keys: → on, ← back, Enter on, Esc ends and returns to the help page
    await page.click('[data-tour="tour-start"]');
    let card = await waitCard(page);
    check(card.id === 'triage', `${tag}: Tour beginnt mit der Triage`, card.id);
    await page.keyboard.press('ArrowRight');
    card = await waitCard(page);
    check(card.id === 'notes', `${tag}: Pfeil rechts geht weiter`, card.id);
    await page.keyboard.press('ArrowLeft');
    card = await waitCard(page);
    check(card.id === 'triage', `${tag}: Pfeil links geht zurück (deck unverändert)`, card.id);
    await page.keyboard.press('Enter');
    card = await waitCard(page);
    check(card.id === 'notes', `${tag}: Enter geht weiter`, card.id);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    check(
      await page.evaluate(() => document.querySelector('[data-tour-card]').contains(document.activeElement)),
      `${tag}: Tab bleibt im Kärtchen`
    );
    await page.keyboard.press('Escape');
    await tourEnded(page);
    check(await page.locator('[data-tour="tour-start"]').isVisible(), `${tag}: Esc beendet, zurück auf der Hilfeseite`);
    // The × ends too
    await page.click('[data-tour="tour-start"]');
    await waitCard(page);
    await page.locator('[data-tour-card] button[aria-label="Tour beenden"]').click();
    await tourEnded(page);
    check(await page.locator('[data-tour="tour-start"]').isVisible(), `${tag}: × beendet, zurück auf der Hilfeseite`);
    check(errors.length === 0, `${tag}: keine Fehler im Browser`, errors);
    await ctx.close();
    await browser.close();
  }

  {
    const browser = await chromium.launch();
    const tag = 'Handy';
    const { ctx, page, errors } = await openHelp(browser, admin, true);
    const seen = await clickThrough(page, tag, true);
    // The phone shows the list of notes, not an open note: the focus-mode step has nothing to point at
    check(
      JSON.stringify(seen) === JSON.stringify(['triage', 'notes', 'linked', 'tasks', 'search', 'end']),
      `${tag}: Schritte am Handy (Vollbild ohne offene Notiz übersprungen)`,
      seen
    );
    check(await page.locator('[data-tour="tour-start"]').isVisible(), `${tag}: am Ende wieder auf der Hilfeseite`);
    check(errors.length === 0, `${tag}: keine Fehler im Browser`, errors);
    await ctx.close();
    await browser.close();
  }

  const after = await snapshot(admin);
  check(after === before, 'Keine Daten verändert (Notizen, Aufgaben, Triage, Listen gleich)');

  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
