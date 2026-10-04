// Fan out (v5, Notes and Sketches/Ask at Anything, "Where parallel work
// helps"): parts that each need their own judgment go to workers side by
// side. Every worker gets the same plan and only its shard's elements; its
// reply is untrusted, checked against its shard and against the document as
// it is, and lands as soon as it is done. A shard that fails leaves its parts
// as they were and says why; the rest still land.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-fanout-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { enginePath } = await import('../server/engine.js');
const { build } = await import('../server/gallery.js');
const { createTools, TOOL_SCHEMAS } = await import('../server/agent/tools.js');
const { undoTurn } = await import('../server/agent/undo.js');
const { CONCURRENCY, TIMEOUT, fanOutPrompt, readOps, runFanOut } = await import('../server/change/fanout.js');

const ROWS = Array.from({ length: 12 }, (_, i) => i + 1);
const SOURCE = `<!doctype html>
<html><head><title>Papers</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Papers</h1>
  <ul data-marble-id="u">
${ROWS.map((n) => `    <li data-marble-id="p${n}"><span data-marble-id="p${n}t">Paper ${n}</span></li>`).join('\n')}
  </ul>
  <script data-marble-id="js">console.log('page')</script>
</body></html>
`;

const pairs = (n) => Array.from({ length: n }, (_, i) => ({ ids: [`p${2 * i + 1}`, `p${2 * i + 2}`] }));
const label = (n, text) => ({ type: 'setText', id: `p${n}t`, text });
const reply = (ops) => ({ code: 0, stdout: JSON.stringify({ ops }), stderr: '' });
/** Which shard a worker was handed: the first row whose markup is in its prompt. */
const firstRow = (args) => {
  const ask = args.at(-1);
  return ROWS.find((n) => ask.includes(`data-marble-id="p${n}"`));
};
const relabel = (args) => {
  const n = firstRow(args);
  return reply([label(n, `Paper ${n}, relabelled`), label(n + 1, `Paper ${n + 1}, relabelled`)]);
};
const quiet = { error() {} };
const applier = () => {
  const landed = [];
  return { landed, apply: async (k, ops) => { landed.push([k, ops]); return { applied: ops.length }; } };
};

// ------------------------------------------------------------ the workers

