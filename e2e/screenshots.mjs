// Takes the README screenshots from a fresh server in demo mode (English sample data of admin/admin).
// The title picture and the colour-family grid are taken twice in the same state – light and dark
// theme – and joined along a slanted diagonal (light left, dark right); the others are plain light
// or dark pictures.
// Usage: e2e/screenshots.sh (builds the image) or MINDSIFT_URL=… SHOTS_DIR=… node screenshots.mjs
// Theme pair: SHOT_LIGHT / SHOT_DARK (default: light / dark, the "Klassik" family)
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const OUT = process.env.SHOTS_DIR || '../screenshots';
const LIGHT = process.env.SHOT_LIGHT || 'light';
const DARK = process.env.SHOT_DARK || 'dark';
const DESKTOP = { viewport: { width: 1518, height: 886 }, deviceScaleFactor: 2 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Colour families for the theme grid in the README (Klassik is the title picture)
const FAMILIES = [
  ['fjord', 'fjord', 'fjord-night'],
  ['terracotta', 'terracotta', 'terracotta-night'],
  ['polarized', 'polarized-light', 'polarized'],
  ['suri', 'suri-light', 'suri'],
];

async function login(user) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: user, password: user }),
  });
  if (!res.ok) throw new Error(`login ${user}: ${res.status}`);
  return (await res.json()).token;
}

async function open(browser, token, options) {
  const ctx = await browser.newContext({ ...options, colorScheme: 'dark', locale: 'en-US' });
  await ctx.addInitScript(
    ([t, theme]) => {
      localStorage.setItem('mindsift_jwt_token', t);
      localStorage.setItem('mindsift_active_theme', theme);
    },
    [token, DARK]
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  return page;
}

// Anchored, so "Workspace" does not hit the triage button "As note – in the workspace"
const tab = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).locator('visible=true').first().click();

// Switches the theme in place (no reload), so both halves show exactly the same state
async function setTheme(page, id, dark) {
  await page.evaluate(
    ([themeId, isDark]) => {
      const root = document.documentElement;
      root.setAttribute('data-theme', themeId);
      root.classList.toggle('dark', isDark);
    },
    [id, dark]
  );
  await sleep(250);
}

