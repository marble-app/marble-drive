// GET /health/deep: what marble-host asks a drive on the owner's PC once it
// has made it or moved it to a release, and what the owner's Console shows in
// its Agent column (docs/HOSTING.md, "Other people's drives on the PC"). The
// release it runs, whether each agent CLI starts and is signed in, how many
// documents its person has made, whether an agent can run on it at all, how
// many turns its agents began today and when it was last used. marble-host
// reads it every five minutes, for the Console's People view.
//
// Answered only on this machine and only to the owner (server/app.js), and
// kept a minute: each fresh answer runs four short CLI commands. The CLIs are
// asked about their own logins the way Connect an agent asks
// (`claudeStatus`, `codexStatus`): under the drive's own home, with no key in
// the environment, so the answer is about the login, and never by opening
// ~/.claude or ~/.codex. The keys file is asked only whether a key is set.
// On a drive the PC hosts (no starter credit, no Cursor) `agentConnected` is
// what GET /agent/setup calls `ready`.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { claudeStatus } from './agent/claude-signin.js';
import { codexStatus } from './agent/codex-signin.js';
import { pickEnv } from './agent/env.js';
import { createKeyStore } from './agent/keys.js';
import { runCommand } from './agent/providers/exec.js';
import { readManifest } from './app-updates.js';

const versionOf = (r) => (r.missing || r.code !== 0 ? null : /(\d+\.\d+\.\d+)/.exec(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)?.[1] ?? null);

const DAY = 24 * 60 * 60 * 1000;
const LEDGER_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/** How the drive has been used, from the agents' own records of their turns
 *  and the usage ledger's count of pages opened each minute (server/ledger.js),
 *  never from anything anyone wrote: `turnsToday`, the turns its agents began
 *  since midnight by this machine's clock, and `lastActive`, when a turn last
 *  ran or a page was last opened, as an ISO time (null for never). A day's
 *  ledger file is read again only once it has changed. */
export function createActivity({ turnsSince = async () => [], usageDir = null, now = Date.now, lookBackDays = 90 } = {}) {
  const files = new Map();

  async function lastOpened() {
    if (!usageDir) return null;
    let names;
    try {
      names = (await fsp.readdir(usageDir)).filter((n) => LEDGER_FILE.test(n)).sort().reverse();
    } catch {
      return null;
    }
    // Newest day first: the first with a page opened in it has the answer.
    for (const name of names) {
      const file = path.join(usageDir, name);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) continue;
      let kept = files.get(name);
      if (!kept || kept.size !== stat.size || kept.mtimeMs !== stat.mtimeMs) {
        let latest = null;
        for (const raw of (await fsp.readFile(file, 'utf8').catch(() => '')).split('\n')) {
          if (!raw.includes('"opens"')) continue;
          try {
            const line = JSON.parse(raw);
            if (line.opens > 0 && Number.isFinite(line.t) && (latest === null || line.t > latest)) latest = line.t;
          } catch {}
        }
        kept = { size: stat.size, mtimeMs: stat.mtimeMs, latest };
        files.set(name, kept);
      }
      if (kept.latest !== null) return kept.latest * 1000;
    }
    return null;
  }

  return {
    async read() {
      const t = now();
      const midnight = new Date(t);
      midnight.setHours(0, 0, 0, 0);
      const turns = (await Promise.resolve().then(() => turnsSince(t - lookBackDays * DAY)).catch(() => [])) ?? [];
      let turnsToday = 0;
      let lastTurn = null;
      for (const turn of turns) {
        if (turn.status === 'queued') continue;
        if (Number.isFinite(turn.startedAt) && turn.startedAt >= midnight.getTime()) turnsToday += 1;
        const at = turn.status === 'running' ? t : turn.finishedAt ?? turn.startedAt ?? null;
        if (Number.isFinite(at) && (lastTurn === null || at > lastTurn)) lastTurn = at;
      }
      const opened = await lastOpened();
      const last = Math.max(lastTurn ?? -Infinity, opened ?? -Infinity);
      return { turnsToday, lastActive: Number.isFinite(last) ? new Date(last).toISOString() : null };
    },
  };
}

/** Documents in the drive that the host did not put there itself: Start
 *  here, the Drive, Chat and the other pages a new drive is seeded with are
 *  not the person's. */
export async function madeDocs(store) {
  const { seeded } = await readManifest(store.marbleDir);
  const ours = new Set(Object.values(seeded).filter(Boolean));
  return (await store.list({ recursive: true })).filter((e) => e.kind === 'doc' && !ours.has(e.path)).length;
}

export function createDeepHealth({ store, keysFile, env = process.env, run = runCommand, now = Date.now, keepMs = 60_000, timeoutMs = 10_000, activity = null }) {
  let kept = null;
  let asking = null;

  async function ask() {
    const version = (command) => run(command, ['--version'], { env: pickEnv(env), timeout: timeoutMs });
    const [claudeVersion, claude, codexVersion, codex] = await Promise.all([
      version('claude'),
      claudeStatus({ env, exec: run, timeout: timeoutMs }),
      version('codex'),
      codexStatus({ env, exec: run, timeout: timeoutMs }),
    ]);
    const claudeIn = claude.signedIn;
    const codexIn = codex.signedIn;
    const keys = keysFile ? await createKeyStore({ file: keysFile }).flags().catch(() => ({})) : {};
    return {
      ok: true,
      release: env.MARBLE_GUEST_RELEASE ?? null,
      claude: { version: versionOf(claudeVersion), signedIn: claudeIn },
      codex: { version: versionOf(codexVersion), signedIn: codexIn },
      docs: await madeDocs(store),
      // A login, or a key the person put in Agents settings.
      agentConnected: claudeIn || codexIn || Boolean(keys.anthropic || keys.claude || keys.openai),
      ...(activity ? await activity.read().catch(() => ({ turnsToday: null, lastActive: null })) : {}),
    };
  }

  return {
    /** The answer, at most a minute old. Asked twice at once, it is worked out once. */
    async read() {
      if (kept && now() - kept.at < keepMs) return kept.body;
      asking ??= ask()
        .then((body) => {
          kept = { at: now(), body };
          return body;
        })
        .finally(() => {
          asking = null;
        });
      return asking;
    },
  };
}