test('every worker gets the same plan, its own brief and only its shard, with no tools, on the login', async () => {
  const calls = [];
  const { apply } = applier();
  await runFanOut({
    source: SOURCE,
    docPath: 'papers',
    plan: 'Give each paper a short, plain label.',
    note: 'Relabel the papers.',
    shards: [{ ids: ['p1', 'p2'], brief: 'These two are about notebooks.' }, { ids: ['p3', 'p4'] }],
    exec: async (command, args, options) => { calls.push({ command, args, options }); return relabel(args); },
    env: { PATH: '/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'sk-nope', MARBLE_DRIVE_SECRET: 's' },
    apply,
    log: quiet,
  });
  assert.equal(calls.length, 2);
  for (const { command, args, options } of calls) {
    assert.equal(command, 'claude');
    assert.deepEqual(args.slice(0, -2), ['-p', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'text']);
    assert.ok(!args.includes('--mcp-config'), 'no MCP server attaches to a worker');
    assert.equal(args.at(-2), '--');
    assert.equal(options.timeout, TIMEOUT);
    assert.equal(TIMEOUT, 120_000);
    assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH'], 'no keys beyond what the login needs');
  }
  const first = calls.find((c) => firstRow(c.args) === 1).args.at(-1);
  const second = calls.find((c) => firstRow(c.args) === 3).args.at(-1);
  for (const ask of [first, second]) {
    assert.match(ask, /Give each paper a short, plain label\./, 'the one plan');
    assert.match(ask, /\{"ops":/, 'the shape of the reply');
    assert.match(ask, /setText/);
    assert.match(ask, /setInner/);
    assert.doesNotMatch(ask, /Papers<\/h1>/, 'nothing of the page but the shard');
    assert.doesNotMatch(ask, /console\.log/);
  }
  assert.match(first, /These two are about notebooks\./, 'its own brief');
  assert.doesNotMatch(second, /notebooks/, 'and not another shard\'s');
  assert.match(first, /data-marble-id="p1t"/);
  assert.doesNotMatch(first, /data-marble-id="p3"/, 'another shard\'s parts are not shown');
  assert.match(first, /"p1", "p2"/, 'the ids it may change');
});

test('the prompt says which ids may change and that inserts go inside them', () => {
  const ask = fanOutPrompt({ plan: 'Shorten each.', brief: '', ids: ['a', 'b'], markup: '<li data-marble-id="a">A</li>' });
  assert.match(ask, /Shorten each\./);
  assert.match(ask, /only/i);
  assert.match(ask, /inside/i);
  assert.match(ask, /"a", "b"/);
});

test('the model is sonnet unless haiku is asked for', async () => {
  const models = [];
  const { apply } = applier();
  const exec = async (_c, args) => { models.push(args[args.indexOf('--model') + 1]); return relabel(args); };
  await runFanOut({ source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(2), exec, apply, log: quiet });
  await runFanOut({ source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(2), model: 'haiku', exec, apply, log: quiet });
  assert.deepEqual(models, ['sonnet', 'sonnet', 'haiku', 'haiku']);
});

test('a reply is only {"ops": […]}: prose, other keys or other shapes are no reply', () => {
  assert.deepEqual(readOps('{"ops":[{"type":"setText","id":"a","text":"x"}]}'), [{ type: 'setText', id: 'a', text: 'x' }]);
  assert.deepEqual(readOps('```json\n{"ops":[]}\n```'), [], 'one fence round the whole reply is the same reply');
  assert.equal(readOps('Here you go: {"ops":[]}'), null);
  assert.equal(readOps('{"ops":[],"note":"also this"}'), null);
  assert.equal(readOps('{"ops":{"type":"remove","id":"a"}}'), null);
  assert.equal(readOps('{"ops":["remove a"]}'), null);
  assert.equal(readOps('[{"type":"remove","id":"a"}]'), null);
  assert.equal(readOps(''), null);
});

test('a shard that edits outside its ids fails whole, and the other shards land', async () => {
  const { landed, apply } = applier();
  const result = await runFanOut({
    source: SOURCE,
    docPath: 'd',
    plan: 'Relabel.',
    note: 'Relabel.',
    shards: pairs(3),
    exec: async (_c, args) => (firstRow(args) === 3
      ? reply([label(3, 'Fine'), { type: 'setText', id: 'h', text: 'Mine now' }])
      : relabel(args)),
    apply,
    log: quiet,
  });
  assert.equal(result.applied, 4);
  assert.deepEqual(result.shards.map((s) => s.applied), [2, 0, 2]);
  assert.match(result.shards[1].error, /outside its shard/);
  assert.deepEqual(result.shards[1].ids, ['p3', 'p4']);
  assert.deepEqual(landed.map(([k]) => k).sort(), [0, 2], 'none of the failed shard\'s ops were handed on');
});

test('an insert or a move is refused unless it lands inside the shard', async () => {
  const run = (ops) => runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(2),
    exec: async (_c, args) => (firstRow(args) === 1 ? reply(ops) : relabel(args)),
    apply: applier().apply,
    log: quiet,
  });
  const inside = await run([{ type: 'insert', parentId: 'p1', beforeId: null, html: '<em>new</em>' }]);
  assert.equal(inside.shards[0].error, undefined);
  for (const ops of [
    [{ type: 'insert', parentId: 'u', beforeId: 'p2', html: '<li>new</li>' }],
    [{ type: 'move', id: 'p1t', parentId: 'p3', beforeId: null }],
    [{ type: 'move', id: 'p1t', parentId: 'p1', beforeId: 'p5t' }],
    [{ type: 'remove', id: 'u' }],
  ]) {
    const result = await run(ops);
    assert.match(result.shards[0].error, /outside its shard/, JSON.stringify(ops));
    assert.equal(result.shards[1].applied, 2);
  }
});

// Rows whose first holds a table and a script of its own, for what a worker
// may not do to markup it is allowed to touch.
const SCRIPTED = SOURCE.replace(
  '<li data-marble-id="p1"><span data-marble-id="p1t">Paper 1</span></li>',
  '<li data-marble-id="p1"><span data-marble-id="p1t">Paper 1</span><table data-marble-id="p1g"><tbody data-marble-id="p1b"></tbody></table><script data-marble-id="p1s">count()</script>'
    + '<svg data-marble-id="p1v" viewBox="0 0 10 10"><path data-marble-id="p1vp" d="M0 0h10"/></svg><math data-marble-id="p1m"><mi data-marble-id="p1mi">x</mi></math></li>',
);
const firstOf = (source, ops) => runFanOut({
  source, docPath: 'd', plan: 'x', note: 'x', shards: pairs(2),
  exec: async (_c, args) => (firstRow(args) === 1 ? reply(ops) : relabel(args)),
  apply: applier().apply,
  log: quiet,
});

