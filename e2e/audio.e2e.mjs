// Voice notes: recorded in Chromium (fake microphone), played in WebKit. MediaRecorder writes WebM without
// length or index; WebKit (GStreamer, like the Linux desktop app's WebKitGTK) then guessed a length of a
// fraction of a second, its playhead stopped there and seeking did nothing. A recording made in the app is
// saved with its length; an older one without it (uploaded here as it came from MediaRecorder) gets it
// when it is played. Also: leaving the note stops playback, and starting a second voice note pauses the
// first. Needs a server in demo mode (account admin/admin); see e2e/README.md.
import { chromium, webkit } from 'playwright';

const BASE = process.env.MINDSIFT_URL || 'http://localhost:18080';
let failures = 0;
const check = (cond, msg, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detail !== undefined ? `\n     got: ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

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

async function removeNotes(token, ids) {
  for (const id of ids) {
    await api(token, 'DELETE', `/api/v1/documents/${id}`).catch(() => {});
    await api(token, 'DELETE', `/api/v1/documents/${id}/permanent`).catch(() => {});
  }
}

// Whether a WebM file carries a length > 0 in its header (Segment > Info > Duration, ID 0x4489)
function storedDuration(bytes) {
  for (let i = 0; i + 11 <= bytes.length && i < 4096; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88) {
      return new DataView(bytes.buffer, bytes.byteOffset + i + 3, 8).getFloat64(0);
    }
  }
  return 0;
}

async function login(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1');
  }, token);
  return ctx;
}

async function openNote(page, title) {
  await page.getByRole('button', { name: /^Workspace/ }).locator('visible=true').first().click();
  await page.getByText(title, { exact: true }).first().click();
}

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const created = [];
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const title = `Sprachnotizen ${stamp}`;
  const otherTitle = `Andere Notiz ${stamp}`;
  try {
    // The older recording is uploaded into this note and referenced from the test note
    const upload = await api(admin, 'POST', '/api/v1/documents', { title: `Ablage ${stamp}`, blocks: [] });
    created.push(upload.id);
    const other = await api(admin, 'POST', '/api/v1/documents', {
      title: otherTitle,
      blocks: [{ id: `ao0_${stamp}`, type: 'text', content: 'Nichts zu hören', level: 0 }],
    });
    created.push(other.id);

    // Chromium: one recording as MediaRecorder writes it (stored as it is, like before the fix), and one
    // through the app's recorder
    const chrome = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const cctx = await login(chrome, admin);
    const cpage = await cctx.newPage();
    await cpage.goto(BASE);
    const oldId = await cpage.evaluate(
      async ({ docId, token }) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.start(1000);
        await new Promise((r) => setTimeout(r, 5000));
        await new Promise((r) => ((rec.onstop = r), rec.stop()));
        stream.getTracks().forEach((t) => t.stop());
        const form = new FormData();
        form.append('source', 'recording');
        form.append('file', new Blob(chunks, { type: 'audio/webm' }), 'alt.webm');
        const res = await fetch(`/api/v1/documents/${docId}/media`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
        return (await res.json()).id;
      },
      { docId: upload.id, token: admin }
    );
    const oldFile = new Uint8Array(await (await fetch(`${BASE}/api/v1/media/${oldId}`, { headers: { Authorization: `Bearer ${admin}` } })).arrayBuffer());
    check(storedDuration(oldFile) === 0, 'Alte Aufnahme liegt ohne Länge auf dem Server (wie von MediaRecorder)');

    const doc = await api(admin, 'POST', '/api/v1/documents', {
      title,
      blocks: [
        { id: `au0_${stamp}`, type: 'text', content: 'Sprachnotizen', level: 0 },
        { id: `au1_${stamp}`, type: 'audio', content: `[Alt](media:${oldId})`, level: 0 },
        { id: `au2_${stamp}`, type: 'text', content: '', level: 0 },
      ],
    });
    created.push(doc.id);

    await openNote(cpage, title);
    await cpage.waitForFunction(() => document.querySelectorAll('[data-outline-block] audio').length === 1, null, { timeout: 15000 });
    const b = await cpage.locator('[data-outline-block]').nth(2).boundingBox();
    await cpage.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 12));
    await cpage.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 5000 });
    await cpage.keyboard.type('/audio');
    await cpage.keyboard.press('Enter');
    await cpage.getByRole('button', { name: 'Aufnahme starten' }).click();
    await cpage.waitForTimeout(6000);
    await cpage.getByRole('button', { name: 'Aufnahme beenden und speichern' }).click();
    await cpage.waitForFunction(() => document.querySelectorAll('[data-outline-block] audio').length === 2, null, { timeout: 15000 });
    await cpage.waitForTimeout(1500); // synced
    const blocks = (await api(admin, 'GET', `/api/v1/documents/${doc.id}`)).blocks || [];
    const newId = blocks.map((x) => /media:(med_[0-9a-f]+)/.exec(x.content)?.[1]).find((id) => id && id !== oldId);
    const newFile = new Uint8Array(await (await fetch(`${BASE}/api/v1/media/${newId}`, { headers: { Authorization: `Bearer ${admin}` } })).arrayBuffer());
    const newSeconds = storedDuration(newFile) / 1000;
    check(newSeconds > 5 && newSeconds < 8, 'Neue Aufnahme wird mit ihrer Länge gespeichert', newSeconds);
    await chrome.close();

    // WebKit plays both: the new recording and the older one without length
    const wk = await webkit.launch();
    const wctx = await login(wk, admin);
    const page = await wctx.newPage();
    await page.goto(BASE);
    await openNote(page, title);
    await page.waitForFunction(() => document.querySelectorAll('[data-outline-block] audio').length === 2, null, { timeout: 15000 });
    const players = await page.waitForFunction(
      () => {
        const list = Array.from(document.querySelectorAll('[data-outline-block] audio'));
        if (list.length !== 2 || list.some((a) => a.readyState < 1)) return null;
        window.__players = list;
        return list.map((a) => a.duration);
      },
      null,
      { timeout: 15000 }
    );
    const durations = await players.jsonValue();
    check(durations.every((d) => Number.isFinite(d) && d > 4 && d < 8), 'WebKit: beide Sprachnotizen zeigen ihre Länge sofort', durations);

    const playback = await page.evaluate(async () => {
      const [first, second] = window.__players;
      first.muted = true;
      second.muted = true;
      await first.play();
      await new Promise((r) => setTimeout(r, 2000));
      const moved = first.currentTime;
      first.currentTime = 3.5;
      await new Promise((r) => setTimeout(r, 600));
      const sought = first.currentTime;
      await second.play();
      await new Promise((r) => setTimeout(r, 300));
      return { moved, sought, firstPaused: first.paused, secondPaused: second.paused };
    });
    check(playback.moved > 1.5 && playback.moved < 3, 'WebKit: der Abspielpunkt läuft mit', playback.moved);
    check(playback.sought >= 3.5 && playback.sought < 4.8, 'WebKit: Springen in der Aufnahme geht', playback.sought);
    check(playback.firstPaused && !playback.secondPaused, 'WebKit: die zweite Sprachnotiz hält die erste an', playback);

    await openNote(page, otherTitle);
    await page.getByText('Nichts zu hören').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.__players.map((a) => ({ paused: a.paused, src: a.getAttribute('src') })));
    check(after.every((a) => a.paused && !a.src), 'WebKit: nach dem Wechsel der Notiz spielt nichts mehr', after);
    await wk.close();
  } finally {
    await removeNotes(admin, created);
  }
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('Voice notes OK');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
