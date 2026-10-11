import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-typesafe-http-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const quiet = { log() {}, error() {} };

const openEnv = (extra = {}) => ({
  ...process.env,
  MARBLE_DRIVE_SECRET: '',
  MARBLE_DRIVE_AGENTS: '',
  MARBLE_DRIVE_BACKUP_DIR: '',
  MARBLE_DRIVE_BACKUP_CMD: '',
  MARBLE_DRIVE_ROOT: ROOT,
  MARBLE_APPS: ROOT,
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
    const base = await listen(drive);
    return await fn(base, drive);
  } finally {
    await drive.close();
  }
};

test('GET /typesafe/status says whether a TypeSafe key is configured', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const noKey = await (await fetch(`${base}/typesafe/status`)).json();
    assert.equal(noKey.key, false);
  });

  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), {}, async (base) => {
    const withKey = await (await fetch(`${base}/typesafe/status`)).json();
    assert.equal(withKey.key, true);
    assert.equal(withKey.llm, 'cursor-grok-4.8-high');
  });
});

test('POST /typesafe/run without a key is 503', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const response = await fetch(`${base}/typesafe/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'What control should this quantity field be?' }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.kind, 'no_key');
    assert.match(body.title, /can't access TypeSafe/i);
    assert.match(body.error, /TYPESAFE_API_KEY/);
  });
});

const readNdjson = async (response) => {
  const text = await response.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

test('POST /typesafe/run returns the pipeline tree from injected providers', async () => {
  await withDrive(
    loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })),
    {
      typesafe: {
        shape: async (prompt) => ({ type: 'noul', text: prompt }),
        gate: async (nodes) =>
          Object.fromEntries(nodes.map((node) => [node.id, { type: 'noul', noul: 0.93 }])),
        decompose: async () => {
          throw new Error('should not decompose a high-confidence root');
        },
      },
    },
    async (base) => {
      const response = await fetch(`${base}/typesafe/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Is this a quantity field?', stop: 0.75 }),
      });
      assert.equal(response.status, 200);
      const events = await readNdjson(response);
      const done = events.at(-1);
      assert.equal(events[0].phase, 'shape');
      assert.equal(done.type, 'done');
      assert.equal(done.root.text, 'Is this a quantity field?');
      assert.equal(done.root.fate, 'answer');
      assert.equal(done.root.confidence, 0.93);
    },
  );
});

test('closing POST /typesafe/run during a hang does not decompose', async () => {
  let decomposed = 0;
  let gating;
  const started = new Promise((resolve) => {
    gating = resolve;
  });
  await withDrive(
    loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })),
    {
      typesafe: {
        shape: async () => ({ type: 'noul', text: 'root' }),
        gate: async () => {
          gating();
          await new Promise((resolve) => setTimeout(resolve, 400));
          return { n1: { type: 'noul', noul: 0.5 } };
        },
        decompose: async () => {
          decomposed += 1;
          return [{ type: 'noul', text: 'child' }];
        },
      },
    },
    async (base) => {
      const ac = new AbortController();
      const responseP = fetch(`${base}/typesafe/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'root', stop: 0.75 }),
        signal: ac.signal,
      });
      await started;
      const response = await responseP;
      await response.body.getReader().read();
      ac.abort();
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(decomposed, 0);
    },
  );
});

test('POST /typesafe/run streams a named TypeSafe failure when the gate is 429', async () => {
  await withDrive(
    loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })),
    {
      typesafe: {
        shape: async () => ({ type: 'noul', text: 'root' }),
        gate: async () => {
          const err = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        },
        decompose: async () => [],
      },
    },
    async (base) => {
      const response = await fetch(`${base}/typesafe/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'root', stop: 0.75 }),
      });
      assert.equal(response.status, 200);
      const events = await readNdjson(response);
      const fail = events.find((event) => event.type === 'error');
      assert.ok(fail);
      assert.equal(fail.kind, 'rate_limit');
      assert.match(fail.title, /rate limit/i);
    },
  );
});

test('POST /typesafe/run streams a named TypeSafe failure when the gate is 422', async () => {
  await withDrive(
    loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })),
    {
      typesafe: {
        shape: async () => ({ type: 'noul', text: 'root' }),
        gate: async () => {
          const err = new Error('TypeSafe HTTP 422');
          err.status = 422;
          err.body = {
            detail: [{ loc: ['body', 'questions', 'n1', 'criteria'], msg: 'Input should be a valid dictionary' }],
          };
          throw err;
        },
        decompose: async () => [],
      },
    },
    async (base) => {
      const response = await fetch(`${base}/typesafe/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'root', stop: 0.75 }),
      });
      assert.equal(response.status, 200);
      const events = await readNdjson(response);
      const fail = events.find((event) => event.type === 'error');
      assert.ok(fail);
      assert.equal(fail.kind, 'invalid');
      assert.match(fail.message, /dictionary/i);
    },
  );
});