test('a worker may not write a script into the page, however it is spelled', async () => {
  for (const ops of [
    [{ type: 'setInner', id: 'p1', html: '<script>fetch("//x")</script>' }],
    [{ type: 'setAttr', id: 'p1', name: 'onclick', value: 'go()' }],
    [{ type: 'setAttr', id: 'p1', name: 'href', value: 'javascript:go()' }],
    [{ type: 'setAttr', id: 'p1', name: 'href', value: 'java\tscript:go()' }],
    [{ type: 'setAttr', id: 'p1', name: 'href', value: ' \u0001JavaScript:go()' }],
    [{ type: 'setAttr', id: 'p1', name: 'src', value: 'data:text/html,<b>hi</b>' }],
    [{ type: 'setAttr', id: 'p1s', name: 'src', value: 'https://example.com/x.js' }],
    [{ type: 'setInner', id: 'p1s', html: 'steal()' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<img src=x onerror="go()">' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<img/onerror=go() src=x>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<svg/onload=go()></svg>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<a href="javas&#99;ript:go()">x</a>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<a href="java&Tab;script:go()">x</a>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<svg><a xlink:href="javascript:go()">x</a></svg>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<form action="vbscript:go()"></form>' }],
    [{ type: 'insert', parentId: 'p1b', beforeId: null, html: '<tr onclick="go()"><td>x</td></tr>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<iframe srcdoc="&lt;script&gt;go()&lt;/script&gt;"></iframe>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<object data="x.swf"></object>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<embed src="x.swf">' }],
  ]) {
    const result = await firstOf(SCRIPTED, ops);
    assert.match(result.shards[0].error ?? '', /script/, JSON.stringify(ops));
    assert.equal(result.shards[1].applied, 2);
  }
});

test('markup that is only words in a page is still refused if it would run where it lands: in an svg or in maths', async () => {
  const breakout = (tag) => `<${tag}><img src=x onerror=go()></${tag}>`;
  for (const tag of ['style', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'noscript']) {
    for (const ops of [
      [{ type: 'insert', parentId: 'p1v', beforeId: null, html: breakout(tag) }],
      [{ type: 'setInner', id: 'p1v', html: breakout(tag) }],
      [{ type: 'insert', parentId: 'p1m', beforeId: null, html: breakout(tag) }],
      [{ type: 'insert', parentId: 'p1', beforeId: null, html: breakout(tag) }],
    ]) {
      const result = await firstOf(SCRIPTED, ops);
      assert.match(result.shards[0].error ?? '', /script/, JSON.stringify(ops));
    }
  }
});

test('an icon drawn in svg is not a script', async () => {
  for (const ops of [
    [{ type: 'insert', parentId: 'p1v', beforeId: null, html: '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1L9 9"/><circle cx="5" cy="5" r="3"/></g>' }],
    [{ type: 'setInner', id: 'p1v', html: '<title>Done</title><style>.tick { stroke: currentColor; }</style><path class="tick" d="M2 5l2 2 4-4" fill="none"/>' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#icon-check"/><rect x="1" y="1" width="14" height="14" rx="3"/></svg>' }],
  ]) {
    const result = await firstOf(SCRIPTED, ops);
    assert.equal(result.shards[0].error, undefined, JSON.stringify(ops));
  }
});

test('words about scripts are not scripts', async () => {
  for (const ops of [
    [{ type: 'setText', id: 'p1t', text: 'javascript: the good parts' }],
    [{ type: 'setInner', id: 'p1t', html: 'Learn <em>javascript:</em> carry on=1, <code>&lt;script&gt;</code>' }],
    [{ type: 'setAttr', id: 'p1', name: 'title', value: 'javascript: a history' }],
    [{ type: 'insert', parentId: 'p1', beforeId: null, html: '<a href="https://example.com/javascript:guide">guide</a><img src="data:image/png;base64,AAAA" alt="">' }],
  ]) {
    const result = await firstOf(SCRIPTED, ops);
    assert.equal(result.shards[0].error, undefined, JSON.stringify(ops));
  }
});

test('a worker that times out fails its shard; the others land', async () => {
  const { landed, apply } = applier();
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(3),
    exec: async (_c, args) => (firstRow(args) === 5 ? { code: null, stdout: '', stderr: '', timedOut: true } : relabel(args)),
    apply,
    log: quiet,
  });
  assert.match(result.shards[2].error, /longer than 120 s/);
  assert.equal(result.shards[2].applied, 0);
  assert.equal(result.applied, 4);
  assert.deepEqual(landed.map(([k]) => k).sort(), [0, 1]);
});

