// What the lead agent of a build is told: the marks, read into words, and how
// to build in the open.
//
// Every mark names the element it is on, so the agent reads the page where
// the person pointed. A piece carries its own markup, because the snapshot is
// the piece (it still works if its source has changed or gone). A comment
// thread rides along as context: a comment can be a question that was already
// answered, or a wish; the lead tells them apart.

import { textOf } from './pieces.js';

const PIECE_HTML_MAX = 14_000;
const PIECE_CSS_MAX = 6_000;
const PIECE_SCRIPT_MAX = 8_000;
const WORDS_NEAR = 70;

const names = (ids) => {
  const list = (ids ?? []).filter(Boolean).map((id) => `#${id}`);
  if (!list.length) return 'nothing in particular';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

/** A few words of what is at an element now, so the brief reads as the page. */
const near = (index, id) => {
  if (!id || !index?.byId) return '';
  const node = index.byId.get(id);
  if (!node) return '';
  const words = textOf(node, WORDS_NEAR);
  return words ? ` ("${words}${words.length >= WORDS_NEAR ? '…' : ''}")` : '';
};

/** One mark, in words. */
export function phraseOf(mark, { index = null, piece = null, imagePath = null } = {}) {
  const on = mark.anchorId ? `#${mark.anchorId}${near(index, mark.anchorId)}` : 'the page';
  if (mark.type === 'note') {
    const head = mark.first
      ? `The prompt the app was made from, on ${on}: "${mark.text}"`
      : mark.text ? `A note on ${on}: "${mark.text}"` : `A note on ${on}, with nothing written on it`;
    const parts = [head];
    const pictures = (mark.images ?? []).map((image) => imagePath?.(image.name)).filter(Boolean);
    if (pictures.length) {
      parts.push(`   Pasted onto the note, ${pictures.length === 1 ? 'a picture' : `${pictures.length} pictures`} (open ${pictures.length === 1 ? 'it' : 'each'} with Read to see what is meant):`);
      for (const file of pictures) parts.push(`   - ${file}`);
    }
    for (const clip of mark.clips ?? []) {
      parts.push(`   Pasted onto the note, a part copied from a page${clip.text ? ` ("${clip.text}")` : ''}:`, '```html', clip.html, '```');
    }
    return parts.join('\n');
  }
  if (mark.type === 'stroke') {
    if (mark.kind === 'box') return `A box sketched around ${names(mark.ids)}`;
    if (mark.kind === 'arrow') return `An arrow sketched from ${mark.from ? `#${mark.from}` : 'nothing'} to ${mark.to ? `#${mark.to}` : 'nothing'}`;
    return `Ink sketched over ${names(mark.ids)}`;
  }
  if (mark.type === 'comment') {
    const lines = (mark.thread ?? []).filter((line) => line.text).map((line) => `${line.who === 'agent' ? 'Agent' : 'Person'}: ${line.text}`);
    return `A comment thread pinned to ${on}:\n${lines.map((line) => `   ${line}`).join('\n')}`;
  }
  if (mark.type === 'piece') {
    const p = mark.piece ?? {};
    const from = p.source?.path ? ` from "${p.source.path}"${p.source.id ? ` (#${p.source.id})` : ''}` : '';
    const head = `A piece placed on ${on}: "${p.title}", a ${String(p.kind || 'part').toLowerCase()}${from}${p.line ? ` — ${p.line}` : ''}. Work it into the app where it was placed, in the app's own look.`;
    if (!piece?.html) return head;
    const parts = [head, '   Its markup, as it was taken:', '```html', piece.html.slice(0, PIECE_HTML_MAX), '```'];
    if (piece.css) parts.push('   The styles it was drawn with (take only what it needs):', '```css', piece.css.slice(0, PIECE_CSS_MAX), '```');
    if (piece.script) parts.push('   The script of the app it came from (take only what it needs):', '```js', piece.script.slice(0, PIECE_SCRIPT_MAX), '```');
    return parts.join('\n');
  }
  return '';
}

/**
 * The lead's prompt for one build.
 *
 * @param {object} input
 * @param {string} input.path       the document
 * @param {number} input.n          which build this is
 * @param {object[]} input.marks    the marks this build takes, in order
 * @param {object[]} [input.context] marks it does not take but should know of (comments)
 * @param {Map<string, object>} [input.pieces] piece snapshots by id
 * @param {object} [input.index]    the document's index (server/agent/source.js)
 * @param {boolean} [input.empty]   the app has nothing in it yet
 * @param {boolean} [input.untitled] the app still has its placeholder name
 */
export function buildBrief({ path, n, marks, context = [], pieces = new Map(), index = null, empty = false, untitled = false, imagePath = null }) {
  const lines = [];
  lines.push(
    empty
      ? `Build mode, build ${n}: make the app in "${path}" from what is marked on it. It is empty: a new app made from a prompt.`
      : `Build mode, build ${n}: change the app in "${path}" the way the marks on it ask.`,
    '',
    'The person marked up the app instead of writing to you. These are the marks this build takes; each names the element it is on. Read those elements first.',
    '',
  );
  marks.forEach((mark, i) => {
    lines.push(`${i + 1}. ${phraseOf(mark, { index, imagePath, piece: mark.type === 'piece' ? pieces.get(mark.piece?.id) : null })}`);
  });
  if (context.length) {
    lines.push('', 'Also on the app, waiting for a later build (do not act on these unless a mark above needs them):');
    for (const mark of context) lines.push(`- ${phraseOf(mark, { index }).split('\n')[0]}`);
  }
  lines.push(
    '',
    'How to build:',
    '- Call build_plan first, before any edit: the parts you will make or change, a few words each, in the order you will do them. '
      + 'Keep it current as you go — a part is "now" while you work on it and "done" once it has landed — by calling build_plan again with every part.',
  );
  if (untitled) {
    lines.push('- The app is still called Untitled. Give build_plan a short `title` for it (two to four words, what it is, e.g. "CHI reviews").');
  }
  lines.push(
    '- If a folder in the drive is plainly where this app belongs (list_documents shows them), give build_plan its path as `folder`. Leave it out when none fits.',
    '- Build in the open: the person is watching the page. Put the plan down first as stubs of the parts to come, drawn with apply_ops marks as "ahead", then fill each part in, coarse to fine, with the part you are on drawn "now". Follow the growing-the-open-page and drawing-the-change skills.',
    '- When the marks fall in separate parts of the app, work the parts with fan_out side by side rather than one after another; check what the workers made before you finish.',
    '- What you make must work: anything a person does in the app (ticking, typing, choosing, adding) changes the page and files the same change with window.marble.op, so it is saved (read_guide "Persistence"). Follow the drive\'s Design System for anything you draw.',
    '- Look things up when the marks need data (the person\'s other documents, their calendar, the web). Say nothing about the marks on the page itself: they are not part of the app.',
    '- When the build is done, reply in one or two plain sentences saying what you built. Ask nothing: the person answers on the app.',
  );
  return lines.join('\n');
}

/** The prompt that resumes a paused build: the same plan, carried on. */
export function resumeBrief({ path, n, plan }) {
  const parts = plan?.parts ?? [];
  const done = parts.filter((part) => part.state === 'done').map((part) => part.title);
  const left = parts.filter((part) => part.state !== 'done').map((part) => part.title);
  return [
    `Build mode: build ${n} of "${path}" was paused, and the person has resumed it. Carry on with the same plan from where you stopped.`,
    done.length ? `Done already: ${done.join('; ')}.` : 'Nothing had landed yet.',
    left.length ? `Still to do: ${left.join('; ')}.` : '',
    'Read the parts you were working on again before you edit them (the page may have changed), keep build_plan current, and reply in one or two sentences when it is done.',
  ].filter(Boolean).join('\n');
}
