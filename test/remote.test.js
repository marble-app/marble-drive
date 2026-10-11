import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-remote-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { seedDrive } = await import('../server/seed.js');
const { preflight, serveOn, serveOff, check } = await import('../server/remote.js');

const ready = { secret: 'a-long-secret', port: 4400, portIsExplicit: true, host: '127.0.0.1' };

/** Stands in for the `tailscale` binary: answers by the first argument, and
 *  remembers what it was asked. The real one is only run by hand. */
function fakeTailscale(answers = {}) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return answers[args[0]] ?? { code: 0, output: '' };
  };
  return { run, calls };
}

const statusJson = {
  code: 0,
  output: JSON.stringify({ Self: { DNSName: 'bryans-macbook-pro.tail1234.ts.net.' } }),
};

test('a host that is ready to be served passes preflight', () => {
  assert.deepEqual(preflight(ready), []);
});

test('preflight names every reason the host is not ready', () => {
  const problems = preflight({ secret: null, port: 4400, portIsExplicit: false, host: '0.0.0.0' });
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /MARBLE_DRIVE_SECRET/);
  // Serve's config outlives this process and names a port. A host that stepped
  // to the next free one would leave it pointing at whatever took this one.
  assert.match(problems.join('\n'), /PORT/);
  assert.match(problems.join('\n'), /HOST/);
});

test('serve is not touched when preflight fails', async () => {
  const tailscale = fakeTailscale();
  const result = await serveOn({ config: { ...ready, secret: null }, run: tailscale.run });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.deepEqual(tailscale.calls, []);
});

test('serve points the tailnet address at the loopback port and says where', async () => {
  const tailscale = fakeTailscale({ status: statusJson });
  const result = await serveOn({ config: ready, run: tailscale.run });
  assert.deepEqual(tailscale.calls[0], ['serve', '--bg', 'http://127.0.0.1:4400']);
  assert.deepEqual(result, { ok: true, url: 'https://bryans-macbook-pro.tail1234.ts.net/' });
});

test('a tailnet without Serve enabled hands back the page that enables it', async () => {
  const tailscale = fakeTailscale({
    serve: {
      code: 1,
      output:
        'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n' +
        '         https://login.tailscale.com/f/serve?node=abc123\n',
    },
  });
  const result = await serveOn({ config: ready, run: tailscale.run });
  assert.deepEqual(result, { ok: false, enable: 'https://login.tailscale.com/f/serve?node=abc123' });
});

test('turning it off removes this address and leaves anything else being served', async () => {
  const tailscale = fakeTailscale();
  await serveOff({ run: tailscale.run });
  assert.deepEqual(tailscale.calls, [['serve', '--https=443', 'off']]);
});

test('check walks a real gated host: health, the closed door, the bearer, the stream', async () => {
  const drive = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_SECRET: 'hunter2' }), {
    log: { log() {}, error() {} },
  });
  await seedDrive(drive.store);
  const port = await new Promise((resolve) => {
    drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  try {
    const passing = await check({ url, secret: 'hunter2' });
    assert.deepEqual(
      passing.map((c) => [c.name, c.ok]),
      [
        ['health', true],
        ['closed without the secret', true],
        ['open with the secret', true],
        ['live stream arrives', true],
      ],
    );

    // Over https the gate's cookie has to come back Secure, which is only true
    // if the proxy really does say X-Forwarded-Proto. Here there is no proxy,
    // so the same check run against this http host would fail — it is only
    // asked for an https address.
    assert.equal(passing.some((c) => c.name === 'cookie is Secure'), false);

    const wrong = await check({ url, secret: 'nope' });
    assert.equal(wrong.find((c) => c.name === 'open with the secret').ok, false);
  } finally {
    await drive.close();
  }
});
