// Features: every change the owner is making to Marble, as a line from spec to
// every drive (drive: Notes and Sketches/Features view, the spec and its
// working board).
//
// Three parts, so that only one of them needs judgement:
//
//   collect()  reads the evidence: the drive's chats (and Claude Code sessions
//              in a terminal), what each wrote, committed, pushed and shipped;
//              the workshop's branches and worktrees; main's commits; specs and
//              plans. It also makes a first grouping by rules (draft()). It is
//              run by the triage skill (agent-plugin/skills/triage), never on a
//              timer: triage happens when the owner asks for it.
//   the skill  turns that draft into features with plain names, merges and
//              splits what the rules got wrong, and saves the board.
//   place()    puts each saved feature on its stops and drives from git alone,
//              every time the view is read, so a dot is never an agent's claim
//              and a ship shows the moment the Console knows the release.
//
// The board lives in .marble/console/features.json. The owner's corrections
// (a name, a stage, a next line, hidden) are kept beside it, by feature id, and
// a save from the skill never touches them.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const STOPS = ['spec', 'plan', 'build', 'commit', 'push'];
export const KINDS = ['host', 'drive', 'skill'];
const SHA = /^[0-9a-f]{7,40}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY = 24 * 60 * 60 * 1000;

const git = (cwd, args, { timeout = 30_000 } = {}) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout.replace(/\n$/, '')));
  });
const ok = (cwd, args) => new Promise((resolve) => execFile('git', args, { cwd, timeout: 15_000 }, (err) => resolve(!err)));

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

export const slug = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'feature';

// ------------------------------------------------------------------ chats

// What a chat did, read from its own log. A commit is known by its subject as
// well as its sha, because a rebase changes the sha and keeps the subject.
const COMMIT_LINE = /^\[([^\]\s]+) ([0-9a-f]{7,40})\] (.+)$/gm;
const PUSH = /\b([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})\s+(\S+) -> (\S+)/g;
const DEPLOY = /sprite-deploy\.sh\s+(--all|[a-z0-9][a-z0-9-]*)((?:\s+--[a-z-]+)*)/g;
const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// sprite-deploy's own last line: what went where.
const SHIPPED = /done: (\d{8}T\d{6}Z-[\w-]+) is (?:live|staged) on ([a-z0-9][a-z0-9-]*)/g;

/** The subject a `git commit` command gives, from -m or a heredoc. */
export function commitSubjects(command) {
  if (!/\bgit\b[^\n|;&]*\bcommit\b/.test(command)) return [];
  // A heredoc, fed by -F - or by -m "$(cat <<'EOF' …)": its first line.
  const doc = /<<-?\s*['"]?(\w+)['"]?\)?\n([^\n]*)/.exec(command);
  if (doc && (/-F\s+-|--file[= ]-/.test(command) || /-m\s+"\$\(cat/.test(command))) return [doc[2].trim()].filter(Boolean);
  const m = /-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\$'((?:[^'\\]|\\.)*)')/.exec(command);
  return m ? [(m[1] ?? m[2] ?? m[3] ?? '').split('\n')[0].replace(/\\"/g, '"').trim()].filter(Boolean) : [];
}

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n') : '');

/** Read one transcript (a drive chat's raw log, or a Claude Code session) for
 *  what it wrote, committed, pushed and shipped. */
export async function readTranscript(file, into) {
  let body;
  try {
    body = await fsp.readFile(file, 'utf8');
  } catch {
    return into;
  }
  const commitCalls = new Set();
  for (const line of body.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"') && !line.includes('"type":"user"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const content = j.message?.content;
    if (!into.prompt && j.type === 'user' && j.message?.role === 'user') {
      const t = typeof content === 'string' ? content : Array.isArray(content) ? content.find((c) => c?.type === 'text')?.text : '';
      if (t && !t.startsWith('<')) into.prompt = t.slice(0, 400);
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use') {
        const input = b.input ?? {};
        if (WRITES.has(b.name) && typeof input.file_path === 'string') into.files.add(input.file_path);
        if (/apply_ops|create_document/.test(b.name ?? '') && typeof input.path === 'string') into.docs.add(input.path);
        const cmd = typeof input.command === 'string' ? input.command : '';
        if (!cmd) continue;
        const subjects = commitSubjects(cmd);
        if (subjects.length) {
          for (const s of subjects) into.subjects.add(s);
          commitCalls.add(b.id);
        }
        if (/\bgit push\b/.test(cmd)) into.pushes += 1;
        for (const m of cmd.matchAll(DEPLOY)) into.deploys.add(`${m[1]}${/--local/.test(m[2]) ? ' --local' : ''}`);
        if (/mac-release\.sh/.test(cmd)) into.deploys.add('mac');
        else if (/home-release\.sh/.test(cmd)) into.deploys.add(process.platform === 'darwin' ? 'mac' : 'pc');
        const cd = /(?:^|&&|;)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(cmd);
        if (cd) into.dirs.add(cd[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, os.homedir()));
      } else if (b?.type === 'tool_result') {
        const t = textOf(b.content);
        if (!t) continue;
        for (const m of t.matchAll(PUSH)) if (/main$/.test(m[4])) into.ranges.add(`${m[1]}..${m[2]}`);
        for (const m of t.matchAll(SHIPPED)) into.shipped.add(`${m[2]} ${m[1]}`);
        if (!commitCalls.has(b.tool_use_id)) continue;
        // `[branch sha] subject` is git's own line for a commit it made. A
        // bare `sha subject` is one too only as the first line of the answer;
        // after it come whatever log the same command printed.
        for (const m of t.matchAll(COMMIT_LINE)) into.made.add(`${m[2]} ${m[3].trim()}`);
        const first = /^([0-9a-f]{7,40}) (.{3,})$/m.exec(t.trimStart());
        if (first && t.trimStart().startsWith(first[0])) into.made.add(`${first[1]} ${first[2].trim()}`);
      }
    }
  }
  return into;
}

/** One spelling of a path: git prints the real one (/private/var on a Mac),
 *  a chat may have written the other. */
export function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(real(parent), path.basename(p));
  }
}

