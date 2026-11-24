// Transcriptions in the background (internal/api/transcription_jobs.go, frontend/src/lib/transcriptionJobs.ts)
// against a server with its own Whisper server, which this script plays itself: it holds its answers until
// the script has seen the waiting state, so nothing depends on how long a step takes. Checked, in Chromium
// with a fake microphone:
//   - "Transkribieren" on a voice note: the bullet shows "Wird erkannt …", also after switching to another
//     note and after a reload; the text arrives in the caption by itself, and the server has it
//   - holding the rail's + : the recording is on the server once released; a reload right after loses
//     nothing, the Quick Dump shows it as being transcribed, and the server makes the entry
//   - a failing Whisper server: the recording stays above the Quick Dump, "Neuer Versuch folgt gleich";
//     discarding it removes it. With TRANSCRIPTION_FULL=1 also the end (the server tries twice more, after
//     30 s and 2 min, so it takes about 3 minutes): "nicht transkribiert" with "Erneut versuchen", which
//     makes the entry once the Whisper server works again
//   - dictating into a text field and switching the view asks first: "Bleiben" stays, "Trotzdem wechseln" goes
// Needs a server without demo mode (the demo has no Whisper server): MINDSIFT_PLAIN_URL with the first admin
// (MINDSIFT_PLAIN_ADMIN / MINDSIFT_PLAIN_PASSWORD), as e2e/run.sh starts it. The script points the server's
// speech recognition at its fake Whisper server on WHISPER_PORT (the administration's setting, put back at
// the end); the server must reach that port on localhost (host network).
import http from 'node:http';
import { chromium } from 'playwright';

const BASE = process.env.MINDSIFT_PLAIN_URL || 'http://localhost:18081';
const LOGIN = process.env.MINDSIFT_PLAIN_ADMIN || 'admin';
const PASSWORD = process.env.MINDSIFT_PLAIN_PASSWORD || 'Tour-Angebot-2026';
const WHISPER_PORT = Number(process.env.WHISPER_PORT || 18566);
const FULL = process.env.TRANSCRIPTION_FULL === '1';
const TEXT = 'Automatisch erkannter Text';

let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

// The Whisper server: model list and transcriptions. While `held`, answers wait until release();
// `failing` answers every transcription with 500.
const whisper = {
  calls: 0,
  failing: false,
  held: false,
  waiting: [],
  hold() {
    this.held = true;
  },
  release() {
    this.held = false;
    for (const answer of this.waiting.splice(0)) answer();
  },
};
const fake = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
    whisper.calls++;
    req.resume();
    req.on('end', () => {
      const answer = () => {
        if (whisper.failing) {
          res.statusCode = 500;
          res.end('model crashed');
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ text: TEXT }));
      };
      if (whisper.held) whisper.waiting.push(answer);
      else answer();
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

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

async function until(what, fn, timeout = 60000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Screenshots of the states checked, with SHOTS=<folder>
const shot = (page, name) => (process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }).catch(() => {}) : Promise.resolve());

async function openNote(page, title) {
  await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
  await page.getByText(title, { exact: true }).first().click();
}

