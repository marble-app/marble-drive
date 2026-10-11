// The words of a reply that are read aloud (docs/superpowers/specs/
// 2026-10-10-voice-design.md, "What is spoken"). A spoken turn is asked for a
// reply that sounds right aloud; this does not trust that it got one. What a
// page draws (fences, tables, marks, links) would be read out as symbols, and
// a long reply would talk for minutes, so this keeps the sentences, drops the
// markup, and stops near sixty words with a pointer to the rest.
//
// Pure string work: the route runs it on a turn's last `text`, and the test
// runs it on strings.

const MAX_CHARS = 2000;
const REST = 'The rest is in the chat.';
const ON_SCREEN = "It's on the screen.";
const EXT = '(?:mrbl|md|mjs|cjs|js|ts|json|html|css|txt|sh|py|csv|yaml|yml|toml)';
// A path whose segments are Title Case words, as the drive names folders:
// "Notes and Sketches/Agents and Chat/Voice.mrbl". The small words a title
// keeps in lower case are allowed between capitals; any other lower-case word
// ends the path, so "I opened Notes/…" keeps "I opened".
const SPACED_PATH = new RegExp(`(?:[A-Z0-9][\\w'’&-]*(?: (?:and|of|the|a|an|in|on|for|to|&|[A-Z0-9][\\w'’&-]*))*\\/)+([^/\\n]+?)\\.${EXT}\\b`, 'g');
// A path with no spaces: server/agent/runner.js, ./a/b.mrbl, ~/x/y.md.
const PLAIN_PATH = new RegExp(`(?:[~.\\w-]*\\/)+([\\w.-]+?)\\.${EXT}\\b`, 'g');
const BARE_FILE = new RegExp(`^([\\w .'’&-]+)\\.${EXT}$`);

const fileName = (segment) => segment.trim();

/** A code span's words: a path says its file's name, anything else as written. */
function codeSpan(inner) {
  const text = inner.trim();
  const slash = text.lastIndexOf('/');
  if (slash >= 0) {
    const last = text.slice(slash + 1);
    const named = BARE_FILE.exec(last);
    return named ? named[1] : last;
  }
  return text;
}

const ends = (line) => /[.!?:;…]["')\]]?$/.test(line);
const sentence = (line) => (ends(line) ? line : `${line}.`);

function clean(raw) {
  let text = String(raw ?? '').replace(/\r\n?/g, '\n');
  // Fenced blocks of any kind: code, a marble-visual, a diagram.
  text = text.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|$(?![\s\S]))/gm, '\n');
  // Images say nothing; links say their words.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Code spans: a path is its file's name.
  text = text.replace(/`([^`\n]+)`/g, (_, inner) => codeSpan(inner));
  text = text.replace(/<https?:\/\/[^>\s]+>/g, '');
  text = text.replace(/\bhttps?:\/\/[^\s)]+/g, '');
  text = text.replace(SPACED_PATH, (_, name) => fileName(name));
  text = text.replace(PLAIN_PATH, (_, name) => fileName(name));

  const lines = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line) { lines.push(''); continue; }
    // A table row or its rule.
    if (/^\|.*\|$/.test(line) || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line)) { lines.push(''); continue; }
    if (/^(?:[-*_]\s*){3,}$/.test(line)) { lines.push(''); continue; }
    let block = false;
    if (/^#{1,6}\s+/.test(line)) { line = line.replace(/^#{1,6}\s+/, ''); block = true; }
    if (/^>\s?/.test(line)) line = line.replace(/^>\s?/, '');
    if (/^(?:[-*+]|\d{1,3}[.)])\s+/.test(line)) { line = line.replace(/^(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/, ''); block = true; }
    line = line
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
      .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/<[^>\n]+>/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    if (!line) continue;
    lines.push(block ? sentence(line) : line);
  }
  // Paragraphs and lines join as running speech; a paragraph that stopped
  // without a stop gets one, so the voice pauses where the page did.
  const paragraphs = lines.join('\n').split(/\n{2,}/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')).filter(Boolean);
  return paragraphs.map((p, i) => (i < paragraphs.length - 1 && !/[:]$/.test(p) ? sentence(p) : p)).join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Sentences, kept whole, until the next would pass `maxWords`. */
function limit(text, maxWords) {
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  if (words(text) <= maxWords) return { text, cut: false };
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["')\]]?|$)\s*/g) ?? [text];
  let kept = '';
  let count = 0;
  for (const part of parts) {
    const n = words(part);
    if (count + n > maxWords) break;
    kept += part;
    count += n;
  }
  kept = kept.trim();
  if (!kept) kept = sentence(text.split(/\s+/).slice(0, maxWords).join(' ').replace(/[,;:]$/, ''));
  return { text: kept, cut: true };
}

const firstSentence = (text) => {
  const t = clean(text);
  if (!t) return '';
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t);
  return sentence((m ? m[0] : t).trim());
};

const cap = (text) => (text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS - 1).replace(/\s+\S*$/, '')}…`);

/** What to say for a turn: its reply, cleaned and cut; or, for a turn that
 *  failed, stopped or is asking, the line that says so. An ask is never read
 *  out as a question: it is answered by hand, on the screen. */
export function speakable(text, { maxWords = 60, status = 'completed', asked = false } = {}) {
  if (asked) return `It needs your OK. ${ON_SCREEN}`;
  if (status === 'failed') {
    const why = firstSentence(text);
    return cap(why ? `That didn't work. ${why}` : "That didn't work.");
  }
  if (status === 'cancelled' || status === 'interrupted') return 'Stopped.';
  const cleaned = clean(text);
  if (!cleaned) return `Done. ${ON_SCREEN}`;
  const { text: kept, cut } = limit(cleaned, maxWords);
  return cap(cut ? `${kept} ${REST}` : kept);
}
