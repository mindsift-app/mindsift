// Key views in English (browser language en-US) on desktop and phone, for checking translations and line breaks.
// Run against a demo server: MINDSIFT_URL=http://localhost:PORT OUT=/shots node enshots.mjs (see refshots.sh for the container setup)
import { chromium } from 'playwright';
const BASE = process.env.MINDSIFT_URL || 'http://localhost:18700';
const OUT = process.env.OUT || '/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (u) =>
  (await (await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: u, password: u }) })).json()).token;
const b = await chromium.launch();
const shot = async (p, name) => {
  await sleep(700);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('OK', name);
};
const safe = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log('FAIL', name, String(e).split('\n')[0]);
  }
};

// Sign-in screen without session
{
  const c = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark' });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.waitForLoadState('networkidle');
  await shot(p, 'd00_login');
  await c.close();
}

const token = await login('admin');
for (const [dev, opts] of [
  ['d', { viewport: { width: 1440, height: 900 } }],
  ['m', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
]) {
  const c = await b.newContext({ ...opts, locale: 'en-US', colorScheme: 'dark', timezoneId: 'Europe/Berlin' });
  await c.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    sessionStorage.setItem('mindsift_pwa_offer_shown', '1');
    localStorage.setItem('mindsift:demo-hint-closed', '1'); // the demo's public notice is not part of the pictures
    localStorage.setItem('mindsift:tour-offered', '1'); // nor is the offer of the guided tour
  }, token);
  const p = await c.newPage();
  await p.goto(BASE);
  await p.waitForLoadState('networkidle');
  await p.getByText('Keep using it in the browser').click({ timeout: 2500 }).catch(() => {});
  await shot(p, `${dev}01_triage`);
  const tab = async (name) => {
    if (dev === 'd') await p.getByRole('button', { name: new RegExp('^' + name) }).locator('visible=true').first().click();
    else await p.locator('[data-mobile-nav]').getByText(name, { exact: true }).click();
    await p.waitForLoadState('networkidle');
  };
  await safe('tasks', async () => {
    await tab('Tasks');
    await shot(p, `${dev}02_tasks`);
    await p.getByText(/^Kanban$/).locator('visible=true').first().click({ timeout: 3000 });
    await shot(p, `${dev}03_kanban`);
    await p.getByText(/^List$/).locator('visible=true').first().click({ timeout: 3000 }).catch(() => {});
  });
  await safe('task detail', async () => {
    await p.locator('[data-task-row], li').filter({ hasText: /./ }).first();
    await p.getByTitle('Edit task').first().click({ timeout: 3000 });
    await shot(p, `${dev}04_task_detail`);
    await p.keyboard.press('Escape');
    await sleep(400);
  });
  await safe('workspace', async () => {
    await tab('Workspace');
    await shot(p, `${dev}05_workspace`);
    await p.getByText(/^Homelab/).first().click({ timeout: 3000 });
    await shot(p, `${dev}06_note`);
  });
  await safe('lists', async () => {
    await tab('Lists');
    await shot(p, `${dev}07_lists`);
  });
  await safe('settings', async () => {
    await p.getByTitle(dev === 'd' ? 'Open user menu' : 'Profile & settings').first().click();
    await shot(p, `${dev}08_profile_menu`);
    await p.getByRole('button', { name: /Account settings/ }).locator('visible=true').first().click();
    await shot(p, `${dev}09_settings`);
    await p.getByText('Language of the interface').click();
    await shot(p, `${dev}10_language`);
    await p.getByText('Email, Discord & webhooks').click();
    await shot(p, `${dev}11_alarms`);
    await p.getByText('Keys, curl, smart home & AI agents').click();
    await shot(p, `${dev}12_api`);
  });
  await safe('help', async () => {
    if (dev === 'd') await p.locator('[data-tour="help-entry"]').locator('visible=true').first().click();
    else {
      await p.getByTitle('Profile & settings').first().click();
      await p.getByRole('button', { name: /Help & guide/ }).locator('visible=true').first().click();
    }
    await shot(p, `${dev}13_help`);
  });
  await safe('search', async () => {
    await p.getByTitle(dev === 'd' ? /Global search \(/ : 'Global search').first().click();
    await p.keyboard.type('home');
    await shot(p, `${dev}14_search`);
    await p.keyboard.press('Escape');
  });
  if (dev === 'm')
    await safe('capture', async () => {
      await tab('Triage');
      await p.locator('[data-mobile-nav] button').nth(2).click();
      await shot(p, `${dev}15_capture`);
    });
  await c.close();
}
await b.close();
