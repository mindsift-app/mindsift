// Two-factor sign-in (frontend/src/features/settings/user/TwoFactorCard.tsx, features/auth/MfaStep.tsx):
// set up the authenticator app in the settings (the code is computed here from the shown key), sign out,
// sign in with the app's code, with a recovery code, with "trust this device" and then again without a
// code on that device. Chromium and Firefox, German interface; on a phone the second step keeps its
// targets at 44 px. Not in the demo (shared accounts), so it needs the server without it: MINDSIFT_PLAIN_URL
// with the first admin from ADMIN_USER / ADMIN_PASSWORD (MINDSIFT_PLAIN_ADMIN / MINDSIFT_PLAIN_PASSWORD),
// who creates one account per browser.
import { createHmac } from 'node:crypto';
import { chromium, firefox } from 'playwright';

const PLAIN = process.env.MINDSIFT_PLAIN_URL || 'http://localhost:18081';
const PLAIN_ADMIN = process.env.MINDSIFT_PLAIN_ADMIN || 'admin';
const PLAIN_PASSWORD = process.env.MINDSIFT_PLAIN_PASSWORD || 'Tour-Angebot-2026';
const SHOTS = process.env.SHOT_DIR || '';
let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, method, path, body) {
  const res = await fetch(PLAIN + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'de', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// RFC 6238 as the server does it: HMAC-SHA1 over the 30-second step, 6 digits
function base32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/\s|=/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30000);

// Each code works once: the next one is the step after the last used, which the server takes while it is
// at most one step ahead of its clock
function codes(key) {
  let last = 0;
  return async () => {
    while (stepNow() < last) await sleep(500);
    const step = Math.max(stepNow(), last + 1);
    last = step;
    return hotp(key, step);
  };
}

const DESKTOP = { viewport: { width: 1280, height: 860 }, locale: 'de-DE' };
const PHONE = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' };

const appReady = (page) => page.waitForSelector('[data-tour="triage-deck"]', { timeout: 15000 });
const secondStep = (page) => page.getByText('Bestätigung in zwei Schritten');

async function signInWithPassword(page, login, password) {
  await page.getByPlaceholder('admin oder name@beispiel.de').fill(login);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="password"]').press('Enter');
}

async function signOut(page) {
  await page.getByTitle('Benutzermenü öffnen').locator('visible=true').first().click();
  await page.getByRole('button', { name: 'Abmelden' }).locator('visible=true').first().click();
  await page.getByPlaceholder('admin oder name@beispiel.de').waitFor({ timeout: 10000 });
}