test('a reply that is not ops, or a worker that exits badly, fails only its shard', async () => {
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(3),
    exec: async (_c, args) => {
      const n = firstRow(args);
      if (n === 1) return { code: 0, stdout: 'I changed the labels for you.', stderr: '' };
      if (n === 3) return { code: 1, stdout: '', stderr: 'Error: something broke\nat line 2' };
      return relabel(args);
    },
    apply: applier().apply,
    log: quiet,
  });
  assert.match(result.shards[0].error, /not \{"ops"/);
  assert.match(result.shards[1].error, /something broke/);
  assert.doesNotMatch(result.shards[1].error, /line 2/, 'one line of what went wrong');
  assert.equal(result.shards[2].applied, 2);
});

test('a worker with nothing to change lands nothing and is not a failure', async () => {
  const { apply } = applier();
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(2),
    exec: async (_c, args) => (firstRow(args) === 1 ? reply([]) : relabel(args)),
    apply,
    log: quiet,
  });
  assert.deepEqual(result.shards[0], { ids: ['p1', 'p2'], applied: 0 });
});

test('a shard too big to show its worker whole fails without running it; a part inside another is shown once', async () => {
  const big = SOURCE.replace('<span data-marble-id="p3t">Paper 3</span>', `<span data-marble-id="p3t">${'word '.repeat(2700)}</span>`);
  const asked = [];
  const result = await runFanOut({
    source: big, docPath: 'd', plan: 'x', note: 'x',
    shards: [{ ids: ['p1t', 'p1', 'p2'] }, { ids: ['p3', 'p4'] }],
    exec: async (_c, args) => { asked.push(args.at(-1)); return relabel(args); },
    apply: applier().apply,
    log: quiet,
  });
  assert.match(result.shards[1].error, /too big to show a worker whole/);
  assert.equal(asked.length, 1, 'only the shard that fits was asked');
  assert.equal(asked[0].split('data-marble-id="p1t"').length - 1, 1, 'p1t is shown inside p1, not twice');
  assert.equal(result.shards[0].applied, 2);
});

test('no more than four workers run at once', async () => {
  let running = 0;
  let most = 0;
  const { apply } = applier();
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(6),
    exec: async (_c, args) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
      return relabel(args);
    },
    apply,
    log: quiet,
  });
  assert.equal(CONCURRENCY, 4);
  assert.equal(most, 4);
  assert.equal(result.applied, 12);
});

test('each shard lands as soon as its worker is done, not when all are', async () => {
  const order = [];
  await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(3),
    exec: async (_c, args) => {
      const n = firstRow(args);
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 120 : n === 3 ? 10 : 60));
      order.push(`worked ${n}`);
      return relabel(args);
    },
    apply: async (k, ops) => { order.push(`landed ${k}`); return { applied: ops.length }; },
    log: quiet,
  });
  assert.deepEqual(order, ['worked 3', 'landed 1', 'worked 5', 'landed 2', 'worked 1', 'landed 0']);
});

test('the abort signal stops the workers running and the shards still to start', async () => {
  const controller = new AbortController();
  let calls = 0;
  const { landed, apply } = applier();
  const started = Date.now();
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(6),
    exec: async (_c, _args, { signal }) => {
      calls += 1;
      if (calls === 1) setTimeout(() => controller.abort(), 20);
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { code: null, stdout: '', stderr: '', aborted: true };
    },
    signal: controller.signal,
    apply,
    log: quiet,
  });
  assert.ok(Date.now() - started < 1000, 'it returns at once');
  assert.equal(calls, 4, 'the two still waiting never start');
  assert.equal(landed.length, 0);
  assert.equal(result.applied, 0);
  for (const shard of result.shards) assert.match(shard.error, /stopped/);
});

test('a reply that arrives after the stop does not land', async () => {
  const controller = new AbortController();
  const { landed, apply } = applier();
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(2),
    exec: async (_c, args) => { controller.abort(); return relabel(args); },
    signal: controller.signal,
    apply,
    log: quiet,
  });
  assert.equal(landed.length, 0);
  for (const shard of result.shards) assert.match(shard.error, /stopped/);
});

