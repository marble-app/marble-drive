// The intent layer, wired to a store instead of a folder.
//
// None of the thinking is here — `resolveIntent` in the Marble package does all
// of it, including checking the model's answer and refusing a batch that would
// destroy something. What this adds is the two things that are the Drive's
// business: where the source comes from (the store, so a document three folders
// down works exactly like one at the root), and where the record goes.
//
// The route never writes. It reads what the gesture pointed at, asks for an
// interpretation, checks the answer, and hands back ops — accepting them is a
// separate POST /ops from the page. That separation is what makes an agent a
// third client rather than a special one.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { loadProvider, resolveIntent } from './engine.js';
import { docKey } from './paths.js';

export function createIntents({ store, log = console }) {
  const logFile = (docPath, kind) => path.join(store.marbleDir, `${docKey(docPath)}.${kind}.jsonl`);

  async function record(docPath, entry) {
    await fsp.mkdir(store.marbleDir, { recursive: true });
    await fsp.appendFile(logFile(docPath, 'intents'), `${JSON.stringify(entry)}\n`);
  }

  /** One question, asked and recorded. A refusal is written down too: what the
   *  checks caught used to reach the person and nothing else, so there was no
   *  record of what the model gets wrong and nothing to improve against. */
  async function ask(docPath, request, onEvent, signal) {
    const source = await store.read(docPath);
    if (source === null) throw Object.assign(new Error(`no document "${docPath}"`), { status: 404 });

    const provider = await loadProvider(request.provider);
    const started = Date.now();
    const id = crypto.randomUUID().slice(0, 8);
    const asked = {
      id,
      doc: docPath,
      kind: request.kind,
      targets: request.targets,
      gesture: request.gesture ?? null,
      instruction: request.instruction ?? null,
    };

    try {
      const result = await resolveIntent({ source, request, provider, onEvent, signal });
      await record(docPath, {
        t: Date.now(),
        ...asked,
        ms: Date.now() - started,
        provider: result.provider,
        status: 'ok',
        attempts: result.attempts,
        refused: result.refused,
        repaired: result.repaired,
        warnings: result.warnings,
        note: result.note,
        ops: result.ops,
      });
      log.log(
        `[drive] intent ${id} — ${request.kind} on ${request.targets.length} target(s) in ${docPath}` +
          ` → ${result.ops.length} op(s) in ${Date.now() - started}ms`,
      );
      return { ok: true, id, note: result.note, ops: result.ops };
    } catch (err) {
      await record(docPath, {
        t: Date.now(),
        ...asked,
        ms: Date.now() - started,
        provider: provider.name,
        status: 'refused',
        error: err.message,
      });
      log.error(`[drive] intent ${id} refused — ${err.message}`);
      throw err;
    }
  }

  /** The zoom fast path. The answer is words rather than ops — the document
   *  composes the ops itself from the finished text, which is what lets it grow
   *  under a gesture still in progress. */
  async function zoom(docPath, request, onEvent, signal) {
    const provider = await loadProvider(request.provider);
    if (!provider.completeText) throw new Error(`provider "${provider.name}" has no text fast path`);

    const phrase = typeof request.phrase === 'string' ? request.phrase.trim() : '';
    const paragraph = typeof request.paragraph === 'string' ? request.paragraph.trim() : '';
    const from = Number(request.from);
    const to = Number(request.to);
    if (!phrase) throw new Error('zoom needs the phrase');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) {
      throw new Error('zoom needs two distinct integer levels');
    }

    const zoomIn = to > from;
    const words =
      Number.isInteger(Number(request.words)) && Number(request.words) > 0
        ? Number(request.words)
        : null;
    const system =
      'You adjust how compressed or expanded a phrase is. Levels run from negative (terser) through 0 (the original) to positive (fuller). ' +
      'Answer with the rewritten phrase only — no quotes, no preamble, no commentary, no trailing punctuation the original does not have. ' +
      'The phrase sits mid-sentence, so the rewrite must be grammatical in exactly that position, keeping the original casing of its first word.';
    const wish = words
      ? `Aim for roughly ${words} words — the person sized this by hand — ${zoomIn ? 'adding concrete specifics rather than padding' : 'keeping only what is load-bearing'}.`
      : zoomIn
        ? `Expand it to roughly ${to >= 2 ? 'three times' : 'twice'} its current length, adding concrete specifics rather than padding.`
        : `Compress it to ${to <= -2 ? 'its bare point, a few words' : 'roughly half its current length, keeping only what is load-bearing'}.`;
    const user =
      `The phrase, currently at level z${from}:\n\n  ${phrase}\n\n` +
      `It appears inside this paragraph:\n\n  ${paragraph || phrase}\n\n` +
      `Rewrite the phrase at level z${to}. ${wish}`;

    const started = Date.now();
    const id = crypto.randomUUID().slice(0, 8);
    try {
      const answer = (await provider.completeText({ system, user, onEvent, signal })).trim();
      if (!answer) throw new Error('the model answered with nothing');
      await record(docPath, {
        t: Date.now(), id, doc: docPath, kind: 'zoom', from, to, words,
        ms: Date.now() - started, provider: provider.name, status: 'ok', phrase, text: answer,
      });
      return { ok: true, id, text: answer };
    } catch (err) {
      await record(docPath, {
        t: Date.now(), id, doc: docPath, kind: 'zoom', from, to,
        ms: Date.now() - started, provider: provider.name, status: 'refused', error: err.message,
      });
      throw err;
    }
  }

  /** Reading provenance back. A node tagged data-marble-intent points here. */
  async function lookup(docPath, id) {
    const log = await fsp.readFile(logFile(docPath, 'intents'), 'utf8').catch(() => '');
    return log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse()
      .find((entry) => entry.id === id);
  }

  return { ask, zoom, lookup };
}
