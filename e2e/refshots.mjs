// Reference screenshots for refactors (Doku/plans/frontend-aufteilen.md): takes the same set of views
// on desktop and phone from a fresh demo server, and compares two such sets pixel by pixel.
// Client clock fixed, animations and the caret off, and every run starts from the same database (see
// refshots.sh), so two runs of the same code give the same pictures. Known exceptions, real server times:
// the login time in the session list (d14) and the deletion time in the task trash (d17).
//
//   MODE=capture OUT=/shots/before node refshots.mjs
//   MODE=compare A=/shots/before B=/shots/after OUT=/shots/diff node refshots.mjs
//
// e2e/refshots.sh runs both against images built from two Git revisions.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
const MODE = process.env.MODE || 'capture';
const OUT = process.env.OUT || '/shots/out';
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Today at 10:00 local time: same greeting and same "heute/morgen" in every run of a day
const now = new Date();
const FIXED = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0);

const FREEZE_CSS = `*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }`;

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
  const ctx = await browser.newContext({ ...options, colorScheme: 'dark', locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  await ctx.addInitScript(
    ([t]) => {
      localStorage.setItem('mindsift_jwt_token', t);
      localStorage.setItem('mindsift_active_theme', 'dark');
    },
    [token]
  );
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: FREEZE_CSS });
  return page;
}

const tab = (page, name) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) }).locator('visible=true').first().click();
// Phone: the bottom bar (badges come before the label there)
const navTab = (page, name) => page.locator('[data-mobile-nav]').getByRole('button', { name: new RegExp(name) }).first().click();
const exact = (page, name) => page.getByRole('button', { name, exact: true }).locator('visible=true').first().click();
// Bottom right: no edge that slides something in (focus mode), no bullet that shows its action bubble
const park = (page) => {
  const v = page.viewportSize();
  return page.mouse.move(v.width - 2, v.height - 2);
};

let failures = 0;
async function shot(page, name) {
  await sleep(700);
  await park(page);
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  // The version rises with every dev push: a fixed placeholder, so it never shows as a difference
  await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (/v\d+\.\d+\.\d+/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/v\d+\.\d+\.\d+(-dev)?/g, 'v0.0.0');
    }
  });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`OK   ${name}`);
}

// One step: run the navigation, take the picture; a failing step is reported and skipped
async function step(page, name, go) {
  try {
    await go();
    await shot(page, name);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    // What the page showed when the step failed (not part of a comparison)
    await page.screenshot({ path: path.join(OUT, `FAIL_${name}.png`) }).catch(() => {});
  }
}

