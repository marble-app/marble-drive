// One real turn, to find out whether a provider works on this machine.
//
// It never touches your drive. A scratch drive is made in a temp directory
// with one document in it, agents are switched on for that host only, the
// turn runs through the same HTTP surface the drawer will use, and the scratch
// directories are removed afterwards. What comes back is what a person would
// want to know: did it finish, did it change the document, what did it cost.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDrive } from '../app.js';
import { loadConfig } from '../config.js';
import { builtInProviders } from './providers/index.js';

export const DEFAULT_PROMPT = 'Rename the heading of this document to "Backlog". Change nothing else.';

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why do people stop using a tool?</li>
  </ul>
</body></html>
`;

const quiet = { log() {}, error() {} };

export async function tryProvider({
  providerId,
  providers = builtInProviders(),
  prompt = DEFAULT_PROMPT,
  model = null,
  timeoutMs = 180_000,
  // A seam for tests only: a real run always wants the real createDrive.
  createDriveImpl = createDrive,
}) {
  if (!providers.has(providerId)) throw new Error(`no provider "${providerId}" — there is: ${[...providers.keys()].join(', ')}`);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-try-drive-'));
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-try-work-'));
  let drive = null;
  // loadConfig points MARBLE_APPS at the drive it loads, for the whole
  // process; the scratch drive is gone after this, so put it back.
  const apps = process.env.MARBLE_APPS;

  try {
    const config = loadConfig({
      ...process.env,
      MARBLE_DRIVE_ROOT: root,
      MARBLE_DRIVE_DATA: '',
      MARBLE_DRIVE_SECRET: '',
      HOST: '127.0.0.1',
      MARBLE_DRIVE_AGENTS: '1',
      MARBLE_DRIVE_AGENT_PROVIDER: providerId,
      MARBLE_DRIVE_AGENT_WORKDIR: workdir,
      MARBLE_DRIVE_BACKUP_DIR: '',
      MARBLE_DRIVE_BACKUP_CMD: '',
    });
    drive = await createDriveImpl(config, { log: quiet, agentProviders: providers });
    if (!drive.agents) throw new Error(`agents could not start: ${drive.agentsWhy}`);
    await drive.createDocument('garden', SOURCE, { label: 'try' });

    const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
    const base = `http://127.0.0.1:${port}`;
    const call = async (method, route, body) => {
      const response = await fetch(base + route, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const answer = await response.json();
      if (!response.ok) throw new Error(answer.error ?? `${route} answered ${response.status}`);
      return answer;
    };

    const conversation = await call('POST', '/agent/conversations', { provider: providerId, ...(model ? { model } : {}) });
    const { turnId } = await call('POST', `/agent/conversations/${conversation.id}/turns`, {
      prompt,
      context: { target: 'garden', viewing: 'garden', selection: [] },
    });

    const deadline = Date.now() + timeoutMs;
    let snapshot;
    for (;;) {
      snapshot = await call('GET', `/agent/conversations/${conversation.id}`);
      const turn = snapshot.turns.find((t) => t.id === turnId);
      if (turn && !['queued', 'running'].includes(turn.status)) break;
      if (Date.now() > deadline) {
        await call('POST', `/agent/turns/${turnId}/cancel`);
        throw new Error(`the turn did not finish within ${Math.round(timeoutMs / 1000)} s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const turn = snapshot.turns.find((t) => t.id === turnId);
    const source = await drive.store.read('garden');
    return {
      status: turn.status,
      error: turn.error,
      applied: turn.applied,
      heading: /<h1 data-marble-id="h">([^<]*)<\/h1>/.exec(source)?.[1] ?? null,
      costUsd: turn.usage?.costUsd ?? null,
      events: snapshot.events.map((e) => e.type),
    };
  } finally {
    // A close that fails still must not leak the scratch directories — what a
    // caller wants back is the turn's result (or its own error), not a report
    // about the drive's own shutdown. So the failure is swallowed here, after
    // giving close a chance to do whatever teardown it can.
    try {
      await drive?.close();
    } catch {
      // ignored: cleanup below still has to happen either way
    }
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(workdir, { recursive: true, force: true });
    if (apps === undefined) delete process.env.MARBLE_APPS;
    else process.env.MARBLE_APPS = apps;
  }
}
