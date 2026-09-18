// TypeSafe 422 is a malformed question, not a quota miss. Read the validator,
// fix what code can, ask the LLM only for the rest, and retry the same gate.

import { formatTypesafeDetail } from './client.js';
import { composeInstructions } from './pipeline.js';

function slug(text) {
  const raw = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return raw || 'opt';
}

export function normalizeQuestion(q) {
  if (!q || typeof q !== 'object') return q;
  const type = String(q.type ?? '').toLowerCase().trim();
  const out = { ...q, type };
  if (type === 'choice') {
    const c = q.criteria;
    if (Array.isArray(c)) {
      const map = {};
      c.forEach((item, i) => {
        if (typeof item === 'string') {
          const id = slug(item) || `opt${i}`;
          map[id] = item;
        } else if (item && typeof item === 'object') {
          const id = String(item.id || slug(item.label || item.text || `opt${i}`));
          map[id] = item.label || item.text || item.rubric || String(id);
        }
      });
      out.criteria = map;
    }
  } else if (type === 'score') {
    const c = q.criteria;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      out.criteria = Object.values(c).map((value) => String(value));
    } else if (Array.isArray(c)) {
      out.criteria = c.map((value) => String(value));
    }
  } else if (type === 'noul' && Array.isArray(q.criteria) && q.criteria.length >= 2) {
    out.criteria = { true: String(q.criteria[0]), false: String(q.criteria[1]) };
  }
  return out;
}

export function repairTargets(nodes, body) {
  const list = nodes ?? [];
  const ids = [];
  const detail = body?.detail;
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const loc = item?.loc ?? [];
      const at = loc.indexOf('questions');
      if (at >= 0 && loc[at + 1] != null) ids.push(String(loc[at + 1]));
    }
  }
  if (!ids.length) return list;
  const want = new Set(ids);
  const hit = list.filter((node) => want.has(node.id));
  return hit.length ? hit : list;
}

function applyNormalize(nodes) {
  for (const node of nodes ?? []) {
    const next = normalizeQuestion(node);
    node.type = next.type;
    node.criteria = next.criteria;
  }
}

function applySpecs(targets, specs) {
  for (let i = 0; i < targets.length; i += 1) {
    const spec = specs?.[i];
    const node = targets[i];
    if (!spec || !node) continue;
    const next = normalizeQuestion({ ...node, ...spec });
    node.type = next.type;
    if (spec.text) {
      node.text = spec.text;
      node.instructions = composeInstructions(node.origin, spec.text);
    }
    if (spec.criteria !== undefined) node.criteria = next.criteria;
  }
}

export async function gateWithRepair({
  nodes,
  ask,
  repair,
  onEvent,
  maxPasses = 2,
} = {}) {
  if (typeof ask !== 'function') throw new Error('gateWithRepair needs ask');
  applyNormalize(nodes);
  let repairs = 0;
  for (;;) {
    try {
      return await ask(nodes);
    } catch (err) {
      if (Number(err.status) !== 422) throw err;
      const detail = formatTypesafeDetail(err.body) || err.message || 'TypeSafe HTTP 422';
      if (!/TypeSafe HTTP 422/i.test(String(err.message))) {
        err.message = `TypeSafe HTTP 422. ${detail}`;
      } else if (detail && !String(err.message).includes(detail)) {
        err.message = `TypeSafe HTTP 422. ${detail}`;
      }
      if (repairs >= maxPasses || typeof repair !== 'function') throw err;
      repairs += 1;
      await onEvent?.({
        phase: 'gate',
        message: `TypeSafe rejected a question. Fixing… ${detail}`,
      });
      const targets = repairTargets(nodes, err.body);
      applySpecs(targets, await repair(targets, detail));
      applyNormalize(nodes);
    }
  }
}
