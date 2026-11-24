// Full server backups (internal/api/fullrestore.go, backup_upload.go; Administration → Daten), in Chromium.
// Checked:
//   - "Jetzt sichern" makes a full backup, listed as "Komplett mit … Mediendatei(en)"
//   - "Download" saves one tar archive holding the database, the media files and secrets.key
//   - restoring it from the list asks first, shows "Wird wiederhergestellt …", reloads by itself; afterwards the
//     notes are as at the backup (a note made later is gone, the picture is there), the state before is kept
//     as a backup "vor einer Wiederherstellung" and the restore is in the audit log
//   - uploading the downloaded archive goes in several chunks with a progress bar, asks, and restores it
// Restores replace the whole instance, so it needs a server of its own without demo mode (restoring is off
// in the demo): MINDSIFT_PLAIN_URL with the first admin from ADMIN_USER / ADMIN_PASSWORD (MINDSIFT_PLAIN_ADMIN
// / MINDSIFT_PLAIN_PASSWORD), as e2e/run.sh starts it. Run it last there: everything after the backup is undone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_PLAIN_URL || 'http://localhost:18081';
const ADMIN = process.env.MINDSIFT_PLAIN_ADMIN || 'admin';
const PASSWORD = process.env.MINDSIFT_PLAIN_PASSWORD || 'Tour-Angebot-2026';

let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

async function api(token, method, p, body, raw) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), 'Accept-Language': 'de', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const login = async () => (await api(null, 'POST', '/api/v1/auth/login', { login: ADMIN, password: PASSWORD })).token;
const titles = async (token) => {
  const docs = await api(token, 'GET', '/api/v1/documents');
  return (Array.isArray(docs) ? docs : docs.documents || []).map((d) => d.title);
};