test('without the claude CLI no worker runs, and the run says so', async () => {
  let calls = 0;
  const result = await runFanOut({
    source: SOURCE, docPath: 'd', plan: 'x', note: 'x', shards: pairs(6),
    exec: async () => { calls += 1; return { code: null, stdout: '', stderr: '', missing: true }; },
    apply: applier().apply,
    log: quiet,
  });
  assert.equal(result.missing, true);
  assert.ok(calls <= 4, 'nothing more is started once it is known to be missing');
});

test('shards that are not a fan out are refused before any worker runs', async () => {
  let calls = 0;
  const exec = async (_c, args) => { calls += 1; return relabel(args); };
  const run = (extra) => runFanOut({ source: SOURCE, docPath: 'd', plan: 'x', note: 'x', exec, apply: applier().apply, log: quiet, ...extra });
  assert.match((await run({ shards: pairs(1) })).error, /2 to 8/);
  assert.match((await run({ shards: pairs(6).concat(pairs(3)) })).error, /2 to 8/);
  assert.match((await run({ shards: [{ ids: [] }, { ids: ['p1'] }] })).error, /1 to 24/);
  assert.match((await run({ shards: [{ ids: ['p1'] }, { ids: ['nope'] }] })).error, /"nope"/);
  assert.match((await run({ shards: [{ ids: ['p1', 'p2'] }, { ids: ['p2'] }] })).error, /"p2"/, 'one id in two shards');
  assert.match((await run({ shards: [{ ids: ['u'] }, { ids: ['p2'] }] })).error, /inside/, 'one shard inside another');
  assert.match((await run({ shards: pairs(2), plan: '  ' })).error, /plan/);
  assert.match((await run({ shards: pairs(2), model: 'opus' })).error, /haiku or sonnet/);
  assert.equal(calls, 0);
});

// ------------------------------------------------------------ through the tool

const drive = await createDrive(loadConfig(), { log: { log() {}, error() {} } });
test.after(() => drive.close());

let n = 0;
async function freshTurn() {
  n += 1;
  const target = `papers-${n}`;
  await drive.createDocument(target, SOURCE, { label: 'test' });
  const events = [];
  return {
    id: `f${n}-t1`,
    conversationId: `f${n}`,
    target,
    writable: new Set([target]),
    undo: [],
    events,
    onEvent: (event) => events.push(event),
  };
}

function fanTools(exec, { beforeWrite = null } = {}) {
  const looks = [];
  const presences = [];
  const tools = createTools({
    store: drive.store,
    writeOps: async (docPath, ops, options) => {
      await beforeWrite?.(options);
      const result = await drive.writeOps(docPath, ops, options);
      if (result.applied) presences.push(options.presence);
      return result;
    },
    createDocument: drive.createDocument,
    buildStarter: build,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine: () => [],
    onLook: (docPath, ids, client, extra) => looks.push({ docPath, ids, client, extra }),
    exec,
  });
  return { tools, looks, presences };
}

test('fan_out is offered to agents with the plan, the shards and the model', () => {
  const schema = TOOL_SCHEMAS.find((t) => t.name === 'fan_out');
  assert.ok(schema);
  assert.deepEqual(schema.inputSchema.required, ['path', 'note', 'plan', 'shards']);
  assert.equal(schema.inputSchema.properties.shards.minItems, 2);
  assert.equal(schema.inputSchema.properties.shards.maxItems, 8);
  assert.equal(schema.inputSchema.properties.shards.items.properties.ids.maxItems, 24);
  assert.deepEqual(schema.inputSchema.properties.model.enum, ['haiku', 'sonnet']);
  assert.match(schema.description, /six or more parts; for a few, use apply_ops/);
});

test('each shard lands as its own batch with its own undo record, and the turn\'s undo takes back all of them', async () => {
  const { tools, looks, presences } = fanTools(async (_c, args) => relabel(args));
  const turn = await freshTurn();
  const result = await tools.call('fan_out', { path: turn.target, note: 'Relabel the papers.', plan: 'A plain label each.', shards: pairs(3) }, turn);
  assert.equal(result.applied, 6);
  assert.deepEqual(result.shards.map((s) => s.applied), [2, 2, 2]);
  assert.equal(turn.undo.length, 3, 'one undo record per applied shard');
  assert.equal(turn.events.filter((e) => e.type === 'ops.applied').length, 3);
  const after = await drive.store.read(turn.target);
  for (const k of [1, 2, 3, 4, 5, 6]) assert.match(after, new RegExp(`Paper ${k}, relabelled`));

  // Each batch is said as one part of n, against the whole change.
  const befores = looks.filter((l) => l.extra?.stage === 'before');
  assert.equal(befores.length, 3);
  assert.deepEqual(befores.map((l) => l.extra.note).sort(), [1, 2, 3].map((k) => `Relabel the papers. · part ${k} of 3`));
  for (const look of befores) {
    assert.equal(look.extra.total, 6, 'the total is every id the shards hold');
    assert.deepEqual(look.extra.reach, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], 'the whole reach rides on every batch');
    assert.equal(look.extra.turn, turn.id);
    assert.equal(look.client, `agent:${turn.conversationId}`);
  }
  assert.equal(presences.length, 3);
  assert.deepEqual(presences.map((p) => p.groups.done).sort(), [1, 2, 3]);
  for (const p of presences) assert.equal(p.stage, 'after');

  const undone = await undoTurn({ records: turn.undo, writeOps: drive.writeOps, client: `agent-undo:${turn.conversationId}` });
  assert.equal(undone.reverted, 6, 'every op of every shard');
  assert.equal(await drive.store.read(turn.target), SOURCE);
});