let composer;
// Light picture on the left of the diagonal, dark on the right, a thin line between them;
// scale < 1 shrinks the result (small pictures of the theme grid)
async function compose(lightPng, darkPng, file, scale = 1) {
  const dataUrl = await composer.evaluate(
    async ([light, dark, scale]) => {
      const load = (b64) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = 'data:image/png;base64,' + b64;
        });
      const [a, b] = await Promise.all([load(light), load(dark)]);
      const w = Math.round(a.naturalWidth * scale);
      const h = Math.round(a.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(b, 0, 0, w, h);
      const top = w * 0.58;
      const bottom = w * 0.42;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(top, 0);
      ctx.lineTo(bottom, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(a, 0, 0, w, h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = Math.max(2, w / 600);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = w / 300;
      ctx.beginPath();
      ctx.moveTo(top, 0);
      ctx.lineTo(bottom, h);
      ctx.stroke();
      return canvas.toDataURL('image/png');
    },
    [lightPng.toString('base64'), darkPng.toString('base64'), scale]
  );
  fs.writeFileSync(`${OUT}/${file}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

// Diagonal light/dark picture
async function shot(page, file, { light = LIGHT, dark = DARK, scale = 1 } = {}) {
  await sleep(800); // animations
  await page.mouse.move(0, 0);
  await setTheme(page, light, false);
  const lightPng = await page.screenshot();
  await setTheme(page, dark, true);
  const darkPng = await page.screenshot();
  await compose(lightPng, darkPng, file, scale);
  console.log(`OK   ${file}`);
}

// Plain picture in one theme ('light' or 'dark' of the chosen pair)
async function plain(page, file, mode) {
  await sleep(800);
  await page.mouse.move(0, 0);
  if (mode === 'light') await setTheme(page, LIGHT, false);
  else await setTheme(page, DARK, true);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`OK   ${file}`);
}

const main = async () => {
  const admin = await login('admin');
  const user = await login('user');
  const browser = await chromium.launch({ args: ['--lang=en-US'] });
  composer = await (await browser.newContext()).newPage();

  const page = await open(browser, admin, DESKTOP);
  await tab(page, 'Triage');
  await shot(page, 'Triage_desktop.png');

  await tab(page, 'Tasks');
  await page.getByText('Homelab', { exact: true }).first().click().catch(() => {});
  await page.getByRole('button', { name: /Kanban|Board/ }).first().click().catch(() => {});
  await plain(page, 'aufgaben_desktop.png', 'dark');
  // Colour families: the board fills the width, so both halves of the diagonal show content
  for (const [family, light, dark] of FAMILIES) {
    await shot(page, `Theme_${family}.png`, { light, dark, scale: 0.5 });
  }

  // The demo user edits a bullet of the shared note, so the screenshot shows lock and presence
  const other = await open(browser, user, DESKTOP);
  await tab(other, 'Workspace');
  await other.getByText(/^Homelab 2\.0/).first().click();
  await other.waitForFunction(() => document.querySelectorAll('textarea').length > 5, null, { timeout: 10000 });
  await other.getByText('Finally room for the services', { exact: false }).first().click();
  await other.keyboard.press('End');
  await other.keyboard.type(': Paperless and Immich', { delay: 20 });

  await tab(page, 'Workspace');
  await page.getByText(/^Homelab 2\.0/).first().click();
  await page.waitForFunction(() => document.querySelectorAll('textarea').length > 5, null, { timeout: 10000 });
  await page.getByText('User', { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(2000);
  await plain(page, 'workspace_desktop.png', 'light');

  // Journal: a few days with entries, the calendar in the sidebar
  const H = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (offset) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset));
  await fetch(`${BASE}/api/v1/journal/${day(0)}`, { method: 'POST', headers: H });
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await sleep(1500);
  const write = async (date, lines) => {
    const section = page.locator(`[data-journal-date="${date}"]`);
    if ((await section.count()) === 0) return; // day outside the visible month
    await section.locator('.cursor-text').first().click();
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Enter');
      await page.keyboard.type(lines[i], { delay: 5 });
    }
    await sleep(600);
  };
  await write(day(0), ['Standup: the move is on schedule #homelab', 'Afternoon: backup test with restic', 'Idea: make a template for the weekly review']);
  for (const offset of [2, 5]) {
    await page.getByTitle(new RegExp(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).toLocaleDateString('en-US', { day: 'numeric', month: 'long' }))).first().click().catch(() => {});
    await sleep(1200);
    await write(day(offset), offset === 2 ? ['Mowed the lawn, the hedge still has to wait #garden'] : ['First thoughts on the house renovation #renovation', 'Get quotes by the end of the month']);
  }
  await page.getByRole('button', { name: 'Today' }).click().catch(() => {});
  await page.mouse.click(1000, 860);
  await sleep(2500);
  // Round corners (setting "Corners: round") for this picture only
  await page.evaluate(() => document.documentElement.setAttribute('data-corners', 'round'));
  await plain(page, 'journal_desktop.png', 'dark');
  await page.evaluate(() => document.documentElement.removeAttribute('data-corners'));
  await page.getByRole('button', { name: 'Journal', exact: true }).click(); // close it again

  await tab(page, 'Lists');
  await page.getByText('Weekly groceries', { exact: true }).first().click().catch(() => {});
  await plain(page, 'Listen_desktop.png', 'light');

  const mobile = await open(browser, admin, MOBILE);
  await mobile.getByText('Keep using it in the browser').click({ timeout: 5000 }).catch(() => {}); // install prompt
  await plain(mobile, 'Mobile_Triage.png', 'light');

  await tab(mobile, 'Workspace');
  await sleep(600);
  await mobile.getByText(/^Homelab 2\.0/).first().click();
  await sleep(1500);
  await plain(mobile, 'Mobile_Workspace.png', 'dark');

  await browser.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
