// A build's summary: when a build ends, the drawer is asked once more, with
// everything the build is known by (what it was asked, its parts, what it
// changed, the comments it answered, the questions asked while it ran, what
// it said at the end), for the card a person reads to catch up on a build
// they did not watch. How it is drawn is the drawing-progress skill's "When a
// build is done: its summary"; this file only says what happened.
//
// Pure, so test/build.test.js can run it without a drawer.

const clip = (text, n) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const PARTS_MAX = 16;
const CHANGES_MAX = 24;
const READS_MAX = 8;
const DRAWN_MAX = 8_000;

/** A mark in a line: what the person wrote, or what they drew. */
export function wordsOf(mark) {
  if (!mark) return '';
  if (mark.type === 'comment') return clip((mark.thread ?? []).filter((line) => line.who !== 'agent').map((line) => line.text).filter(Boolean).join(' / '), 300);
  if (mark.type === 'piece') return clip(`a piece put in${mark.piece?.name ? `: ${mark.piece.name}` : ''}${mark.text ? `, with "${mark.text}"` : ''}`, 300);
  if (mark.type === 'stroke') return clip(`${mark.kind === 'arrow' ? 'an arrow drawn' : mark.kind === 'box' ? 'a box drawn' : 'a sketch'}${mark.text ? `: "${mark.text}"` : ''}`, 300);
  if (mark.type === 'move') return 'a part dragged to a new place';
  return clip(mark.text, 300);
}

/** The questions asked on the app while the build ran, each with its answer:
 *  comment threads where the person said something and the agent answered,
 *  in words, between the build's start and its end. */
export function questionsOf(marks, { from = 0, to = Date.now() } = {}) {
  const out = [];
  for (const mark of marks ?? []) {
    if (mark.type !== 'comment') continue;
    const thread = mark.thread ?? [];
    for (let i = 0; i < thread.length; i += 1) {
      const line = thread[i];
      if (line.who === 'agent' || !line.text) continue;
      const answer = thread.slice(i + 1).find((x) => x.who === 'agent' && x.text && !x.pending);
      if (!answer || !(answer.at >= from && answer.at <= to)) continue;
      // "Making this now" and "Done in Build 3" say a change was made, which
      // the build's own parts already tell.
      if (/^(Making this now|Done in Build \d+)\.?$/.test(answer.text.trim())) continue;
      out.push({ q: clip(line.text, 240), a: clip(answer.text, 320) });
    }
  }
  return out.slice(0, 8);
}

/** The prompt for a build's summary. */
export function summaryPrompt({ build, marks = [], now = Date.now() }) {
  const b = build;
  const taken = marks.filter((m) => m.build === b.id || (b.marks ?? []).includes(m.id));
  const parts = (b.plan?.parts ?? []).slice(0, PARTS_MAX);
  const log = b.log ?? [];
  const changes = log.filter((step) => step.kind === 'change').slice(-CHANGES_MAX);
  const reads = log.filter((step) => step.kind !== 'change');
  const settled = (b.plan?.settled ?? []).map(({ id, said }) => ({ mark: marks.find((m) => m.id === id), said })).filter((x) => x.mark);
  const questions = questionsOf(marks, { from: b.startedAt ?? 0, to: b.endedAt ?? now });
  const minutes = Math.max(1, Math.round(((b.endedAt ?? now) - (b.startedAt ?? now)) / 60_000));
  const how = b.status === 'finished' ? 'finished' : b.status === 'failed' ? `did not finish (${clip(b.error, 160) || 'it stopped with an error'})` : b.status;
  const lines = [
    `Draw the summary of a build that has ended: build ${b.n}${b.title ? `, "${clip(b.title, 80)}"` : ''}. It ${how} after ${minutes} min.`,
    '',
    'What the person asked for, as marks on the app:',
    ...(taken.length ? taken.map((m, i) => `${i + 1}. ${m.type === 'comment' ? 'Comment' : m.type === 'note' ? 'Note' : 'Mark'}: ${wordsOf(m) || '(no words)'}`) : ['(no marks were kept with it)']),
    '',
    'Its parts:',
    ...(parts.length ? parts.map((p) => `- ${p.title}${p.detail ? ` (${clip(p.detail, 120)})` : ''}: ${p.state === 'done' ? 'made' : p.state === 'now' ? 'being made when it ended' : 'not made'}`) : ['(it gave no plan)']),
    '',
    'What it changed on the app, in order:',
    ...(changes.length ? changes.map((step) => `- ${clip(step.head, 200)}${step.failed ? ' (failed)' : ''}`) : ['(no changes were logged)']),
  ];
  if (reads.length) {
    lines.push('', `What it read or looked up (${reads.length}):`, ...reads.slice(-READS_MAX).map((step) => `- ${clip(step.head, 140)}${step.lines?.[0] ? `: ${clip(step.lines[0], 140)}` : ''}`));
  }
  if (settled.length) {
    // Mostly changes asked for in a comment: what they became is New or
    // Changed, not a question.
    lines.push('', 'Comments it settled (changes asked for, so New or Changed, not Asked):', ...settled.map(({ mark, said }) => `- "${wordsOf(mark)}" → ${clip(said, 300) || 'done'}`));
  }
  lines.push('', ...(questions.length
    ? ['Questions asked on the app while it ran, with their answers (these are Asked):', ...questions.map(({ q, a }) => `- Q: ${q}\n  A: ${a}`)]
    : ['No questions were asked on the app while it ran: leave Asked out.']));
  if (b.said) lines.push('', 'What it said when it ended:', clip(b.said, 400));
  if (b.drawn?.html) {
    lines.push('', 'Its last drawing of the work (keep its picture of the result if it fits; the summary replaces it):', '"""', String(b.drawn.html).slice(0, DRAWN_MAX), '"""');
  }
  lines.push('', 'Answer with the summary widget\'s HTML. Every name and number in it must be in what is above.');
  return lines.join('\n');
}
