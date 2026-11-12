// Sign-in through an OpenID Connect provider (internal/api/oidc.go, frontend/src/lib/oidc.ts) against a real Dex
// (e2e/dex.yaml, started by run.sh). The server MINDSIFT_OIDC_URL has the password login switched off
// (OIDC_PASSWORD_LOGIN=false) and its first admin from ADMIN_USER / ADMIN_PASSWORD (MINDSIFT_OIDC_ADMIN /
// MINDSIFT_OIDC_PASSWORD). Chromium and Firefox, German interface:
//   - the login shows only "Mit Dex anmelden": no form, no sign-up, no "forgot password"
//   - the button leads to Dex; back in the app there is a new account without a password of its own, and the
//     ticket is gone from the address bar
//   - signing out and in again (and in the other browser) lands in the same account
//   - an error of the return (?oidc_error=…) is explained on the login screen
//   - the administrators' emergency access /?login=password shows the form and signs the admin in
// On a phone the button is 44 px high.
import { chromium, firefox } from 'playwright';

const BASE = process.env.MINDSIFT_OIDC_URL || 'http://localhost:18083';
const ADMIN = process.env.MINDSIFT_OIDC_ADMIN || 'admin';
const ADMIN_PASSWORD = process.env.MINDSIFT_OIDC_PASSWORD || 'Notzugang-2026';
const DEX_LOGIN = process.env.DEX_LOGIN || 'erika@example.com';
const DEX_PASSWORD = process.env.DEX_PASSWORD || 'password';
const SHOTS = process.env.SHOT_DIR || '';
let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

const DESKTOP = { viewport: { width: 1280, height: 860 }, locale: 'de-DE' };
const PHONE = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' };

const appReady = (page) => page.waitForSelector('[data-tour="triage-deck"]', { timeout: 20000 });
const providerButton = (page) => page.getByRole('button', { name: 'Mit Dex anmelden' });
const loginField = (page) => page.getByPlaceholder('admin oder name@beispiel.de');

// The account of the browser's session, as the server sees it
const me = (page) =>
  page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('mindsift_jwt_token')}` } });
    return res.json();
  });

// At Dex: the password form (a connector list first, should Dex show one), then back to MindSift
async function signInAtDex(page) {
  await page.waitForURL(/\/dex\//, { timeout: 15000 });
  const email = page.getByRole('link', { name: /Log in with Email/i });
  if (await email.isVisible().catch(() => false)) await email.click();
  await page.locator('#login').fill(DEX_LOGIN);
  await page.locator('#password').fill(DEX_PASSWORD);
  await page.locator('#submit-login').click();
}

// The offer of the guided tour for a new account is answered, so it covers nothing
async function dismissTour(page) {
  const offer = page.getByRole('dialog', { name: 'Kurze Tour starten?' });
  if (await offer.isVisible().catch(() => false)) await offer.getByRole('button', { name: 'Nein danke' }).click();
}

async function signOut(page) {
  await dismissTour(page);
  await page.getByTitle('Benutzermenü öffnen').locator('visible=true').first().click();
  await page.getByRole('button', { name: 'Abmelden' }).locator('visible=true').first().click();
  await providerButton(page).waitFor({ timeout: 10000 });
}

let accountId = '';
for (const [name, type] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext(DESKTOP)).newPage();
    await page.goto(BASE + '/');
    await providerButton(page).waitFor({ timeout: 15000 });
    check((await loginField(page).count()) === 0, `${name}: password login off shows only the provider's button`);
    check((await page.getByRole('button', { name: 'Registrieren' }).count()) === 0, `${name}: no sign-up with a password`);
    check((await page.getByText('Passwort vergessen?').count()) === 0, `${name}: no "forgot password"`);
    if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/oidc-login-only-button.png` });

    // First sign-in: to Dex and back, a new account
    await providerButton(page).click();
    await signInAtDex(page);
    await appReady(page);
    check(!page.url().includes('oidc='), `${name}: the ticket left the address bar`, page.url());
    const first = await me(page);
    check(
      first.user?.noPassword === true && first.user?.oidc === true && first.user?.email === DEX_LOGIN,
      `${name}: signed in with an account from Dex (no own password, linked)`,
      first.user
    );
    check(first.mfaSetupRequired === false, `${name}: no second factor asked by MindSift`);
    if (!accountId) accountId = first.user?.id;
    check(first.user?.id === accountId, `${name}: the same account as in the other browser`, first.user?.id);

    // Sign out and in again: the same account
    await signOut(page);
    await providerButton(page).click();
    // Dex asks again, or still knows the person and sends the browser straight back
    const asked = await Promise.race([
      page.locator('#login').waitFor({ timeout: 20000 }).then(() => true),
      appReady(page).then(() => false),
    ]);
    if (asked) await signInAtDex(page);
    await appReady(page);
    check((await me(page)).user?.id === accountId, `${name}: the second sign-in lands in the same account`);

    // An error of the return, explained on the login screen
    await signOut(page);
    await page.goto(BASE + '/?oidc_error=cancelled');
    await page.getByText('Die Anmeldung bei Dex wurde abgebrochen.').waitFor({ timeout: 10000 });
    check(!page.url().includes('oidc_error'), `${name}: the error code left the address bar`, page.url());
    if (SHOTS && name === 'chromium') await page.screenshot({ path: `${SHOTS}/oidc-return-error.png` });

    // The administrators' emergency access
    await page.goto(BASE + '/?login=password');
    await loginField(page).waitFor({ timeout: 10000 });
    check(await page.getByText(/Notzugang für die Administration/).isVisible(), `${name}: emergency access explained`);
    await loginField(page).fill(ADMIN);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('input[type="password"]').press('Enter');
    await page.waitForFunction(() => Boolean(localStorage.getItem('mindsift_jwt_token')), null, { timeout: 15000 });
    check((await me(page)).user?.role === 'admin', `${name}: the admin signs in with the password`);
  } catch (err) {
    check(false, `${name}: ${err.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

// Phone: the button is a 44 px target
{
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext(PHONE)).newPage();
    await page.goto(BASE + '/');
    await providerButton(page).waitFor({ timeout: 15000 });
    const box = await providerButton(page).boundingBox();
    check(box && box.height >= 44, 'phone: the provider button is at least 44 px high', box);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/oidc-login-phone.png` });
  } catch (err) {
    check(false, `phone: ${err.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

if (failures > 0) {
  console.log(`${failures} OIDC check(s) failed`);
  process.exit(1);
}
console.log('All OIDC checks passed');