test('a shard whose part changed while its worker read it fails, says so on the page, and leaves the person\'s edit', async () => {
  let release;
  const typed = new Promise((resolve) => { release = resolve; });
  let working;
  const begun = new Promise((resolve) => { working = resolve; });
  const { tools, looks } = fanTools(async (_c, args) => {
    if (firstRow(args) === 3) {
      working();
      await typed;
    }
    return relabel(args);
  });
  const turn = await freshTurn();
  const call = tools.call('fan_out', { path: turn.target, note: 'Relabel.', plan: 'A plain label each.', shards: pairs(3) }, turn);
  await begun;
  await drive.writeOps(turn.target, [{ type: 'setText', id: 'p3t', text: 'Typed by hand' }], { client: 'tab' });
  release();
  const result = await call;
  assert.match(result.shards[1].error, /changed while it worked/);
  assert.equal(result.shards[1].applied, 0);
  assert.equal(result.applied, 4);
  assert.equal(turn.undo.length, 2);
  const after = await drive.store.read(turn.target);
  assert.match(after, /Typed by hand/);
  assert.doesNotMatch(after, /Paper 4, relabelled/, 'none of the failed shard\'s ops landed');
  const failed = looks.find((l) => l.extra?.failed);
  assert.ok(failed, 'a failed shard is said on the page');
  assert.deepEqual(failed.extra.failed, ['p3', 'p4']);
  assert.equal(failed.extra.stage, 'after');
  assert.equal(failed.extra.turn, turn.id);
  assert.equal(failed.client, `agent:${turn.conversationId}`);
  assert.equal(failed.extra.groups.failed, 1);
  assert.equal(failed.extra.groups.of, 3);
  assert.equal(turn.v5.failed, 1, 'the turn counts what failed, for its end');
});

test('a shard that edits outside itself lands nothing at all', async () => {
  const { tools } = fanTools(async (_c, args) => (firstRow(args) === 1
    ? reply([label(1, 'Inside'), { type: 'setText', id: 'h', text: 'Outside' }])
    : relabel(args)));
  const turn = await freshTurn();
  const result = await tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: pairs(2) }, turn);
  assert.match(result.shards[0].error, /outside its shard/);
  const after = await drive.store.read(turn.target);
  assert.doesNotMatch(after, />Inside</);
  assert.doesNotMatch(after, />Outside</);
  assert.match(after, /Paper 3, relabelled/);
  assert.deepEqual(Object.keys(result).sort(), ['applied', 'shards'], 'the answer is short');
});

test('ops a shard sends are checked as apply_ops checks them, ids minted into new markup', async () => {
  const { tools } = fanTools(async (_c, args) => (firstRow(args) === 1
    ? reply([{ type: 'insert', parentId: 'p1', beforeId: null, html: '<em>new</em>' }])
    : reply([{ type: 'setAttr', id: 'p3', name: 'not a name', value: 'x' }])));
  const turn = await freshTurn();
  const result = await tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: pairs(2) }, turn);
  assert.equal(result.shards[0].applied, 1);
  assert.match(await drive.store.read(turn.target), /<em data-marble-id="[a-z0-9]+">new<\/em>/);
  assert.match(result.shards[1].error, /not an attribute name/);
  assert.equal(turn.undo.length, 1);
});

test('without the claude CLI the agent is told to make the edits itself', async () => {
  const { tools } = fanTools(async () => ({ code: null, stdout: '', stderr: '', missing: true }));
  const turn = await freshTurn();
  const result = await tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: pairs(2) }, turn);
  assert.match(result.error, /apply_ops/);
  assert.equal(turn.undo.length, 0);
});