const blank = () => ({ prompt: '', shipped: new Set(), files: new Set(), docs: new Set(), subjects: new Set(), made: new Set(), ranges: new Set(), deploys: new Set(), dirs: new Set(), pushes: 0 });
const plain = (s) => ({ ...s, shipped: [...s.shipped], files: [...s.files], docs: [...s.docs], subjects: [...s.subjects], made: [...s.made], ranges: [...s.ranges], deploys: [...s.deploys], dirs: [...s.dirs] });

/** Chats in the drive since `since`, each read once and remembered by the
 *  sizes of its logs, so a second triage reads only what changed. */
async function driveChats({ driveDir, since, cache }) {
  const dir = path.join(driveDir, '.marble', 'agents');
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const id of names) {
    const meta = await readJson(path.join(dir, id, 'meta.json'), null);
    if (!meta?.id || (meta.updatedAt ?? 0) < since) continue;
    const raw = path.join(dir, id, 'raw');
    let files = [];
    try {
      files = (await fsp.readdir(raw)).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {}
    const stamp = (await Promise.all(files.map(async (f) => {
      try {
        const st = await fsp.stat(path.join(raw, f));
        return `${f}:${st.size}`;
      } catch {
        return f;
      }
    }))).join('|');
    let sig = cache[`chat:${id}`]?.stamp === stamp ? cache[`chat:${id}`].sig : null;
    if (!sig) {
      const into = blank();
      for (const f of files) await readTranscript(path.join(raw, f), into);
      sig = plain(into);
      cache[`chat:${id}`] = { stamp, sig };
    }
    out.push({
      id: meta.id,
      source: 'drive',
      title: meta.title || sig.prompt.slice(0, 60) || 'Untitled',
      target: meta.target ?? null,
      running: Boolean(meta.running),
      archived: Boolean(meta.archived),
      at: meta.updatedAt,
      ...sig,
    });
  }
  return out;
}

/** Claude Code sessions run in a terminal in the workshop's checkouts, which
 *  Agents cannot open: they count, and show their folder and id. */
