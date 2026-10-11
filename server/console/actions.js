// What the console can do, each as a job (jobs.js) built from the same tools
// the owner runs from a terminal: tools/sprite-deploy.sh, sprite-provision.sh,
// release.sh, the Sprites CLI, git and npm. Nothing here is a second way of
// deploying; it is the first way, with a page in front of it.
//
// Where the tools come from matters. A deploy of main runs sprite-deploy.sh
// from a checkout of that very commit (<src>/marble-drive-ship, detached), so
// the release script and the Claude pin are the ones the release carries,
// whatever the workshop checkout is in the middle of. The workshop's copy is
// deployed from the workshop checkout itself, with --local.

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSecret, parse, patch } from './envfile.js';
import { compareVersions, nextPatch } from './workshop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REMOTE_SETTINGS = path.join(HERE, 'remote-settings.mjs');
// This host's own copy of the sprite's half of a deploy, sent with every
// settings change so the drive has the `apply` this console expects.
const RELEASE_SH = path.join(REPO, 'tools', 'sprite', 'release.sh');

const HOME = '/home/sprite';
const ENV_FILE = `${HOME}/.config/marble-drive/sprite.env`;
const APP = `${HOME}/app`;
const USER_LABELS = ['marble-tester', 'marble-user'];
const STUCK = /Failed to create checkpoint/;
const SECRET_KEY = 'MARBLE_DRIVE_SECRET';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/** The name sprite-provision.sh makes from a person's: t-<slug>. */
export const slug = (person) => String(person ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

const passphrase = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(48);
  let out = '';
  for (const b of bytes) {
    if (b < 248) out += chars[b % 62];
    if (out.length === 24) break;
  }
  return out;
};

const quick = (cmd, args, options = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, out: stdout, err: stderr }));
  });