async function capture() {
  fs.mkdirSync(OUT, { recursive: true });
  const admin = await login('admin');
  const browser = await chromium.launch({ args: ['--lang=de-DE'] });

  // --- Desktop ---
  const d = await open(browser, admin, DESKTOP);
  await step(d, 'd01_triage', () => tab(d, 'Triage'));
  await step(d, 'd02_tasks_all_list', async () => {
    await tab(d, 'Aufgaben');
    await d.getByRole('button', { name: /^Alle Aufgaben/ }).first().click();
    await exact(d, 'Liste');
  });
  await step(d, 'd03_tasks_all_kanban', () => exact(d, 'Kanban'));
  await step(d, 'd04_tasks_list_kanban', async () => {
    await d.getByRole('button', { name: /Homelab/ }).locator('visible=true').first().click();
    await exact(d, 'Kanban');
  });
  await step(d, 'd05_tasks_list_list', () => exact(d, 'Liste'));
  await step(d, 'd06_task_detail', async () => {
    await d.getByText(/Nginx-Timeouts/).first().click();
    await sleep(500);
  });
  await d.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await step(d, 'd07_workspace_note', async () => {
    await tab(d, 'Workspace');
    await d.getByText(/^Homelab 2\.0/).first().click();
    await d.waitForFunction(() => document.querySelectorAll('textarea').length > 5, null, { timeout: 10000 });
  });
  await step(d, 'd08_workspace_todos', () => d.getByRole('button', { name: /^To-Dos/ }).locator('visible=true').first().click());
  await step(d, 'd09_workspace_tags', () => d.getByRole('button', { name: /^Hashtags/ }).locator('visible=true').first().click());
  await step(d, 'd09b_workspace_tags_search', async () => {
    await d.getByTitle('Alphabetisch sortieren').click();
    await d.getByPlaceholder('Hashtags durchsuchen…').fill('m');
  });
  await d.getByPlaceholder('Hashtags durchsuchen…').fill('').catch(() => {});
  await step(d, 'd10_workspace_tag_detail', () => d.getByText('#homelab').locator('visible=true').first().click());
  await step(d, 'd11_workspace_journal', async () => {
    await d.getByRole('button', { name: /^Notizen/ }).locator('visible=true').first().click();
    await d.getByRole('button', { name: 'Journal', exact: true }).click();
    await sleep(800);
  });
  await step(d, 'd12_focus_mode', async () => {
    await d.getByRole('button', { name: 'Journal', exact: true }).click(); // close
    await d.getByText(/^Homelab 2\.0/).first().click();
    await sleep(600);
    await d.keyboard.press('Control+Shift+F');
  });
  await step(d, 'd12b_focus_pinned', async () => {
    await d.mouse.move(700, 2); // the header slides in at the top edge
    await sleep(400);
    await d.getByTitle('Leiste anpinnen', { exact: true }).click();
    await d.getByTitle('Ordner und Notizen einblenden').click();
    await sleep(400);
    await d.getByTitle('Seitenleiste anpinnen').click();
    await d.mouse.move(900, 500);
    await sleep(400);
  });
  await d.getByTitle('Seitenleiste lösen').click().catch(() => {});
  await d.getByTitle('Leiste lösen', { exact: true }).click().catch(() => {});
  await d.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await step(d, 'd12c_note_share', async () => {
    // Share dialog of the open note "Homelab 2.0" (button in the row above the workspace)
    await d.getByTitle(/Teilen-Menü öffnen|Teilen & Berechtigungen öffnen/).locator('visible=true').first().click();
    await sleep(600);
  });
  await d.getByRole('button', { name: 'Schließen', exact: true }).locator('visible=true').first().click().catch(() => {});
  await sleep(300);
  await step(d, 'd13_lists', async () => {
    await tab(d, 'Listen');
    await d.getByText('Wocheneinkauf', { exact: true }).first().click().catch(() => {});
  });
  await step(d, 'd13c_list_share', async () => {
    // Share dialog of the open list (button on the right of the list tabs)
    await d.getByTitle(/^(Teilen-Menü öffnen|Teilen & Berechtigungen öffnen|Liste teilen und Berechtigungen)/).locator('visible=true').first().click();
    await sleep(600);
  });
  await d.getByRole('button', { name: 'Schließen', exact: true }).locator('visible=true').first().click().catch(() => {});
  await sleep(300);
  await step(d, 'd13b_profile_menu', () => d.getByTitle('Benutzermenü öffnen').first().click());
  await d.getByTitle('Benutzermenü öffnen').first().click().catch(() => {}); // close again
  await sleep(300);
  await step(d, 'd14_user_settings', async () => {
    await d.getByTitle('Benutzermenü öffnen').first().click();
    await d.getByRole('button', { name: /Kontoeinstellungen/ }).locator('visible=true').first().click();
  });
  // Every section of the account settings, in a tall window (the sections are long)
  await d.setViewportSize({ width: 1440, height: 2600 });
  for (const [key, label] of [
    ['profile', 'Profil & Sicherheit'],
    ['appearance', 'Darstellung & Themes'],
    ['alarms', 'Alarme'],
    ['voice', 'Spracheingabe'],
    ['retention', 'Aufbewahrung'],
    ['api', 'API'],
    ['data', 'Export & Import'],
  ]) {
    const button = d.locator('aside button', { hasText: label }).locator('visible=true').first();
    if (!(await button.count())) continue; // voice input only with a Whisper server
    await step(d, `d14_us_${key}`, () => button.click());
  }
  // Unsaved input survives switching sections (the state lives in the view, not in the section)
  await step(d, 'd14_us_unsaved_kept', async () => {
    await d.locator('aside button', { hasText: 'Profil & Sicherheit' }).first().click();
    await d.locator('label', { hasText: 'Anzeigename' }).locator('xpath=following-sibling::input').fill('Admin geändert');
    await d.locator('aside button', { hasText: 'Alarme' }).first().click();
    await d.locator('label', { hasText: 'Abweichende Empfänger-E-Mail' }).locator('xpath=following-sibling::input').fill('alarm@example.org');
    await d.locator('aside button', { hasText: 'Profil & Sicherheit' }).first().click();
  });
  await step(d, 'd14_us_unsaved_kept_alarms', () => d.locator('aside button', { hasText: 'Alarme' }).first().click());
  await step(d, 'd14_us_danger_sheet', async () => {
    // The danger zone asks for the password first
    await d.locator('aside button', { hasText: 'Profil & Sicherheit' }).first().click();
    await d.getByRole('button', { name: 'Daten löschen', exact: true }).click();
    await sleep(300);
  });
  await d.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await d.setViewportSize({ width: 1440, height: 900 });
  await step(d, 'd15_admin_settings', async () => {
    await d.getByTitle('Benutzermenü öffnen').first().click();
    await d.getByRole('button', { name: /Administration/ }).locator('visible=true').first().click();
  });
  // Every section of the administration, in a tall window
  await d.setViewportSize({ width: 1440, height: 2600 });
  for (const [key, label] of [
    ['users', 'Benutzer & Einladungen'],
    ['orgs', 'Organisationen'],
    ['server', 'Server & Isolation'],
    ['smtp', 'E-Mail / SMTP-Server'],
  ]) {
    await step(d, `d15_as_${key}`, () => d.locator('aside button', { hasText: label }).first().click());
  }
  await d.setViewportSize({ width: 1440, height: 900 });
  await step(d, 'd16_help', () => d.getByTitle('Hilfe & Dokumentation').first().click());
  await step(d, 'd16b_help_scroll_kept', async () => {
    // Each page keeps its scroll position: scrolled help, another page, back to the help
    await d.evaluate(() => {
      document.querySelector('[data-app-scroll]').scrollTop = 700;
    });
    await sleep(300);
    await tab(d, 'Listen');
    await sleep(600);
    await d.getByTitle('Hilfe & Dokumentation').first().click();
    await sleep(800);
  });
  await step(d, 'd16c_command_palette', async () => {
    // Ctrl+K toggles the search, '/' outside a text field opens it
    await d.keyboard.press('Control+k');
    await sleep(300);
    await d.keyboard.press('Control+k');
    await sleep(300);
    await d.keyboard.press('/');
    await sleep(500);
  });
  await d.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await step(d, 'd17_tasks_trash', async () => {
    // One task into the trash (always the same one), then the trash of "Alle Aufgaben"
    const H = { Authorization: `Bearer ${admin}` };
    const tasks = await (await fetch(`${BASE}/api/v1/tasks`, { headers: H })).json();
    const victim = tasks.find((t) => t.content.startsWith('Hecke schneiden'));
    if (victim) await fetch(`${BASE}/api/v1/thoughts/${victim.id}`, { method: 'DELETE', headers: H });
    await tab(d, 'Aufgaben');
    await d.getByRole('button', { name: /^Alle Aufgaben/ }).first().click();
    await exact(d, 'Liste');
    await d.getByRole('button', { name: /^Papierkorb \(/ }).locator('visible=true').first().click();
  });
  await step(d, 'd19_tasklist_share', async () => {
    // Share dialog of the selected list "Homelab" (its tab has the share button)
    await d.setViewportSize({ width: 1440, height: 900 });
    await d.getByRole('button', { name: /Homelab/ }).locator('visible=true').first().click();
    await sleep(400);
    await d.getByTitle(/Aufgabenliste teilen|Teilen & Berechtigungen|Teilen-Menü öffnen/).locator('visible=true').first().click();
    await sleep(400);
  });
  await d.getByRole('button', { name: 'Schließen', exact: true }).locator('visible=true').first().click().catch(() => {});
  await d.getByRole('button', { name: /^Alle Aufgaben/ }).first().click().catch(() => {});
  await sleep(400);
  await step(d, 'd18_tags_expanded_filtered', async () => {
    // Kanban in a narrower window (the hashtag row is cut off there): open all hashtags, filter by one
    await d.setViewportSize({ width: 900, height: 900 });
    await exact(d, 'Kanban');
    await sleep(500);
    await d.getByTitle('Alle Hashtags zeigen').click();
    await d.getByRole('button', { name: /^#backup/ }).locator('visible=true').first().click();
  });

  // Logging out ends the session (last on the desktop) and signing in again by the form
  await d.setViewportSize({ width: 1440, height: 900 });
  await step(d, 'd20_logged_out', async () => {
    await d.getByTitle('Benutzermenü öffnen').first().click();
    await d.getByRole('button', { name: 'Abmelden' }).locator('visible=true').first().click();
    await d.getByPlaceholder('admin oder name@beispiel.de').waitFor();
  });
  await step(d, 'd20b_logged_in', async () => {
    await d.getByPlaceholder('admin oder name@beispiel.de').fill('admin');
    await d.getByPlaceholder('••••••••').fill('admin');
    await d.locator('form button[type="submit"]').click();
    await d.getByTitle('Benutzermenü öffnen').first().waitFor();
    // The triage card flies in after the login: wait until it has settled
    await d.waitForLoadState('networkidle');
    await sleep(2000);
  });

  // --- Phone --- (a session of its own: the desktop one was logged out)
  const m = await open(browser, await login('admin'), MOBILE);
  // The install offer comes up on the first visit; with no browser prompt (headless), installing shows the guide
  await step(m, 'm00_pwa_offer', () => m.getByText('Später im Browser weiter nutzen').waitFor({ timeout: 3000 }));
  await step(m, 'm00b_pwa_guide', async () => {
    await m.getByRole('button', { name: 'Jetzt als Web-App installieren' }).click();
    await sleep(300);
  });
  await m.getByRole('button', { name: 'Verstanden' }).click().catch(() => {});
  await m.getByText('Später im Browser weiter nutzen').click({ timeout: 1000 }).catch(() => {});
  await sleep(300);
  await step(m, 'm01_triage', () => sleep(100));
  await step(m, 'm02_tasks', () => navTab(m, 'Aufgaben'));
  await step(m, 'm03_tasks_kanban', async () => {
    // On phones the views are switched in the menu at the top
    await m.getByTitle('Menü & Ansichts-Optionen öffnen').first().click();
    await m.getByRole('button', { name: /Kanban-Board Ansicht/ }).locator('visible=true').first().click();
  });
  await step(m, 'm07_task_sheet', async () => {
    // New task on the phone: the + button opens the sheet; a draft with text and priority
    await m.getByTitle('Schnell erfassen (+)').tap();
    await m.getByPlaceholder('Was ist zu tun?…').fill('Fahrradschloss ölen');
    await m.getByRole('button', { name: 'Wichtig', exact: true }).tap();
  });
  await m.getByRole('button', { name: 'Abbrechen', exact: true }).tap().catch(() => {});
  await sleep(300);
  await step(m, 'm08_tasks_menu', () => m.getByTitle('Menü & Ansichts-Optionen öffnen').first().click());
  await m.getByTitle('Menü schließen').first().click().catch(() => {});
  await sleep(300);
  await step(m, 'm09_filter_sheet', async () => {
    // Filter sheet from the menu, with a hashtag chosen
    await m.getByTitle('Menü & Ansichts-Optionen öffnen').first().click();
    await m.getByRole('button', { name: /Filter, Hashtags & Sortierung/ }).locator('visible=true').first().click();
    // The sheet comes before the board in the page, whose cards carry #backup chips as well
    await m.getByText('#backup', { exact: true }).locator('visible=true').first().click();
  });
  await m.getByRole('button', { name: 'Fertig', exact: true }).click().catch(() => {});
  await sleep(300);
  await step(m, 'm09b_profile_sheet', () => m.getByTitle('Profil & Einstellungen').first().click());
  await m.mouse.click(195, 20); // the backdrop closes it
  await sleep(300);
  await step(m, 'm04_workspace', () => navTab(m, 'Workspace'));
  await step(m, 'm04b_workspace_menu', () => m.getByTitle('Menü & Ansichts-Optionen öffnen').first().click());
  await m.getByTitle('Menü schließen').first().click().catch(() => {});
  await sleep(300);
  await step(m, 'm05_workspace_note', async () => {
    await m.getByText(/^Homelab 2\.0/).first().click();
    await sleep(800);
  });
  await step(m, 'm06_lists', async () => {
    await m.goBack().catch(() => {}); // back from the note to the overview, so the bottom bar shows
    await sleep(500);
    await navTab(m, 'Listen');
  });
  await step(m, 'm06b_lists_menu', () => m.getByTitle('Menü & Ansichts-Optionen öffnen').first().click());
  await m.getByTitle('Menü schließen').first().click().catch(() => {});
  await sleep(300);
  // Last, since saving changes the counters: the Quick Dump sheet of the + on the triage page
  await step(m, 'm10_quickdump_sheet', async () => {
    await navTab(m, 'Triage');
    await sleep(500);
    await m.getByTitle('Schnell erfassen (+)').tap();
    await m.getByPlaceholder('Was geht dir durch den Kopf?…').fill('Heizung entlüften');
    await m.getByRole('button', { name: 'Dringend' }).click();
  });
  await step(m, 'm10b_quickdump_saved', async () => {
    await m.getByRole('button', { name: 'Gedanke erfassen' }).click();
    await sleep(800);
    // The new card shows the server's real time of capture: a fixed one instead
    await m.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/^\d\d\.\d\d\., \d\d:\d\d$/.test(n.nodeValue.trim())) n.nodeValue = '01.01., 00:00';
      }
    });
  });

  await browser.close();
  console.log(failures ? `${failures} Schritt(e) fehlgeschlagen` : 'Alle Schritte aufgenommen');
}

