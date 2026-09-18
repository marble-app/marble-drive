// TypeSafe System One over HTTP. The SDK is a convenience; this repo already
// speaks fetch, and a document-hosted test should not take a new dependency
// for one POST.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export function formatTypesafeDetail(body) {
  if (!body || typeof body !== 'object') return '';
  const detail = body.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        const loc = (item?.loc ?? []).filter((part) => part !== 'body' && part !== 'questions');
        const path = loc.map(String).join('.');
        const msg = item?.msg || item?.message || '';
        if (path && msg) return `${path}: ${msg}`;
        return msg || path;
      })
      .filter(Boolean)
      .join('; ');
  }
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  if (typeof body.message === 'string' && body.message.trim() && !/^TypeSafe HTTP /i.test(body.message)) {
    return body.message.trim();
  }
  return '';
}

export function explainTypesafeFailure(err) {
  const status = Number(err?.status);
  const message = String(err?.message ?? err ?? 'TypeSafe request failed');
  const cause = err?.cause?.code || err?.code;
  if (status === 422) {
    const detail = formatTypesafeDetail(err.body) || message.replace(/^TypeSafe HTTP 422\.?\s*/i, '');
    return {
      kind: 'invalid',
      title: 'TypeSafe rejected a question.',
      message: detail || 'A question failed validation.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'unauthorized',
      title: "Can't access TypeSafe.",
      message: 'The API key was rejected.',
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limit',
      title: 'TypeSafe rate limit.',
      message: 'The account is out of requests for this window.',
    };
  }
  if (status === 529) {
    return {
      kind: 'overloaded',
      title: 'TypeSafe is overloaded.',
      message: 'TypeSafe is temporarily overloaded. Try again in a moment.',
    };
  }
  if (status === 503 && /TYPESAFE_API_KEY/.test(message)) {
    return {
      kind: 'no_key',
      title: "Can't access TypeSafe.",
      message: 'TYPESAFE_API_KEY is not set. Put it in .env.local and restart the host.',
    };
  }
  if (
    cause === 'ENOTFOUND' ||
    cause === 'ECONNREFUSED' ||
    cause === 'ETIMEDOUT' ||
    /fetch failed|network|ECONNREFUSED|ENOTFOUND/i.test(message)
  ) {
    return {
      kind: 'unreachable',
      title: "Can't reach TypeSafe.",
      message: 'The TypeSafe API did not respond.',
    };
  }
  return {
    kind: 'failed',
    title: 'TypeSafe API failed.',
    message,
    status: Number.isFinite(status) ? status : undefined,
  };
}

export function explainLlmFailure(err) {
  const message = String(err?.message ?? '');
  if (/cursor-agent is not installed/.test(message)) {
    return {
      kind: 'llm_missing',
      title: "Can't reach Grok.",
      message: 'cursor-agent is not installed on this machine.',
    };
  }
  if (/timed out/.test(message)) {
    return { kind: 'llm_timeout', title: 'Grok timed out.', message };
  }
  if (err?.status === 502 || /cursor-agent exited/.test(message) || /did not return/.test(message)) {
    return { kind: 'llm_failed', title: 'Grok failed.', message: message || 'The model did not return a usable question.' };
  }
  return null;
}

export function explainRunFailure(err) {
  if (err?.code === 'CANCELLED') {
    return { kind: 'cancelled', title: 'Stopped.', message: 'The run was cancelled.' };
  }
  if (err?.status === 503 && /TYPESAFE_API_KEY/.test(String(err?.message ?? ''))) {
    return explainTypesafeFailure(err);
  }
  return explainLlmFailure(err) || explainTypesafeFailure(err);
}

export function questionsFromNodes(nodes) {
  return Object.fromEntries(
    (nodes ?? []).map((node) => [
      node.id,
      {
        type: node.type,
        instructions: node.instructions,
        ...(node.criteria != null ? { criteria: node.criteria } : {}),
      },
    ]),
  );
}

export async function askSystemOne({
  apiKey,
  state,
  questions,
  model = 'jev-latest',
  signal,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    const err = new Error('TYPESAFE_API_KEY is not set. Put it in .env.local and restart the host.');
    err.status = 503;
    throw err;
  }
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, model, questions }),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      const cancelled = new Error('cancelled');
      cancelled.status = 499;
      cancelled.code = 'CANCELLED';
      throw cancelled;
    }
    throw err;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = formatTypesafeDetail(body);
    const err = new Error(detail || body.error || body.message || `TypeSafe HTTP ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}