async function terminalChats({ src, since, cache, home = os.homedir() }) {
  const projects = path.join(home, '.claude', 'projects');
  const stem = path.join(src, 'marble-drive').replace(/[/.]/g, '-');
  let dirs = [];
  try {
    dirs = (await fsp.readdir(projects)).filter((d) => d === stem || d.startsWith(`${stem}-`));
  } catch {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    let files = [];
    try {
      files = (await fsp.readdir(path.join(projects, d))).filter((f) => f.endsWith('.jsonl'));
    } catch {}
    for (const f of files) {
      const file = path.join(projects, d, f);
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < since) continue;
      const stamp = `${st.size}`;
      const key = `term:${d}/${f}`;
      let sig = cache[key]?.stamp === stamp ? cache[key].sig : null;
      if (!sig) {
        sig = plain(await readTranscript(file, blank()));
        cache[key] = { stamp, sig };
      }
      out.push({
        id: f.replace(/\.jsonl$/, ''),
        source: 'terminal',
        folder: d.slice(stem.length).replace(/^-+/, '').replace(/^-claude-worktrees-/, 'worktree ') || 'marble-drive',
        title: sig.prompt.split('\n')[0].slice(0, 70) || 'A terminal session',
        target: null,
        running: false,
        archived: false,
        at: st.mtimeMs,
        ...sig,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ git

async function mainCommits(repo, since) {
  const out = await git(repo, ['log', 'origin/main', `--since=${new Date(since).toISOString()}`, '--format=%x1e%H%x1f%ct%x1f%s', '--name-only']);
  return parseLog(out, 'main');
}
function parseLog(out, where) {
  if (!out) return [];
  return out.split('\x1e').filter((s) => s.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [sha, ct, subject] = head.split('\x1f');
    return { sha, short: sha.slice(0, 7), at: Number(ct) * 1000, subject, files: rest.filter(Boolean), where };
  });
}

/** Every worktree of the repo, with what is loose in it and what it has that
 *  GitHub does not. */
async function worktrees(repo, since = 0) {
  const out = await git(repo, ['worktree', 'list', '--porcelain']);
  if (!out) return [];
  const list = [];
  for (const block of out.split('\n\n')) {
    const found = /^worktree (.+)$/m.exec(block)?.[1];
    if (!found) continue;
    const p = real(found);
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    if (!fs.existsSync(p)) continue;
    const status = (await git(p, ['status', '--porcelain'])) ?? '';
    const changed = status.split('\n').filter(Boolean).map((l) => l.slice(3));
    // Only what was done lately: an old branch that never merged is not work
    // in flight, and its hundred commits would bury the rest.
    const ahead = branch ? parseLog(await git(repo, ['log', `origin/main..${branch}`, `--since=${new Date(since).toISOString()}`, '--format=%x1e%H%x1f%ct%x1f%s', '--name-only']), branch) : [];
    list.push({ path: p, branch, changed, ahead });
  }
  return list;
}

// ------------------------------------------------------------------ specs

async function titleOf(file) {
  try {
    const head = (await fsp.readFile(file, 'utf8')).slice(0, 4000);
    return /<title[^>]*>([^<]+)<\/title>/.exec(head)?.[1]?.trim() ?? /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? path.basename(file);
  } catch {
    return path.basename(file);
  }
}
async function specs({ driveDir, repo, since }) {
  const out = [];
  const notes = path.join(driveDir, 'Notes and Sketches');
  try {
    for (const f of await fsp.readdir(notes)) {
      if (!f.endsWith('.mrbl')) continue;
      const st = await fsp.stat(path.join(notes, f));
      if (st.mtimeMs < since) continue;
      out.push({ kind: 'spec', where: 'drive', path: `Notes and Sketches/${f.replace(/\.mrbl$/, '')}`, title: await titleOf(path.join(notes, f)), at: st.mtimeMs });
    }
  } catch {}
  // Specs and plans as GitHub's main has them, and any this checkout has that
  // main does not yet: a checkout behind main would miss the newest.
  for (const [kind, sub] of [['spec', 'docs/superpowers/specs'], ['plan', 'docs/superpowers/plans']]) {
    const names = new Set(((await git(repo, ['ls-tree', '--name-only', 'origin/main', `${sub}/`])) ?? '').split('\n').filter(Boolean).map((p) => path.basename(p)));
    try {
      for (const f of await fsp.readdir(path.join(repo, sub))) names.add(f);
    } catch {}
    for (const f of names) {
      const d = /^(\d{4}-\d{2}-\d{2})/.exec(f)?.[1];
      if (!f.endsWith('.md') || !d || Date.parse(d) < since - DAY) continue;
      const rel = `${sub}/${f}`;
      const head = (await git(repo, ['show', `origin/main:${rel}`])) ?? (await fsp.readFile(path.join(repo, rel), 'utf8').catch(() => ''));
      out.push({ kind, where: 'repo', path: rel, title: /^#\s+(.+)$/m.exec(head.slice(0, 4000))?.[1]?.trim() ?? f, at: Date.parse(d) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- collect

/** All the evidence, and a first grouping by rules. `src` holds the
 *  marble-drive checkout; `driveDir` is the drive. */
export async function collect({ driveDir, src, days = 14, now = Date.now(), home = os.homedir(), cacheFile = null } = {}) {
  const since = now - days * DAY;
  const repo = path.join(src, 'marble-drive');
  await git(repo, ['fetch', '-q', 'origin'], { timeout: 60_000 });
  const cache = cacheFile ? await readJson(cacheFile, {}) : {};
  const [main, trees, docs, chats, terms] = await Promise.all([
    mainCommits(repo, since),
    worktrees(repo, since),
    specs({ driveDir, repo, since }),
    driveChats({ driveDir, since, cache }),
    terminalChats({ src, since, cache, home }),
  ]);
  if (cacheFile) await writeJson(cacheFile, cache).catch(() => {});
  const all = [...chats, ...terms];
  const realRepo = real(repo);
  const realDrive = real(driveDir);

  // Commits each chat made (by subject or sha) and pushed (by range).
  const bySubject = new Map();
  const commits = [...main];
  for (const t of trees) for (const c of t.ahead) if (!commits.some((x) => x.sha === c.sha)) commits.push(c);
  for (const c of commits) bySubject.set(c.subject, [...(bySubject.get(c.subject) ?? []), c]);
  const pushedCache = new Map();
  for (const chat of all) {
    const made = new Set();
    for (const s of chat.subjects) for (const c of bySubject.get(s) ?? []) made.add(c.sha);
    for (const line of chat.made) {
      const [sha, ...rest] = line.split(' ');
      const subject = rest.join(' ');
      for (const c of commits) if (c.sha.startsWith(sha) || c.subject === subject) made.add(c.sha);
    }
    const pushed = new Set();
    for (const range of chat.ranges) {
      if (!pushedCache.has(range)) pushedCache.set(range, ((await git(repo, ['rev-list', range])) ?? '').split('\n').filter(Boolean));
      for (const sha of pushedCache.get(range)) if (!made.has(sha) && commits.some((c) => c.sha === sha)) pushed.add(sha);
    }
    chat.madeCommits = [...made];
    chat.pushedCommits = [...pushed];
    // The main checkout is where every chat starts, so being in it says
    // nothing; a chat belongs to it only by the loose files it wrote there.
    chat.files = chat.files.map(real);
    chat.dirs = chat.dirs.map(real);
    chat.trees = trees.filter((t) => (t.path === realRepo
      ? chat.files.some((f) => t.changed.some((c) => f === path.join(realRepo, c)))
      : [...chat.files, ...chat.dirs].some((f) => f === t.path || f.startsWith(`${t.path}/`)))).map((t) => t.path);
    // The main checkout holds every worktree under .claude/worktrees, so a
    // file there belongs to the deepest worktree only.
    chat.trees = chat.trees.filter((p) => !chat.trees.some((q) => q !== p && q.startsWith(`${p}/`)));
    chat.repoFiles = chat.files.filter((f) => trees.some((t) => f.startsWith(`${t.path}/`)));
    chat.driveDocs = [...new Set([...chat.docs, ...chat.files.filter((f) => f.endsWith('.mrbl') && f.startsWith(realDrive)).map((f) => path.relative(realDrive, f).replace(/\.mrbl$/, ''))])];
    delete chat.made;
    delete chat.subjects;
    delete chat.ranges;
    delete chat.dirs;
    delete chat.docs;
  }

  // The release each sprite was last sent, from the deploys' own words in the
  // chats and in any deploy logs this machine kept. A release is named for
  // when it was built, so the newest name is the latest.
  const releases = {};
  const note = (sprite, release, from) => {
    if (!releases[sprite] || release > releases[sprite].release) releases[sprite] = { release, from };
  };
  for (const chat of all) for (const line of chat.shipped ?? []) {
    const [sprite, release] = line.split(' ');
    note(sprite, release, `${chat.source} chat`);
  }
  for (const dir of [os.tmpdir(), '/tmp']) {
    let names = [];
    try {
      names = (await fsp.readdir(dir)).filter((f) => /^deploy.*\.log$/.test(f));
    } catch {}
    for (const f of names) {
      const text = await fsp.readFile(path.join(dir, f), 'utf8').catch(() => '');
      for (const m of text.matchAll(SHIPPED)) note(m[2], m[1], 'deploy log');
    }
  }
  for (const chat of all) delete chat.shipped;

  const facts = {
    readAt: now,
    releases,
    days,
    src,
    origin: await git(repo, ['rev-parse', 'origin/main']),
    commits: commits.map(({ files, ...c }) => ({ ...c, files: files.slice(0, 40) })),
    worktrees: trees.filter((t) => t.changed.length || t.ahead.length).map((t) => ({ path: t.path, branch: t.branch, changed: t.changed.length, files: t.changed.slice(0, 20), ahead: t.ahead.map((c) => c.sha) })),
    specs: docs,
    chats: all.map(({ files, ...c }) => ({ ...c, files: files.length })),
  };
  facts.draft = draft(facts);
  return facts;
}

// ------------------------------------------------------------------ draft

const LEAD = /^([A-Z][\w .'-]{1,30}?):\s/;
const APPS = new Set(['Agents', 'drive', 'Chat', 'Board', 'Console', 'Design System', "Design Don'ts"]);

/** A first grouping, by rules only (the order the spec gives): a spec page,
 *  a worktree, a chat's own commits, a commit subject's lead. What it cannot
 *  place stays loose for the skill to read. */
export function draft(facts) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const join = (a, b) => { add(a); add(b); parent.set(find(a), find(b)); };

  const merges = new Set(facts.commits.filter((c) => /^Merge (branch|remote-tracking|pull request)\b/.test(c.subject)).map((c) => c.sha));
  for (const c of facts.commits) if (!merges.has(c.sha)) add(`c:${c.sha}`);
  for (const w of facts.worktrees) add(`w:${w.path}`);
  for (const w of facts.worktrees) for (const sha of w.ahead) join(`w:${w.path}`, `c:${sha}`);
  const leads = new Map();
  for (const c of facts.commits) {
    if (merges.has(c.sha)) continue;
    const lead = LEAD.exec(c.subject)?.[1]?.toLowerCase();
    if (lead && !/^(merge|revert|wip|fixup)$/.test(lead)) {
      if (leads.has(lead)) join(`c:${c.sha}`, leads.get(lead));
      else leads.set(lead, `c:${c.sha}`);
    }
    // A commit that writes one spec or plan is that spec's work; one that
    // touches many is moving the docs about, and says nothing.
    const docs = facts.specs.filter((s) => s.where === 'repo' && c.files.includes(s.path));
    if (docs.length <= 2) for (const s of docs) join(`c:${c.sha}`, `s:${s.path}`);
  }
  for (const chat of facts.chats) {
    const key = `chat:${chat.source}:${chat.id}`;
    const strong = [
      ...chat.madeCommits.filter((sha) => !merges.has(sha)).map((sha) => `c:${sha}`),
      ...chat.trees.map((p) => `w:${p}`),
      ...facts.specs.filter((s) => s.where === 'drive' && (chat.target === s.path || chat.driveDocs.includes(s.path))).map((s) => `s:${s.path}`),
    ];
    // What one chat made is one piece of work until the skill splits it,
    // except a long session that made a dozen things: it is a workbench, and
    // is listed under each piece it touched instead of gluing them together.
    if (chat.madeCommits.length > 12) for (const k of strong) add(k);
    else for (const k of strong) join(key, k);
  }

  const groups = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(key);
  }
  const bySha = new Map(facts.commits.map((c) => [c.sha, c]));
  const features = [];
  const placedChats = new Set();
  for (const keys of groups.values()) {
    const shas = keys.filter((k) => k.startsWith('c:')).map((k) => k.slice(2)).filter((sha) => !merges.has(sha));
    const trees = keys.filter((k) => k.startsWith('w:')).map((k) => k.slice(2));
    const docs = keys.filter((k) => k.startsWith('s:')).map((k) => k.slice(2));
    const chatKeys = new Set(keys.filter((k) => k.startsWith('chat:')));
    // Chats that touched any of this group without gluing it.
    for (const chat of facts.chats) {
      const key = `chat:${chat.source}:${chat.id}`;
      if (chatKeys.has(key)) continue;
      if (chat.madeCommits.some((s) => shas.includes(s)) || chat.trees.some((p) => trees.includes(p))) chatKeys.add(key);
    }
    if (!shas.length && !trees.length && !docs.length) continue;
    if (!shas.length && !trees.length && !chatKeys.size) continue; // a spec nobody worked on lately
    const specDocs = facts.specs.filter((s) => docs.includes(s.path));
    const branch = facts.worktrees.find((w) => trees.includes(w.path))?.branch;
    const first = shas.map((s) => bySha.get(s)).filter(Boolean).sort((a, b) => a.at - b.at)[0];
    const name = specDocs.find((s) => s.kind === 'spec')?.title ?? (first ? first.subject.replace(LEAD, '$1: ') : null) ?? branch ?? 'Unnamed';
    const chats = facts.chats.filter((c) => chatKeys.has(`chat:${c.source}:${c.id}`));
    for (const c of chats) placedChats.add(`${c.source}:${c.id}`);
    features.push({
      id: slug(specDocs[0]?.title ?? branch ?? first?.subject ?? name),
      name,
      kind: 'host',
      area: null,
      commits: shas.sort((a, b) => (bySha.get(a)?.at ?? 0) - (bySha.get(b)?.at ?? 0)),
      worktrees: trees,
      specs: specDocs.filter((s) => s.kind === 'spec').map((s) => s.path),
      plans: specDocs.filter((s) => s.kind === 'plan').map((s) => s.path),
      docs: [],
      chats: chats.map((c) => ({ id: c.id, source: c.source })),
      next: null,
      wait: false,
    });
  }
  // Chats left over that look like Marble work: a seeded app page or a spec
  // page as their target, or the workshop's files. Everything else in the
  // drive (a day page, a paper) is the owner's own writing, not a feature.
  const loose = facts.chats.filter((c) => !placedChats.has(`${c.source}:${c.id}`)
    && (APPS.has(c.target) || String(c.target ?? '').startsWith('Notes and Sketches/') || c.repoFiles.length || c.source === 'terminal'))
    .map((c) => ({ id: c.id, source: c.source }));
  const seen = new Map();
  for (const f of features) {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    if (n > 1) f.id = `${f.id}-${n}`;
  }
  return { features, loose };
}

// ------------------------------------------------------------------ board

/** A board as the skill saves it, checked, with anything unknown dropped.
 *  Throws with a sentence when it cannot be used. */
export function checkBoard(input) {
  if (!input || !Array.isArray(input.features)) throw new Error('a board has a features list');
  const ids = new Set();
  const list = (v, test) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && (!test || test(x))).slice(0, 200) : []);
  const features = input.features.map((f, i) => {
    if (!f || typeof f.name !== 'string' || !f.name.trim()) throw new Error(`feature ${i + 1} has no name`);
    const id = SLUG.test(String(f.id ?? '')) ? f.id : slug(f.name);
    if (ids.has(id)) throw new Error(`two features are called ${id}`);
    ids.add(id);
    const chats = Array.isArray(f.chats) ? f.chats.filter((c) => c && typeof c.id === 'string').map((c) => ({ id: c.id, source: c.source === 'terminal' ? 'terminal' : 'drive' })) : [];
    return {
      id,
      name: f.name.trim().slice(0, 120),
      area: typeof f.area === 'string' && f.area.trim() ? f.area.trim().slice(0, 60) : 'Other',
      kind: KINDS.includes(f.kind) ? f.kind : 'host',
      commits: list(f.commits, (s) => SHA.test(s)),
      worktrees: list(f.worktrees),
      specs: list(f.specs),
      plans: list(f.plans),
      docs: list(f.docs),
      chats,
      lives: typeof f.lives === 'string' ? f.lives.slice(0, 160) : null,
      at: STOPS.includes(f.at) ? f.at : null,
      next: typeof f.next === 'string' ? f.next.slice(0, 200) : null,
      wait: Boolean(f.wait),
    };
  });
  const loose = Array.isArray(input.loose) ? input.loose.filter((c) => c && typeof c.id === 'string').map((c) => ({ id: c.id, source: c.source === 'terminal' ? 'terminal' : 'drive' })) : [];
  const areas = list(input.areas);
  return { features, loose, areas, note: typeof input.note === 'string' ? input.note.slice(0, 400) : null };
}

const rank = (stop) => STOPS.indexOf(stop);

export function createFeatures({ dir, driveDir, src, log = console }) {
  const boardFile = path.join(dir, 'features.json');
  const factsFile = path.join(dir, 'features-facts.json');
  const configFile = path.join(dir, 'features-config.json');
  const repo = path.join(src, 'marble-drive');
  const known = new Map(); // `${sha}@${target}` → bool; both shas fixed, so never stale

  // Where the workshop is, for the skill, which runs outside this host and
  // reads it rather than guessing.
  writeJson(configFile, { src, driveDir }).catch(() => {});

  async function board() {
    const b = await readJson(boardFile, null);
    return b && Array.isArray(b.features) ? b : { features: [], loose: [], areas: [], owner: {}, readAt: null };
  }

  /** The skill's save. The owner's corrections are kept as they were. */
  async function save(input, { by = null, at = Date.now() } = {}) {
    const checked = checkBoard(input);
    const prior = await board();
    const next = { ...checked, readAt: at, by, owner: prior.owner ?? {} };
    await writeJson(boardFile, next);
    return next;
  }

  /** One of the owner's corrections: a name, a stage, a next line, hidden.
   *  A null clears it back to what triage said. */
  async function correct(id, patch = {}) {
    const b = await board();
    if (!b.features.some((f) => f.id === id)) throw Object.assign(new Error('no such feature'), { status: 404 });
    const mine = { ...(b.owner?.[id] ?? {}) };
    if ('name' in patch) mine.name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 120) : null;
    if ('next' in patch) mine.next = typeof patch.next === 'string' ? patch.next.trim().slice(0, 200) || null : null;
    if ('at' in patch) mine.at = STOPS.includes(patch.at) ? patch.at : null;
    if ('hidden' in patch) mine.hidden = Boolean(patch.hidden);
    for (const k of Object.keys(mine)) if (mine[k] === null || mine[k] === false) delete mine[k];
    b.owner = { ...(b.owner ?? {}), [id]: mine };
    if (!Object.keys(mine).length) delete b.owner[id];
    await writeJson(boardFile, b);
    return b.owner[id] ?? {};
  }

  async function contains(sha, target) {
    const key = `${sha}@${target}`;
    if (known.has(key)) return known.get(key);
    const yes = await ok(repo, ['merge-base', '--is-ancestor', sha, target]);
    // A sha this checkout does not have yet is not known to be anywhere.
    const have = yes || (await ok(repo, ['cat-file', '-e', `${sha}^{commit}`]));
    if (have) known.set(key, yes);
    return yes;
  }

  /** Each feature on its stops and drives, from git and the releases. */
  async function place({ drives = [] } = {}) {
    const b = await board();
    const origin = await git(repo, ['rev-parse', 'origin/main']);
    const trees = new Map((await worktrees(repo)).map((t) => [t.path, t]));
    const placed = [];
    for (const f of b.features) {
      const mine = b.owner?.[f.id] ?? {};
      const commits = [];
      for (const sha of f.commits) commits.push({ sha, onMain: origin ? await contains(sha, origin) : false });
      const loose = f.worktrees.map((p) => trees.get(real(p))).filter(Boolean);
      let at;
      if (f.kind !== 'host') at = f.at ?? 'build';
      else if (commits.length && commits.every((c) => c.onMain)) at = 'push';
      else if (commits.length) at = 'commit';
      else if (loose.some((t) => t.changed.length) || f.at === 'build') at = 'build';
      else if (f.plans.length) at = 'plan';
      else at = 'spec';
      // The owner's stage holds until the evidence passes it.
      if (mine.at && rank(mine.at) > rank(at) && !(f.kind === 'host' && at === 'push')) at = mine.at;
      // On a drive when its release holds every commit. A --local release
      // carries files that may never be committed, so it only says tried.
      const on = [];
      const tried = [];
      if (f.kind === 'host' && at === 'push' && commits.length) {
        const last = commits.map((c) => c.sha);
        for (const d of drives) {
          if (!d.sha) continue;
          let all = true;
          for (const sha of last) if (!(await contains(sha, d.sha))) { all = false; break; }
          if (all) (d.local ? tried : on).push(d.key);
        }
      }
      const skip = [];
      if (!f.specs.length && rank(at) > rank('spec')) skip.push('spec');
      if (!f.plans.length && rank(at) > rank('plan')) skip.push('plan');
      placed.push({
        ...f,
        name: mine.name ?? f.name,
        next: mine.next ?? f.next,
        hidden: Boolean(mine.hidden),
        corrected: Object.keys(mine),
        at,
        on,
        tried,
        skip,
        loose: loose.map((t) => ({ path: t.path, branch: t.branch, changed: t.changed.length })),
      });
    }
    return { readAt: b.readAt, by: b.by ?? null, note: b.note ?? null, areas: b.areas ?? [], loose: b.loose ?? [], origin, features: placed };
  }

  /** Chats by id, with what the view needs to show and open them. */
  async function chatIndex(ids) {
    const facts = await readJson(factsFile, null);
    const out = {};
    for (const c of facts?.chats ?? []) {
      if (!ids.has(`${c.source}:${c.id}`)) continue;
      out[`${c.source}:${c.id}`] = { id: c.id, source: c.source, title: c.title, at: c.at, running: c.running, folder: c.folder ?? null, target: c.target ?? null };
    }
    // A chat's running state is read now, not as triage saw it.
    for (const key of Object.keys(out)) {
      if (!key.startsWith('drive:')) continue;
      const meta = await readJson(path.join(driveDir, '.marble', 'agents', out[key].id, 'meta.json'), null);
      if (meta) {
        out[key].running = Boolean(meta.running);
        out[key].title = meta.title || out[key].title;
        out[key].at = meta.updatedAt ?? out[key].at;
      }
    }
    return out;
  }

  async function view({ drives = [] } = {}) {
    // A drive whose release the Console does not know yet (asleep, its
    // checkpoints stuck, deployed from a terminal) takes the newest one the
    // last triage read from the deploys themselves.
    const facts0 = await readJson(factsFile, null);
    drives = drives.map((d) => {
      const seen = facts0?.releases?.[d.key];
      if (!seen || (d.release && d.release >= seen.release)) return d;
      const sha = /-([0-9a-f]{7,40})$/.exec(seen.release)?.[1] ?? null;
      return { ...d, release: seen.release, sha, local: /-local-/.test(seen.release), from: seen.from };
    });
    const placed = await place({ drives });
    const ids = new Set([...placed.features.flatMap((f) => f.chats.map((c) => `${c.source}:${c.id}`)), ...placed.loose.map((c) => `${c.source}:${c.id}`)]);
    const facts = await readJson(factsFile, null);
    const subjects = Object.fromEntries((facts?.commits ?? []).map((c) => [c.sha, c.subject]));
    return { ...placed, drives, chats: await chatIndex(ids), subjects };
  }

  /** Changes when the board is saved or corrected, for the page's stream. */
  async function signature() {
    try {
      const st = await fsp.stat(boardFile);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'none';
    }
  }

  return { board, save, correct, place, view, signature, files: { boardFile, factsFile, configFile } };
}

// ------------------------------------------------------------------ drives

/** The drives in their rings: Yours (this Mac or PC, when it is a drive's
 *  home, and the owner's sprite), t-bryan, then everyone else. admin-p1 is
 *  retired and never deployed to (docs/HOSTING.md), so it is not on the line
 *  unless it is the console's own drive. `home` is 'mac' or 'pc' (`mac: true`
 *  is 'mac'). */
export function ringDrives({ fleet = [], self = null, selfRelease = null, mac = false, home = mac ? 'mac' : null }) {
  const sha = (release) => /-([0-9a-f]{7,40})$/.exec(String(release ?? ''))?.[1] ?? null;
  const out = [];
  if (home) out.push({ key: home, name: home === 'pc' ? 'PC' : 'Mac', ring: 'yours', release: selfRelease, sha: sha(selfRelease), local: /-local-/.test(String(selfRelease ?? '')), role: 'home' });
  for (const d of fleet) {
    if (d.name === 'admin-p1' && !d.self) continue;
    const ring = d.role === 'owner' ? 'yours' : d.name === 't-bryan' ? 'tb' : d.role === 'user' ? 'all' : null;
    if (!ring) continue;
    const release = d.self && selfRelease ? selfRelease : d.release;
    out.push({ key: d.name, name: d.name, ring, release: release ?? null, sha: sha(release), local: /-local-/.test(String(release ?? '')), from: d.releaseFrom ?? null, awake: Boolean(d.awake) });
  }
  const order = { yours: 0, tb: 1, all: 2 };
  return out.sort((a, b) => order[a.ring] - order[b.ring] || (a.role === 'home' ? -1 : b.role === 'home' ? 1 : a.name.localeCompare(b.name)));
}

/** The release this host runs, from where its code lives: …/releases/<name>/. */
export function ownRelease(file) {
  return /\/releases\/([^/]+)\/marble-drive\//.exec(String(file ?? ''))?.[1] ?? null;
}