// The names in a tar archive (ustar headers; PAX and GNU long-name records carry the full name)
function tarNames(buf) {
  const names = [];
  let longName = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === 'x') {
      const m = body.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      if (m) longName = m[1];
    } else if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
    } else if (type !== 'g') {
      const prefix = str(345, 500);
      names.push(longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100)));
      longName = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const main = async () => {
  let token = await login();
  // A server started with ADMIN_USER shows the admin the rest of the setup wizard first: closed with what is set
  if ((await api(token, 'GET', '/api/v1/auth/me')).setupPending) {
    const cur = await api(token, 'GET', '/api/v1/admin/settings');
    await api(token, 'POST', '/api/v1/admin/setup', {
      instanceName: cur.instanceName,
      allowRegistration: cur.allowRegistration,
      sharingMode: cur.sharingMode,
      defaultLanguage: cur.defaultLanguage || '',
      createSampleData: false,
    });
  }
  await api(token, 'PATCH', '/api/v1/auth/settings', { tourOffered: true });
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const before = `Vor der Sicherung ${stamp}`;
  const after = `Nach der Sicherung ${stamp}`;
  const beforeUpload = `Vor dem Upload ${stamp}`;
  const doc = await api(token, 'POST', '/api/v1/documents', { title: before });
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'bild.png');
  const media = await api(token, 'POST', `/api/v1/documents/${doc.id}/media`, null, form);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsift-backup-'));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'de-DE', acceptDownloads: true });
    await ctx.addInitScript(() => localStorage.setItem('mindsift:tour-offered', '1'));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const open = async () => {
      await page.goto(BASE + '/');
      await page.evaluate((t) => localStorage.setItem('mindsift_jwt_token', t), token);
      await page.goto(BASE + '/');
      await page.getByTitle('Benutzermenü öffnen').locator('visible=true').first().click();
      await page.getByRole('button', { name: /^Administration/ }).locator('visible=true').first().click();
      await page.locator('[data-admin-nav="data"]').locator('visible=true').first().click();
      await page.getByRole('button', { name: 'Jetzt sichern' }).waitFor({ timeout: 15000 });
    };
    await open();

    // 1. A full backup by hand
    const listed = new Set((await api(token, 'GET', '/api/v1/admin/backups')).map((f) => f.name));
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/backups') && r.request().method() === 'POST', { timeout: 60000 });
    await page.getByRole('button', { name: 'Jetzt sichern' }).click();
    const fresh = (await (await ran).json()).find((f) => !listed.has(f.name));
    check(fresh?.full === true && fresh.media >= 1, 'Jetzt sichern: ein vollständiges Backup mit Mediendateien', fresh);
    const name = fresh.name;
    const restoreButton = page.getByLabel(`Backup ${name} wiederherstellen`);
    await restoreButton.waitFor({ timeout: 10000 });
    const row = restoreButton.locator('xpath=../..');
    check(/Komplett mit \d+ Mediendatei/.test(await row.textContent()), 'die Liste zeigt es als „Komplett mit … Mediendatei(en)“', await row.textContent());

    // 2. Download: one tar archive with database, media and key
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), row.getByRole('button', { name: 'Download' }).click()]);
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    const names = tarNames(fs.readFileSync(file));
    check(download.suggestedFilename() === `${name}.tar`, `Download: ${download.suggestedFilename()}`);
    check(names.some((n) => n.endsWith('mindsift.db.gz')), 'Download: enthält die Datenbank', names);
    check(names.some((n) => n.endsWith('secrets.key')), 'Download: enthält secrets.key', names);
    check(names.some((n) => n.includes('media/') && n.includes(media.id)), 'Download: enthält das Bild', names);

    // 3. Restore from the list: the note made afterwards is gone, the picture stays
    const restores = async () => {
      const audit = await api(token, 'GET', '/api/v1/admin/audit?action=backup.restored');
      return (Array.isArray(audit) ? audit : audit.entries || []).length;
    };
    const restoresBefore = await restores();
    await api(token, 'POST', '/api/v1/documents', { title: after });
    await restoreButton.click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor({ timeout: 5000 });
    const reloaded = page.waitForEvent('load', { timeout: 90000 });
    await dialog.getByRole('button', { name: 'Wiederherstellen' }).click();
    await page.getByText('Wird wiederhergestellt … MindSift lädt danach neu.').waitFor({ timeout: 30000 });
    check(true, 'Wiederherstellen: fragt nach und zeigt „Wird wiederhergestellt …“');
    await reloaded;
    check(true, 'Wiederherstellen: die Seite lädt danach von selbst neu');
    token = await login();
    const t1 = await titles(token);
    check(t1.includes(before) && !t1.includes(after), 'Wiederherstellen: die Notizen sind auf dem Stand des Backups', t1.filter((t) => t.includes(stamp)));
    const pic = await fetch(`${BASE}/api/v1/media/${media.id}`, { headers: { Authorization: `Bearer ${token}` } });
    check(pic.ok, 'Wiederherstellen: das Bild ist da', pic.status);
    const restoresAfter = await restores();
    check(restoresAfter === restoresBefore + 1, 'Wiederherstellen: steht im Audit-Log', [restoresBefore, restoresAfter]);
    await open();
    await page.getByText(/vor einer Wiederherstellung/).first().waitFor({ timeout: 10000 });
    check(true, 'Wiederherstellen: der Stand davor ist als „vor einer Wiederherstellung“ gesichert');

    // 4. Upload in chunks (smaller ones than the server offers, so there are several) and restore it
    await api(token, 'POST', '/api/v1/documents', { title: beforeUpload });
    const size = fs.statSync(file).size;
    let chunks = 0;
    let releaseSecond;
    const secondHeld = new Promise((r) => (releaseSecond = r));
    await page.route('**/api/v1/admin/backups/uploads', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      body.chunkSize = Math.max(1, Math.ceil(size / 4));
      await route.fulfill({ response: res, json: body });
    });
    // The second chunk waits until the progress bar has shown the first
    await page.route('**/api/v1/admin/backups/uploads/*?offset=*', async (route) => {
      chunks++;
      if (chunks === 2) await secondHeld;
      await route.continue();
    });
    await page.getByTestId('backup-upload-input').setInputFiles(file);
    const bar = page.getByRole('progressbar');
    await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) > 0, null, { timeout: 15000 });
    check(await bar.isVisible(), 'Upload: der Fortschrittsbalken zeigt den Stand');
    releaseSecond();
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor({ timeout: 60000 });
    check((await confirm.textContent()).includes(`Alle Daten durch ${name}.tar ersetzen?`), 'Upload: fragt vor dem Ersetzen', await confirm.textContent());
    check(chunks >= 4, `Upload: in ${chunks} Stücken hochgeladen`, chunks);
    const reloaded2 = page.waitForEvent('load', { timeout: 90000 });
    await confirm.getByRole('button', { name: 'Wiederherstellen' }).click();
    await reloaded2;
    token = await login();
    const t2 = await titles(token);
    check(t2.includes(before) && !t2.includes(beforeUpload) && !t2.includes(after), 'Upload: die Notizen sind auf dem Stand des hochgeladenen Backups', t2.filter((t) => t.includes(stamp)));
    check(errors.length === 0, 'keine Fehler im Browser', errors);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll backup checks passed');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
