import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-genui-http-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const quiet = { log() {}, error() {} };
const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const ATLAS = new URL('./fixtures/genui/atlas.mini.json', import.meta.url).pathname;

const openEnv = (extra = {}) => ({
  ...process.env,
  MARBLE_DRIVE_SECRET: '',
  MARBLE_DRIVE_AGENTS: '',
  MARBLE_DRIVE_BACKUP_DIR: '',
  MARBLE_DRIVE_BACKUP_CMD: '',
  MARBLE_DRIVE_ROOT: ROOT,
  MARBLE_APPS: ROOT,
  MARBLE_DRIVE_GENUI_ATLAS: ATLAS,
  ...extra,
});

const listen = async (drive) => {
  const port = await new Promise((resolve) => {
    drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port));
  });
  return `http://127.0.0.1:${port}`;
};

const withDrive = async (config, extra, fn) => {
  const drive = await createDrive(config, { log: quiet, agents: false, ...extra });
  try {
    await drive.createDocument('Spaces/49ers', FIXTURE, { label: 'test' });
    const base = await listen(drive);
    return await fn(base, drive);
  } finally {
    await drive.close();
  }
};

const post = (base, body) =>
  fetch(`${base}/genui/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const answer = (choice, confidence = 0.9) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });
const fakeAsk = (pick) => async ({ questions }) => ({
  model: 'fake',
  usage: { input_tokens: 5, output_tokens: 1 },
  answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer(pick(id, questions[id]))])),
});
const firstOption = (id, q) => Object.keys(q.criteria)[0];

test('GET /genui/space returns the extracted space and its validation', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const body = await (await fetch(`${base}/genui/space?doc=${encodeURIComponent('Spaces/49ers')}`)).json();
    assert.equal(body.validation.ok, true);
    assert.equal(body.space.instances.length, 2);
    assert.equal(body.space.instances[0].name, 'games');
    const missing = await fetch(`${base}/genui/space?doc=nope`);
    assert.equal(missing.status, 404);
  });
});

test('POST /genui/decide without a key is 503 with the existing explanation', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const response = await post(base, { doc: 'Spaces/49ers' });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.kind, 'no_key');
  });
});

test('POST /genui/decide writes the applied positions into the file and records the run', async () => {
  // The authored defaults, so the fake can "choose the current value" for the
  // decisions it does not mean to move.
  const currents = {
    'games.overviewType': 'grid', 'games.detailMultiplicity': 'one-at-a-time', 'games.attributePlacement': 'identity-record',
    'game-card.media': 'side-thumbnail', 'game-card.actions': 'none', 'game-card.target': 'whole-card',
  };
  const ask = fakeAsk((id) => (id === 'games.openIn' ? 'pop-up' : id === 'game-card.shape' ? 'horizontal' : currents[id]));
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask } }, async (base, drive) => {
    const response = await post(base, { doc: 'Spaces/49ers', context: { viewport: 'phone', items: 6 }, stop: 0.75 });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applied, 2);
    assert.equal(typeof body.elapsedMs, 'number');
    assert.deepEqual(body.usage, { input_tokens: 5, output_tokens: 1 });
    assert.ok(body.decisions.find((d) => d.id === 'games.openIn').applied);
    assert.equal(body.decisions.filter((d) => d.reason === 'kept-unchanged').length, 6);

    const written = await drive.store.read('Spaces/49ers');
    assert.match(written, /id="games"[^>]*data-open-in="pop-up"/s);
    assert.match(written, /data-marble-id="overview"[^>]*data-shape="horizontal"/s);

    const record = await fsp.readFile(path.join(drive.store.marbleDir, 'Spaces%2F49ers.genui.jsonl'), 'utf8');
    const lines = record.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].doc, 'Spaces/49ers');
    assert.deepEqual(lines[0].context, { viewport: 'phone', items: 6 });
    assert.equal(lines[0].decisions.length, 8);
    assert.equal(lines[0].dry, false);
  });
});

test('POST /genui/decide with dry:true asks but writes nothing', async () => {
  const ask = fakeAsk((id, q) => (id === 'games.openIn' ? 'new-page' : firstOption(id, q)));
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask } }, async (base, drive) => {
    const before = await drive.store.read('Spaces/49ers');
    const body = await (await post(base, { doc: 'Spaces/49ers', dry: true })).json();
    assert.ok(body.ops.some((op) => op.value === 'new-page'));
    assert.equal(body.applied, 0);
    assert.equal(await drive.store.read('Spaces/49ers'), before);
  });
});

test('POST /genui/decide on an invalid space is 422 with issues; on an unknown doc 404', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask: fakeAsk(firstOption) } }, async (base, drive) => {
    await drive.createDocument('Spaces/broken', FIXTURE.replace(/\n  data-open-in="side-by-side"/, '\n  data-open-in="tooltip"'), { label: 'test' });
    const bad = await post(base, { doc: 'Spaces/broken' });
    assert.equal(bad.status, 422);
    assert.ok((await bad.json()).issues.some((i) => i.kind === 'current-not-declared'));
    const missing = await post(base, { doc: 'Spaces/none' });
    assert.equal(missing.status, 404);
  });
});

test('a doc path spelled with slashes lands in the same document, queue and record', async () => {
  const ask = fakeAsk((id, q) => (id === 'games.openIn' ? 'new-page' : firstOption(id, q)));
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask } }, async (base, drive) => {
    // The tests share one .marble/, so count the record's growth, not its size.
    const recordFile = path.join(drive.store.marbleDir, 'Spaces%2F49ers.genui.jsonl');
    const lines = async () => (await fsp.readFile(recordFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
    const before = (await lines()).length;
    const body = await (await post(base, { doc: '/Spaces/49ers/' })).json();
    assert.equal(body.doc, 'Spaces/49ers');
    assert.match(await drive.store.read('Spaces/49ers'), /id="games"[^>]*data-open-in="new-page"/s);
    const after = await lines();
    assert.equal(after.length, before + 1, 'one record under the normalized key, not a second file under the raw spelling');
    assert.equal(JSON.parse(after.at(-1)).doc, 'Spaces/49ers');
    assert.equal(await fsp.access(path.join(drive.store.marbleDir, '%2FSpaces%2F49ers%2F.genui.jsonl')).then(() => true, () => false), false);
    const bad = await post(base, { doc: '../etc' });
    assert.equal(bad.status, 400);
    const space = await fetch(`${base}/genui/space?doc=${encodeURIComponent('/Spaces/49ers/')}`);
    assert.equal((await space.json()).doc, 'Spaces/49ers');
  });
});

test('POST /genui/root decides the pattern from the prompt; GET /genui/spaces lists app spaces only', async () => {
  const ask = async ({ questions }) => {
    assert.deepEqual(Object.keys(questions), ['root']);
    return { answers: { root: { type: 'choice', choice: 'dashboard', confidence: 0.81, probabilities: { dashboard: 0.81, chart: 0.19 } } } };
  };
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask } }, async (base, drive) => {
    await drive.createDocument('garden', '<!doctype html><html><body data-marble-id="b"><p data-marble-id="p">no space here</p></body></html>', { label: 'test' });
    const root = await (await fetch(`${base}/genui/root`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'error rate, p95 latency, open incidents', context: { viewport: 'desktop' } }),
    })).json();
    assert.equal(root.choice, 'dashboard');
    assert.equal(root.name, 'Dashboard');
    assert.equal(root.confidence, 0.81);
    assert.ok(root.options.some((o) => o.id === 'overview-detail'));

    const empty = await fetch(`${base}/genui/root`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: '' }) });
    assert.equal(empty.status, 400);

    // The tests share one drive, so other spaces may be listed; the garden never is.
    const spaces = await (await fetch(`${base}/genui/spaces`)).json();
    assert.ok(!spaces.some((s) => s.path === 'garden'));
    const niners = spaces.find((s) => s.path === 'Spaces/49ers');
    assert.equal(niners.instances, 2);
    assert.equal(niners.decisions, 8);
    assert.match(niners.request, /49ers/);
  });
});

test('POST /genui/root without a key is 503', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const response = await fetch(`${base}/genui/root`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'anything' }) });
    assert.equal(response.status, 503);
  });
});
