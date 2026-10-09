// What a build did, step by step, kept with the build: what it read, what it
// searched for, and what it changed, each under the stage of its plan that was
// being made at the time. The page shows them in three layers (build-mode.js):
// the build's picture, then its stages, then a stage's steps.
//
// Pure, so test/build.test.js can run it without a turn.

const READS = new Set(['read_document', 'list_documents', 'Read', 'Grep', 'Glob', 'WebSearch', 'web_search', 'WebFetch']);
const CHANGES = new Set(['apply_ops', 'fan_out', 'create_document', 'Write', 'Edit', 'MultiEdit']);
export const LOG_MAX = 120;

const clip = (text, n) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const docName = (p) => String(p ?? '').replace(/\.mrbl$/, '');
const tail = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? '';

/** One tool call, in the words a person would use, or null for one that is
 *  not worth a line (planning calls, messages to other agents). */
export function stepOf(name, input = {}, { app = '' } = {}) {
  const short = String(name ?? '').split('__').pop();
  if (READS.has(short)) {
    switch (short) {
      case 'read_document': {
        const p = docName(input.path);
        return { kind: 'read', head: p === app ? 'Read this app' : `Read ${tail(p) || 'a document'}`, path: p };
      }
      case 'list_documents': return { kind: 'look', head: 'Looked through your drive', path: input.folder || '' };
      case 'Read': return { kind: 'read', head: `Read ${tail(input.file_path) || 'a file'}`, path: String(input.file_path ?? '') };
      case 'Grep': return { kind: 'search', head: `Searched for "${clip(input.pattern, 40)}"`, path: String(input.path ?? input.glob ?? '') };
      case 'Glob': return { kind: 'search', head: `Looked for ${clip(input.pattern, 40)}`, path: String(input.path ?? '') };
      case 'WebSearch':
      case 'web_search': return { kind: 'search', head: `Searched the web for "${clip(input.query ?? input.search_term, 48)}"`, path: '' };
      case 'WebFetch': {
        let host = '';
        try { host = new URL(input.url).host; } catch { host = clip(input.url, 40); }
        return { kind: 'read', head: `Read ${host}`, path: clip(input.url, 120) };
      }
      default: return null;
    }
  }
  if (CHANGES.has(short)) {
    if (short === 'apply_ops' || short === 'fan_out') {
      // The note the change was made with says what it did, in its own words;
      // the "Stage 2 of 4:" it may start with is the plan's, said already.
      const bare = String(input.note ?? '').replace(/^stage\s+\d+\s+of\s+\d+\s*[:·-]\s*/i, '').trim();
      const said = clip(bare.charAt(0).toUpperCase() + bare.slice(1), 160);
      const count = Array.isArray(input.ops) ? input.ops.length : Array.isArray(input.shards) ? input.shards.length : 0;
      if (!said && !count) return null;
      const what = short === 'fan_out' ? `${count} part${count === 1 ? '' : 's'} at once` : `${count} change${count === 1 ? '' : 's'}`;
      // The parts it touched, so a hand over the step can light them.
      const ids = [...new Set([
        ...(Array.isArray(input.ops) ? input.ops.map((op) => op?.id ?? op?.parentId) : []),
        ...(Array.isArray(input.shards) ? input.shards.flatMap((shard) => shard?.ids ?? []) : []),
      ].filter((id) => typeof id === 'string' && id))].slice(0, 40);
      return { kind: 'change', head: said || 'Changed the app', path: count ? what : '', ids };
    }
    if (short === 'create_document') return { kind: 'change', head: `Made ${tail(docName(input.path)) || 'a document'}`, path: docName(input.path) };
    return { kind: 'change', head: `Changed ${tail(input.file_path) || 'a file'}`, path: String(input.file_path ?? '') };
  }
  return null;
}

/** What a step found, as up to three plain lines: no markdown, no JSON, no
 *  line numbers or file prefixes. */
export function linesOf(summary) {
  const text = String(summary ?? '').trim();
  if (!text || /^[[{]/.test(text)) return [];
  return text.split('\n')
    .map((line) => line
      .replace(/^\s*\d+[:→-]\s?/, '')
      .replace(/^[^:]{1,80}\.mrbl:\d+:/, '')
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s+)/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .trim())
    .filter((line) => line.length > 2 && !/^[[{]/.test(line) && !/^(links|web search results for query)\b/i.test(line))
    .slice(0, 3)
    .map((line) => clip(line, 140));
}

/** The plan's part being made now, by title, or null while it is planning. */
export function partNow(plan) {
  const parts = plan?.parts ?? [];
  return (parts.find((p) => p.state === 'now') ?? null)?.title ?? null;
}