test('fan_out only writes where the turn may, and refuses bad shards before any worker runs', async () => {
  let calls = 0;
  const { tools } = fanTools(async (_c, args) => { calls += 1; return relabel(args); });
  const turn = await freshTurn();
  assert.match((await tools.call('fan_out', { path: 'elsewhere', note: 'x', plan: 'x', shards: pairs(2) }, turn)).error, /not writable/);
  assert.match((await tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: [{ ids: ['u'] }, { ids: ['p1'] }] }, turn)).error, /inside/);
  assert.equal(calls, 0);
  assert.equal(turn.v5, undefined, 'a refused fan out tallies nothing');
});

test('fan_out stops with the turn', async () => {
  const controller = new AbortController();
  let calls = 0;
  const { tools } = fanTools(async (_c, _args, { signal }) => {
    calls += 1;
    if (calls === 1) setTimeout(() => controller.abort(), 20);
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { code: null, stdout: '', stderr: '', aborted: true };
  });
  const turn = { ...(await freshTurn()), abort: controller };
  const result = await tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: pairs(6) }, turn);
  assert.equal(result.applied, 0);
  assert.equal(calls, 4);
  for (const shard of result.shards) assert.match(shard.error, /stopped/);
});

// ------------------------------------------------------------ review, round 1

/** Every groups count the page was told, newest last. */
const groupsSaid = (looks, presences) => [...looks.map((l) => l.extra?.groups), ...presences.map((p) => p?.groups)]
  .filter(Boolean)
  .sort((a, b) => a.seq - b.seq);

test('a shard the write would refuse is not counted done, and its parts are not counted changed', async () => {
  // setText on a row would wipe the addressed title inside it: the write
  // refuses that, so nothing of the shard lands.
  const { tools, looks, presences } = fanTools(async (_c, args) => (firstRow(args) === 3
    ? reply([{ type: 'setText', id: 'p3', text: 'Flattened' }, label(4, 'Paper 4, relabelled')])
    : relabel(args)));
  const turn = await freshTurn();
  const result = await tools.call('fan_out', { path: turn.target, note: 'Relabel.', plan: 'x', shards: pairs(3) }, turn);
  assert.match(result.shards[1].error, /addressed element/);
  assert.equal(result.applied, 4);
  assert.equal(turn.v5.parts.size, 4, 'only the parts that landed are counted');
  assert.equal(turn.v5.failed, 1);
  assert.equal(looks.filter((l) => l.extra?.stage === 'before' && /part 2 of 3/.test(l.extra.note)).length, 0, 'a refused batch is never said as coming');
  const last = groupsSaid(looks, presences).at(-1);
  assert.deepEqual({ done: last.done, failed: last.failed, of: last.of }, { done: 2, failed: 1, of: 3 });
  assert.match(await drive.store.read(turn.target), /Paper 3</, 'the row keeps its title');
});

test('apply_ops refuses a batch the write would refuse, before it says or counts anything', async () => {
  const { tools, looks } = fanTools(async () => reply([]));
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  looks.length = 0;
  const result = await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'p3', text: 'Flattened' }] }, turn);
  assert.equal(result.refused, true);
  assert.match(result.reason, /addressed element/);
  assert.equal(turn.v5, undefined);
  assert.equal(looks.length, 0);
  assert.equal(turn.undo.length, 0);
});

test('a failed group whose parts the agent lands itself is no longer counted failed', async () => {
  const { tools, looks } = fanTools(async (_c, args) => (firstRow(args) === 3
    ? reply([{ type: 'setText', id: 'h', text: 'Mine' }])
    : relabel(args)));
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  const result = await tools.call('fan_out', { path: turn.target, note: 'Relabel.', plan: 'x', shards: pairs(2) }, turn);
  assert.match(result.shards[1].error, /outside its shard/);
  assert.equal(turn.v5.failed, 1);
  await tools.call('apply_ops', { path: turn.target, note: 'Finish the rest.', ops: [label(3, 'By hand')] }, turn);
  assert.equal(turn.v5.failed, 1, 'half a group is still a failed group');
  looks.length = 0;
  await tools.call('apply_ops', { path: turn.target, note: 'Finish the rest.', ops: [label(4, 'By hand too')] }, turn);
  assert.equal(turn.v5.failed, 0);
  const before = looks.find((l) => l.extra?.stage === 'before');
  assert.equal(before.extra.groups.failed, 0, 'the page is told the group is done after all');
});

