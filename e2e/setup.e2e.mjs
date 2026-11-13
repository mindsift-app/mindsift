// The first-boot setup wizard with its one-time setup code (internal/api/setup_code.go,
// frontend/src/features/auth/SetupAndAuthView.tsx). Needs a fresh server without the demo and without
// ADMIN_USER (MINDSIFT_SETUP_URL); run.sh reads the code from that container's log and passes it as
// MINDSIFT_SETUP_CODE. German interface. The wizard asks for the code, refuses a wrong one, creates the
// admin with the right one, and the code is no longer accepted afterwards. The time zone field suggests the
// browser's zone (Asia/Tokyo here), which becomes the server's.
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_SETUP_URL || 'http://localhost:18084';
const CODE = process.env.MINDSIFT_SETUP_CODE || '';
const PASSWORD = 'Ersteinrichtung-2026';
let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'de', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const PHONE = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: 'de-DE' };
// A browser in Tokyo, whose zone the wizard suggests
const DESKTOP = { viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Asia/Tokyo' };

async function fillAccount(page, code) {
  await page.locator('[data-setup-code]').fill(code);
  await page.getByPlaceholder('z.B. Admin / Dein Name').fill('Chefin');
  await page.getByPlaceholder('admin@deinedomain.de').fill('chefin@example.com');
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
}

const submit = (page) => page.getByRole('button', { name: /Ersteinrichtung abschließen/ }).click();

const main = async () => {
  check(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(CODE), 'Einrichtungscode aus dem Server-Log gelesen', CODE);
  const status = await call('GET', '/api/v1/auth/status');
  check(status.body?.needsSetup === true && status.body?.setupCodeRequired === true, 'Status: Ersteinrichtung mit Code', status.body);
  const register = await call('POST', '/api/v1/auth/register', { email: 'frueh@example.com', password: PASSWORD });
  check(register.status === 403 && register.body?.code === 'setup_required', 'Registrierung legt kein erstes Konto an', register);

  const browser = await chromium.launch();

  // Phone: the field is there, big enough to tap, and says where the code is
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    const field = page.locator('[data-setup-code]');
    await field.waitFor({ state: 'visible', timeout: 15000 });
    const box = await field.boundingBox();
    check(box && box.height >= 44, 'Handy: Code-Feld mindestens 44 px hoch', box);
    check((await page.getByText('docker logs mindsift').count()) === 1, 'Handy: Hinweis auf das Server-Log');
    await ctx.close();
  }

  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.getByText('MindSift Ersteinrichtung').waitFor({ timeout: 15000 });
  check((await page.getByLabel('Einrichtungscode *').count()) === 1, 'Assistent fragt nach dem Einrichtungscode');
  check(
    await page.locator('[data-setup-code]').evaluate((el) => el === document.activeElement),
    'Code-Feld hat den Fokus'
  );
  const zoneField = page.getByRole('button', { name: 'Zeitzone' });
  check((await zoneField.textContent()).includes('Asia/Tokyo'), 'Zeitzone des Browsers vorgeschlagen', await zoneField.textContent());

  // A wrong code: refused with the server's message, no account
  const wrong = CODE.startsWith('A') ? 'BBBB-BBBB-BBBB' : 'AAAA-AAAA-AAAA';
  await fillAccount(page, wrong);
  await submit(page);
  const alert = page.getByRole('alert');
  await alert.waitFor({ timeout: 10000 });
  check((await alert.textContent()).includes('Der Einrichtungscode stimmt nicht'), 'Falscher Code wird abgelehnt', await alert.textContent());
  check((await call('GET', '/api/v1/auth/status')).body?.needsSetup === true, 'Nach falschem Code kein Konto');

  // After three wrong codes the address is locked for a while, and the wizard says so for the setup (not
  // for the sign-in); the right code still goes through below
  const answered = () => page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/setup'), { timeout: 10000 });
  for (let i = 0; i < 2; i++) await Promise.all([answered(), submit(page)]);
  const [lockAnswer] = await Promise.all([answered(), submit(page)]);
  check(lockAnswer.status() === 429, 'Gesperrt: 429', lockAnswer.status());
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent?.includes('gesperrt'), null, { timeout: 10000 });
  const locked = await page.getByRole('alert').textContent();
  check(locked.includes('Die Einrichtung ist für noch') && !locked.includes('Anmeldung'), 'Nach drei falschen Codes: Einrichtung gesperrt', locked);

  // The right one, typed in lower case: the admin exists and is signed in
  await page.locator('[data-setup-code]').fill(CODE.toLowerCase());
  await submit(page);
  await page.waitForFunction(() => !!localStorage.getItem('mindsift_jwt_token'), null, { timeout: 15000 });
  await page.locator('[data-setup-code]').waitFor({ state: 'detached', timeout: 15000 });
  check(true, 'Richtiger Code legt das Admin-Konto an und meldet an');
  const after = (await call('GET', '/api/v1/auth/status')).body;
  check(after?.needsSetup === false && after?.setupCodeRequired === false, 'Status: eingerichtet, kein Code mehr', after);
  const again = await call('POST', '/api/v1/auth/setup', { email: 'zweite@example.com', password: PASSWORD, setupCode: CODE });
  check(again.status === 403, 'Code gilt nach der Einrichtung nicht mehr', again);
  const login = await call('POST', '/api/v1/auth/login', { login: 'chefin@example.com', password: PASSWORD });
  check(login.status === 200 && !!login.body?.token, 'Anmeldung als neue Administratorin', login.status);
  const settings = (await call('GET', '/api/v1/admin/settings', undefined, login.body?.token)).body;
  check(
    settings?.timeZone === 'Asia/Tokyo' && settings?.serverTime?.zone === 'Asia/Tokyo' && settings?.serverTime?.source === 'setting',
    'Zeitzone aus dem Assistenten gespeichert und in Kraft',
    { timeZone: settings?.timeZone, serverTime: settings?.serverTime }
  );
  check(errors.length === 0, 'Keine Fehler im Browser', errors);

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
