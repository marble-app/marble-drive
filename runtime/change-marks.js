// The marks: a change, drawn part by part while it happens (v5, Notes and
// Sketches/Ask at Anything, "The marks, from reading to done").
//
// A zone (collab.js) boxes the one element that holds everything an edit
// touched and writes the edit's note on it: it says something is changing
// somewhere in there, not which part, how far along, or what is still to
// come. The host now says all of that in its presence frames (the turn, the
// finest parts each batch changes, the step, a count, a total and the reach
// of a step sent ahead), so this layer draws it where it happens:
//
//   - a light tint on each part the step will touch, shaped to the part and
//     all at once, before any of them changes, so the reach is seen first;
//   - the tint deepens, with a hairline of the accent round it, on the parts
//     landing now, and lifts slowly once they have landed;
//   - past a dozen parts a tint on every row would run together into one
//     block, so each new part gets a dot in the margin instead, and only the
//     parts landing now are tinted;
//   - one tag for the whole change, on the part changing now: what it is
//     doing in the parts' own unit, how many, a meter when the total is
//     known, the steps, and the time. Resting on it opens what was asked and
//     the steps so far; a press opens the conversation. It never says Agent;
//   - a rail at the window's edge for parts out of view, with a pill that
//     takes you to the next one. The page never scrolls by itself.
//
// Done, the tag says what changed in numbers, then every mark goes: nothing
// stays on the page. Everything is transient chrome in one fixed layer;
// nothing here is filed as an op. Only work this tab is following is drawn
// (a chat nobody here follows is a glint, agent-glints.js); an undo is drawn
// as tints, with no tag. Work inside one block of words is the caret's
// (agent-text.js), and a press is collab.js's ring. What this layer draws,
// the zone does not (`claims`).