export function createActions({ sprites, inspector, jobs, workshop, src, self, stateDir, env = process.env }) {
  const md = path.join(src, 'marble-drive');
  const marbleDir = path.join(src, 'marble');
  const shipDir = path.join(src, 'marble-drive-ship');
  const stateFile = path.join(stateDir, 'console.json');
  const jobEnv = { ...env, GIT_TERMINAL_PROMPT: '0' };

  // Drives whose checkpoint store is stuck: shipped with --no-checkpoint, and
  // said so, until someone asks to try checkpoints again.
  let stuck = new Set();
  try {
    stuck = new Set(JSON.parse(fs.readFileSync(stateFile, 'utf8')).stuck ?? []);
  } catch {}
  const saveStuck = () => fsp.mkdir(stateDir, { recursive: true })
    .then(() => fsp.writeFile(stateFile, JSON.stringify({ stuck: [...stuck] })))
    .catch(() => {});

  async function drive(name) {
    const row = (await sprites.list()).find((s) => s.name === name);
    if (!row) throw bad(`no drive called ${name}`, 404);
    return row;
  }
  const isUser = (row) => row.labels.some((l) => USER_LABELS.includes(l));

  const onDrive = (ctx, name, cmd, options = {}) => {
    const [bin, args] = sprites.command.exec(name, cmd, { files: options.files ?? [] });
    return ctx.exec(bin, args, { env: jobEnv, ...options });
  };

  // ------------------------------------------------------------- deploying

  async function resolve(ctx, ref) {
    ctx.say(`==> fetching main`);
    await ctx.exec('git', ['-C', md, 'fetch', '--quiet', 'origin'], { env: jobEnv });
    const { out } = await ctx.exec('git', ['-C', md, 'rev-parse', '--verify', `${ref}^{commit}`], { env: jobEnv, quiet: true });
    return out.trim();
  }

  async function toolsAt(ctx, sha) {
    if (fs.existsSync(path.join(shipDir, '.git'))) {
      await ctx.exec('git', ['-C', shipDir, 'checkout', '--quiet', '--detach', '--force', sha], { env: jobEnv });
    } else {
      await ctx.exec('git', ['-C', md, 'worktree', 'add', '--quiet', '--detach', shipDir, sha], { env: jobEnv });
    }
    return shipDir;
  }

  async function deployOne(ctx, name, { sha = null, local = false } = {}) {
    const dir = local ? md : shipDir;
    const base = [path.join(dir, 'tools', 'sprite-deploy.sh'), name, ...(local ? ['--local'] : ['--ref', sha])];
    const run = (noCheckpoint) => ctx.exec('bash', [...base, ...(noCheckpoint ? ['--no-checkpoint'] : [])], { cwd: dir, env: jobEnv, allowFail: true });
    let skip = stuck.has(name);
    if (skip) ctx.say(`==> ${name}'s checkpoint store is stuck: deploying without a checkpoint (--rollback still undoes the code)`);
    let result = await run(skip);
    if (result.code !== 0 && !skip && STUCK.test(`${result.out}${result.err}`)) {
      stuck.add(name);
      await saveStuck();
      skip = true;
      ctx.say(`==> ${name} cannot make a checkpoint (its store is stuck). Nothing was changed; deploying again without one.`);
      result = await run(true);
    }
    if (result.code !== 0) throw new Error(`the deploy to ${name} failed`);
    await inspector.look(name).catch(() => {});
    return { name, skippedCheckpoint: skip };
  }

  function deploy(name, { source = 'main', ref = 'origin/main' } = {}) {
    const local = source === 'workshop';
    return drive(name).then(() => {
      if (jobs.running('fleet')) throw bad('shipping is under way; wait for it', 409);
      return jobs.start({
        kind: 'deploy',
        title: local ? `Deploy the workshop's copy to ${name}` : `Deploy main to ${name}`,
        target: name,
        meta: { source, ref },
        run: async (ctx) => {
          if (local) return deployOne(ctx, name, { local: true });
          const sha = await resolve(ctx, ref);
          await toolsAt(ctx, sha);
          return { sha, ...(await deployOne(ctx, name, { sha })) };
        },
      });
    });
  }

  /** Every user's drive, then this one: the order a person ships in. */
  async function shipTargets() {
    const all = await sprites.list();
    const users = all.filter(isUser).map((r) => r.name)
      .sort((a, b) => (a === 't-bryan' ? -1 : b === 't-bryan' ? 1 : a.localeCompare(b)));
    const own = all.find((r) => r.name === self && !isUser(r));
    return [...users, ...(own ? [own.name] : [])];
  }

  async function ship({ ref = 'origin/main' } = {}) {
    const targets = await shipTargets();
    const busy = targets.map((t) => jobs.running(t)).find(Boolean);
    if (busy) throw bad(`${busy.target} is busy: ${busy.title}`, 409);
    return jobs.start({
      kind: 'ship',
      title: 'Ship main to every drive',
      target: 'fleet',
      meta: { ref, targets },
      run: async (ctx) => {
        const sha = await resolve(ctx, ref);
        await toolsAt(ctx, sha);
        const deployed = [];
        const failed = [];
        for (const name of targets) {
          if (ctx.stopping) break;
          ctx.say(`\n==> ==== ${name} ====`);
          try {
            await deployOne(ctx, name, { sha });
            deployed.push(name);
          } catch (err) {
            ctx.say(`==> ${err.message}; going on`);
            failed.push(name);
          }
        }
        ctx.say(`\n==> deployed: ${deployed.join(', ') || 'none'}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
        if (failed.length) throw new Error(`${failed.join(', ')} did not take ${sha.slice(0, 7)}`);
        return { sha, deployed, failed };
      },
    });
  }

  /** What a deploy would do, from the script itself, before anything moves. */
  async function plan({ name = null, source = 'main', ref = 'origin/main' } = {}) {
    const targets = name ? [name] : await shipTargets();
    const local = source === 'workshop';
    let sha = null;
    if (!local) {
      await quick('git', ['-C', md, 'fetch', '--quiet', 'origin']);
      sha = (await quick('git', ['-C', md, 'rev-parse', '--verify', `${ref}^{commit}`])).out.trim() || null;
    }
    const script = path.join(md, 'tools', 'sprite-deploy.sh');
    const args = [script, targets[0], ...(local ? ['--local'] : ['--ref', sha ?? ref]), '--print-plan'];
    const { code, out, err } = await quick('bash', args, { cwd: md, env: jobEnv });
    const fields = {};
    for (const line of out.split('\n')) {
      const m = /^([a-z]+): (.*)$/.exec(line);
      if (m) fields[m[1]] = m[2];
    }
    return {
      ok: code === 0,
      error: code === 0 ? null : (err || out).trim().split('\n').slice(-1)[0],
      sha,
      source,
      targets,
      noCheckpoint: targets.filter((t) => stuck.has(t)),
      self,
      marble: fields.marble ?? null,
      claude: fields.claude ?? null,
      release: fields.release ?? null,
    };
  }

  function rollback(name) {
    return drive(name).then(() => jobs.start({
      kind: 'rollback',
      title: `Roll ${name} back`,
      target: name,
      run: async (ctx) => {
        await ctx.exec('bash', [path.join(md, 'tools', 'sprite-deploy.sh'), name, '--rollback'], { cwd: md, env: jobEnv });
        await inspector.look(name).catch(() => {});
      },
    }));
  }

  // ------------------------------------------------------------- settings

  async function rewriteEnv(ctx, name, change) {
    ctx.say(`==> reading ${name}'s settings`);
    const { out } = await onDrive(ctx, name, ['cat', ENV_FILE], { quiet: true });
    for (const { key, value } of parse(out)) if (isSecret(key)) ctx.secret(value);
    for (const [key, value] of Object.entries(change.set ?? {})) if (isSecret(key)) ctx.secret(String(value));
    const next = patch(out, change);
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-env-'));
    const file = path.join(tmp, 'sprite.env');
    try {
      await fsp.writeFile(file, next, { mode: 0o600 });
      ctx.say(`==> writing ${Object.keys(change.set ?? {}).concat(change.unset ?? []).join(', ')}`);
      await onDrive(ctx, name, ['sh', '-c', `install -m 600 /tmp/marble-console-sprite.env ${ENV_FILE} && rm -f /tmp/marble-console-sprite.env && chmod +x ${APP}/release.sh`], {
        files: [[file, '/tmp/marble-console-sprite.env'], [RELEASE_SH, `${APP}/release.sh`]],
      });
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
    const when = name === self ? 'apply-when-idle' : 'apply';
    ctx.say(name === self ? '==> restarting when no agent is working' : `==> restarting ${name} with them`);
    await onDrive(ctx, name, [`${APP}/release.sh`, when]);
    inspector.forget(name);
    await inspector.look(name).catch(() => {});
  }

  function settings(name, { set = {}, unset = [] } = {}) {
    if (SECRET_KEY in set || unset.includes(SECRET_KEY)) throw bad('the passphrase is changed with New passphrase');
    patch('', { set, unset }); // refuses a bad name or value before a job starts
    return drive(name).then(() => jobs.start({
      kind: 'settings',
      title: `Change ${name}'s settings`,
      target: name,
      meta: { set: Object.fromEntries(Object.entries(set).map(([k, v]) => [k, isSecret(k) ? '••••' : v])), unset },
      run: (ctx) => rewriteEnv(ctx, name, { set, unset }),
    }));
  }

  function newPassphrase(name) {
    return drive(name).then(() => jobs.start({
      kind: 'passphrase',
      title: `New passphrase for ${name}`,
      target: name,
      run: (ctx) => rewriteEnv(ctx, name, { set: { [SECRET_KEY]: passphrase() } }),
    }));
  }

  async function secretOf(name) {
    let value = inspector.secret(name, SECRET_KEY);
    if (!value) {
      await inspector.look(name);
      value = inspector.secret(name, SECRET_KEY);
    }
    if (!value) throw bad(`${name} has no passphrase`, 409);
    return value;
  }

  function claude(name, auth) {
    if (auth !== 'login' && auth !== 'api') throw bad('Claude is login or api');
    return drive(name).then(() => jobs.start({
      kind: 'claude',
      title: `${name}: Claude on ${auth === 'login' ? 'the login' : 'an API key'}`,
      target: name,
      run: async (ctx) => {
        const secret = await secretOf(name);
        ctx.secret(secret);
        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-claude-'));
        const payload = path.join(tmp, 'payload.json');
        try {
          await fsp.writeFile(payload, JSON.stringify({ secret, settings: { claudeAuth: auth } }), { mode: 0o600 });
          await onDrive(ctx, name, ['node', '/tmp/marble-console-settings.mjs', '/tmp/marble-console-payload.json'], {
            files: [[REMOTE_SETTINGS, '/tmp/marble-console-settings.mjs'], [payload, '/tmp/marble-console-payload.json']],
          });
        } finally {
          await fsp.rm(tmp, { recursive: true, force: true });
        }
        await inspector.look(name).catch(() => {});
      },
    }));
  }

  function signOut(name) {
    return drive(name).then(() => jobs.start({
      kind: 'signout',
      title: `Sign ${name} out of Claude`,
      target: name,
      run: async (ctx) => {
        await onDrive(ctx, name, ['rm', '-f', `${HOME}/.claude/.credentials.json`]);
        ctx.say('==> signed out: its agents need a new login, or an API key');
        await inspector.look(name).catch(() => {});
      },
    }));
  }

  function access(name, to) {
    if (name === self && to === 'public') throw bad(`${self} stays private: it holds the keys that change everyone's drive`);
    const [bin, args] = sprites.command.access(name, to);
    return drive(name).then(() => jobs.start({
      kind: 'access',
      title: `Make ${name}'s link ${to}`,
      target: name,
      run: (ctx) => ctx.exec(bin, args, { env: jobEnv }),
    }));
  }

  // ----------------------------------------------------------- checkpoints

  function checkpoint(name, comment = 'from the console') {
    const [bin, args] = sprites.command.checkpoint(name, String(comment).slice(0, 200));
    return drive(name).then(() => jobs.start({
      kind: 'checkpoint',
      title: `Checkpoint ${name}`,
      target: name,
      run: async (ctx) => {
        const { code, out, err } = await ctx.exec(bin, args, { env: jobEnv, allowFail: true });
        if (code !== 0 && STUCK.test(`${out}${err}`)) {
          stuck.add(name);
          await saveStuck();
          throw new Error(`${name}'s checkpoint store is stuck; report it to Fly if it persists`);
        }
        if (code !== 0) throw new Error('the checkpoint was not made');
      },
    }));
  }

  async function restore(name, id, confirm) {
    if (name === self) throw bad(`${self} is not restored from its own console`);
    if (confirm !== name) throw bad(`type ${name} to restore it`);
    await drive(name);
    if (!(await sprites.checkpoints(name)).some((c) => c.id === id)) throw bad(`${name} has no checkpoint ${id}`, 404);
    const [bin, args] = sprites.command.restore(name, id);
    return jobs.start({
      kind: 'restore',
      title: `Restore ${name} to ${id}`,
      target: name,
      run: async (ctx) => {
        await ctx.exec(bin, args, { env: jobEnv });
        await inspector.look(name).catch(() => {});
      },
    });
  }

  // ------------------------------------------------------------ people

  async function provision({ person, agent = 'api', key = '' } = {}) {
    const s = slug(person);
    if (!s) throw bad('a name is needed');
    if (agent !== 'api' && agent !== 'subscription') throw bad('Claude is api or subscription');
    const key2 = String(key ?? '').trim();
    if (key2 && agent !== 'api') throw bad('a key is for Claude on an API key');
    if (key2 && !/^sk-ant-/.test(key2)) throw bad('that does not look like an Anthropic API key');
    const name = `t-${s}`;
    if ((await sprites.list()).some((r) => r.name === name)) throw bad(`${name} already exists`, 409);
    return jobs.start({
      kind: 'provision',
      title: `New drive for ${String(person).trim()}`,
      target: name,
      meta: { person: String(person).trim(), agent, name },
      run: async (ctx) => {
        ctx.mask(/(passphrase: )\S+/);
        if (key2) ctx.secret(key2);
        const sha = await resolve(ctx, 'origin/main');
        await toolsAt(ctx, sha);
        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-key-'));
        const args = [path.join(shipDir, 'tools', 'sprite-provision.sh'), String(person).trim(), '--agent', agent];
        try {
          if (key2) {
            await fsp.writeFile(path.join(tmp, 'key'), key2, { mode: 0o600 });
            args.push('--key-file', path.join(tmp, 'key'));
          }
          await ctx.exec('bash', args, { cwd: shipDir, env: jobEnv });
        } finally {
          await fsp.rm(tmp, { recursive: true, force: true });
        }
        await inspector.look(name).catch(() => {});
        return { name };
      },
    });
  }

  async function remove(name, confirm) {
    const row = await drive(name);
    if (!isUser(row) || !name.startsWith('t-')) throw bad(`${name} is not a tester's drive`);
    if (confirm !== name) throw bad(`type ${name} to remove it`);
    return jobs.start({
      kind: 'remove',
      title: `Remove ${name}`,
      target: name,
      run: async (ctx) => {
        await ctx.exec('bash', [path.join(md, 'tools', 'sprite-provision.sh'), '--remove', name.slice(2)], { cwd: md, env: jobEnv, stdin: `${name}\n` });
        stuck.delete(name);
        await saveStuck();
        inspector.forget(name);
        await fsp.rm(path.join(stateDir, 'sprites', `${name}.json`), { force: true });
      },
    });
  }

  // ------------------------------------------------------------ workshop

  const repoDir = (repo) => {
    if (repo === 'marble-drive') return md;
    if (repo === 'marble') return marbleDir;
    throw bad(`no checkout called ${repo}`, 404);
  };

  // Each workshop job says its steps as it goes, so the card can show where it
  // is, and says what went wrong in words, with the button that fixes it
  // (`fix`) when there is one. A failure also says whether anything changed,
  // because that is the first thing anyone wants to know.

  function pull(repo) {
    const dir = repoDir(repo);
    return jobs.start({
      kind: 'pull',
      title: `Get the latest ${repo} from GitHub`,
      target: 'workshop',
      meta: { repo },
      run: async (ctx) => {
        ctx.step('Get the latest from GitHub');
        const got = await ctx.exec('git', ['-C', dir, 'pull', '--ff-only'], { env: jobEnv, allowFail: true });
        if (got.code !== 0) {
          throw new Error(`This copy of ${repo} could not simply move forward to GitHub's: it has edits or commits of its own that GitHub does not. Nothing was changed.`);
        }
      },
    });
  }

  function runTests(repo) {
    const dir = repoDir(repo);
    return jobs.start({
      kind: 'test',
      title: `Test ${repo}`,
      target: 'workshop',
      meta: { repo },
      run: async (ctx) => {
        ctx.step('Run the tests');
        const ran = await ctx.exec('npm', ['test'], { cwd: dir, env: jobEnv, allowFail: true });
        if (ran.code !== 0) throw new Error(`Some of ${repo}'s tests failed; the full output says which. Nothing was changed.`);
      },
    });
  }

  // npm prints the page to open when it wants the owner: a sign-in, or an
  // approval for a publish. Either becomes a button on the card.
  const NPM_LINK = /https:\/\/www\.npmjs\.com\/\S+/;
  const watchNpm = (ctx, label) => ctx.onLine((line) => {
    const url = NPM_LINK.exec(line)?.[0];
    if (url) ctx.link(url.replace(/[.,)]+$/, ''), label);
  });

  const npmSignedIn = async () => {
    const who = await quick('npm', ['whoami'], { env: jobEnv, timeout: 30_000 });
    return who.code === 0 ? who.out.trim() || null : null;
  };

  /** Sign this machine in to npm, through the browser: npm prints a link,
   *  the owner approves it on npmjs.com, and npm keeps the token itself. */
  function npmLogin() {
    return jobs.start({
      kind: 'npm-login',
      title: 'Sign in to npm',
      target: 'workshop',
      meta: { repo: 'marble' },
      run: async (ctx) => {
        watchNpm(ctx, 'Sign in on npmjs.com');
        try {
          ctx.step('Wait for you to sign in on npmjs.com');
          const login = await ctx.exec('npm', ['login', '--auth-type=web'], { env: jobEnv, allowFail: true });
          ctx.step('Check the sign-in');
          const user = await npmSignedIn();
          if (!user) throw new Error(login.code === 0 ? 'npm says it signed in, but still does not know who this is.' : 'The sign-in did not finish. Nothing was changed; try again.');
          ctx.say(`Signed in to npm as ${user}.`);
          return { user };
        } finally {
          workshop.forgetNpm?.();
        }
      },
    });
  }

  /** Why npm would not take it, in words, and which button puts it right.
   *  By now the version is committed and pushed, so the way on is always to
   *  upload that version, never to make another. */
  function publishFailed(version, text) {
    // npm's own reason, skipping its "code E500" line for the one that says what happened.
    const said = text.split('\n').filter((l) => /^npm (error|ERR!)/.test(l)).map((l) => l.replace(/^npm (error|ERR!)\s*/, '').trim())
      .filter((l) => l && !/^code \S+$/.test(l) && !/complete log of this run/i.test(l));
    const kept = `${version} is committed and pushed, so Finish publishing uploads it without making a new version.`;
    if (/E401|ENEEDAUTH|E404[\s\S]*PUT/.test(text)) {
      return Object.assign(new Error(`npm refused the upload: this machine is not signed in to npm, or its account cannot publish @bdhmin/marble. ${kept}`), { fix: 'npm-login' });
    }
    if (/EOTP|one-time password/i.test(text)) {
      return Object.assign(new Error(`npm wanted you to approve the upload and did not hear back in time. ${kept}`), { fix: 'finish' });
    }
    if (/cannot publish over|previously published/i.test(text)) {
      return new Error(`npm already has ${version}, so there was nothing to upload.`);
    }
    return Object.assign(new Error(`npm did not take ${version}${said[0] ? `: ${said[0]}` : ''}. ${kept}`), { fix: 'finish' });
  }

  /** marble, published. In order, and nothing changes until the checks pass:
   *  this copy has no loose edits, it has GitHub's latest, and npm knows who
   *  this is. Then a new patch version (package.json and both plugin
   *  manifests, which marble's own test holds together), committed, tagged
   *  and pushed, and uploaded; prepublishOnly runs marble's guard and unit
   *  tests. A version made before and never uploaded is uploaded as it is:
   *  pressing again finishes the job rather than making 0.2.4 on top of an
   *  unpublished 0.2.3. marble-drive needs nothing: it depends on ../marble,
   *  and a deploy installs whatever version that checkout declares. */
  function publish() {
    return jobs.start({
      kind: 'publish',
      title: 'Publish marble',
      target: 'workshop',
      meta: { repo: 'marble' },
      run: async (ctx) => {
        watchNpm(ctx, 'Approve on npmjs.com');
        try {
          ctx.step('Check this copy has no loose edits');
          const { out: dirty } = await ctx.exec('git', ['-C', marbleDir, 'status', '--porcelain'], { env: jobEnv, quiet: true });
          if (dirty.trim()) throw new Error('marble has edits that are not committed. Commit or drop them first; nothing was changed.');

          ctx.step('Get the latest from GitHub');
          const got = await ctx.exec('git', ['-C', marbleDir, 'pull', '--ff-only'], { env: jobEnv, allowFail: true });
          if (got.code !== 0) throw new Error("This copy could not simply move forward to GitHub's, so it was not published. Nothing was changed.");

          ctx.step('Check this machine is signed in to npm');
          const user = await npmSignedIn();
          if (!user) throw Object.assign(new Error('This machine is not signed in to npm, so it cannot publish. Nothing was changed.'), { fix: 'npm-login' });
          ctx.say(`Signed in to npm as ${user}.`);

          const pkgFile = path.join(marbleDir, 'package.json');
          const here = JSON.parse(await fsp.readFile(pkgFile, 'utf8')).version;
          const seen = await quick('npm', ['view', '@bdhmin/marble', 'version'], { cwd: marbleDir, env: jobEnv, timeout: 30_000 });
          const onNpm = seen.code === 0 ? seen.out.trim() : null;
          const prepared = onNpm && compareVersions(here, onNpm) > 0;

          let version = here;
          if (prepared) {
            ctx.say(`${here} was made before and never reached npm; uploading it as it is.`);
          } else {
            version = nextPatch(here);
            ctx.step(`Make version ${version}`);
            await ctx.exec('npm', ['version', 'patch', '--no-git-tag-version'], { cwd: marbleDir, env: jobEnv });
            for (const file of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
              const full = path.join(marbleDir, file);
              const text = await fsp.readFile(full, 'utf8').catch(() => null);
              if (text === null) continue;
              await fsp.writeFile(full, text.replace(/("version":\s*")[^"]*(")/g, `$1${version}$2`));
            }
            await ctx.exec('git', ['-C', marbleDir, 'commit', '-q', '-am', `marble ${version}`], { env: jobEnv });
          }
          // Annotated, because --follow-tags pushes only annotated tags.
          const tagged = await ctx.exec('git', ['-C', marbleDir, 'rev-parse', '-q', '--verify', `refs/tags/v${version}`], { env: jobEnv, allowFail: true, quiet: true });
          if (tagged.code !== 0) await ctx.exec('git', ['-C', marbleDir, 'tag', '-a', `v${version}`, '-m', `marble ${version}`], { env: jobEnv });

          ctx.step('Push it to GitHub');
          await ctx.exec('git', ['-C', marbleDir, 'push', '--quiet', 'origin', 'HEAD', `refs/tags/v${version}`], { env: jobEnv });

          ctx.step(`Test and upload ${version} to npm`);
          const published = await ctx.exec('npm', ['publish'], { cwd: marbleDir, env: jobEnv, allowFail: true });
          if (published.code !== 0) throw publishFailed(version, `${published.out}\n${published.err}`);
          ctx.say(`${version} is on npm. The next deploy installs it; nothing reaches a drive until you ship.`);
          return { version };
        } finally {
          workshop.forgetNpm?.();
        }
      },
    });
  }

  // --------------------------------------------------------------- reads

  const looking = new Map();
  /** Look inside now; one look at a time per drive. */
  function look(name) {
    if (!looking.has(name)) {
      looking.set(name, drive(name).then(() => inspector.look(name)).finally(() => looking.delete(name)));
    }
    return looking.get(name);
  }

  async function reveal(name) {
    await drive(name);
    return secretOf(name);
  }

  async function log(name, lines = 300) {
    await drive(name);
    const n = String(Math.max(20, Math.min(2000, Number(lines) || 300)));
    const { stdout } = await sprites.exec(name, ['tail', '-n', n, '/.sprite/logs/services/marble-drive.log']);
    return stdout;
  }

  return {
    deploy,
    ship,
    plan,
    rollback,
    settings,
    newPassphrase,
    claude,
    signOut,
    access,
    checkpoint,
    restore,
    provision,
    remove,
    pull,
    test: runTests,
    publish,
    npmLogin,
    look,
    reveal,
    log,
    shipTargets,
    stuck: () => [...stuck],
    clearStuck: async (name) => {
      stuck.delete(name);
      await saveStuck();
    },
  };
}
