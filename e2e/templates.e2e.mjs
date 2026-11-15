// Note templates in Chromium: a note marked as template (⋯ menu) shows its mark, /vorlage inserts its bullets
// into another note (types kept, to-dos open, {{datum}}/{{titel}} filled in, a hidden value copied for the
// target note), and "Neue Notiz anlegen" starts a note from it. Needs a server in demo mode (account
// admin/admin) with the German interface; see e2e/README.md.
import { chromium } from 'playwright';

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

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const today = new Date().toLocaleDateString('de-DE');
const secretRef = (s) => (s.match(/\{\{secret:([^}]+)\}\}/) || [])[1];

const main = async () => {
  const admin = (await api(null, 'POST', '/api/v1/auth/login', { login: 'admin', password: 'admin' })).token;
  const stamp = Date.now().toString(36);
  const tplTitle = `Wochenplan ${stamp}`;
  const targetTitle = `Ziel ${stamp}`;

  const tpl = await api(admin, 'POST', '/api/v1/documents', {
    title: tplTitle,
    blocks: [
      { id: `tp1_${stamp}`, type: 'h2', content: 'Woche ab {{datum}}', level: 0 },
      { id: `tp2_${stamp}`, type: 'todo', content: 'Sport für {{titel}}', level: 1, checked: true },
      { id: `tp3_${stamp}`, type: 'code', content: 'echo "{{datum}}"', lang: 'bash', level: 1 },
      { id: `tp4_${stamp}`, type: 'bullet', content: 'Zugang', level: 1 },
    ],
  });
  const { id: secret } = await api(admin, 'POST', `/api/v1/documents/${tpl.id}/secrets`, { value: 'geheim-123' });
  const tplNow = await api(admin, 'GET', `/api/v1/documents/${tpl.id}`);
  const zugang = tplNow.blocks.find((b) => b.content === 'Zugang');
  await api(admin, 'POST', `/api/v1/docs/${tpl.id}/sync`, {
    clientId: `e2e_tpl_${stamp}`, lastSeq: 0,
    ops: [{ opId: `op_tpl_${stamp}`, kind: 'set_content', blockId: zugang.id, baseVersion: 1, content: `Zugang {{secret:${secret}}}` }],
  });
  const target = await api(admin, 'POST', '/api/v1/documents', {
    title: targetTitle,
    blocks: [{ id: `tg1_${stamp}`, type: 'bullet', content: 'Vorher', level: 0 }, { id: `tg2_${stamp}`, type: 'bullet', content: '', level: 0 }],
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('mindsift_jwt_token', t);
    localStorage.setItem('mindsift:tour-offered', '1');
  }, admin);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Workspace/ }).locator('visible=true').first().click();

  // Mark the template in its ⋯ menu
  await page.getByText(tplTitle, { exact: true }).first().click();
  await page.waitForSelector('[data-outline-block]');
  await page.getByRole('button', { name: 'Weitere Aktionen' }).locator('visible=true').first().click();
  await page.getByRole('menuitem', { name: 'Als Vorlage verwenden' }).click();
  const marked = await waitFor(async () => (await api(admin, 'GET', `/api/v1/documents/${tpl.id}`)).isTemplate, 5000);
  check(marked, 'the ⋯ menu marks the note as template');
  check(await page.getByRole('img', { name: 'Vorlage' }).first().isVisible(), 'the folder tree marks the template');

  // /vorlage in the empty bullet of another note
  await page.getByText(targetTitle, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-outline-block]').length >= 2);
  // Into the empty second bullet: from the end of the first one
  await page.locator('[data-outline-block]').first().locator('[data-outline-text]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('/vorlage');
  await page.getByRole('button', { name: /^\/vorlage/ }).waitFor();
  await page.keyboard.press('Enter');
  const search = page.getByPlaceholder('Vorlage suchen …');
  await search.waitFor();
  await search.fill(stamp);
  await page.keyboard.press('Enter');

  const inserted = await waitFor(async () => {
    const d = await api(admin, 'GET', `/api/v1/documents/${target.id}`);
    return d.blocks.length >= 5 ? d.blocks : null;
  }, 10000);
  check(!!inserted, 'the template went into the note', inserted);
  if (inserted) {
    check(
      JSON.stringify(inserted.map((b) => [b.type, b.level])) === JSON.stringify([['bullet', 0], ['h2', 0], ['todo', 1], ['code', 1], ['bullet', 1]]),
      'types and levels as in the template, the empty bullet became its first one',
      inserted.map((b) => [b.type, b.level, b.content])
    );
    check(inserted[1].content === `Woche ab ${today}`, '{{datum}} became today', inserted[1].content);
    check(inserted[2].content === `Sport für ${targetTitle}` && !inserted[2].checked && !inserted[2].taskId, 'to-do open, {{titel}} filled in', inserted[2]);
    check(inserted[3].content === 'echo "{{datum}}"' && inserted[3].lang === 'bash', 'code kept as written, with its language', inserted[3]);
    const ref = secretRef(inserted[4].content || '');
    check(!!ref && ref !== secret, 'the hidden value is a copy of the target note', inserted[4].content);
  }

  // "Neue Notiz anlegen" with the template
  await page.getByRole('button', { name: 'Neue Notiz anlegen' }).locator('visible=true').first().click();
  await page.getByPlaceholder('Name der Notiz').fill(`Neu ${stamp}`);
  await page.getByRole('button', { name: 'Vorlage', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(tplTitle) }).click();
  await page.getByRole('button', { name: 'Erstellen', exact: true }).click();
  const created = await waitFor(async () => {
    const list = await api(admin, 'GET', '/api/v1/documents');
    const d = list.find((x) => x.title === `Neu ${stamp}`);
    return d ? api(admin, 'GET', `/api/v1/documents/${d.id}`) : null;
  }, 10000);
  check(!!created, 'the new note was created');
  if (created) {
    check(
      JSON.stringify(created.blocks.map((b) => b.type)) === JSON.stringify(['h2', 'todo', 'code', 'bullet']),
      'the new note starts with the template',
      created.blocks.map((b) => [b.type, b.content])
    );
    check(created.blocks[1]?.content === `Sport für Neu ${stamp}`, '{{titel}} is the title from the dialog', created.blocks[1]?.content);
    check(!created.isTemplate, 'the new note is no template itself');
  }

  await browser.close();
  // Leave nothing behind for other tests
  for (const id of [tpl.id, target.id, created?.id].filter(Boolean)) {
    await api(admin, 'DELETE', `/api/v1/documents/${id}`);
  }
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
