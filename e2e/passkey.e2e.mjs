// Passkeys (frontend/src/features/settings/user/PasskeyCard.tsx, features/auth/MfaStep.tsx and the
// login of SetupAndAuthView.tsx): in Chromium with a virtual authenticator of the DevTools protocol
// (ctap2, resident keys, user verification): add a passkey in the settings, sign out, sign in without
// password, sign in with password and the passkey as second step, remove it again (confirmed with the
// passkey) and sign in with the password alone. On a phone the second step keeps its targets at 44 px.
// Firefox has no virtual authenticator: there it only checks that login and settings still work and show
// the passkey parts. Needs the server without the demo and with BASE_URL=http://localhost:<port>
// (MINDSIFT_PLAIN_URL, as e2e/run.sh starts it), German interface.
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

const DESKTOP = { viewport: { width: 1280, height: 860 }, locale: 'de-DE' };
const PHONE = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' };

const appReady = (page) => page.waitForSelector('[data-tour="triage-deck"]', { timeout: 15000 });
const loginField = (page) => page.getByPlaceholder('admin oder name@beispiel.de');
const secondStep = (page) => page.getByText('Bestätigung in zwei Schritten');

async function signInWithPassword(page, login, password) {
  await loginField(page).fill(login);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="password"]').press('Enter');
}

async function signOut(page) {
  await page.getByTitle('Benutzermenü öffnen').locator('visible=true').first().click();
  await page.getByRole('button', { name: 'Abmelden' }).locator('visible=true').first().click();
  await loginField(page).waitFor({ timeout: 10000 });
}

async function openSecurity(page) {
  await page.getByTitle('Benutzermenü öffnen').locator('visible=true').first().click();
  await page.getByRole('button', { name: /Kontoeinstellungen/ }).locator('visible=true').first().click();
  await page.locator('aside').getByRole('button', { name: /^Sicherheit/ }).click();
  const card = page.locator('[data-security-card="passkeys"]');
  await card.getByText('Passkeys', { exact: true }).waitFor({ timeout: 10000 });
  return card;
}

