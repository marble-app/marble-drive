// Recursive Subquestions: code owns the loop, TypeSafe owns the gate, an LLM
// owns only the split. One TypeSafe call per depth; only gate failures go to
// the model; identical questions are answered once.

export function gateConfidence(answer) {
  if (!answer) return 0;
  if (answer.type === 'noul') {
    const yes = Number(answer.noul);
    if (!Number.isFinite(yes)) return 0;
    return Math.max(yes, 1 - yes);
  }
  const confidence = Number(answer.confidence);
  return Number.isFinite(confidence) ? confidence : 0;
}

export function questionHash(node) {
  const criteria = node?.criteria == null ? '' : JSON.stringify(node.criteria);
  return `${node?.type ?? ''}\n${node?.text ?? ''}\n${criteria}`;
}

export function composeInstructions(origin, text) {
  return `Original task:\n${origin}\n\nCurrent question:\n${text}`;
}

export function cancelledError(message = 'cancelled') {
  const err = new Error(message);
  err.status = 499;
  err.code = 'CANCELLED';
  return err;
}

export function cloneTree(node) {
  if (!node) return null;
  return {
    id: node.id,
    depth: node.depth,
    parent: node.parent,
    origin: node.origin,
    type: node.type,
    text: node.text,
    instructions: node.instructions,
    criteria: node.criteria,
    children: (node.children ?? []).map(cloneTree),
    answer: node.answer,
    confidence: node.confidence,
    fate: node.fate,
    busy: node.busy ?? null,
  };
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

export function orAbort(promise, signal) {
  throwIfAborted(signal);
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function mapLimit(items, cap, fn) {
  if (!items.length) return Promise.resolve([]);
  const limit = Math.max(1, Number(cap) || 1);
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  };
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => out);
}

export async function runPipeline({
  prompt,
  stop = 0.75,
  maxDepth = 4,
  maxWidth = 8,
  llmCap = 8,
  shape,
  gate,
  decompose,
  onEvent,
  signal,
} = {}) {
  const origin = String(prompt ?? '').trim();
  if (!origin) throw new Error('a run needs a prompt');
  if (typeof shape !== 'function' || typeof gate !== 'function' || typeof decompose !== 'function') {
    throw new Error('a run needs shape, gate, and decompose');
  }

  let seq = 0;
  const mint = () => {
    seq += 1;
    return `n${seq}`;
  };

  const makeNode = (spec, { depth, parent, busy = null }) => ({
    id: mint(),
    depth,
    parent,
    origin,
    type: spec.type,
    text: spec.text,
    instructions: spec.instructions ?? composeInstructions(origin, spec.text),
    criteria: spec.criteria,
    children: [],
    answer: null,
    confidence: null,
    fate: null,
    busy,
  });

  let root = {
    id: 'pending',
    depth: 0,
    parent: null,
    origin,
    type: null,
    text: origin,
    instructions: composeInstructions(origin, origin),
    criteria: undefined,
    children: [],
    answer: null,
    confidence: null,
    fate: null,
    busy: 'shape',
  };

  const emit = async (phase, message, extra = {}) => {
    if (typeof onEvent !== 'function') return;
    await orAbort(onEvent({ phase, message, root: cloneTree(root), ...extra }), signal);
  };

  const apply = (node, hit) => {
    node.answer = hit.answer;
    node.confidence = hit.confidence;
    node.fate = hit.fate;
    node.busy = null;
  };

  const finish = (node, answer) => {
    node.answer = answer;
    node.confidence = gateConfidence(answer);
    node.busy = null;
    if (node.depth >= maxDepth) node.fate = node.confidence >= stop ? 'answer' : 'cap';
    else node.fate = node.confidence >= stop ? 'answer' : 'split';
  };

  await emit('shape', 'Writing the first TypeSafe question…');
  root = makeNode(await orAbort(shape(origin), signal), { depth: 0, parent: null });
  await emit('shape', 'First question is ready.');

  const cache = new Map();
  let frontier = [root];

  while (frontier.length) {
    throwIfAborted(signal);
    const depth = frontier[0].depth;
    const unique = [];
    const copies = [];

    for (const node of frontier) {
      const hash = questionHash(node);
      const hit = cache.get(hash);
      if (hit?.answer) apply(node, hit);
      else if (hit?.pending) copies.push({ node, hash });
      else {
        cache.set(hash, { pending: true });
        unique.push(node);
      }
    }

    if (unique.length) {
      for (const node of unique) node.busy = 'gate';
      await emit(
        'gate',
        unique.length === 1
          ? 'TypeSafe is judging this question…'
          : `TypeSafe is judging ${unique.length} questions at depth ${depth}…`,
      );
      const answers = (await orAbort(gate(unique), signal)) ?? {};
      for (const node of unique) {
        finish(node, answers[node.id]);
        cache.set(questionHash(node), {
          answer: node.answer,
          confidence: node.confidence,
          fate: node.fate,
        });
      }
      await emit('gate', 'Gate returned.', {
        som: {
          stop,
          nodes: unique.map((node) => ({
            id: node.id,
            text: node.text,
            type: node.type,
            answer: node.answer,
            confidence: node.confidence,
            fate: node.fate,
          })),
        },
      });
    }

    for (const { node, hash } of copies) apply(node, cache.get(hash));

    if (depth >= maxDepth) break;

    const toSplit = unique.filter((node) => node.fate === 'split');
    if (!toSplit.length) break;

    await mapLimit(toSplit, llmCap, async (node) => {
      throwIfAborted(signal);
      node.busy = 'split';
      await emit('split', `Splitting: ${node.text}`);
      const raw = await orAbort(decompose(node), signal);
      const specs = (Array.isArray(raw) ? raw : []).slice(0, Math.max(0, maxWidth));
      node.busy = null;
      node.children = specs.map((spec) =>
        makeNode(spec, { depth: depth + 1, parent: node.id }),
      );
      await emit('split', `Opened ${node.children.length} branches.`);
    });

    frontier = toSplit.flatMap((node) => node.children);
  }

  await emit('done', 'Done.');
  return { root };
}
