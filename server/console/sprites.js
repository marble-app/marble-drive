// The fleet, as the Sprites API sees it, through the CLI admin-p1 is signed in
// to. Reading the API never wakes a drive: `status` is `running` while a sprite
// is awake and `warm` while it is paused, `last_running_at` is when it last
// woke and `last_warming_at` when it last paused (measured 2026-09-24). So the
// console can say who is awake, and since when, for nothing.
//
// Only the fields a row needs are passed on. The API has more — a sprite's
// services answer with the host's environment, passphrase included — and none
// of it leaves this file.

import { execFile } from 'node:child_process';

const run = (bin, args, { timeout = 30_000 } = {}) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error((stderr || err.message).trim().split('\n').slice(-2).join(' ')), { stderr, stdout }));
      resolve({ stdout, stderr });
    });
  });

/** The JSON in a CLI answer: `sprite api` may print a line or two first. */
const jsonIn = (text) => {
  const at = text.search(/[[{]/);
  if (at < 0) throw new Error('the Sprites API answered without JSON');
  return JSON.parse(text.slice(at));
};

const ACCESS = { public: 'public', private: 'sprite' };

export function createSprites({ bin = 'sprite', org = 'marble-drive' } = {}) {
  const api = async (route) => {
    const body = jsonIn((await run(bin, ['api', '-o', org, route])).stdout);
    if (body?.error) throw new Error(`Sprites: ${body.error}`);
    return body;
  };

  const row = (s) => {
    const awake = s.status === 'running';
    return {
      name: s.name,
      status: s.status,
      awake,
      // Awake since it woke; asleep since it paused.
      since: (awake ? s.last_running_at : s.last_warming_at) ?? s.last_running_at ?? null,
      url: s.url,
      access: s.url_settings?.auth === 'public' ? 'public' : 'private',
      labels: Array.isArray(s.labels) ? s.labels : [],
      createdAt: s.created_at ?? null,
    };
  };

  async function list() {
    const body = await api('/v1/sprites/');
    return (body.data ?? []).map(row).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function checkpoints(name) {
    const body = await api(`/v1/sprites/${encodeURIComponent(name)}/checkpoints`);
    return (Array.isArray(body) ? body : body.data ?? [])
      .filter((c) => c.id !== 'Current')
      .map((c) => ({ id: c.id, at: c.create_time, comment: c.comment ?? '' }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  // The commands jobs run, as [bin, args]: never a shell string.
  const command = {
    exec: (name, cmd, { files = [] } = {}) => [bin, [
      'exec', '-o', org, '-s', name, '--no-stdin',
      ...files.flatMap(([local, remote]) => ['--file', `${local}:${remote}`]),
      '--', ...cmd,
    ]],
    checkpoint: (name, comment) => [bin, ['checkpoint', 'create', '-o', org, '-s', name, '--comment', comment]],
    restore: (name, id) => [bin, ['restore', id, '-o', org, '-s', name]],
    access: (name, access) => {
      if (!ACCESS[access]) throw new Error('access is public or private');
      return [bin, ['config', 'update', '--url-auth', ACCESS[access], '-o', org, '-s', name]];
    },
  };

  /** Run one command on a drive and give back what it printed. Wakes it. */
  async function exec(name, cmd, options = {}) {
    const [b, args] = command.exec(name, cmd, options);
    return run(b, args, { timeout: options.timeout ?? 60_000 });
  }

  return { list, checkpoints, exec, command, org, bin };
}
