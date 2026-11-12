// The offer of the guided tour after the first sign-in (frontend/src/features/tour/TourOfferCard.tsx).
// Without the demo: a new account is asked once, only after the first setup, and never again after any
// answer, on no device; "Starten" starts the tour. In the demo every browser is asked once, and the shared
// account keeps no answer. German interface.
// Needs a server in demo mode (MINDSIFT_URL, admin/admin) and a fresh one without (MINDSIFT_PLAIN_URL,
// first admin from ADMIN_USER / ADMIN_PASSWORD, given as MINDSIFT_PLAIN_ADMIN / MINDSIFT_PLAIN_PASSWORD).
import { chromium } from 'playwright';

const DEMO = process.env.MINDSIFT_URL || 'http://localhost:18080';
const PLAIN = process.env.MINDSIFT_PLAIN_URL || 'http://localhost:18081';
const PLAIN_ADMIN = process.env.MINDSIFT_PLAIN_ADMIN || 'admin';
const PLAIN_PASSWORD = process.env.MINDSIFT_PLAIN_PASSWORD || 'Tour-Angebot-2026';
let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

async function api(base, token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const login = async (base, name, password) => (await api(base, null, 'POST', '/api/v1/auth/login', { login: name, password })).token;
const tourOffered = async (base, token) => (await api(base, token, 'GET', '/api/v1/auth/me')).user.tourOffered;

const PHONE = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' };
const DESKTOP = { viewport: { width: 1280, height: 860 }, locale: 'de-DE' };

// A browser of its own (nothing remembered yet) signed in with the token
async function open(browser, base, token, options) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:demo-hint-closed', '1');
    sessionStorage.setItem('mindsift_pwa_dismissed', '1');
  }, token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  return { ctx, page, errors };
}

const offer = (page) => page.getByRole('dialog', { name: 'Kurze Tour starten?' });
const appReady = (page) => page.waitForSelector('[data-tour="triage-deck"]', { timeout: 15000 });

// Signed in and the data loaded, with time for the offer to come up if it would
async function settled(page) {
  await appReady(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

async function offerShown(page) {
  try {
    await offer(page).waitFor({ state: 'visible', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

const main = async () => {
  const browser = await chromium.launch();

  // --- Without the demo: the first admin, asked after the first setup ---
  {
    const admin = await login(PLAIN, PLAIN_ADMIN, PLAIN_PASSWORD);
    check((await tourOffered(PLAIN, admin)) === false, 'Neues Konto: noch nicht gefragt');
    const { ctx, page, errors } = await open(browser, PLAIN, admin, DESKTOP);
    const submit = page.getByRole('button', { name: 'Ersteinrichtung abschließen & Starten' });
    await submit.waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    check((await offer(page).count()) === 0, 'Ersteinrichtung: noch keine Frage nach der Tour');
    await submit.click();
    check(await offerShown(page), 'Nach der Ersteinrichtung: Frage nach der Tour');
    check(await page.getByText('in der Hilfe starten').isVisible(), 'Hinweis auf die Hilfe');
    const box = await offer(page).boundingBox();
    check(box && box.x + box.width <= 1280 && box.y + box.height <= 860 && box.width < 400, 'Desktop: kleine Karte am Rand', box);
    await offer(page).getByRole('button', { name: 'Nein danke' }).click();
    check((await offer(page).count()) === 0, '„Nein danke“ schließt die Karte');
    await page.waitForTimeout(500);
    check((await tourOffered(PLAIN, admin)) === true, '„Nein danke“ merkt die Antwort am Konto');
    check((await page.locator('[data-tour-card]').count()) === 0, '„Nein danke“ startet keine Tour');
    await page.reload();
    await settled(page);
    check((await offer(page).count()) === 0, 'Nach dem Neuladen nicht wieder gefragt');
    check(errors.length === 0, 'Keine Fehler im Browser', errors);
    await ctx.close();

    // Another device of the same account
    const other = await open(browser, PLAIN, admin, PHONE);
    await settled(other.page);
    check((await offer(other.page).count()) === 0, 'Anderes Gerät: nicht wieder gefragt');
    await other.ctx.close();

    // --- A member the admin created, on a phone: "Starten" ---
    const stamp = Date.now();
    await api(PLAIN, admin, 'POST', '/api/v1/admin/users', {
      email: `tour.${stamp}@example.com`,
      password: 'Tour-Mitglied-2026',
      displayName: 'Tour Mitglied',
      role: 'member',
    });
    const member = await login(PLAIN, `tour.${stamp}@example.com`, 'Tour-Mitglied-2026');
    const m = await open(browser, PLAIN, member, PHONE);
    check(await offerShown(m.page), 'Handy, neues Mitglied: Frage nach der Tour');
    const geo = await m.page.evaluate(() => {
      const card = document.querySelector('[data-tour-offer]').getBoundingClientRect();
      const nav = document.querySelector('[data-mobile-nav]').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('[data-tour-offer] button')].map((b) => b.getBoundingClientRect().height);
      return { bottom: card.bottom, navTop: nav.top, left: card.left, right: card.right, buttons };
    });
    check(geo.bottom <= geo.navTop && geo.left >= 0 && geo.right <= 400, 'Handy: Karte über der Navigation', geo);
    check(geo.buttons.length === 3 && geo.buttons.every((h) => h >= 44), 'Handy: Knöpfe mindestens 44 px hoch', geo.buttons);
    await offer(m.page).getByRole('button', { name: 'Starten', exact: true }).click();
    check((await offer(m.page).count()) === 0, '„Starten“ schließt die Karte');
    let tourStarted = true;
    await m.page.waitForSelector('[data-tour-card]', { timeout: 10000 }).catch(() => (tourStarted = false));
    check(tourStarted, '„Starten“ startet die Tour');
    await m.page.keyboard.press('Escape');
    await m.page.waitForTimeout(500);
    check((await tourOffered(PLAIN, member)) === true, '„Starten“ merkt die Antwort am Konto');
    await m.page.reload();
    await settled(m.page);
    check((await offer(m.page).count()) === 0, 'Nach der Tour nicht wieder gefragt');
    check(m.errors.length === 0, 'Handy: keine Fehler im Browser', m.errors);
    await m.ctx.close();
  }

  // --- Demo: every browser once, the shared account keeps nothing ---
  {
    const admin = await login(DEMO, 'admin', 'admin');
    const first = await open(browser, DEMO, admin, DESKTOP);
    check(await offerShown(first.page), 'Demo: Besucher wird gefragt');
    await offer(first.page).getByRole('button', { name: 'Schließen' }).click();
    check((await offer(first.page).count()) === 0, 'Demo: Schließen zählt als Antwort');
    check(
      (await first.page.evaluate(() => localStorage.getItem('mindsift:tour-offered'))) === '1',
      'Demo: Antwort im Browser gemerkt'
    );
    await first.page.reload();
    await settled(first.page);
    check((await offer(first.page).count()) === 0, 'Demo: derselbe Browser nicht wieder gefragt');
    check((await tourOffered(DEMO, admin)) === false, 'Demo: gemeinsames Konto merkt nichts');
    check(first.errors.length === 0, 'Demo: keine Fehler im Browser', first.errors);
    await first.ctx.close();

    const second = await open(browser, DEMO, admin, PHONE);
    check(await offerShown(second.page), 'Demo: ein anderer Besucher wird wieder gefragt');
    await second.ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