test('a shard that lands after the turn is stopped is refused inside the queue', async () => {
  const controller = new AbortController();
  const { tools, looks } = fanTools(async (_c, args) => relabel(args), {
    // The stop arrives while the batch waits its turn in the document's queue.
    beforeWrite: () => controller.abort(),
  });
  const turn = { ...(await freshTurn()), abort: controller };
  const result = await tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: pairs(2) }, turn);
  assert.equal(result.applied, 0);
  for (const shard of result.shards) assert.match(shard.error, /stopped/);
  assert.equal(turn.undo.length, 0);
  assert.equal(await drive.store.read(turn.target), SOURCE);
  assert.equal(looks.filter((l) => l.extra?.failed).length, 0, 'a stop is not a failure');
  assert.equal(turn.events.filter((e) => e.type === 'ops.refused').length, 0);
});

test('two fan outs in one turn are counted apart', async () => {
  const { tools, looks, presences } = fanTools(async (_c, args) => relabel(args));
  const turn = await freshTurn();
  await tools.call('fan_out', { path: turn.target, note: 'First.', plan: 'x', shards: pairs(3) }, turn);
  const first = groupsSaid(looks, presences);
  looks.length = 0;
  presences.length = 0;
  await tools.call('fan_out', { path: turn.target, note: 'Second.', plan: 'x', shards: [{ ids: ['p7', 'p8'] }, { ids: ['p9', 'p10'] }] }, turn);
  const second = groupsSaid(looks, presences);
  assert.notEqual(second[0].call, first[0].call);
  assert.deepEqual({ done: second[0].done, of: second[0].of }, { done: 0, of: 2 });
  assert.deepEqual({ done: second.at(-1).done, of: second.at(-1).of }, { done: 2, of: 2 });
  assert.ok(second[0].seq > first.at(-1).seq, 'the newer count is said as newer');
});

test('a part the person deleted while its worker read it fails the shard as changed, not as a bad op', async () => {
  let release;
  const deleted = new Promise((resolve) => { release = resolve; });
  let working;
  const begun = new Promise((resolve) => { working = resolve; });
  const { tools } = fanTools(async (_c, args) => {
    if (firstRow(args) === 3) {
      working();
      await deleted;
    }
    return relabel(args);
  });
  const turn = await freshTurn();
  const call = tools.call('fan_out', { path: turn.target, note: 'x', plan: 'x', shards: pairs(2) }, turn);
  await begun;
  await drive.writeOps(turn.target, [{ type: 'remove', id: 'p3' }], { client: 'tab' });
  release();
  const result = await call;
  assert.equal(result.shards[1].error, 'changed while it worked');
  assert.equal(result.shards[0].applied, 2);
});

// ------------------------------------------------------------ review, round 2

test('a failed part lands only by an op on it or inside it, never beside it or on what holds it', async () => {
  const { tools } = fanTools(async (_c, args) => (firstRow(args) === 3
    ? reply([{ type: 'setText', id: 'h', text: 'Mine' }])
    : relabel(args)));
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('fan_out', { path: turn.target, note: 'Relabel.', plan: 'x', shards: pairs(2) }, turn);
  assert.equal(turn.v5.failed, 1);
  const still = async (ops, why) => {
    const result = await tools.call('apply_ops', { path: turn.target, note: 'Around the rows.', ops }, turn);
    assert.ok(result.applied, JSON.stringify(result));
    assert.equal(turn.v5.failed, 1, why);
    assert.deepEqual([...turn.v5.lost[0].left], left, why);
  };
  let left = ['p3', 'p4'];
  await still([{ type: 'insert', parentId: 'u', beforeId: 'p3', html: '<li>A new paper</li>' }], 'an insert before a failed row is beside it');
  await still([{ type: 'move', id: 'p1', parentId: 'u', beforeId: 'p4' }], 'a move to before a failed row is beside it');
  await still([{ type: 'setAttr', id: 'u', name: 'class', value: 'papers' }], 'the list holding a failed row is not the row');
  left = ['p4'];
  await still([{ type: 'insert', parentId: 'p3', beforeId: null, html: '<em>new</em>' }], 'one of two failed rows landed is still a failed group');
  await tools.call('apply_ops', { path: turn.target, note: 'Finish.', ops: [{ type: 'setAttr', id: 'p4', name: 'data-done', value: 'yes' }] }, turn);
  assert.equal(turn.v5.failed, 0, 'an insert into one row and an op on the other land the group');
});
