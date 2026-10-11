// The Drive surface for a Recursive Subquestions test. Keys stay on the host.
// The document posts here; it never carries TYPESAFE_API_KEY.

import { json, readJson } from '../http.js';
import { askSystemOne, explainRunFailure, questionsFromNodes } from './client.js';
import { LLM_MODEL, complete as defaultComplete, repairWithLlm, shapeWithLlm, splitWithLlm } from './llm.js';
import { cloneTree, runPipeline } from './pipeline.js';
import { gateWithRepair } from './repair.js';

export function readStop(value, fallback = 0.75) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1 ? n / 100 : n;
}

export function noKeyFailure() {
  return explainRunFailure({
    status: 503,
    message: 'TYPESAFE_API_KEY is not set. Put it in .env.local and restart the host.',
  });
}

function liveProviders({ apiKey, llm, complete, signal, onEvent }) {
  return {
    shape: (origin) => shapeWithLlm(origin, { model: llm, complete, signal }),
    gate: async (nodes) =>
      gateWithRepair({
        nodes,
        onEvent,
        ask: async (batch) => {
          const response = await askSystemOne({
            apiKey,
            signal,
            state: {
              origin: batch[0]?.origin,
              frontier: batch.map((node) => ({ id: node.id, text: node.text, depth: node.depth })),
            },
            questions: questionsFromNodes(batch),
          });
          return response.answers ?? {};
        },
        repair: (batch, detail) => repairWithLlm(batch, detail, { model: llm, complete, signal }),
      }),
    decompose: (node) => splitWithLlm(node, { model: llm, complete, signal }),
  };
}

function writeNdjson(res, obj) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`${JSON.stringify(obj)}\n`);
}

export function createTypesafeHandler({
  apiKey = null,
  llm = LLM_MODEL,
  maxBodyBytes = 16 * 1024 * 1024,
  shape,
  gate,
  decompose,
  complete,
} = {}) {
  return {
    async handle(req, res, url) {
      const route = url.pathname;
      if (route === '/typesafe/status' && req.method === 'GET') {
        json(res, 200, { key: Boolean(apiKey), llm });
        return true;
      }
      if (route === '/typesafe/run' && req.method === 'POST') {
        if (!apiKey) {
          json(res, 503, {
            ...noKeyFailure(),
            error: noKeyFailure().message,
          });
          return true;
        }
        const body = await readJson(req, maxBodyBytes);
        const prompt = String(body.prompt ?? '').trim();
        if (!prompt) {
          json(res, 400, { error: 'a run needs a prompt' });
          return true;
        }

        const ac = new AbortController();
        let finished = false;
        const stop = () => {
          if (!finished) ac.abort();
        };
        res.on('close', stop);

        let streaming = false;
        let lastRoot = null;
        let lastPhase = 'shape';
        const startStream = () => {
          if (streaming || res.headersSent) return;
          streaming = true;
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.flushHeaders?.();
          req.socket?.setNoDelay?.(true);
        };

        const hookedComplete = async (opts) => {
          let text = '';
          const run = complete ?? defaultComplete;
          return run({
            ...opts,
            signal: opts.signal ?? ac.signal,
            onChunk: (delta) => {
              text += delta;
              startStream();
              writeNdjson(res, {
                type: 'progress',
                phase: lastPhase,
                message:
                  lastPhase === 'split'
                    ? 'Grok is writing subquestions…'
                    : 'Grok is writing the first question…',
                llm: { delta, text },
                root: lastRoot,
              });
            },
          });
        };

        const providers =
          shape && gate && decompose
            ? { shape, gate, decompose }
            : liveProviders({
                apiKey,
                llm,
                complete: hookedComplete,
                signal: ac.signal,
                onEvent: (event) => {
                  lastPhase = event.phase || lastPhase;
                  startStream();
                  writeNdjson(res, { type: 'progress', root: lastRoot, ...event });
                },
              });

        try {
          const result = await runPipeline({
            prompt,
            stop: readStop(body.stop),
            maxDepth: Number(body.maxDepth) > 0 ? Number(body.maxDepth) : 4,
            maxWidth: Number(body.maxWidth) > 0 ? Number(body.maxWidth) : 8,
            llmCap: Number(body.llmCap) > 0 ? Number(body.llmCap) : 8,
            signal: ac.signal,
            onEvent: (event) => {
              lastRoot = event.root;
              lastPhase = event.phase || lastPhase;
              startStream();
              writeNdjson(res, { type: 'progress', ...event });
            },
            ...providers,
          });
          finished = true;
          startStream();
          writeNdjson(res, { type: 'done', root: cloneTree(result.root) });
          if (!res.writableEnded) res.end();
        } catch (err) {
          const cancelled = err.code === 'CANCELLED' || ac.signal.aborted;
          const explained = cancelled
            ? { kind: 'cancelled', title: 'Stopped.', message: 'The run was cancelled.' }
            : explainRunFailure(err);
          if (streaming) {
            writeNdjson(
              res,
              cancelled
                ? { type: 'cancelled', root: lastRoot, ...explained }
                : { type: 'error', phase: lastPhase, root: lastRoot, error: err.message, ...explained },
            );
            finished = true;
            if (!res.writableEnded) res.end();
          } else {
            finished = true;
            json(res, err.status || 500, { error: err.message, ...explained });
          }
        }
        return true;
      }
      return false;
    },
  };
}
