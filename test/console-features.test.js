// Features (server/console/features.js): what a chat committed and pushed,
// read from its own log; a first grouping by rules; a saved board placed on
// its stops and drives from git alone; the owner's corrections kept through
// every triage; and the route the Console's Features view reads.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collect, commitSubjects, createFeatures, ownRelease, real, ringDrives } from '../server/console/features.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();

async function commit(dir, file, text, subject) {
  await fsp.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await fsp.writeFile(path.join(dir, file), text);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', subject);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A workshop (origin, a checkout, a worktree with loose work) and a drive
 *  with one chat that committed, one that pushed, and a spec page. */
async function world() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'features-'));
  const src = path.join(root, 'src');
  const drive = path.join(root, 'drive');
  await fsp.mkdir(src);
  const bare = path.join(root, 'marble-drive.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(src, 'clone', '-q', bare, 'marble-drive');
  const repo = path.join(src, 'marble-drive');
  git(repo, 'checkout', '-q', '-b', 'main');
  const base = await commit(repo, 'README.md', 'x', 'first');
  const shareA = await commit(repo, 'server/shares.js', 'a', 'Share links at three levels');
  const notes1 = await commit(repo, 'starters/note.mrbl', '1', 'Notes: a margins switch');
  const notes2 = await commit(repo, 'starters/note.mrbl', '2', 'Notes: four heading sizes');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const wt = path.join(repo, '.claude', 'worktrees', 'variations-ui');
  git(repo, 'worktree', 'add', '-q', '-b', 'variations-ui', wt, 'main');
  await fsp.writeFile(path.join(wt, 'panel.js'), 'loose');

  const chat = async (id, meta, lines) => {
    const dir = path.join(drive, '.marble', 'agents', id);
    await fsp.mkdir(path.join(dir, 'raw'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id, title: meta.title, target: meta.target ?? 'Agents', updatedAt: Date.now(), running: Boolean(meta.running) }));
    await fsp.writeFile(path.join(dir, 'raw', `${id}-t1.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
  };
  const use = (id, input, name = 'Bash') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id, text) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  await chat('aaaaaaaaaaaa', { title: 'File Sharing Permission Levels' }, [
    use('t1', { command: `cd ${repo} && git commit -q -m "Share links at three levels" && git log --oneline -3` }),
    // git log after the commit lists other work too: only the first line is this chat's.
    result('t1', `${shareA.slice(0, 7)} Share links at three levels\n${base.slice(0, 7)} first`),
  ]);
  await chat('bbbbbbbbbbbb', { title: 'Heading Styles Update', running: true }, [
    use('t1', { command: `git commit -q -F - <<'EOF'\nNotes: four heading sizes\n\nbody\nEOF` }),
    result('t1', ''),
    use('t2', { command: 'git push' }),
    result('t2', `To github.com:x/y.git\n   ${shareA.slice(0, 7)}..${notes2.slice(0, 7)}  main -> main`),
  ]);
  await chat('cccccccccccc', { title: 'Variations Panel UI Fix' }, [
    use('t1', { file_path: path.join(wt, 'panel.js'), content: 'loose' }, 'Write'),
  ]);
  await fsp.mkdir(path.join(drive, 'Notes and Sketches'), { recursive: true });
  await fsp.writeFile(path.join(drive, 'Notes and Sketches', 'Features view.mrbl'), '<title>Features view</title>');
  await chat('dddddddddddd', { title: 'Spec a view', target: 'Notes and Sketches/Features view' }, []);
  return { root, src, drive, repo, wt, shas: { base, shareA, notes1, notes2 } };
}

test('a commit command gives its subject, from -m or a heredoc', () => {
  assert.deepEqual(commitSubjects('git commit -q -m "Share links at three levels" -m "body"'), ['Share links at three levels']);
  assert.deepEqual(commitSubjects("git add . && git commit -q -F - <<'EOF'\nNotes: four sizes\n\nmore\nEOF"), ['Notes: four sizes']);
  assert.deepEqual(commitSubjects(`git commit -m "$(cat <<'EOF'\nCodex as an agent\n\nCo-Authored-By: x\nEOF\n)"`), ['Codex as an agent']);
  assert.deepEqual(commitSubjects('git log --oneline -5'), []);
});

test('the sweep reads what each chat made and pushed, and groups by rules', async () => {
  const w = await world();
  const facts = await collect({ driveDir: w.drive, src: w.src, home: w.root });
  const chat = (id) => facts.chats.find((c) => c.id === id);
  assert.deepEqual(chat('aaaaaaaaaaaa').madeCommits, [w.shas.shareA], 'its own commit, not the log after it');
  assert.deepEqual(chat('bbbbbbbbbbbb').madeCommits, [w.shas.notes2], 'by subject, from a heredoc');
  assert.ok(chat('bbbbbbbbbbbb').pushedCommits.includes(w.shas.notes1), 'pushed in its range, not made');
  assert.deepEqual(chat('cccccccccccc').trees, [real(w.wt)], 'wrote in the worktree, not in the main checkout');
  assert.equal(facts.worktrees.find((t) => t.branch === 'variations-ui').changed, 1);

  const named = (pred) => facts.draft.features.find(pred);
  const notes = named((f) => f.commits.includes(w.shas.notes1));
  assert.ok(notes.commits.includes(w.shas.notes2), 'one lead, one feature');
  assert.ok(!notes.commits.includes(w.shas.shareA));
  assert.ok(named((f) => f.commits.includes(w.shas.shareA)).chats.some((c) => c.id === 'aaaaaaaaaaaa'));
  assert.ok(named((f) => f.worktrees.includes(real(w.wt))).chats.some((c) => c.id === 'cccccccccccc'));
  assert.ok(named((f) => f.specs.includes('Notes and Sketches/Features view')).chats.some((c) => c.id === 'dddddddddddd'), 'a spec page is a feature');
  assert.ok(!facts.draft.features.some((f) => f.commits.includes(w.shas.base) && f.chats.length), 'the first commit belongs to no chat');
});

test('a saved board is placed from git: stops, drives, and what was skipped', async () => {
  const w = await world();
  const dir = path.join(w.drive, '.marble', 'console');
  const features = createFeatures({ dir, driveDir: w.drive, src: w.src, log: { error() {} } });
  await features.save({
    features: [
      { id: 'share', name: 'Share links at three levels', area: 'Sharing', commits: [w.shas.shareA.slice(0, 7)], chats: [{ id: 'aaaaaaaaaaaa' }] },
      { id: 'notes', name: 'Notes', area: 'Notes', commits: [w.shas.notes1, w.shas.notes2], specs: ['Notes and Sketches/Notes'] },
      { id: 'variations', name: 'Variations panel', area: 'Agents', worktrees: [w.wt] },
      { id: 'features-view', name: 'Features view', area: 'Console', specs: ['Notes and Sketches/Features view'] },
      { id: 'widgets', name: 'Widgets view', area: 'Agents', kind: 'drive', docs: ['Agents'], at: 'build', lives: 'In Agents.mrbl' },
    ],
  });
  const drives = [
    { key: 'mac', name: 'Mac', ring: 'yours', sha: w.shas.notes2 },
    { key: 't-bryan', name: 't-bryan', ring: 'tb', sha: w.shas.notes1 },
    { key: 't-sam', name: 't-sam', ring: 'all', sha: w.shas.base },
    { key: 't-irene', name: 't-irene', ring: 'all', sha: null },
  ];
  const placed = await features.place({ drives });
  const by = (id) => placed.features.find((f) => f.id === id);
  assert.equal(by('share').at, 'push');
  assert.deepEqual(by('share').on, ['mac', 't-bryan']);
  assert.deepEqual(by('share').skip, ['spec', 'plan'], 'pushed with no spec or plan written');
  assert.deepEqual(by('notes').on, ['mac'], 'every commit, or not there');
  assert.deepEqual(by('notes').skip, ['plan']);
  assert.equal(by('variations').at, 'build', 'loose files in its worktree');
  assert.equal(by('features-view').at, 'spec');
  assert.equal(by('widgets').at, 'build');
  assert.deepEqual(by('widgets').on, []);
});

test('the owner\'s corrections outlive a triage, and a stage holds until evidence passes it', async () => {
  const w = await world();
  const dir = path.join(w.drive, '.marble', 'console');
  const features = createFeatures({ dir, driveDir: w.drive, src: w.src, log: { error() {} } });
  const board = { features: [{ id: 'fv', name: 'Features view', area: 'Console', specs: ['x'] }, { id: 'share', name: 'Share', area: 'S', commits: [w.shas.shareA] }] };
  await features.save(board);
  await features.correct('fv', { name: 'The Features view', at: 'plan', next: 'Build it' });
  await features.correct('share', { at: 'plan', hidden: true });
  await features.save(board); // triage again
  const placed = await features.place({ drives: [] });
  const fv = placed.features.find((f) => f.id === 'fv');
  assert.equal(fv.name, 'The Features view');
  assert.equal(fv.next, 'Build it');
  assert.equal(fv.at, 'plan', 'held: nothing in git says otherwise');
  const share = placed.features.find((f) => f.id === 'share');
  assert.equal(share.at, 'push', 'the evidence is past the stage the owner set');
  assert.equal(share.hidden, true);
  await features.correct('fv', { name: null });
  assert.equal((await features.place()).features.find((f) => f.id === 'fv').name, 'Features view', 'a null puts triage\'s back');
  await assert.rejects(features.correct('nobody', { name: 'x' }), /no such feature/);
  await assert.rejects(features.save({ features: [{ name: '' }] }), /no name/);
  await assert.rejects(features.save({ features: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }), /two features/);
});

test('drives go in rings: this Mac and the owner\'s sprite, t-bryan, then everyone; admin-p1 is retired', () => {
  const fleet = [
    { name: 't-sam', role: 'user', release: '20261001T1Z-9800637' },
    { name: 'admin-p1', role: 'owner', release: null },
    { name: 'admin-p2', role: 'owner', release: '20261001T2Z-d1fe89a' },
    { name: 't-bryan', role: 'user', release: '20261001T3Z-local-50a1dc8' },
    { name: 't-eunhye', role: 'user', release: null },
  ];
  const rings = ringDrives({ fleet, mac: true, selfRelease: '20261001T175204Z-d1fe89a' });
  assert.deepEqual(rings.map((d) => [d.key, d.ring]), [['mac', 'yours'], ['admin-p2', 'yours'], ['t-bryan', 'tb'], ['t-eunhye', 'all'], ['t-sam', 'all']]);
  assert.equal(rings[0].sha, 'd1fe89a');
  assert.equal(rings[2].local, true);
  assert.equal(ownRelease('/Users/x/Library/Application Support/Marble Drive/app/releases/20261001T175204Z-d1fe89a/marble-drive/server/console/index.js'), '20261001T175204Z-d1fe89a');
  assert.equal(ownRelease('/Users/x/dev/marble-drive/server/console/index.js'), null);
});

test('on the PC the home drive is the PC, first on the line', () => {
  const rings = ringDrives({ fleet: [{ name: 'admin-p2', role: 'owner', release: 'r-d1fe89a' }], home: 'pc', selfRelease: '20261006T1Z-abc1234' });
  assert.deepEqual(rings.map((d) => [d.key, d.name, d.ring]), [['pc', 'PC', 'yours'], ['admin-p2', 'admin-p2', 'yours']]);
  assert.deepEqual(ringDrives({ fleet: [], selfRelease: 'x' }), []);
});

test('the Console reads the board placed on its drives, and corrects only from its own page', async (t) => {
  const { createDrive } = await import('../server/app.js');
  const { loadConfig } = await import('../server/config.js');
  const { fakeFleet, probe } = await import('./fixtures/console-fleet.js');
  const w = await world();
  const fleet = await fakeFleet({ probe: { 't-sam': probe('t-sam') } });
  const config = loadConfig({
    MARBLE_DRIVE_ROOT: w.drive,
    MARBLE_DRIVE_CONSOLE: '1',
    MARBLE_DRIVE_SECRET: 'pw-1234',
    MARBLE_DRIVE_CONSOLE_SPRITE: fleet.bin,
    MARBLE_DRIVE_CONSOLE_SRC: w.src,
    MARBLE_DRIVE_CONSOLE_SELF: 'mac',
  });
  const quiet = { log() {}, error() {}, info() {} };
  const drive = await createDrive(config, { log: quiet, agents: false });
  t.after(() => drive.close());
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const gate = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: config.secret }) });
  const cookie = (gate.headers.get('set-cookie') ?? '').split(';')[0];
  const call = (route, { method = 'GET', body, origin = base } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  assert.equal((await fetch(`${base}/console/api/features`)).status, 401, 'behind the gate');
  const empty = await (await call('/console/api/features')).json();
  assert.deepEqual(empty.features, []);
  assert.ok(empty.drives.some((d) => d.key === 't-bryan' && d.ring === 'tb'));
  assert.ok(!empty.drives.some((d) => d.key === 'admin-p1'), 'the retired sprite is not on the line');

  await drive.console.features.save({ features: [{ id: 'share', name: 'Share links', area: 'Sharing', commits: [w.shas.shareA], chats: [{ id: 'aaaaaaaaaaaa' }] }] });
  const read = await (await call('/console/api/features')).json();
  assert.equal(read.features[0].at, 'push');
  assert.equal(read.chats['drive:aaaaaaaaaaaa']?.title, undefined, 'titles come from the facts, which triage writes');
  assert.equal((await call('/console/api/features/share/correct', { method: 'POST', body: { name: 'x' }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/console/api/features/nobody/correct', { method: 'POST', body: { name: 'x' } })).status, 404);
  assert.deepEqual(await (await call('/console/api/features/share/correct', { method: 'POST', body: { next: 'Ship it' } })).json(), { next: 'Ship it' });
  assert.equal((await (await call('/console/api/features')).json()).features[0].next, 'Ship it');
});