(() => {
  const TRANSIENT = 'data-marble-transient';
  const MANY = 12;           // parts in one change before the margin takes over
  const LAND_AFTER = 300;    // ms after a batch's ops, when no engine plays them
  const LIFT = 900;          // ms a landed part's tint takes to lift
  const STILL = 150;         // ms, the one crossfade reduced motion keeps
  const GONE = 220;          // ms the marks take to go at the end
  const SHOWN = 2200;        // ms the end's numbers stay up
  const REST = 350;          // ms of rest on the tag before its status opens
  const SPREAD = 380;        // ms a step's reach is spread over as it arrives
  const OUT = 6;             // px the scope's tint stands out past it
  const INSIDE = 8;          // px the tag keeps inside the window
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const SKIP = new Set(['HTML', 'BODY', 'HEAD', 'STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'NOSCRIPT']);

  const STYLE = `
    .marble-change-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482900;
      --change-accent: var(--accent, light-dark(#9bb6cf, #7fa8c9));
      --change-ink: var(--accent-ink, light-dark(#738698, #9dc0dc));
      --change-card: var(--card, var(--paper, light-dark(#fff, #1f2023)));
      --change-text: var(--ink, light-dark(#1d1d1f, #ececee));
      --change-muted: var(--muted, light-dark(#5f6267, #a6a9ae));
      --change-faint: var(--faint, light-dark(#8b8e93, #7e8187));
      --change-line: var(--line, color-mix(in srgb, var(--change-text) 14%, transparent));
      --change-ease: var(--ease-out, ${EASE});
      --change-colour: cubic-bezier(.22, .61, .36, 1);
      --change-inset: 0px;
      font: 500 11.5px/1 var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif)); }
    /* Hide work in the tray hides this too: it is the same work. */
    html.marble-zones-off .marble-change-layer { display: none; }

    /* A tint is a fill, the way a selection is shown: light ahead, deeper
       with a full hairline of the accent while the part lands, and it lifts
       as a fade. Nothing is drawn on one side of anything. */
    .marble-change-tint { position: fixed; left: 0; top: 0; box-sizing: border-box; border-radius: 6px;
      background-color: color-mix(in srgb, var(--change-accent) 13%, transparent);
      transition: background-color 240ms var(--change-colour), box-shadow 240ms var(--change-colour), opacity 220ms var(--change-ease); }
    .marble-change-tint[data-state="now"] { background-color: color-mix(in srgb, var(--change-accent) 22%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--change-ink) 26%, transparent); }
    .marble-change-tint[data-state="lift"] { opacity: 0;
      transition: background-color 240ms var(--change-colour), box-shadow 240ms var(--change-colour), opacity ${LIFT}ms var(--change-ease); }
    .marble-change-tint[data-state="gone"], .marble-change-dot[data-state="gone"], .marble-change-tag[data-state="gone"],
    .marble-change-rail[data-state="gone"], .marble-change-more[data-state="gone"] { opacity: 0; transition: opacity ${GONE}ms var(--change-ease); }
    .marble-change-tint[hidden], .marble-change-dot[hidden] { display: none; }

    /* Too many to mark: a dot in the margin beside each part. Faint ahead, a
       ring while it lands, solid once it has. */
    .marble-change-dot { position: fixed; left: 0; top: 0; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
      background-color: color-mix(in srgb, var(--change-ink) 26%, transparent);
      transition: background-color 240ms var(--change-colour), box-shadow 240ms var(--change-colour), opacity 220ms var(--change-ease); }
    .marble-change-dot[data-state="now"] { background-color: var(--change-card); box-shadow: 0 0 0 1.5px var(--change-ink); }
    .marble-change-dot[data-state="landed"] { background-color: var(--change-ink); }

    /* The tag hangs from the part changing now: its squared corner on the
       part, or across a bordered part's top edge. It moves with the work. */
    .marble-change-tag { position: fixed; left: 0; top: 0; pointer-events: auto; }
    .marble-change-tag[data-glide] { transition: left 400ms var(--change-ease), top 400ms var(--change-ease); }
    .marble-change-press { appearance: none; margin: 0; display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 7px; border: 1px solid color-mix(in srgb, var(--change-ink) 30%, transparent);
      border-radius: 6px 6px 6px 1px; background: color-mix(in srgb, var(--change-ink) 12%, var(--change-card));
      color: color-mix(in srgb, var(--change-ink) 70%, var(--change-text)); font: inherit; letter-spacing: -.005em;
      white-space: nowrap; cursor: pointer; transition: background-color 120ms var(--change-colour); }
    .marble-change-tag[data-edge] .marble-change-press { border-radius: 6px; }
    .marble-change-press:hover { background: color-mix(in srgb, var(--change-ink) 18%, var(--change-card)); }
    .marble-change-press:active { background: color-mix(in srgb, var(--change-ink) 24%, var(--change-card)); }
    .marble-change-press:focus-visible { outline: 2px solid color-mix(in srgb, var(--change-ink) 55%, transparent); outline-offset: 2px; }
    .marble-change-tag-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--change-ink); }
    .marble-change-said:empty { display: none; }
    .marble-change-said b, .marble-change-said-aloud b { font-weight: 650; font-variant-numeric: tabular-nums; color: var(--change-ink); }
    .marble-change-meter { position: relative; flex: none; width: 40px; height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--change-ink) 22%, transparent); }
    .marble-change-meter > i { position: absolute; inset: 0 auto 0 0; width: var(--p, 0%); border-radius: 2px; background: var(--change-ink);
      transition: width 240ms var(--change-ease); }
    .marble-change-steps { display: inline-flex; gap: 3px; }
    .marble-change-steps > i { position: relative; flex: none; width: 12px; height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--change-ink) 22%, transparent); }
    .marble-change-steps > i[data-state="done"] { background: var(--change-ink); }
    .marble-change-steps > i[data-state="now"]::after { content: ""; position: absolute; inset: 0 50% 0 0; background: var(--change-ink); }
    .marble-change-meter[hidden], .marble-change-steps[hidden] { display: none; }
    .marble-change-time { font-weight: 400; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--change-ink) 52%, var(--change-text)); }

    /* Resting on the tag opens the change's status under it, in the page's
       ink: what was asked, whole; how long it has run; its steps so far. */
    .marble-change-status { position: absolute; left: 0; top: calc(100% + 6px); box-sizing: border-box;
      width: max-content; min-width: 13rem; max-width: min(18rem, calc(100vw - ${INSIDE * 2}px));
      padding: 10px 12px 11px; border-radius: 10px; background: var(--change-card); color: var(--change-text);
      box-shadow: 0 0 0 1px var(--change-line), var(--shadow-lift, 0 10px 28px -12px rgba(0, 0, 0, .3));
      font: 400 12px/1.4 var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif));
      white-space: normal; text-wrap: pretty; text-align: left; pointer-events: auto;
      opacity: 0; visibility: hidden; transition: opacity 140ms var(--change-colour), visibility 0s linear 140ms; }
    .marble-change-tag[data-open] .marble-change-status { opacity: 1; visibility: visible; transition: opacity 200ms var(--change-colour), visibility 0s; }
    .marble-change-tag[data-flip] .marble-change-status { top: auto; bottom: calc(100% + 6px); }
    .marble-change-ask { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .marble-change-ask:empty { display: none; }
    .marble-change-status time { display: block; margin-top: 3px; color: var(--change-muted); font-variant-numeric: tabular-nums; }
    .marble-change-steplist { list-style: none; display: grid; gap: 6px; margin: 9px 0 0; padding: 9px 0 0;
      border-top: 1px solid color-mix(in srgb, var(--change-ink) 20%, transparent); }
    .marble-change-steplist:empty { display: none; }
    .marble-change-steplist > li { display: flex; align-items: center; gap: 8px; color: var(--change-faint); }
    .marble-change-steplist .mark { flex: none; box-sizing: border-box; display: grid; place-items: center; width: 10px; height: 10px; border-radius: 50%;
      border: 1.5px solid color-mix(in srgb, var(--change-ink) 32%, transparent); color: var(--change-card); }
    .marble-change-steplist .mark svg { width: 8px; height: 8px; visibility: hidden; }
    .marble-change-steplist > li[data-state="done"] { color: var(--change-muted); }
    .marble-change-steplist > li[data-state="done"] .mark { border-color: var(--change-ink); background: var(--change-ink); }
    .marble-change-steplist > li[data-state="done"] .mark svg { visibility: visible; }
    .marble-change-steplist > li[data-state="now"] { color: var(--change-text); font-weight: 560; }
    .marble-change-steplist > li[data-state="now"] .mark { border-color: var(--change-ink); }
    .marble-change-steplist > li[data-state="more"] { padding-left: 18px; }

    /* Out of view: the rail stands for the whole page, a tick per part at
       its place, and the pill takes you to the next one. */
    .marble-change-rail { position: fixed; right: calc(6px + var(--change-inset)); top: 12px; bottom: 12px; width: 2px; border-radius: 1px;
      background: color-mix(in srgb, var(--change-ink) 14%, transparent); transition: opacity ${GONE}ms var(--change-ease); }
    .marble-change-tick { position: absolute; left: -4px; top: 0; width: 10px; height: 3px; margin-top: -1.5px; border-radius: 2px;
      background: color-mix(in srgb, var(--change-ink) 32%, transparent); }
    .marble-change-tick[data-state="landed"] { background: var(--change-ink); }
    .marble-change-tick[data-state="now"] { left: -6px; width: 14px; height: 4px; margin-top: -2px; background: var(--change-ink); }
    .marble-change-more { position: fixed; right: calc(20px + var(--change-inset)); bottom: 80px; pointer-events: auto; appearance: none; margin: 0;
      display: inline-flex; align-items: center; gap: 4px; padding: 5px 8px 5px 11px; border-radius: 999px;
      border: 1px solid var(--change-line); background: var(--change-card); color: var(--change-text);
      box-shadow: var(--shadow, 0 1px 3px rgba(0, 0, 0, .12)); font: inherit; white-space: nowrap; cursor: pointer;
      transition: background-color 120ms var(--change-colour), opacity ${GONE}ms var(--change-ease); }
    .marble-change-more[data-dir="above"] { bottom: auto; top: 16px; }
    .marble-change-more:hover { background: color-mix(in srgb, var(--change-text) 5%, var(--change-card)); }
    .marble-change-more:active { background: color-mix(in srgb, var(--change-text) 9%, var(--change-card)); }
    .marble-change-more:focus-visible { outline: 2px solid color-mix(in srgb, var(--change-ink) 55%, transparent); outline-offset: 2px; }
    .marble-change-more svg { width: 12px; height: 12px; flex: none; }
    .marble-change-said-aloud { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

    @media (prefers-reduced-motion: reduce) {
      .marble-change-tag[data-glide] { transition: none; }
      .marble-change-tint[data-state="lift"] { transition-duration: ${STILL}ms; }
      .marble-change-meter > i { transition: none; }
    }
  `;

  const CHEVRON = (dir) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'above' ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}"/></svg>`;
  const CHECK = '<svg viewBox="0 0 8 8" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.6 4.2l1.6 1.5 3.2-3.4"/></svg>';

  // The parts' own unit, from what they are. A kind the page cannot tell by
  // its tag names itself (`data-marble-kind="chart"`).
  const UNITS = [
    ['li, tr', 'row', 'rows'],
    ['td, th', 'cell', 'cells'],
    ['p', 'paragraph', 'paragraphs'],
    ['h1, h2, h3, h4, h5, h6', 'heading', 'headings'],
    ['img, picture, figure', 'picture', 'pictures'],
    ['section', 'section', 'sections'],
    ['button', 'button', 'buttons'],
    ['input, select, textarea', 'field', 'fields'],
    ['a', 'link', 'links'],
    ['svg', 'drawing', 'drawings'],
  ];
  function unitOf(el) {
    const kind = el.getAttribute('data-marble-kind')?.trim();
    if (kind) return [kind, `${kind}s`];
    for (const [selector, one, many] of UNITS) if (el.matches(selector)) return [one, many];
    return ['part', 'parts'];
  }

  const list = (value) => (Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : []);
  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // A page with its own conversation UI keeps the zone (collab.js).
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-change-layer')) return;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);
    // The layer itself is not hidden from assistive tech: the tag and the
    // pill are buttons. Each mark that is only a picture says so itself.
    const layer = document.createElement('div');
    layer.className = 'marble-change-layer';
    layer.setAttribute(TRANSIENT, '');
    document.documentElement.append(layer);
    const aloud = document.createElement('div');
    aloud.className = 'marble-change-said-aloud';
    aloud.setAttribute(TRANSIENT, '');
    aloud.setAttribute('role', 'status');
    document.documentElement.append(aloud);

    const byId = (id) => (id ? (marble.byId?.(id) ?? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`)) : null);
    const drawable = (el) => Boolean(el?.isConnected && !SKIP.has(el.tagName) && !el.closest(`[${TRANSIENT}]`));
    const conversationOf = (client) => /^agent(?:-undo)?:(.+)$/.exec(String(client ?? ''))?.[1] ?? null;
    const isUndo = (client) => String(client ?? '').startsWith('agent-undo:');
    // A chat this tab is following: asked from here, or opened to follow.
    // An undo is the person's own verdict, so it is always drawn.
    const attended = (client) => {
      if (isUndo(client)) return true;
      if (!String(client).startsWith('agent:')) return false;
      const id = conversationOf(client);
      return Boolean(id) && (typeof agent.attending !== 'function' || agent.attending(id));
    };
    // Ruling R2: words in one block are the caret's, and its tag is the
    // change's tag. Nothing of this layer is drawn for it meanwhile.
    const inText = (client) => Boolean(window.marbleText?.claims?.(client));
    const still = () => stillness.matches;

    /** The person's hand: focus in the part, or their caret in it. */
    function handIn(el) {
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement
        && !active.closest?.(`[${TRANSIENT}]`) && el.contains(active)) return true;
      const sel = getSelection?.();
      const node = sel?.rangeCount ? sel.anchorNode : null;
      const at = node?.nodeType === 1 ? node : node?.parentElement;
      return Boolean(at?.isContentEditable && el.contains(at));
    }

    // ------------------------------------------------------------ state

    // client -> run. One run is one turn of one chat on this page.
    const runs = new Map();

    function newRun(client, turn) {
      return {
        client,
        turn,
        conversation: conversationOf(client),
        undo: isUndo(client),
        startedAt: performance.now(),
        endedAt: null,
        prompt: '',
        read: new Set(),
        reading: false,
        scope: new Map(),     // id -> { id, state: 'soon'|'lift', el, delay }
        parts: new Map(),     // id -> { id, state: 'soon'|'now'|'landed', lifted, dotted, unit, delay, tint, dot }
        reachKey: '',
        many: false,
        verb: null,
        count: 0,
        total: null,
        step: null,
        steps: new Map(),     // n -> what the note called it
        hang: null,
        hangBox: null,
        tagOn: null,
        tag: null,
        batches: [],
        seen: new Set(),      // the batches whose first frame this page saw
        ending: false,
        gone: false,
        done: null,
        drawn: false,
        timers: new Set(),
      };
    }

    function after(run, ms, fn) {
      const timer = setTimeout(() => {
        run.timers.delete(timer);
        if (runs.get(run.client) === run) fn();
      }, ms);
      run.timers.add(timer);
    }

    function addPart(run, id, state, delay = 0) {
      const part = { id, state, lifted: false, dotted: run.many, unit: null, delay, tint: null, dot: null };
      run.parts.set(id, part);
      return part;
    }

    function liftScope(run) {
      for (const mark of run.scope.values()) {
        if (mark.state === 'lift') continue;
        mark.state = 'lift';
        after(run, GONE, () => { run.scope.delete(mark.id); mark.el?.remove(); render(); });
      }
    }

    function landPart(run, id) {
      const part = run.parts.get(id);
      if (!part || part.state === 'landed') return;
      part.state = 'landed';
      after(run, still() ? STILL : LIFT, () => { part.lifted = true; render(); });
    }

    function land(run, batch, { quiet = false } = {}) {
      if (batch.landed) return;
      batch.landed = true;
      batch.played = true;
      for (const id of batch.parts) landPart(run, id);
      run.batches = run.batches.filter((b) => b !== batch);
      document.dispatchEvent(new CustomEvent('marble-change:landed', { detail: { client: run.client, turn: run.turn, ids: [...batch.parts] } }));
      if (!quiet) render();
    }

    function settleFields(run, d) {
      if (Number.isFinite(d.count) && d.count > 0) run.count = Math.max(run.count, d.count);
      if (Number.isFinite(d.total) && d.total > 0) run.total = d.total;
      if (d.step && Number.isFinite(d.step.n)) {
        run.step = { n: d.step.n, of: Number.isFinite(d.step.of) ? d.step.of : null };
        if (d.step.text) run.steps.set(d.step.n, String(d.step.text));
      }
    }

    // A batch's two frames carry the same count and parts; nothing else
    // names which batch an `after` closes.
    const batchKey = (d) => `${Number.isFinite(d.count) ? d.count : ''}|${list(d.parts).join(',')}`;

    function verbOf(d, parts, inserted) {
      switch (d.kind) {
        case 'words': return 'Rewriting';
        case 'look': return 'Restyling';
        case 'structure': {
          const ins = new Set(inserted);
          const rem = new Set(list(d.removes));
          const moved = list(d.moves).length > 0;
          if (ins.size && !rem.size && !moved && parts.every((id) => ins.has(id))) return 'Adding';
          if (rem.size && !ins.size && !moved && parts.every((id) => rem.has(id))) return 'Removing';
          return 'Changing';
        }
        default: return 'Changing';
      }
    }

    /** The outermost of `ids`: a row and the cells inside it are one part.
     *  Ids not on the page (yet, or any more) are kept as they are. */
    function topmost(ids) {
      if (ids.length > 300) return ids;
      const els = ids.map((id) => [id, byId(id)]);
      return ids.filter((id, i) => {
        const el = els[i][1];
        return !el || !els.some(([other, o]) => other !== id && o && o !== el && o.contains(el));
      });
    }

    function dropPart(run, id) {
      const part = run.parts.get(id);
      if (!part) return;
      part.tint?.remove();
      part.dot?.remove();
      run.parts.delete(id);
    }

    /** The first element among `ids` there is something of on screen, the
     *  nearest the window first. */
    function firstShown(ids) {
      let fallback = null;
      for (const id of ids.slice(0, 400)) {
        const el = byId(id);
        if (!drawable(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.bottom > 0 && r.top < innerHeight) return id;
        fallback ??= id;
      }
      return fallback;
    }

    function onStart(run, d) {
      run.startedAt = performance.now();
      for (const id of list(d.ids)) {
        if (drawable(byId(id))) run.scope.set(id, { id, state: 'soon', el: null, delay: 0 });
      }
      run.hang ??= run.scope.keys().next().value ?? null;
    }

    function onRead(run, d) {
      const ids = list(d.ids);
      for (const id of ids) run.read.add(id);
      if (!run.read.size) return;
      run.reading = true;
      if (!run.hang || !drawable(byId(run.hang))) run.hang = firstShown(ids) ?? run.hang;
    }

    function onBatch(run, d, { landed = false } = {}) {
      run.reading = false;
      settleFields(run, d);
      // The batch's finest parts; a frame that names none falls back to the
      // ids its ops address, and a row is one part with the cells inside it.
      const named = list(d.parts);
      const parts = topmost(named.length ? named : list(d.ids));
      const inserted = (Array.isArray(d.inserts) ? d.inserts : []).flatMap((entry) => list(entry?.ids));
      const reach = list(d.reach);
      // An earlier batch whose ops never came has landed as far as anyone
      // here will see. One still moving lands when its motion ends.
      for (const old of run.batches.filter((b) => !b.played)) land(run, old, { quiet: true });
      const distinct = new Set([...run.parts.keys(), ...parts, ...reach]);
      if (!run.many && Math.max(distinct.size, run.count, run.total ?? 0) > MANY) run.many = true;
      const reachKey = reach.join(',');
      if (reach.length && reachKey !== run.reachKey) {
        run.reachKey = reachKey;
        for (const id of reach) {
          if (!run.parts.has(id)) addPart(run, id, 'soon', still() ? 0 : Math.random() * SPREAD);
        }
      }
      for (const id of parts) {
        const part = run.parts.get(id) ?? addPart(run, id, 'soon');
        part.state = 'now';
        part.lifted = false;
        part.delay = 0;
      }
      if (parts.length) liftScope(run);
      if (d.kind || !run.verb) run.verb = verbOf(d, parts, inserted);
      const hang = parts.find((id) => drawable(byId(id)));
      if (hang) run.hang = hang;
      const key = batchKey(d);
      run.seen.add(key);
      const batch = {
        key, parts, inserted, landed: false, played: false, snapshot: null,
        structure: d.kind === 'structure', named: inserted.length > 0 || list(d.removes).length > 0 || list(d.moves).length > 0,
        fresh: new Set(parts.filter((id) => !byId(id))),
      };
      run.batches.push(batch);
      const morph = window.marbleMorph;
      if (landed) {
        batch.played = true;
        after(run, LAND_AFTER, () => land(run, batch));
      } else if (typeof morph?.capture === 'function') {
        try { batch.snapshot = morph.capture(parts, d); } catch { batch.snapshot = null; }
      }
    }

    function onAfter(run, d) {
      settleFields(run, d);
      const key = batchKey(d);
      if (!run.seen.has(key)) {
        // The batch's first frame went by before this page was listening.
        onBatch(run, d, { landed: true });
        return;
      }
      // Its ops never reached this page: it has landed all the same.
      const batch = run.batches.find((b) => b.key === key && !b.played);
      if (batch) {
        batch.played = true;
        after(run, LAND_AFTER, () => land(run, batch));
      }
    }

    function onOps(detail) {
      const run = runs.get(String(detail?.client ?? ''));
      if (!run || run.ending) return;
      const batch = run.batches.find((b) => !b.played);
      if (!batch) return;
      batch.played = true;
      // What the ops brought in is on the page now: a row and its cells are
      // one part, and parts that were not here before were added.
      const kept = topmost(batch.parts);
      for (const id of batch.parts) if (!kept.includes(id)) dropPart(run, id);
      batch.parts = kept;
      if (batch.structure && !batch.named && kept.length) {
        if (kept.every((id) => batch.fresh.has(id) && byId(id))) run.verb = 'Adding';
        else if (kept.every((id) => !batch.fresh.has(id) && !byId(id))) run.verb = 'Removing';
      }
      if (!run.hang || !drawable(byId(run.hang))) {
        run.hang = [...batch.parts, ...batch.inserted].find((id) => drawable(byId(id))) ?? run.hang;
      }
      const morph = window.marbleMorph;
      if (batch.snapshot && typeof morph?.play === 'function') {
        let played = null;
        try {
          played = morph.play(batch.snapshot, {
            onPart: (id, phase) => { if (phase === 'end' && runs.get(run.client) === run) { landPart(run, id); render(); } },
          });
        } catch { played = null; }
        Promise.resolve(played).then(() => land(run, batch), () => land(run, batch));
      } else {
        after(run, LAND_AFTER, () => land(run, batch));
      }
      render();
    }

    function endWords(done) {
      const counts = [];
      if (done?.changed) counts.push([done.changed, 'changed']);
      if (done?.added) counts.push([done.added, 'added']);
      if (done?.removed) counts.push([done.removed, 'removed']);
      if (done?.status === 'cancelled') return [['Stopped'], ...counts];
      if (done?.status === 'failed') return [['Didn\'t finish'], ...counts];
      return counts.length ? counts : [['Nothing changed']];
    }

    function end(run, done) {
      if (run.ending) return;
      run.ending = true;
      run.done = done;
      run.reading = false;
      run.endedAt = performance.now();
      for (const batch of [...run.batches]) land(run, batch, { quiet: true });
      for (const id of run.parts.keys()) landPart(run, id);
      liftScope(run);
      document.dispatchEvent(new CustomEvent('marble-change:end', { detail: { client: run.client, turn: run.turn, done } }));
      const shown = run.tag && done;
      if (shown) aloud.textContent = endWords(done).map((bit) => bit.join(' ')).join(' · ');
      render();
      // The numbers stay up a moment; then everything goes, and the page is
      // the page.
      after(run, shown ? SHOWN : 0, () => {
        run.gone = true;
        render();
        after(run, GONE, () => forget(run));
      });
    }

    function forget(run, { quiet = false } = {}) {
      for (const timer of run.timers) clearTimeout(timer);
      run.timers.clear();
      for (const mark of run.scope.values()) mark.el?.remove();
      for (const part of run.parts.values()) { part.tint?.remove(); part.dot?.remove(); }
      run.tag?.root.remove();
      run.tag = null;
      if (runs.get(run.client) === run) runs.delete(run.client);
      if (!quiet) render();
    }

    // ------------------------------------------------------------ frames

    function onPresence(detail, { caught = false } = {}) {
      const client = String(detail?.client ?? '');
      if (!/^agent(-undo)?:/.test(client)) return;
      // Unattended: a dot on the element, if the person asked for dots.
      if (!attended(client)) return;
      // A press is one control at one instant: collab.js rings it.
      if (detail.phase === 'acting') return;
      let run = runs.get(client);
      if (detail.stage === 'end') {
        if (run && (!detail.turn || detail.turn === run.turn)) end(run, detail.done ?? null);
        return;
      }
      // A frame without a turn is from before the host said which parts:
      // the zone draws it.
      if (!detail.turn) return;
      if (run && run.turn !== detail.turn) {
        forget(run);
        run = null;
      }
      if (run?.ending) return;
      if (!run) {
        run = newRun(client, String(detail.turn));
        runs.set(client, run);
      }
      if (detail.prompt) run.prompt = String(detail.prompt);
      if (detail.stage === 'start') onStart(run, detail);
      else if (detail.stage === 'before') onBatch(run, detail, { landed: caught });
      else if (detail.stage === 'after') onAfter(run, detail);
      else if (detail.phase === 'reading') onRead(run, detail);
      render();
    }

    // ------------------------------------------------------------ drawing

    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return r.width || r.height ? r : null;
    };
    const page = (r) => ({ left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height });
    const view = (b) => ({ left: b.left - scrollX, top: b.top - scrollY, width: b.width, height: b.height });
    const opaque = (colour) => colour && colour !== 'transparent' && !/rgba?\([^)]*,\s*0\)$/.test(colour) && !/\/\s*0\)$/.test(colour);

    function scopeBox(el) {
      const r = rectOf(el);
      if (!r) return null;
      const radius = getComputedStyle(el).borderRadius || '0px';
      return {
        left: r.left - OUT, top: r.top - OUT, width: r.width + OUT * 2, height: r.height + OUT * 2,
        radius: radius.includes('%') ? radius : radius.replace(/([\d.]+)px/g, (_, n) => `${Number(n) + OUT}px`),
      };
    }

    /** A part with a shape of its own is tinted to its edge and corners;
     *  words have none, so they get a little room round them, as a
     *  highlighter would leave. */
    function partBox(el) {
      const r = rectOf(el);
      if (!r) return null;
      const css = getComputedStyle(el);
      const shaped = parseFloat(css.borderTopWidth) > 0 || parseFloat(css.borderLeftWidth) > 0
        || opaque(css.backgroundColor) || (css.boxShadow && css.boxShadow !== 'none');
      if (shaped) return { left: r.left, top: r.top, width: r.width, height: r.height, radius: css.borderRadius || '0px' };
      const words = window.marbleText?.textBlockOf?.(el) === el;
      if (!words) {
        const radius = parseFloat(css.borderTopLeftRadius) > 0 ? css.borderRadius : '4px';
        return { left: r.left, top: r.top, width: r.width, height: r.height, radius };
      }
      // Rows sit edge to edge; room above and below would wash into the next.
      const y = /^(list-item|table)/.test(css.display) ? 0 : 3;
      return { left: r.left - 6, top: r.top - y, width: r.width + 12, height: r.height + y * 2, radius: '6px' };
    }

    function fadeIn(el, delay = 0) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: still() ? STILL : 340, delay: still() ? 0 : delay, easing: EASE, fill: 'backwards',
      });
    }

    function placeBox(el, box) {
      Object.assign(el.style, {
        left: `${Math.round(box.left)}px`, top: `${Math.round(box.top)}px`,
        width: `${Math.round(box.width)}px`, height: `${Math.round(box.height)}px`, borderRadius: box.radius,
      });
    }

    /** One tint: made when it is first wanted, kept in place, and taken off
     *  when it is no longer wanted. A part that has gone keeps its tint
     *  where it last stood while that lifts. */
    function paintTint(holder, key, state, measure) {
      const el = byId(holder.id);
      const live = drawable(el) ? measure(el) : null;
      if (live) holder.box = { ...page(live), radius: live.radius };
      const box = live ?? (holder.box && holder[key] ? { ...view(holder.box), radius: holder.box.radius } : null);
      // Lifting and going are what a tint already there does; nothing is
      // made just to fade.
      const leaving = state === 'lift' || state === 'gone';
      if (!state || !box || (leaving && !holder[key])) {
        holder[key]?.remove();
        holder[key] = null;
        return false;
      }
      let tint = holder[key];
      if (!tint) {
        tint = document.createElement('i');
        tint.className = 'marble-change-tint';
        tint.setAttribute(TRANSIENT, '');
        tint.setAttribute('aria-hidden', 'true');
        tint.dataset.id = holder.id;
        tint.dataset.state = state;
        holder[key] = tint;
        placeBox(tint, box);
        layer.append(tint);
        fadeIn(tint, holder.delay ?? 0);
      }
      if (tint.dataset.state !== state) tint.dataset.state = state;
      placeBox(tint, box);
      tint.hidden = Boolean(live && handIn(el));
      return true;
    }

    function paintDot(part, state) {
      const el = byId(part.id);
      const r = drawable(el) ? rectOf(el) : null;
      if (!state || (!r && !part.dot)) {
        part.dot?.remove();
        part.dot = null;
        return false;
      }
      let dot = part.dot;
      if (!dot && state === 'gone') return false;
      if (!dot) {
        dot = document.createElement('i');
        dot.className = 'marble-change-dot';
        dot.setAttribute(TRANSIENT, '');
        dot.setAttribute('aria-hidden', 'true');
        dot.dataset.id = part.id;
        part.dot = dot;
        layer.append(dot);
        fadeIn(dot);
      }
      if (dot.dataset.state !== state) dot.dataset.state = state;
      if (r) {
        dot.style.left = `${Math.round(Math.max(6, r.left - 10))}px`;
        dot.style.top = `${Math.round(r.top + Math.min(r.height / 2, 11))}px`;
        dot.hidden = handIn(el);
      }
      return true;
    }

    // ------------------------------------------------------------ the tag

    function openConversation(run) {
      const id = run.conversation;
      if (!id) return;
      // A callout on this page for the same chat gets first refusal.
      const offer = new CustomEvent('marble-callout:open', { cancelable: true, detail: { id } });
      if (!document.dispatchEvent(offer)) return;
      agent.open?.(id);
    }

    function makeTag(run) {
      const root = document.createElement('div');
      root.className = 'marble-change-tag';
      root.setAttribute(TRANSIENT, '');
      root.dataset.client = run.client;
      const press = document.createElement('button');
      press.type = 'button';
      press.className = 'marble-change-press';
      const dot = document.createElement('span');
      dot.className = 'marble-change-tag-dot';
      dot.setAttribute('aria-hidden', 'true');
      const said = document.createElement('span');
      said.className = 'marble-change-said';
      const meter = document.createElement('span');
      meter.className = 'marble-change-meter';
      meter.setAttribute('aria-hidden', 'true');
      meter.append(document.createElement('i'));
      const steps = document.createElement('span');
      steps.className = 'marble-change-steps';
      steps.setAttribute('aria-hidden', 'true');
      const time = document.createElement('time');
      time.className = 'marble-change-time';
      press.append(dot, said, meter, steps, time);
      const status = document.createElement('div');
      status.className = 'marble-change-status';
      status.id = `marble-change-status-${Math.random().toString(36).slice(2, 9)}`;
      const ask = document.createElement('p');
      ask.className = 'marble-change-ask';
      const ran = document.createElement('time');
      const steplist = document.createElement('ol');
      steplist.className = 'marble-change-steplist';
      status.append(ask, ran, steplist);
      press.setAttribute('aria-describedby', status.id);
      root.append(press, status);

      const tag = { root, press, said, meter, steps, time, status, ask, ran, steplist, rest: 0, at: null, over: false };
      const open = () => { root.toggleAttribute('data-open', true); fillStatus(run, tag); placeStatus(tag); };
      const close = () => { if (!tag.over && !root.contains(document.activeElement)) root.removeAttribute('data-open'); };
      root.addEventListener('pointerenter', (event) => {
        tag.over = true;
        tag.at = { x: event.clientX, y: event.clientY };
        clearTimeout(tag.rest);
        tag.rest = setTimeout(open, REST);
      });
      root.addEventListener('pointermove', (event) => {
        if (root.hasAttribute('data-open') || !tag.at) return;
        if (Math.hypot(event.clientX - tag.at.x, event.clientY - tag.at.y) < 4) return;
        tag.at = { x: event.clientX, y: event.clientY };
        clearTimeout(tag.rest);
        tag.rest = setTimeout(open, REST);
      });
      root.addEventListener('pointerleave', () => { tag.over = false; clearTimeout(tag.rest); close(); });
      press.addEventListener('focus', open);
      press.addEventListener('blur', () => setTimeout(close, 0));
      press.addEventListener('click', () => openConversation(run));
      layer.append(root);
      root.animate(still()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: still() ? STILL : 200, easing: EASE });
      return tag;
    }

    function unitWords(run) {
      const units = new Set();
      for (const part of run.parts.values()) {
        if (!part.unit) {
          const el = byId(part.id);
          if (drawable(el)) part.unit = unitOf(el);
        }
        if (part.unit) units.add(part.unit.join('|'));
      }
      return units.size === 1 ? [...units][0].split('|') : ['part', 'parts'];
    }

    /** What the tag says, as pieces: words, and numbers to set in figures. */
    function tagWords(run) {
      if (run.ending) return run.done ? endWords(run.done) : [];
      if (run.reading) return [['Reading'], [run.read.size, run.read.size === 1 ? 'part' : 'parts']];
      if (!run.verb) return [];
      const n = run.count || [...run.parts.values()].filter((p) => p.state !== 'soon').length;
      const [one, many] = unitWords(run);
      const howMany = run.total ?? n;
      return run.total
        ? [[run.verb], [n, `of ${run.total} ${howMany === 1 ? one : many}`]]
        : [[run.verb], [n, n === 1 ? one : many]];
    }

    // The verb and its count read as one phrase; the end's tallies, a list.
    const VERBS = new Set(['Rewriting', 'Restyling', 'Changing', 'Adding', 'Removing', 'Reading']);
    const isCount = (pieces) => pieces.length === 2 && VERBS.has(pieces[0][0]) && typeof pieces[1][0] === 'number';

    function writeSaid(node, pieces) {
      const phrase = isCount(pieces);
      const key = JSON.stringify(pieces);
      if (node.dataset.key === key) return;
      node.dataset.key = key;
      node.replaceChildren();
      pieces.forEach((bit, i) => {
        if (i > 0) node.append(phrase ? ' ' : ' · ');
        bit.forEach((word, j) => {
          if (j > 0) node.append(' ');
          if (typeof word === 'number') {
            const b = document.createElement('b');
            b.textContent = String(word);
            node.append(b);
          } else node.append(word);
        });
      });
    }

    function elapsed(run) {
      return clock((run.endedAt ?? performance.now()) - run.startedAt);
    }

    function fillTag(run, tag) {
      const pieces = tagWords(run);
      writeSaid(tag.said, pieces);
      const time = elapsed(run);
      if (tag.time.textContent !== time) tag.time.textContent = time;
      const metered = Boolean(run.total) && !run.ending && !run.reading && Boolean(run.verb);
      tag.meter.hidden = !metered;
      if (metered) tag.meter.firstChild.style.setProperty('--p', `${Math.round(Math.min(1, (run.count || 0) / run.total) * 100)}%`);
      const of = run.step?.of && run.step.of <= 12 ? run.step.of : 0;
      tag.steps.hidden = !of;
      if (of) {
        while (tag.steps.children.length < of) tag.steps.append(document.createElement('i'));
        while (tag.steps.children.length > of) tag.steps.lastChild.remove();
        [...tag.steps.children].forEach((tile, i) => {
          const n = i + 1;
          const state = n < run.step.n || (run.ending && n === run.step.n && run.done?.status === 'completed') ? 'done' : n === run.step.n ? 'now' : '';
          if ((tile.dataset.state ?? '') !== state) {
            if (state) tile.dataset.state = state;
            else delete tile.dataset.state;
          }
        });
      }
      // The time is left out of the name: a focused button whose name changed
      // every second would be read out every second.
      const words = tag.said.textContent;
      const name = `${words ? `${words}. ` : ''}Open the conversation`;
      if (tag.press.getAttribute('aria-label') !== name) tag.press.setAttribute('aria-label', name);
      if (tag.root.hasAttribute('data-open')) fillStatus(run, tag);
    }

    function fillStatus(run, tag) {
      if (tag.ask.textContent !== run.prompt) tag.ask.textContent = run.prompt;
      tag.ran.textContent = elapsed(run);
      const current = run.step?.n ?? null;
      const named = [...run.steps.entries()].sort((a, b) => a[0] - b[0]);
      const rows = named.map(([n, text]) => {
        const state = current === null ? '' : n < current || (run.ending && run.done?.status === 'completed') ? 'done' : n === current ? 'now' : '';
        return { state, text: text.charAt(0).toUpperCase() + text.slice(1) };
      });
      const last = named.at(-1)?.[0] ?? 0;
      const more = run.step?.of && run.step.of > last ? run.step.of - last : 0;
      if (more && named.length) rows.push({ state: 'more', text: `and ${more} more` });
      const key = JSON.stringify(rows);
      if (tag.steplist.dataset.key === key) return;
      tag.steplist.dataset.key = key;
      tag.steplist.replaceChildren(...rows.map(({ state, text }) => {
        const li = document.createElement('li');
        if (state) li.dataset.state = state;
        if (state !== 'more') {
          const mark = document.createElement('span');
          mark.className = 'mark';
          mark.setAttribute('aria-hidden', 'true');
          mark.innerHTML = CHECK;
          li.append(mark);
        }
        li.append(text);
        return li;
      }));
    }

    function placeStatus(tag) {
      tag.root.removeAttribute('data-flip');
      const r = tag.status.getBoundingClientRect();
      if (r.bottom > innerHeight - INSIDE) tag.root.toggleAttribute('data-flip', true);
      const left = tag.root.getBoundingClientRect().left;
      const over = left + tag.status.offsetWidth - (innerWidth - INSIDE);
      tag.status.style.left = over > 0 ? `${-Math.round(over)}px` : '0px';
    }

    /** Where the tag hangs: the part changing now, else the last place it
     *  hung while that part has gone. */
    function hangBox(run) {
      let el = byId(run.hang);
      if (!drawable(el) || !rectOf(el)) {
        // The part it hung from has gone: the newest part that has changed,
        // else any still to come.
        const shown = (part) => drawable(byId(part.id)) && rectOf(byId(part.id));
        const parts = [...run.parts.values()].reverse();
        const other = parts.find((part) => part.state !== 'soon' && shown(part)) ?? parts.find(shown);
        if (other) { run.hang = other.id; el = byId(other.id); } else el = null;
      }
      if (el) {
        const r = rectOf(el);
        const edged = parseFloat(getComputedStyle(el).borderTopWidth) > 0;
        const part = run.parts.get(run.hang);
        const tint = part?.tint && !part.tint.hidden ? part.tint : run.scope.get(run.hang)?.el ?? null;
        const box = tint ? tint.getBoundingClientRect() : null;
        run.hangBox = { ...page(r), edged, tint: box ? page(box) : null };
      }
      if (!run.hangBox) return null;
      const b = run.hangBox;
      return { ...view(b), edged: b.edged, tint: b.tint ? view(b.tint) : null };
    }

    function placeTag(run, tag, at) {
      const w = tag.press.offsetWidth;
      const h = tag.press.offsetHeight;
      let x;
      let y;
      if (at.edged) {
        // Across the part's top edge, near its start: over neither its words
        // nor its neighbours'.
        x = at.left + 16;
        y = at.top - h / 2;
      } else if (at.tint) {
        // Resting on the top of the words' tint.
        x = at.tint.left;
        y = at.tint.top + 3 - h;
      } else {
        x = at.left;
        y = at.top - 2 - h;
      }
      x = Math.max(INSIDE, Math.min(x, innerWidth - INSIDE - w));
      y = Math.max(INSIDE, Math.min(y, innerHeight - INSIDE - h));
      tag.root.toggleAttribute('data-edge', at.edged);
      if (run.tagOn !== run.hang && run.tagOn !== null && !still()) {
        tag.root.toggleAttribute('data-glide', true);
        clearTimeout(tag.glide);
        tag.glide = setTimeout(() => tag.root.removeAttribute('data-glide'), 420);
      }
      run.tagOn = run.hang;
      tag.root.style.left = `${Math.round(x)}px`;
      tag.root.style.top = `${Math.round(y)}px`;
    }

    function paintTag(run, hidden) {
      const at = !run.undo && !hidden ? hangBox(run) : null;
      if (!at) {
        run.tag?.root.remove();
        run.tag = null;
        return false;
      }
      run.tag ??= makeTag(run);
      const tag = run.tag;
      fillTag(run, tag);
      placeTag(run, tag, at);
      if (run.gone) tag.root.dataset.state = 'gone';
      return true;
    }

    // ------------------------------------------------------------ the rail

    let rail = null;
    let more = null;
    function paintRail(entries) {
      const below = [];
      const above = [];
      const ticks = [];
      const height = Math.max(1, document.documentElement.scrollHeight);
      for (const { el, state } of entries) {
        const r = rectOf(el);
        if (!r) continue;
        if (r.top >= innerHeight) below.push({ el, r });
        else if (r.bottom <= 0) above.push({ el, r });
        ticks.push({ y: (r.top + scrollY) / height, state });
      }
      if (!below.length && !above.length) {
        rail?.remove();
        more?.remove();
        rail = null;
        more = null;
        return;
      }
      if (!rail) {
        rail = document.createElement('div');
        rail.className = 'marble-change-rail';
        rail.setAttribute(TRANSIENT, '');
        rail.setAttribute('aria-hidden', 'true');
        layer.append(rail);
      }
      while (rail.children.length < ticks.length) {
        const tick = document.createElement('i');
        tick.className = 'marble-change-tick';
        rail.append(tick);
      }
      while (rail.children.length > ticks.length) rail.lastChild.remove();
      ticks.forEach(({ y, state }, i) => {
        const tick = rail.children[i];
        tick.style.top = `${(Math.min(1, Math.max(0, y)) * 100).toFixed(2)}%`;
        if (tick.dataset.state !== state) tick.dataset.state = state;
      });
      if (!more) {
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'marble-change-more';
        more.setAttribute(TRANSIENT, '');
        more.addEventListener('click', () => {
          const target = more.target;
          if (target?.isConnected) target.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
        });
        layer.append(more);
      }
      const dir = below.length ? 'below' : 'above';
      const out = dir === 'below' ? below : above;
      const next = dir === 'below'
        ? out.reduce((a, b) => (b.r.top < a.r.top ? b : a))
        : out.reduce((a, b) => (b.r.bottom > a.r.bottom ? b : a));
      more.target = next.el;
      const label = `${out.length} ${dir}`;
      if (more.dataset.label !== label) {
        more.dataset.label = label;
        more.dataset.dir = dir;
        more.innerHTML = `<span>${label}</span>${CHEVRON(dir)}`;
        more.setAttribute('aria-label', `${label}: show the next one`);
      }
      const gone = entries.length && entries.every((e) => e.gone);
      if (gone) { rail.dataset.state = 'gone'; more.dataset.state = 'gone'; } else { delete rail.dataset.state; delete more.dataset.state; }
    }

    // ------------------------------------------------------------ painting

    let claimKey = '';
    let ticking = 0;

    function paintRun(run) {
      const hidden = inText(run.client);
      let drawn = false;
      for (const mark of run.scope.values()) {
        const state = hidden ? null : run.gone ? 'gone' : mark.state;
        drawn = paintTint(mark, 'el', state, scopeBox) || drawn;
      }
      const entries = [];
      for (const part of run.parts.values()) {
        let tint = null;
        if (!hidden) {
          if (part.state === 'now') tint = 'now';
          else if (part.state === 'soon' && !part.dotted) tint = 'soon';
          else if (part.state === 'landed' && !part.lifted) tint = 'lift';
          if (run.gone && tint) tint = 'gone';
        }
        drawn = paintTint(part, 'tint', tint, partBox) || drawn;
        const dot = hidden || !part.dotted ? null : run.gone ? 'gone' : part.state;
        drawn = paintDot(part, dot) || drawn;
        if (!hidden) {
          const el = byId(part.id);
          if (drawable(el)) entries.push({ el, state: part.state, gone: run.gone });
        }
      }
      drawn = paintTag(run, hidden) || drawn;
      run.drawn = drawn;
      return entries;
    }

    function render() {
      const inset = Math.max(0, document.documentElement.clientWidth - document.documentElement.getBoundingClientRect().right);
      layer.style.setProperty('--change-inset', `${Math.round(inset)}px`);
      const entries = [];
      for (const run of [...runs.values()]) {
        // An undo has no end frame: it is over once all it marked has lifted.
        if (run.undo && !run.batches.length && [...run.parts.values()].every((p) => p.state === 'landed' && p.lifted)) {
          forget(run, { quiet: true });
          continue;
        }
        entries.push(...paintRun(run));
      }
      paintRail(entries);
      const tagged = [...runs.values()].some((run) => run.tag);
      if (tagged && !ticking) ticking = setInterval(tick, 1000);
      if (!tagged && ticking) { clearInterval(ticking); ticking = 0; }
      const key = [...runs.values()].filter((run) => claims(run.client)).map((run) => run.client).sort().join('\n');
      if (key !== claimKey) {
        claimKey = key;
        dispatchEvent(new CustomEvent('marble-change:claims'));
      }
    }

    function tick() {
      for (const run of runs.values()) if (run.tag) fillTag(run, run.tag);
    }

    let frame = 0;
    const schedule = () => { if (!frame && runs.size) frame = requestAnimationFrame(() => { frame = 0; render(); }); };
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('selectionchange', schedule);
    new MutationObserver((records) => {
      if (runs.size && records.some(({ target }) => !layer.contains(target) && target !== aloud)) schedule();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });

    function claims(client) {
      const run = runs.get(String(client ?? ''));
      return Boolean(run && run.drawn && !inText(run.client));
    }

    // ------------------------------------------------------------ listening

    // Capture, so the run is known before the zone (collab.js) asks whether
    // it is claimed; the caret (agent-text.js) answers its own claim after,
    // and says so with `marble-text:claims`.
    document.addEventListener('marble:presence', ({ detail }) => onPresence(detail), true);
    document.addEventListener('marble:ops', ({ detail }) => onOps(detail), true);
    addEventListener('marble-text:claims', () => render());

    // A presence frame is broadcast once, to whoever was listening; a tab
    // that opens mid-change asks for the frames that are standing.
    function catchUp(only = null) {
      fetch(`/presence?app=${encodeURIComponent(marble.app)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          for (const frame of body?.frames ?? []) {
            const client = String(frame?.client ?? '');
            // An undo's frames are history by the time anyone asks.
            if (!client.startsWith('agent:') || !frame.turn || runs.has(client)) continue;
            if (only && client !== `agent:${only}`) continue;
            onPresence(frame, { caught: true });
          }
        })
        .catch(() => {
          // No standing change is the same answer as a host that cannot say.
        });
    }
    catchUp();
    // A chat followed from here mid-change (Follow on its glint) is drawn
    // from where it is.
    addEventListener('marble:attending', (event) => { if (event.detail?.id) catchUp(event.detail.id); });

    // An end frame missed while the stream was away: the chat's summary says
    // it is no longer working, the host confirms the turn is over, and the
    // marks go. (A summary can arrive late, after the next turn has begun.)
    agent.on?.('*', (summary) => {
      if (!summary?.id || summary.running || summary.queued) return;
      const run = runs.get(`agent:${summary.id}`);
      if (!run || run.ending) return;
      setTimeout(async () => {
        if (runs.get(run.client) !== run || run.ending) return;
        try {
          const detail = await agent.conversation(summary.id, { turns: 1 });
          const turn = (detail?.turns ?? []).find((t) => t.id === run.turn);
          if (turn && (turn.status === 'running' || turn.status === 'queued')) return;
        } catch {
          return;
        }
        if (runs.get(run.client) === run && !run.ending) end(run, null);
      }, 1500);
    });

    window.marbleChange = {
      claims,
      runs: () => [...runs.values()].filter((run) => claims(run.client))
        .map(({ client, turn, count, total }) => ({ client, turn, count, total })),
      tintFor(id) {
        for (const run of runs.values()) {
          if (!claims(run.client)) continue;
          const part = run.parts.get(String(id));
          if (part && (part.state === 'soon' || part.state === 'now') && (part.tint || part.dot)) return part.state;
          const scope = run.scope.get(String(id));
          if (scope?.el && scope.state === 'soon') return 'soon';
        }
        return null;
      },
    };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