const main = async () => {
  await new Promise((r) => fake.listen(WHISPER_PORT, '0.0.0.0', r));
  const token = (await api(null, 'POST', '/api/v1/auth/login', { login: LOGIN, password: PASSWORD })).token;
  await api(token, 'PATCH', '/api/v1/auth/settings', { tourOffered: true });
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
  // Speech recognition through the fake Whisper server; the setting as it was goes back at the end
  const settings = await api(token, 'GET', '/api/v1/admin/settings');
  const speechBefore = settings.speech;
  await api(token, 'PUT', '/api/v1/admin/settings', {
    ...settings,
    speech: { ...speechBefore, mode: 'server', url: `http://localhost:${WHISPER_PORT}`, model: 'fake' },
  });
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const title = `Transkription ${stamp}`;
  const otherTitle = `Andere ${stamp}`;
  const created = [];
  const inboxJobs = [];
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    await ctx.addInitScript((t) => {
      localStorage.setItem('mindsift_jwt_token', t);
      localStorage.setItem('mindsift:tour-offered', '1');
    }, token);
    const page = await ctx.newPage();
    await page.goto(BASE);

    // A voice note recorded with the fake microphone
    const upload = await api(token, 'POST', '/api/v1/documents', { title: `Ablage ${stamp}`, blocks: [] });
    created.push(upload.id);
    const mediaId = await page.evaluate(
      async ({ docId, token }) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.start(500);
        await new Promise((r) => setTimeout(r, 2000));
        await new Promise((r) => ((rec.onstop = r), rec.stop()));
        stream.getTracks().forEach((t) => t.stop());
        const form = new FormData();
        form.append('source', 'recording');
        form.append('file', new Blob(chunks, { type: 'audio/webm' }), 'aufnahme.webm');
        const res = await fetch(`/api/v1/documents/${docId}/media`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
        return (await res.json()).id;
      },
      { docId: upload.id, token }
    );
    const doc = await api(token, 'POST', '/api/v1/documents', {
      title,
      blocks: [{ id: `tr1_${stamp}`, type: 'audio', content: `[](media:${mediaId})`, level: 0 }],
    });
    created.push(doc.id);
    const other = await api(token, 'POST', '/api/v1/documents', { title: otherTitle, blocks: [{ id: `tr2_${stamp}`, type: 'text', content: 'Nichts', level: 0 }] });
    created.push(other.id);

    // 1. Transcribe, leave the note, reload: still being recognised, then the caption arrives by itself
    await openNote(page, title);
    const transcribe = page.getByRole('button', { name: /Transkribieren/ });
    await transcribe.waitFor({ timeout: 15000 });
    whisper.hold();
    await transcribe.click();
    await page.getByText('Wird erkannt …').first().waitFor({ timeout: 5000 });
    check(true, 'Notiz: Transkribieren zeigt „Wird erkannt …“');
    await openNote(page, otherTitle);
    await page.reload();
    await openNote(page, title);
    const pending = await page.getByText('Wird erkannt …').first().waitFor({ timeout: 4000 }).then(() => true, () => false);
    check(pending, 'Notiz: nach Notizwechsel und Neuladen noch als „Wird erkannt …“ markiert');
    await shot(page, 'transcription-note');
    whisper.release();
    await page.getByText(TEXT).first().waitFor({ timeout: 30000 });
    check(true, 'Notiz: der Text erscheint ohne Zutun in der Beschriftung');
    const blocks = (await api(token, 'GET', `/api/v1/documents/${doc.id}`)).blocks || [];
    check(blocks.some((b) => b.content === `[${TEXT}](media:${mediaId})`), 'Notiz: der Server hat den Text in der Beschriftung', blocks.map((b) => b.content));

    // 2. Hold the rail's +, reload right after letting go: the server makes the entry anyway
    const before = whisper.calls;
    await page.getByRole('button', { name: /^Triage/ }).locator('visible=true').first().click();
    const plus = page.locator('[data-tour="capture"]').locator('visible=true').first();
    const box = await plus.boundingBox();
    // Holding the + records from the fake microphone; let go after a moment of "speech"
    const dictate = async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.locator('[data-tour="capture"][data-dictation="recording"]').locator('visible=true').first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(1500);
      const uploaded = page.waitForResponse((r) => r.url().endsWith('/api/v1/voice/captures') && r.status() === 202, { timeout: 15000 });
      await page.mouse.up();
      const job = await (await uploaded).json();
      inboxJobs.push(job.id);
      return job;
    };
    whisper.hold();
    await dictate();
    check(true, 'Quick Dump: die Aufnahme liegt nach dem Loslassen auf dem Server');
    await page.reload();
    const pendingRow = page.getByText('Sprachaufnahme wird transkribiert …').first();
    const shown = await pendingRow.waitFor({ timeout: 5000 }).then(() => true, () => false);
    check(shown, 'Quick Dump: nach dem Neuladen als „wird transkribiert …“ zu sehen');
    await shot(page, 'transcription-inbox');
    whisper.release();
    const entry = await until('inbox entry', async () => {
      const list = await api(token, 'GET', '/api/v1/thoughts?status=inbox');
      return (Array.isArray(list) ? list : []).find((t) => t.content === TEXT && t.source === 'voice');
    }, 30000);
    check(!!entry, 'Quick Dump: der Server hat den Eintrag angelegt, obwohl die Seite neu geladen wurde');
    check(whisper.calls > before, 'Quick Dump: der Whisper-Server wurde gefragt');
    const gone = await pendingRow.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
    check(gone, 'Quick Dump: „wird transkribiert …“ verschwindet, sobald der Eintrag da ist');
    if (entry) await api(token, 'DELETE', `/api/v1/thoughts/${entry.id}`).catch(() => {});

    // 3. A failing Whisper server: the recording stays above the Quick Dump, the server tries again later
    whisper.failing = true;
    const job = await dictate();
    const retrying = page.getByText('Neuer Versuch folgt gleich').first();
    await retrying.waitFor({ timeout: 15000 });
    check(true, 'Fehler: die Aufnahme bleibt über dem Quick Dump, „Neuer Versuch folgt gleich“');
    await shot(page, 'transcription-retrying');
    if (FULL) {
      // The server tries twice more by itself (after 30 s and 2 min); then the recording waits for the person
      const failedRow = page.locator('[data-transcription="failed"]').first();
      await failedRow.waitFor({ timeout: 200000 });
      check(true, 'Fehler: nach dem letzten Versuch „nicht transkribiert“ mit „Erneut versuchen“');
      await shot(page, 'transcription-failed');
      whisper.failing = false;
      await failedRow.getByRole('button', { name: 'Erneut versuchen' }).click();
      const retried = await until('entry after retry', async () => {
        const list = await api(token, 'GET', '/api/v1/thoughts?status=inbox');
        return (Array.isArray(list) ? list : []).find((t) => t.content === TEXT && t.source === 'voice');
      }, 30000);
      check(!!retried, 'Fehler: „Erneut versuchen“ legt den Eintrag an, sobald der Whisper-Server wieder geht');
      if (retried) await api(token, 'DELETE', `/api/v1/thoughts/${retried.id}`).catch(() => {});
    } else {
      // Without waiting minutes for the last attempt: the recording is thrown away, and its row goes
      await api(token, 'DELETE', `/api/v1/voice/jobs/${job.id}`);
      const left = await retrying.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
      check(left, 'Fehler: verworfen verschwindet die Aufnahme über dem Quick Dump');
      whisper.failing = false;
    }

    // 4. Dictating into a text field, then switching the view: asks first
    await page.getByRole('button', { name: /^Aufgaben/ }).locator('visible=true').first().click();
    const mic = page.getByRole('button', { name: 'Spracheingabe' }).locator('visible=true').first();
    await mic.waitFor({ timeout: 10000 });
    await mic.click();
    await page.getByRole('button', { name: 'Aufnahme beenden' }).first().waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor({ timeout: 5000 });
    check((await dialog.textContent()).includes('Aufnahme'), 'Diktat: der Wechsel fragt nach');
    await shot(page, 'transcription-leave');
    await dialog.getByRole('button', { name: 'Bleiben' }).click();
    check(await page.getByRole('button', { name: 'Aufnahme beenden' }).first().isVisible(), '„Bleiben“: die Aufnahme läuft weiter, die Ansicht bleibt');
    await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trotzdem wechseln' }).click();
    await page.getByText(title, { exact: true }).first().waitFor({ timeout: 10000 });
    check(true, '„Trotzdem wechseln“: der Workspace öffnet sich');
  } catch (err) {
    if (process.env.SHOTS) {
      for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: `${process.env.SHOTS}/transcription-error.png` }).catch(() => {});
    }
    throw err;
  } finally {
    await browser.close();
    for (const id of inboxJobs) await api(token, 'DELETE', `/api/v1/voice/jobs/${id}`).catch(() => {});
    for (const id of created) {
      await api(token, 'DELETE', `/api/v1/documents/${id}`).catch(() => {});
      await api(token, 'DELETE', `/api/v1/documents/${id}/permanent`).catch(() => {});
    }
    await api(token, 'PUT', '/api/v1/admin/settings', { ...(await api(token, 'GET', '/api/v1/admin/settings')), speech: speechBefore }).catch((e) =>
      console.error('Speech setting not put back:', e.message)
    );
    fake.close();
  }
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll transcription checks passed');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