// A virtual platform authenticator that verifies the user and answers by itself
async function virtualAuthenticator(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

async function newAccount(admin, name) {
  const stamp = Date.now();
  const login = `passkey.${name}.${stamp}@example.com`;
  const password = 'Passkey-' + stamp;
  await api(admin, 'POST', '/api/v1/admin/users', { email: login, password, displayName: `Passkey ${name}`, role: 'member' });
  // No tour card over the settings
  const first = (await api(null, 'POST', '/api/v1/auth/login', { login, password })).token;
  await api(first, 'PATCH', '/api/v1/auth/settings', { tourOffered: true });
  return { login, password };
}

async function runChromium(admin) {
  const { login, password } = await newAccount(admin, 'chromium');
  const status = await api(null, 'GET', '/api/v1/auth/status');
  check(status.passkeys === true, 'Server bietet Passkeys an (BASE_URL auf localhost)', status.passkeys);

  const browser = await chromium.launch();
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => sessionStorage.setItem('mindsift_pwa_dismissed', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { cdp, authenticatorId } = await virtualAuthenticator(ctx, page);
  await page.goto(PLAIN + '/');
  check((await loginField(page).getAttribute('autocomplete')) === 'username webauthn', 'Anmeldefeld bietet Passkeys im Autofill an');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/passkey-login-desktop.png` });

  // --- Add a passkey in the settings ---
  await signInWithPassword(page, login, password);
  await appReady(page);
  const card = await openSecurity(page);
  await card.getByText('Noch keine Passkeys.').waitFor({ timeout: 10000 });
  check(true, 'Noch keine Passkeys');
  await card.getByRole('button', { name: 'Passkey hinzufügen' }).click();
  await card.getByLabel('Zur Bestätigung dein Passwort').fill(password);
  await card.getByRole('button', { name: 'Weiter' }).click();
  const name = card.getByLabel('Name des Passkeys');
  await name.waitFor({ timeout: 10000 });
  check((await name.inputValue()).includes('Chrome'), 'Name aus Browser und System vorbelegt', await name.inputValue());
  await name.fill('Testgerät');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/passkey-register-desktop.png` });
  await card.getByRole('button', { name: 'Passkey anlegen' }).click();
  await card.locator('[data-recovery-codes]').waitFor({ timeout: 10000 });
  check((await card.locator('[data-recovery-code]').count()) === 10, 'erster Passkey zeigt zehn Wiederherstellungscodes');
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  check(credentials.length === 1 && credentials[0].isResidentCredential, 'Passkey im Authenticator als auffindbarer Schlüssel', credentials);
  await card.getByRole('button', { name: 'Ich habe die Codes gesichert' }).click();
  check(await card.getByText('Testgerät').isVisible(), 'Passkey in der Liste');
  check(await page.locator('[data-security-card="two-factor"]').getByText('Ein', { exact: true }).isVisible(), 'Zwei-Faktor-Anmeldung durch den Passkey eingeschaltet');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/passkey-list-desktop.png`, fullPage: true });

  // --- Sign out, sign in without password: from the autofill of the login field … ---
  // (the virtual authenticator answers the waiting "conditional" request by itself, as a person picking
  // the passkey in the field's suggestions would)
  await signOut(page);
  await appReady(page);
  check(true, 'Anmeldung ohne Passwort aus dem Autofill des Anmeldefelds');

  // … and with the button (the authenticator only answers once it is pressed)
  // The authenticator answers only requests started while presence is on: switching it on after the click
  // raced the button's request (left waiting for good when it was faster). So it stays off until the
  // autofill's waiting request has started (that one is never answered then), and the click comes after.
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
  const autofillWaiting = page.waitForResponse((r) => r.url().endsWith('/auth/login/passkey/options'));
  await signOut(page);
  await autofillWaiting;
  await page.waitForTimeout(300);
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: true });
  const passkeyButton = page.getByRole('button', { name: 'Mit Passkey anmelden' });
  await passkeyButton.click();
  await appReady(page);
  check(true, 'Anmeldung ohne Passwort mit dem Knopf „Mit Passkey anmelden“');

  // --- Password, then the passkey as second step ---
  // The authenticator stays quiet while the password is typed (else the autofill would sign in)
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
  await signOut(page);
  await signInWithPassword(page, login, password);
  await secondStep(page).waitFor({ timeout: 10000 });
  check(await page.getByText(/Bestätige die Anmeldung mit deinem Passkey/).isVisible(), 'zweiter Schritt bietet den Passkey zuerst an');
  check((await page.getByLabel('Code', { exact: true }).count()) === 0, 'kein Feld für einen App-Code ohne App');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/passkey-mfa-desktop.png` });
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: true });
  await page.getByRole('button', { name: 'Mit Passkey bestätigen' }).click();
  await appReady(page);
  check(true, 'Anmeldung mit Passwort und Passkey als zweitem Faktor');

  // --- A phone: the second step with passkey, 44 px targets ---
  const phone = await browser.newContext(PHONE);
  await phone.addInitScript(() => sessionStorage.setItem('mindsift_pwa_dismissed', '1'));
  const p = await phone.newPage();
  await p.goto(PLAIN + '/');
  const phoneButton = p.getByRole('button', { name: 'Mit Passkey anmelden' });
  await phoneButton.waitFor({ timeout: 10000 });
  check(Math.round((await phoneButton.boundingBox()).height) >= 44, 'Handy: Knopf „Mit Passkey anmelden“ mindestens 44 px hoch');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/passkey-login-phone.png` });
  await signInWithPassword(p, login, password);
  await secondStep(p).waitFor({ timeout: 10000 });
  const heights = await p.evaluate(() =>
    [...document.querySelectorAll('[data-mfa-step] button')].filter((el) => el.getAttribute('role') !== 'switch').map((el) => Math.round(el.getBoundingClientRect().height))
  );
  check(heights.length >= 3 && heights.every((h) => h >= 44), 'Handy: Knöpfe des zweiten Schritts mindestens 44 px hoch', heights);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/passkey-mfa-phone.png` });
  await phone.close();

  // --- Remove it, confirmed with the passkey: two-factor sign-in goes off ---
  const card2 = await openSecurity(page);
  if (SHOTS) {
    await page.setViewportSize({ width: 400, height: 860 });
    await card2.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/passkey-list-narrow.png` });
    await page.setViewportSize(DESKTOP.viewport);
  }
  await card2.locator('[data-passkey]').getByRole('button', { name: 'Entfernen' }).click();
  const sheet = page.locator('form').filter({ has: page.getByText('Passkey entfernen') });
  check(await sheet.getByText(/Das ist dein letzter zweiter Faktor/).isVisible(), 'Warnung vor dem Entfernen des letzten zweiten Faktors');
  await sheet.getByLabel('Passwort').fill(password);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/passkey-remove-desktop.png` });
  await sheet.getByRole('button', { name: 'Mit Passkey bestätigen' }).click();
  await page.getByText('Passkey entfernt. Die Zwei-Faktor-Anmeldung ist ausgeschaltet.').waitFor({ timeout: 10000 });
  check(true, 'Passkey mit dem Passkey als Bestätigung entfernt');
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
  await signOut(page);
  await signInWithPassword(page, login, password);
  await appReady(page);
  check((await secondStep(page).count()) === 0, 'danach reicht wieder das Passwort');
  check(errors.length === 0, 'Chromium: keine Fehler im Browser', errors);
  await browser.close();
}

// Firefox: no virtual authenticator; login and settings work and show the passkey parts
async function runFirefox(admin) {
  const { login, password } = await newAccount(admin, 'firefox');
  const browser = await firefox.launch();
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => sessionStorage.setItem('mindsift_pwa_dismissed', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PLAIN + '/');
  check(await page.getByRole('button', { name: 'Mit Passkey anmelden' }).isVisible(), 'Firefox: Knopf „Mit Passkey anmelden“ da');
  await signInWithPassword(page, login, password);
  await appReady(page);
  const card = await openSecurity(page);
  // The card loads its state first: wait for the button instead of looking once
  const addShown = await card.getByRole('button', { name: 'Passkey hinzufügen' }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(addShown, 'Firefox: Passkeys in den Einstellungen');
  check(errors.length === 0, 'Firefox: keine Fehler im Browser', errors);
  await browser.close();
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: PLAIN_ADMIN, password: PLAIN_PASSWORD })).token;
  await runChromium(admin);
  await runFirefox(admin);
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
