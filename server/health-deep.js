// GET /health/deep: what marble-host asks a drive on the owner's PC once it
// has made it or moved it to a release, and what the owner's Console shows in
// its Agent column (docs/HOSTING.md, "Other people's drives on the PC"). The
// release it runs, whether each agent CLI starts and is signed in, how many
// documents its person has made, and whether an agent can run on it at all.
//
// Answered only on this machine and only to the owner (server/app.js), and
// kept a minute: each fresh answer runs four short CLI commands. The CLIs are
// asked about their own logins the way Connect an agent asks
// (`claudeStatus`, `codexStatus`): under the drive's own home, with no key in
// the environment, so the answer is about the login, and never by opening
// ~/.claude or ~/.codex. The keys file is asked only whether a key is set.
// On a drive the PC hosts (no starter credit, no Cursor) `agentConnected` is
// what GET /agent/setup calls `ready`.

import { claudeStatus } from './agent/claude-signin.js';
import { codexStatus } from './agent/codex-signin.js';
import { pickEnv } from './agent/env.js';
import { createKeyStore } from './agent/keys.js';
import { runCommand } from './agent/providers/exec.js';
import { readManifest } from './app-updates.js';

const versionOf = (r) => (r.missing || r.code !== 0 ? null : /(\d+\.\d+\.\d+)/.exec(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)?.[1] ?? null);

/** Documents in the drive that the host did not put there itself: Start
 *  here, the Drive, Chat and the other pages a new drive is seeded with are
 *  not the person's. */
export async function madeDocs(store) {
  const { seeded } = await readManifest(store.marbleDir);
  const ours = new Set(Object.values(seeded).filter(Boolean));
  return (await store.list({ recursive: true })).filter((e) => e.kind === 'doc' && !ours.has(e.path)).length;
}

export function createDeepHealth({ store, keysFile, env = process.env, run = runCommand, now = Date.now, keepMs = 60_000, timeoutMs = 10_000 }) {
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