// Pixel comparison in the browser (no image library needed): share of differing pixels per picture
async function compare() {
  const A = process.env.A;
  const B = process.env.B;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const names = fs.readdirSync(A).filter((f) => f.endsWith('.png') && !f.startsWith('FAIL_')).sort();
  let changed = 0;
  for (const name of names) {
    const fb = path.join(B, name);
    if (!fs.existsSync(fb)) {
      console.log(`MISS ${name} (fehlt in B)`);
      changed++;
      continue;
    }
    const res = await page.evaluate(
      async ([a, b]) => {
        const load = (b64) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = 'data:image/png;base64,' + b64;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { size: true };
        const w = ia.width;
        const h = ia.height;
        const draw = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, w, h);
        };
        const da = draw(ia);
        const db = draw(ib);
        const out = new ImageData(w, h);
        let diff = 0;
        for (let i = 0; i < da.data.length; i += 4) {
          const d =
            Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
          if (d > 24) {
            diff++;
            out.data[i] = 255;
            out.data[i + 3] = 255;
          } else {
            out.data[i] = out.data[i + 1] = out.data[i + 2] = da.data[i] / 3;
            out.data[i + 3] = 255;
          }
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').putImageData(out, 0, 0);
        return { diff, total: w * h, png: diff ? c.toDataURL('image/png').split(',')[1] : '' };
      },
      [fs.readFileSync(path.join(A, name)).toString('base64'), fs.readFileSync(fb).toString('base64')]
    );
    if (res.size) {
      console.log(`SIZE ${name} (andere Bildgröße)`);
      changed++;
      continue;
    }
    const pct = (100 * res.diff) / res.total;
    if (res.diff === 0) {
      console.log(`SAME ${name}`);
    } else {
      changed++;
      fs.writeFileSync(path.join(OUT, name), Buffer.from(res.png, 'base64'));
      console.log(`DIFF ${name}: ${res.diff} Pixel (${pct.toFixed(3)} %)`);
    }
  }
  await browser.close();
  console.log(changed ? `${changed} von ${names.length} Bildern unterscheiden sich` : `Alle ${names.length} Bilder gleich`);
}

(MODE === 'compare' ? compare() : capture()).catch((e) => {
  console.error(e);
  process.exit(1);
});