async function run(engine, admin) {
  const name = engine.name();
  const stamp = Date.now();
  const login = `zwei.faktor.${name}.${stamp}@example.com`;
  const password = 'Zwei-Faktor-' + stamp;
  await api(admin, 'POST', '/api/v1/admin/users', { email: login, password, displayName: `Zwei Faktor ${name}`, role: 'member' });
  // No tour card over the settings
  const first = (await api(null, 'POST', '/api/v1/auth/login', { login, password })).token;
  await api(first, 'PATCH', '/api/v1/auth/settings', { tourOffered: true });

  const browser = await engine.launch();
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => sessionStorage.setItem('mindsift_pwa_dismissed', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PLAIN + '/');

  // --- Sign in, set the app up in the settings ---
  await signInWithPassword(page, login, password);
  await appReady(page);
  await page.getByTitle('Benutzermenü öffnen').locator('visible=true').first().click();
  await page.getByRole('button', { name: /Kontoeinstellungen/ }).locator('visible=true').first().click();
  await page.locator('aside').getByRole('button', { name: /^Sicherheit/ }).click();
  const card = page.locator('[data-security-card="two-factor"]');
  await card.getByRole('button', { name: 'Einrichten' }).waitFor({ timeout: 10000 });
  if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/mfa-settings-off.png` });
  await card.getByRole('button', { name: 'Einrichten' }).click();
  await card.getByLabel('Zur Bestätigung dein Passwort').fill(password);
  await card.getByRole('button', { name: 'Weiter' }).click();
  const secretEl = card.locator('[data-totp-secret]');
  await secretEl.waitFor({ timeout: 10000 });
  const secret = (await secretEl.innerText()).replace(/\s/g, '');
  check(/^[A-Z2-7]{32}$/.test(secret), `${name}: Schlüssel zum Abtippen angezeigt`, secret);
  await card.locator('[data-totp-qr]').waitFor({ timeout: 10000 });
  check(await card.locator('[data-totp-qr]').isVisible(), `${name}: QR-Code angezeigt`);
  if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/mfa-setup-qr.png` });
  const next = codes(base32(secret));
  await card.getByLabel('Code', { exact: true }).fill(await next());
  await card.locator('[data-recovery-codes]').waitFor({ timeout: 10000 });
  const recovery = await card.locator('[data-recovery-code]').allInnerTexts();
  check(recovery.length === 10 && recovery.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)), `${name}: zehn Wiederherstellungscodes angezeigt`, recovery);
  if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/mfa-recovery-codes.png` });
  await card.getByRole('button', { name: 'Ich habe die Codes gesichert' }).click();
  check((await card.locator('[data-recovery-code]').count()) === 0, `${name}: Codes nach dem Bestätigen verborgen`);
  check(await card.getByText('Ein', { exact: true }).isVisible(), `${name}: Zwei-Faktor-Anmeldung eingeschaltet`);
  if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/mfa-settings-on.png` });

  // --- Sign out, sign in with the app's code ---
  await signOut(page);
  await signInWithPassword(page, login, password);
  await secondStep(page).waitFor({ timeout: 10000 });
  check(true, `${name}: nach dem Passwort wird der Code verlangt`);
  const codeField = page.getByLabel('Code', { exact: true });
  check((await codeField.getAttribute('autocomplete')) === 'one-time-code' && (await codeField.getAttribute('inputmode')) === 'numeric', `${name}: Code-Feld für Einmalcodes`);
  if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/mfa-login-desktop.png` });
  // A wrong code first: refused, the step stays
  await codeField.fill('000000');
  await page.getByText('Der Code ist falsch oder abgelaufen').waitFor({ timeout: 10000 });
  check(true, `${name}: falscher Code abgelehnt`);
  await codeField.fill(await next());
  await appReady(page);
  check(true, `${name}: Anmeldung mit dem Code der App`);

  // --- With a recovery code ---
  await signOut(page);
  await signInWithPassword(page, login, password);
  await secondStep(page).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Wiederherstellungscode verwenden' }).click();
  await page.getByLabel('Wiederherstellungscode').fill(recovery[0].toUpperCase());
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await page.getByText('Du hast noch 9 Codes.').waitFor({ timeout: 10000 });
  check(true, `${name}: Wiederherstellungscode angenommen, 9 übrig`);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await appReady(page);

  // --- The same recovery code a second time: refused ---
  await signOut(page);
  await signInWithPassword(page, login, password);
  await secondStep(page).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Wiederherstellungscode verwenden' }).click();
  await page.getByLabel('Wiederherstellungscode').fill(recovery[0]);
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await page.getByText('Der Code ist falsch oder abgelaufen').waitFor({ timeout: 10000 });
  check(true, `${name}: verbrauchter Wiederherstellungscode abgelehnt`);

  // --- Trust this device, then no code on it ---
  await page.getByRole('button', { name: 'Code der App verwenden' }).click();
  await page.getByRole('switch', { name: 'Diesem Gerät 30 Tage vertrauen' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await next());
  await appReady(page);
  const stored = await page.evaluate(() => localStorage.getItem('mindsift_trusted_devices') || '');
  check(stored.includes('tdv_'), `${name}: Vertrauens-Token im Browser gespeichert`);
  await signOut(page);
  await signInWithPassword(page, login, password);
  await appReady(page);
  check((await secondStep(page).count()) === 0, `${name}: vertrautes Gerät meldet sich ohne Code an`);
  check(errors.length === 0, `${name}: keine Fehler im Browser`, errors);
  await ctx.close();

  // --- Another device (a phone) is still asked; its targets are big enough ---
  if (name === 'chromium') {
    const phone = await browser.newContext(PHONE);
    await phone.addInitScript(() => sessionStorage.setItem('mindsift_pwa_dismissed', '1'));
    const p = await phone.newPage();
    await p.goto(PLAIN + '/');
    await signInWithPassword(p, login, password);
    await secondStep(p).waitFor({ timeout: 10000 });
    check(true, 'Handy: anderes Gerät muss den Code eingeben');
    const heights = await p.evaluate(() =>
      [...document.querySelectorAll('[data-mfa-step] input, [data-mfa-step] button')]
        .filter((el) => el.getAttribute('role') !== 'switch')
        .map((el) => Math.round(el.getBoundingClientRect().height))
    );
    check(heights.length >= 4 && heights.every((h) => h >= 44), 'Handy: Feld und Knöpfe mindestens 44 px hoch', heights);
    const row = await p.evaluate(() => Math.round(document.querySelector('[role="switch"]').closest('div.flex').getBoundingClientRect().height));
    check(row >= 44, 'Handy: Zeile „Gerät vertrauen“ mindestens 44 px hoch', row);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/mfa-login-phone.png` });
    await phone.close();
  }
  await browser.close();
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: PLAIN_ADMIN, password: PLAIN_PASSWORD })).token;
  for (const engine of [chromium, firefox]) {
    await run(engine, admin);
  }
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
