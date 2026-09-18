#!/usr/bin/env node
// A stand-in for `claude -p` or `cursor-agent -p`, driven by a script instead
// of a model. It does what a real CLI does with Marble: starts the MCP bridge it
// was configured with, speaks MCP to it, and prints a JSON line per thing that
// happens. The runner cannot tell it from the real thing, which is the point.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import readline from 'node:readline';

const script = JSON.parse(process.env.FAKE_SCRIPT ?? '[]');
const mcp = process.env.FAKE_MCP ? JSON.parse(process.env.FAKE_MCP) : null;
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The first line is the prompt (its later lines are context and ignored).
// Anything after that which parses as a control_response answers an ask.
const stdin = readline.createInterface({ input: process.stdin });
const answers = [];
let waiter = null;
let prompt = null;
let promptReady;
const promptSeen = new Promise((resolve) => { promptReady = resolve; });
stdin.on('line', (line) => {
  if (prompt === null) {
    prompt = line;
    promptReady();
    return;
  }
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg?.type !== 'control_response') return;
  if (waiter) { const w = waiter; waiter = null; w(msg); } else answers.push(msg);
});
const nextAnswer = () => (answers.length ? Promise.resolve(answers.shift()) : new Promise((resolve) => { waiter = resolve; }));
await promptSeen;

let bridge = null;
let nextId = 1;
const pending = new Map();

async function rpc(method, params) {
  if (!bridge) {
    bridge = spawn(mcp.command, mcp.args, { env: { ...process.env, ...mcp.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    readline.createInterface({ input: bridge.stdout }).on('line', (line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } });
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }
  const id = nextId++;
  const reply = new Promise((resolve) => pending.set(id, resolve));
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return reply;
}

const vars = {};
const resolve = (value) => {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') {
      return value.$ref.split('.').reduce((at, key) => at?.[key], vars);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
  }
  return value;
};

out({ kind: 'session', id: process.env.FAKE_RESUME || `fake-${process.pid}` });
out({ kind: 'text', text: `prompt:${prompt.split('\n')[0]}` });

for (const step of script) {
  if (step.ignoreTerm) process.on('SIGTERM', () => {});
  if (step.say) {
    out({ kind: 'delta', text: step.say.slice(0, 3) });
    out({ kind: 'text', text: step.say });
  }
  if (step.sleep) await sleep(step.sleep);
  // What a CLI does when it needs the person: print the prompt, wait for the
  // answer on stdin, say what it got.
  if (step.ask) {
    const requestId = `ask-${nextId++}`;
    out({ kind: 'ask', requestId, tool: step.ask.tool, input: step.ask.input ?? {} });
    const msg = await nextAnswer();
    const r = msg.response?.response ?? {};
    out({ kind: 'text', text: `answered:${r.behavior}${r.updatedInput?.answers ? ':' + Object.values(r.updatedInput.answers).join(',') : ''}` });
  }
  if (step.silent) await sleep(step.silent);
  if (step.call) {
    const callId = `call-${nextId}`;
    const args = resolve(step.args ?? {});
    out({ kind: 'call', name: step.call, input: args, callId });
    const reply = await rpc('tools/call', { name: step.call, arguments: args });
    const text = reply.result?.content?.[0]?.text ?? '{}';
    const body = JSON.parse(text);
    if (step.as) vars[step.as] = body;
    out({ kind: 'result', callId, ok: !reply.result?.isError, summary: text.slice(0, 200) });
  }
  // What a full agent does that a documents agent cannot: write the file
  // itself, with no op and no bridge. The host hears it from the watcher.
  if (step.write) {
    await fsp.writeFile(step.write.file, step.write.text);
    out({ kind: 'text', text: `wrote ${step.write.file}` });
  }
  // What a CLI says when asked to resume a session it no longer has.
  if (step.lostWhenResumed && process.env.FAKE_RESUME) {
    out({ kind: 'done', ok: false, error: step.lostWhenResumed });
    bridge?.kill();
    process.exit(1);
  }
  if (step.fail) {
    out({ kind: 'done', ok: false, error: step.fail });
    bridge?.kill();
    process.exit(1);
  }
  if (step.exit !== undefined) {
    bridge?.kill();
    process.exit(step.exit);
  }
}

out({ kind: 'done', ok: true });
bridge?.kill();
process.exit(0);
