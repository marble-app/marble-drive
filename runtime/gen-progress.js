// The page taking shape while an agent builds it.
//
// A page an agent is writing should not sit blank, or show a spinner, while
// the work happens somewhere else. Three things say what is happening, each
// driven by what the turn is really doing, never by a timer:
//
//   The line.      One line at the foot of the window says what the agent is
//                  doing now ("Reading document", "Laying out sections",
//                  "Styling", "Checking layout"), from each tool call the
//                  turn makes (the conversation's own stream, marble.agent.on)
//                  and, where that stream is not heard, from the page's
//                  presence frames. Its words shimmer while it works; a new
//                  step's words take the old one's place, and the line's width
//                  follows. At the end it says Done with a check, then goes.
//   The outline.   Sections the agent says are coming (`outline` on
//                  apply_ops, server/change/outline.js) are drawn where they
//                  will go, as soft placeholder blocks shaped like a header,
//                  cards, rows. Each insert into that place takes the next
//                  block's room; the page's height runs from what it was to
//                  what it is, so nothing below it jumps.
//   The reveal.    What an agent puts in rises into place: its parts one
//                  after another, from a short way down and a little out of
//                  focus. The engine (change-morph.js) still decides when each
//                  part moves; it asks `marbleGen.reveal` how to bring in what
//                  arrived while this module has a run for that change.
//
// Every clock, curve and distance is a custom property on :root (--gen-*),
// so they are tuned in one place. With reduced motion nothing shimmers,
// slides or blurs: the line changes its words, the outline is still, and what
// arrives is the engine's one crossfade. Hide work in the chat's tray hides
// all of it, as it hides the marks.
//
// Nothing here is ever filed as an op. The outline is transient chrome in
// the addressed tree (the carrier steps over it); the line is in its own
// shadow root.

(() => {
  if (window.marbleGen) return;

  const TRANSIENT = 'data-marble-transient';
  const ID = 'data-marble-id';
  const TAG = 'marble-gen';
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => stillness.matches;
  const zonesOff = () => document.documentElement.classList.contains('marble-zones-off');

  // The one place every timing lives. A page may set any of these itself.
  const TOKENS = `
    :root {
      --gen-ease: ${EASE};
      --gen-shimmer-dur: 2000ms;      /* the highlight crossing the line's words */
      --gen-swap-dur: 150ms;          /* one step's words leaving, the next arriving */
      --gen-swap-ease: ease-in-out;
      --gen-swap-rise: 4px;
      --gen-swap-blur: 2px;
      --gen-width-dur: 300ms;         /* the line's width following its words */
      --gen-label-hold: 600ms;        /* the least a step's words stay up */
      --gen-skeleton-dur: 3000ms;     /* the wash crossing a placeholder */
      --gen-reveal-dur: 500ms;        /* what arrives rising into place */
      --gen-reveal-stagger: 40ms;     /* between one part of it and the next */
      --gen-reveal-rise: 8px;
      --gen-reveal-blur: 3px;
      --gen-grow-dur: 300ms;          /* the page's height following what landed */
      --gen-check-dur: 550ms;         /* the check drawing in */
      --gen-done-hold: 1200ms;        /* Done staying up */
      --gen-quiet-hold: 2600ms;       /* Stopped, or Didn't finish, staying up */
      --gen-fade-dur: 300ms;          /* the line, or what is left of the outline, going */
      --gen-text: light-dark(#7c7c7c, #8e8e8e);
      --gen-text-hi: light-dark(#1d1d1f, #f4f4f5);
      --gen-bone: light-dark(rgba(0, 0, 0, .055), rgba(255, 255, 255, .07));
      --gen-wash: light-dark(rgba(0, 0, 0, .05), rgba(255, 255, 255, .06));
    }

    /* The outline: blocks shaped like what is coming. Nothing of the page's
       own styles reaches in, and it takes no pointer. */
    .marble-gen-skel, .marble-gen-skel * { all: unset; box-sizing: border-box; }
    .marble-gen-skel { display: flow-root; pointer-events: none; user-select: none; margin: 0; padding: 0; }
    .marble-gen-skel[data-leaving] { opacity: 0; transition: opacity var(--gen-fade-dur) var(--gen-ease); }
    .marble-gen-block { display: flex; flex-direction: column; gap: 10px; margin: 20px 0; }
    .marble-gen-block[data-shape="cards"] { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); gap: 12px; }
    .marble-gen-block[data-shape="rows"] { gap: 6px; }
    .marble-gen-block[data-shape="form"] { gap: 8px; max-width: 420px; }
    .marble-gen-bone { display: block; position: relative; overflow: hidden; height: 10px; border-radius: 5px; background: var(--gen-bone); }
    .marble-gen-bone[data-k="title"] { height: 24px; width: 46%; border-radius: 6px; }
    .marble-gen-bone[data-k="sub"] { width: 30%; }
    .marble-gen-bone[data-k="line"]:nth-child(2) { width: 94%; }
    .marble-gen-bone[data-k="line"]:nth-child(3) { width: 62%; }
    .marble-gen-bone[data-k="card"] { height: 120px; border-radius: 12px; }
    .marble-gen-bone[data-k="row"] { height: 40px; border-radius: 8px; }
    .marble-gen-bone[data-k="media"] { height: auto; aspect-ratio: 16 / 9; max-height: 260px; border-radius: 12px; }
    .marble-gen-bone[data-k="label"] { width: 22%; margin-top: 6px; }
    .marble-gen-bone[data-k="field"] { height: 36px; border-radius: 8px; }
    .marble-gen-bone[data-k="button"] { height: 34px; width: 104px; border-radius: 8px; margin-top: 6px; }
    /* The wash: a soft band, masked to a diagonal, crossing each bone from
       its far corner to its near one. */
    .marble-gen-bone::after { content: ""; position: absolute; inset: 0; background: var(--gen-wash);
      -webkit-mask-image: linear-gradient(135deg, transparent 0%, transparent 40%, #000 50%, transparent 60%, transparent 100%);
      mask-image: linear-gradient(135deg, transparent 0%, transparent 40%, #000 50%, transparent 60%, transparent 100%);
      -webkit-mask-size: 280% 280%; mask-size: 280% 280%;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      animation: marble-gen-wash var(--gen-skeleton-dur) var(--gen-ease) infinite;
      animation-delay: calc(var(--i, 0) * 90ms); }
    @keyframes marble-gen-wash {
      from { -webkit-mask-position: 100% 100%; mask-position: 100% 100%; }
      to { -webkit-mask-position: 0% 0%; mask-position: 0% 0%; }
    }
    html.marble-zones-off .marble-gen-skel, html.marble-zones-off marble-gen-line { display: none !important; }
    @media (prefers-reduced-motion: reduce) {
      .marble-gen-bone::after { animation: none; opacity: 0; }
      .marble-gen-skel[data-leaving] { transition: none; }
    }
  `;

  // The line: its own shadow root, so a page's styles never reach it. Glass,
  // because it floats over the page; one layer, and opaque when the person
  // asks for less transparency.
  const LINE = `
    /* The page's scheme still holds in here: light-dark() follows it. */
    :host { all: initial; color-scheme: inherit; }
    .line { position: fixed; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom, 0px)); z-index: 2147482950;
      display: inline-flex; align-items: center; height: 30px; padding: 0 13px; box-sizing: border-box; max-width: calc(100vw - 32px);
      border-radius: 999px; pointer-events: none; white-space: nowrap;
      font: 500 12.5px/1 var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif)); letter-spacing: -.005em;
      color: var(--gen-text, #7c7c7c);
      background: color-mix(in srgb, var(--card, var(--paper, light-dark(#fff, #1f2023))) 82%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
      box-shadow: 0 0 0 1px var(--line, light-dark(rgba(0, 0, 0, .09), rgba(255, 255, 255, .1))), 0 4px 14px light-dark(rgba(0, 0, 0, .07), rgba(0, 0, 0, .3));
      transform: translateX(-50%); opacity: 1;
      transition: opacity var(--gen-fade-dur, 300ms) var(--gen-ease), transform var(--gen-fade-dur, 300ms) var(--gen-ease); }
    .line[hidden] { display: none; }
    .line[data-away] { opacity: 0; transform: translate(-50%, 4px); }

    .label { position: relative; display: inline-block; height: 16px; line-height: 16px; overflow: visible;
      transition: width var(--gen-width-dur, 300ms) var(--gen-ease); }
    .line[data-instant] .label, .line[data-instant] .tick { transition: none; }
    .text { position: relative; display: inline-block; white-space: nowrap; }
    /* The shimmer: a copy of the words, transparent but for a highlight band
       that sweeps across them. */
    .text::before { content: attr(data-text); position: absolute; inset: 0; color: transparent; pointer-events: none;
      background-image: linear-gradient(90deg, transparent 0%, transparent 40%, var(--gen-text-hi, #1d1d1f) 50%, transparent 60%, transparent 100%);
      background-size: 400% 100%; background-repeat: no-repeat;
      -webkit-background-clip: text; background-clip: text;
      animation: shimmer var(--gen-shimmer-dur, 2000ms) linear infinite; }
    @keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0% 0; } }
    .line:not([data-state="working"]) .text::before { animation: none; opacity: 0; }
    .line[data-state="done"] .text, .line[data-state="quiet"] .text { color: var(--ink, light-dark(#1d1d1f, #ececee)); }

    /* One step's words leaving downward, the next arriving from above. */
    .text[data-state="out"] { position: absolute; left: 0; top: 0;
      animation: out var(--gen-swap-dur, 150ms) var(--gen-swap-ease, ease-in-out) forwards; }
    .text[data-state="in"] {
      animation: in var(--gen-swap-dur, 150ms) var(--gen-swap-ease, ease-in-out) both;
      animation-delay: calc(var(--gen-swap-dur, 150ms) * .5); }
    @keyframes out { to { transform: translateY(var(--gen-swap-rise, 4px)); filter: blur(var(--gen-swap-blur, 2px)); opacity: 0; } }
    @keyframes in { from { transform: translateY(calc(var(--gen-swap-rise, 4px) * -1)); filter: blur(var(--gen-swap-blur, 2px)); opacity: 0; } }

    /* The check: no room at all until the turn is done, then it opens and
       draws itself in. */
    .tick { display: inline-block; width: 0; height: 14px; overflow: hidden; flex: none;
      transition: width var(--gen-width-dur, 300ms) var(--gen-ease); }
    .line[data-state="done"] .tick { width: 20px; }
    .tick svg { display: block; width: 14px; height: 14px; overflow: visible; fill: none; stroke: currentColor; stroke-width: 1.6;
      stroke-linecap: round; stroke-linejoin: round; color: var(--ink, light-dark(#1d1d1f, #ececee)); opacity: 0; }
    .tick path { stroke-dasharray: 1; stroke-dashoffset: 1; }
    .line[data-state="done"] .tick svg { animation: settle var(--gen-check-dur, 550ms) var(--gen-ease) forwards; }
    .line[data-state="done"] .tick path { animation: draw var(--gen-check-dur, 550ms) var(--gen-ease) forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes settle { from { opacity: 0; filter: blur(1.5px); } to { opacity: 1; filter: blur(0); } }

    @media (prefers-reduced-motion: reduce) {
      .line, .label, .tick { transition: none; }
      .text::before { animation: none; opacity: 0; }
      .text[data-state="out"] { display: none; }
      .text[data-state="in"] { animation: none; }
      .line[data-state="done"] .tick svg, .line[data-state="done"] .tick path { animation: none; opacity: 1; stroke-dashoffset: 0; }
    }
    @media (prefers-reduced-transparency: reduce) {
      .line { background: var(--card, var(--paper, light-dark(#fff, #1f2023))); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
  `;

  // ------------------------------------------------------------ small things

  const byId = (id) => (id ? (window.marble?.byId?.(id) ?? document.querySelector(`[${ID}="${CSS.escape(String(id))}"]`)) : null);
  const list = (value) => (Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : []);
  const convOf = (client) => (String(client ?? '').startsWith('agent:') ? String(client).slice('agent:'.length) : null);
  const toolOf = (name) => String(name ?? '').split('__').pop();
  const docKey = (p) => String(p ?? '').replace(/^\/+/, '').replace(/\.mrbl$/i, '');
  const docName = (p) => docKey(p).split('/').pop() || 'the document';
  const BLOCKY = new Set(['HTML', 'BODY', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'BR', 'WBR']);

  const css = () => getComputedStyle(document.documentElement);
  /** A clock from :root, in ms. */
  const clock = (name, fallback) => {
    const m = /^(-?[\d.]+)(ms|s)?$/.exec(css().getPropertyValue(name).trim());
    return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : fallback;
  };
  const token = (name, fallback) => css().getPropertyValue(name).trim() || fallback;
  const heightOf = (el) => el.getBoundingClientRect().height;
  const animateAs = (el, keyframes, timing) => {
    const a = el.animate(keyframes, timing);
    a.id = TAG;
    return a;
  };
  const cancelOwn = (el) => { for (const a of el.getAnimations()) if (a.id === TAG) a.cancel(); };

  // ------------------------------------------------------------ the words
  //
  // A step in a few plain words: what the agent is doing to this page, or
  // the page it is reading. Short, so the line stays one glance.

  function labelOfOps(input, here) {
    if (input.path && !here(input.path)) return `Updating ${docName(input.path)}`;
    const ops = Array.isArray(input.ops) ? input.ops : [];
    if (!ops.length) return input.outline ? 'Laying out sections' : 'Planning the change';
    const types = new Set(ops.map((op) => op?.type));
    if (types.has('insert')) return 'Laying out sections';
    const look = (op) => (op?.type === 'setAttr' && /^(style|class)$/.test(op.name))
      || (op?.type === 'setInner' && byId(op.id)?.tagName === 'STYLE');
    if (ops.every(look)) return 'Styling';
    if (ops.every((op) => op?.type === 'setText')) return 'Writing';
    if (types.size === 1 && types.has('remove')) return 'Tidying up';
    if (types.size === 1 && types.has('move')) return 'Rearranging';
    return 'Updating the page';
  }

  function labelOfCall(name, input = {}, here = () => true) {
    const tool = toolOf(name);
    switch (tool) {
      case 'read_document':
      case 'read_affordances':
        return !input.path || here(input.path) ? 'Reading document' : `Reading ${docName(input.path)}`;
      case 'list_documents': return 'Looking through the drive';
      case 'read_guide':
      case 'Skill':
        return 'Reading the guide';
      case 'create_document': return 'Creating the page';
      case 'apply_ops': return labelOfOps(input, here);
      case 'fan_out': return input.path && !here(input.path) ? `Updating ${docName(input.path)}` : 'Writing each part';
      case 'check_document': return 'Checking the document';
      case 'act': return 'Trying it out';
      case 'Read': case 'read': case 'Grep': case 'Glob': case 'LS': case 'ToolSearch':
        return 'Reading files';
      case 'Write': case 'Edit': case 'MultiEdit':
        return 'Writing';
      case 'TodoWrite': return 'Planning';
      case 'Agent': case 'Task': return 'Handing off a part';
      case 'WebSearch': case 'WebFetch': return 'Searching the web';
      case 'AskUserQuestion': return 'Waiting for you';
      default:
    }
    if (/^browser_/.test(tool)) return 'Checking layout';
    if (/^(Bash|Shell|shell)$/.test(tool)) {
      const said = String(input.description ?? input.command ?? '');
      return /\b(test|tests|check|verify|screenshot|render|lint|smoke)\b/i.test(said) ? 'Checking' : 'Working';
    }
    return globalThis.marbleAgentWords?.plainStep?.(tool, input)?.say ?? 'Working';
  }

  /** The words a presence frame says, for a run whose steps are not heard
   *  (or a frame that says more than its step did: the start). */
  function labelOfFrame(d) {
    if (d.stage === 'start') return 'Starting';
    if (d.phase === 'reading') return 'Reading document';
    if (d.stage === 'mark') return d.outline ? 'Laying out sections' : 'Planning the change';
    if (d.stage === 'before') {
      if (d.kind === 'structure' && list(d.removes).length === 0 && (d.inserts ?? []).length) return 'Laying out sections';
      if (d.kind === 'look') return 'Styling';
      if (d.kind === 'words') return 'Writing';
      return 'Updating the page';
    }
    return null;
  }

  // ------------------------------------------------------------ the line

  function makeLine() {
    const host = document.createElement('marble-gen-line');
    host.setAttribute(TRANSIENT, '');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${LINE}</style><div class="line" role="status" aria-live="polite" hidden data-state="working">`
      + '<span class="tick" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.4 8.6 6.5 11.6 12.6 4.6" pathLength="1"/></svg></span>'
      + '<span class="label"></span></div>';
    const line = root.querySelector('.line');
    const label = root.querySelector('.label');
    let said = '';
    let at = 0;
    let wait = null;
    let away = null;

    const mount = () => { if (!host.isConnected) document.documentElement.append(host); };

    function swap(text) {
      const old = [...label.children].find((el) => el.dataset.state !== 'out');
      if (old?.dataset.text === text) return;
      const next = document.createElement('span');
      next.className = 'text';
      next.dataset.text = text;
      next.textContent = text;
      const from = label.getBoundingClientRect().width;
      for (const gone of label.querySelectorAll('[data-state="out"]')) gone.remove();
      if (old) {
        if (still()) old.remove();
        else {
          old.dataset.state = 'out';
          old.addEventListener('animationend', () => old.remove(), { once: true });
          setTimeout(() => old.remove(), clock('--gen-swap-dur', 150) + 200);
        }
      }
      if (old && !still()) next.dataset.state = 'in';
      label.append(next);
      const to = next.getBoundingClientRect().width;
      // The width runs from the old words' to the new; the first words, or
      // a line that was not up, just take theirs.
      if (!old || line.hidden) {
        line.setAttribute('data-instant', '');
        label.style.width = `${to}px`;
        void label.offsetWidth;
        line.removeAttribute('data-instant');
      } else {
        label.style.width = `${from}px`;
        void label.offsetWidth;
        label.style.width = `${to}px`;
      }
      said = text;
      at = performance.now();
    }

    /** The words of the step the agent is on. A step's words stay up a
     *  moment, so a run of quick calls reads as steps and not as flicker;
     *  only the newest waiting words are said. */
    function say(text, state = 'working') {
      if (!text) return;
      clearTimeout(away);
      away = null;
      mount();
      const wasHidden = line.hidden || line.hasAttribute('data-away');
      line.dataset.state = state;
      if (wasHidden) {
        line.hidden = false;
        line.removeAttribute('data-away');
        if (!still()) animateAs(line, [{ opacity: 0, transform: 'translate(-50%, 4px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: clock('--gen-fade-dur', 300), easing: EASE });
      }
      clearTimeout(wait);
      const hold = clock('--gen-label-hold', 600) - (performance.now() - at);
      if (state !== 'working' || wasHidden || hold <= 0 || still()) swap(text);
      else wait = setTimeout(() => swap(text), hold);
    }

    /** The end: Done with its check, or a plain word for a stop. Then the
     *  line goes. */
    function finish(text, state) {
      clearTimeout(wait);
      say(text, state);
      const hold = state === 'done' ? clock('--gen-done-hold', 1200) + clock('--gen-check-dur', 550) : clock('--gen-quiet-hold', 2600);
      away = setTimeout(hide, hold);
    }

    function hide() {
      clearTimeout(wait);
      clearTimeout(away);
      away = null;
      if (line.hidden) return;
      if (still()) { line.hidden = true; return; }
      line.setAttribute('data-away', '');
      setTimeout(() => {
        if (!line.hasAttribute('data-away')) return;
        line.hidden = true;
        line.removeAttribute('data-away');
        label.replaceChildren();
        label.style.width = '';
        said = '';
      }, clock('--gen-fade-dur', 300) + 40);
    }

    return { say, finish, hide, get said() { return said; }, get up() { return !line.hidden && !line.hasAttribute('data-away'); }, el: line };
  }

  // ------------------------------------------------------------ the outline

  const SHAPES = {
    header: () => [['title'], ['sub']],
    text: () => [['line'], ['line'], ['line']],
    cards: (n) => Array.from({ length: n ?? 3 }, () => ['card']),
    rows: (n) => Array.from({ length: n ?? 4 }, () => ['row']),
    media: () => [['media']],
    form: () => [['label'], ['field'], ['label'], ['field'], ['button']],
  };

  function blockOf(block, from) {
    const el = document.createElement('div');
    el.className = 'marble-gen-block';
    el.dataset.shape = block.shape;
    let i = from;
    for (const [k] of (SHAPES[block.shape] ?? SHAPES.text)(block.count)) {
      const bone = document.createElement('i');
      bone.className = 'marble-gen-bone';
      bone.dataset.k = k;
      bone.style.setProperty('--i', String(i++));
      el.append(bone);
    }
    return el;
  }

  function skeletonOf(outline) {
    const el = document.createElement('div');
    el.className = 'marble-gen-skel';
    el.setAttribute(TRANSIENT, '');
    el.setAttribute('aria-hidden', 'true');
    let i = 0;
    const blocks = outline.blocks.map((block) => {
      const made = blockOf(block, i);
      i += made.childElementCount;
      el.append(made);
      return made;
    });
    return { el, blocks, parentId: outline.parentId, beforeId: outline.beforeId ?? null, landed: 0, key: keyOfOutline(outline) };
  }
  const keyOfOutline = (o) => JSON.stringify([o.parentId, o.beforeId ?? null, o.blocks]);

  /** Whether nothing the file holds comes after `el` among its siblings. */
  const lastKept = (el) => {
    for (let next = el.nextElementSibling; next; next = next.nextElementSibling) if (!next.hasAttribute(TRANSIENT)) return false;
    return true;
  };
  /** The next sibling the file holds. */
  const nextKept = (el) => {
    let next = el.nextElementSibling;
    while (next?.hasAttribute(TRANSIENT)) next = next.nextElementSibling;
    return next;
  };

  /** The outline stands just before where its sections go: what lands
   *  there lands above it, and what is still to come stays below. Moved only
   *  when it is not already there, so its wash runs on. */
  function place(skel) {
    const parent = byId(skel.parentId);
    if (!parent) { skel.el.remove(); return; }
    let before = skel.beforeId ? byId(skel.beforeId) : null;
    if (before && before.parentElement !== parent) before = null;
    const there = skel.el.parentElement === parent && (before ? nextKept(skel.el) === before : lastKept(skel.el));
    if (!there) parent.insertBefore(skel.el, before);
  }

  // ------------------------------------------------------------ boot

  const api = {
    /** How what arrived comes in, while a run is drawing this change;
     *  null leaves it to the engine. */
    reveal: () => null,
    /** Whether a run of this conversation is drawn here (the island in
     *  agent-work.js steps aside for it). */
    speaks: () => false,
  };
  window.marbleGen = api;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // A page with its own conversation UI shows its own progress.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('marble-gen-line')) return;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = TOKENS;
    document.head.append(style);

    const line = makeLine();
    const here = (p) => docKey(p) === docKey(marble.app);
    const attended = (client) => {
      const id = convOf(client);
      return Boolean(id) && (typeof agent.attending !== 'function' || agent.attending(id));
    };
    // A Build mode build says its line in Describe's bar.
    const built = (conv) => Boolean(window.marbleBuild?.buildConversations?.()?.has?.(conv));

    const runs = new Map(); // client -> run
    const spoke = new Set(); // conversations whose line this page has said
    let speaker = null; // the run the line is saying
    const changed = () => dispatchEvent(new CustomEvent('marble-gen:change'));

    function newRun(client, turn) {
      const run = {
        client, turn, conv: convOf(client), heard: false, ending: false, label: null,
        skel: null, pendingLanded: null, grow: null, last: performance.now(), off: null,
      };
      return run;
    }

    /** Every step of the turn from here on, as the conversation's own
     *  stream says it: from the conversation's last event, not its top. */
    async function follow(run) {
      let after = 0;
      try { after = Number((await agent.conversation(run.conv, { turns: 0 }))?.seq) || 0; } catch { after = 0; }
      if (runs.get(run.client) !== run || run.ending) return;
      run.off = agent.on(run.conv, (event) => onEvent(run, event), { after });
    }

    function say(run, text) {
      if (!text || run.ending) return;
      run.label = text;
      run.last = performance.now();
      if (built(run.conv)) return;
      speaker = run;
      if (!spoke.has(run.conv)) { spoke.add(run.conv); changed(); }
      line.say(text);
    }

    function onEvent(run, event) {
      if (runs.get(run.client) !== run || run.ending) return;
      if (event?.turn && event.turn !== run.turn) return;
      if (event?.type === 'tool.call') {
        run.heard = true;
        say(run, labelOfCall(event.name, event.input ?? {}, here));
      } else if (event?.type === 'ask') {
        run.heard = true;
        say(run, 'Waiting for you');
      } else if (event?.type === 'ask.resolved' || event?.type === 'ask.void') {
        if (run.label === 'Waiting for you') say(run, 'Working');
      } else if (/^turn\.(completed|failed|cancelled)$/.test(event?.type ?? '')) {
        end(run, { status: event.type.slice('turn.'.length), changed: event.applied ?? 0 });
      }
    }

    // ---------------------------------------------------------- frames

    function onPresence(d, { caught = false } = {}) {
      const client = String(d?.client ?? '');
      if (!client.startsWith('agent:') || d.phase === 'acting') return;
      let run = runs.get(client);
      if (d.stage === 'end') {
        if (run && (!d.turn || d.turn === run.turn)) end(run, d.done ?? null);
        return;
      }
      if (!d.turn || !attended(client)) return;
      if (run && run.turn !== d.turn) { forget(run); run = null; }
      if (run?.ending) return;
      if (!run) {
        run = newRun(client, String(d.turn));
        runs.set(client, run);
        follow(run);
      }
      run.last = performance.now();
      if (d.outline) outline(run, d.outline, { now: caught || d.stage !== 'before' });
      if (d.stage === 'before') measure(run, d);
      // The steps the stream says are the better words; a frame speaks for
      // itself only where they are not heard, and the start always does.
      const words = labelOfFrame(d);
      if (words && (!run.heard || d.stage === 'start') && !(d.stage === 'start' && run.label)) say(run, words);
    }

    /** The outline a frame carries: drawn if it is new, placed, and given
     *  up block by block as the host counts its sections landed. A count
     *  said ahead of its batch (`before`) waits for the batch's ops. */
    function outline(run, o, { now }) {
      if (!o?.parentId || !Array.isArray(o.blocks) || !o.blocks.length) return;
      const key = keyOfOutline(o);
      const landed = Math.max(0, Math.min(o.blocks.length, Number(o.landed) || 0));
      // An outline whose sections have all landed is not drawn again by
      // the frames that go on repeating it.
      if (run.skel?.key !== key && landed >= o.blocks.length) return;
      if (run.skel?.key !== key) {
        if (run.skel) leave(run.skel);
        run.skel = skeletonOf(o);
      }
      place(run.skel);
      if (now) landTo(run, landed);
      else run.pendingLanded = landed;
    }

    function landTo(run, n, { keep = false } = {}) {
      const skel = run.skel;
      if (!skel || n <= skel.landed) return;
      for (let i = skel.landed; i < n; i += 1) skel.blocks[i]?.remove();
      skel.landed = n;
      // All of it landed: the empty outline stays a moment as the room the
      // page closes (the ops below), unless nothing is about to.
      if (skel.landed >= skel.blocks.length) {
        run.skel = null;
        if (!keep) skel.el.remove();
      }
    }

    /** What is left of an outline, going: it fades, and the room it took
     *  closes on the page's own clock. */
    function leave(skel) {
      const el = skel.el;
      if (!el.isConnected || still()) { el.remove(); return; }
      el.setAttribute('data-leaving', '');
      const fade = clock('--gen-fade-dur', 300);
      setTimeout(() => {
        if (!el.isConnected) return;
        const h = heightOf(el);
        const close = animateAs(el, [{ height: `${h}px`, overflow: 'clip' }, { height: '0px', overflow: 'clip' }], { duration: clock('--gen-grow-dur', 300), easing: token('--gen-ease', EASE), fill: 'forwards' });
        close.finished.then(() => el.remove(), () => el.remove());
      }, fade);
    }

    /** Just before a batch lands: how tall each place it puts something
     *  into is now, so the page can grow from there. */
    function measure(run, d) {
      const parents = [...new Set((d.inserts ?? []).map((e) => e?.parentId).filter(Boolean))].slice(0, 6);
      const grow = [];
      for (const id of parents) {
        const el = byId(id);
        if (!el || BLOCKY.has(el.tagName) || el.closest(`[${TRANSIENT}]`)) continue;
        grow.push({ el, h: heightOf(el) });
      }
      run.grow = { parents: grow, skel: run.skel?.el.isConnected ? { el: run.skel.el, h: heightOf(run.skel.el), parent: run.skel.el.parentElement, ph: heightOf(run.skel.el.parentElement) } : null };
    }

    // The batch's ops have just been applied, and the engine has not read
    // the page yet (this listens on the window, ahead of the document):
    // the outline gives up the room that landed, and every place that grew
    // starts from its old height, so the engine sees nothing jump and
    // what is below rides the height down.
    addEventListener('marble:ops', ({ detail }) => {
      const run = runs.get(String(detail?.client ?? ''));
      if (!run || run.ending) return;
      const grow = run.grow;
      run.grow = null;
      const moving = Boolean(grow) && !still() && !zonesOff();
      const skel = run.skel;
      if (skel) {
        if (run.pendingLanded != null) landTo(run, run.pendingLanded, { keep: moving });
        run.pendingLanded = null;
        place(skel);
      }
      if (!moving) return;
      const dur = clock('--gen-grow-dur', 300);
      const easing = token('--gen-ease', EASE);
      const s = grow.skel;
      if (s && s.el.isConnected && s.parent?.isConnected) {
        // The outline is the give: it starts as tall as it must for the
        // page to stand where it stood, and settles to what is left of it
        // (nothing, once every section has landed, and then it goes).
        const empty = !s.el.childElementCount;
        cancelOwn(s.el);
        const to = heightOf(s.el);
        const from = Math.max(0, to + (s.ph - heightOf(s.parent)));
        if (Math.abs(from - to) >= 1) {
          const a = animateAs(s.el, [{ height: `${from}px`, overflow: 'clip' }, { height: `${to}px`, overflow: 'clip' }], { duration: dur, easing });
          if (empty) a.finished.then(() => s.el.remove(), () => s.el.remove());
        } else if (empty) s.el.remove();
      }
      for (const { el, h } of grow.parents) {
        if (!el.isConnected || (s && el === s.parent)) continue;
        cancelOwn(el);
        const now = heightOf(el);
        if (Math.abs(now - h) < 1) continue;
        animateAs(el, [{ height: `${h}px`, overflow: 'clip' }, { height: `${now}px`, overflow: 'clip' }], { duration: dur, easing });
      }
    }, true);

    // ---------------------------------------------------------- the end

    function end(run, done) {
      if (run.ending) return;
      run.ending = true;
      run.off?.();
      if (run.skel) { leave(run.skel); run.skel = null; }
      const status = done?.status ?? 'completed';
      if (speaker === run && !built(run.conv)) {
        const made = Number(done?.changed ?? 0) + Number(done?.added ?? 0) + Number(done?.removed ?? 0) > 0;
        if (status === 'cancelled') line.finish(made ? 'Stopped. What was made is kept.' : 'Stopped', 'quiet');
        else if (status === 'failed') line.finish(made ? 'Didn’t finish. What was made is kept.' : 'Didn’t finish', 'quiet');
        else line.finish('Done', 'done');
      }
      if (runs.get(run.client) === run) runs.delete(run.client);
      if (speaker === run) speaker = null;
      setTimeout(() => { spoke.delete(run.conv); changed(); }, clock('--gen-quiet-hold', 2600) + 600);
    }

    /** A run put out of mind (a new turn of the same chat, a chat no longer
     *  followed): its drawing goes without a word. */
    function forget(run) {
      run.ending = true;
      run.off?.();
      if (run.skel) { leave(run.skel); run.skel = null; }
      if (runs.get(run.client) === run) runs.delete(run.client);
      if (speaker === run) { speaker = null; line.hide(); }
      spoke.delete(run.conv);
      changed();
    }

    /** Whether a run still runs, asked of the host when its frames stop or
     *  the tab is back: over (or gone), it ends quietly. */
    async function settle(run) {
      if (runs.get(run.client) !== run || run.ending) return;
      let detail = null;
      try {
        detail = await agent.conversation(run.conv, { turns: 1 });
      } catch (err) {
        if (err?.status !== 404) return;
      }
      if (runs.get(run.client) !== run || run.ending) return;
      const turn = (detail?.turns ?? []).find((t) => t.id === run.turn);
      if (turn && (turn.status === 'running' || turn.status === 'queued')) return;
      forget(run);
    }
    const settleAll = () => { for (const run of [...runs.values()]) settle(run); };
    addEventListener('marble:agent-reopened', settleAll);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) settleAll(); });
    setInterval(() => {
      for (const run of [...runs.values()]) if (performance.now() - run.last > 120_000) settle(run);
    }, 30_000);

    // ---------------------------------------------------------- listening

    document.addEventListener('marble:presence', ({ detail }) => onPresence(detail), true);

    // A tab that opens mid-build asks for the frames that are standing.
    function catchUp(only = null) {
      fetch(`/presence?app=${encodeURIComponent(marble.app)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          for (const frame of body?.frames ?? []) {
            const client = String(frame?.client ?? '');
            if (!client.startsWith('agent:') || !frame.turn || runs.has(client)) continue;
            if (only && client !== `agent:${only}`) continue;
            onPresence(frame, { caught: true });
          }
        })
        .catch(() => { /* nothing standing is the same answer */ });
    }
    catchUp();
    addEventListener('marble:attending', (event) => { if (event.detail?.id) catchUp(event.detail.id); });

    // ---------------------------------------------------------- the reveal

    api.speaks = (conv) => spoke.has(String(conv ?? ''));

    /** What arrived rises into place: its parts one after another (its own
     *  frame fades with them), or itself when it is one thing. `delay` is
     *  the engine's turn for it; `motion` is the engine's own animate, so
     *  its rules for what it may cancel still hold. */
    api.reveal = (el, { delay = 0, client = null, motion = null } = {}) => {
      const run = runs.get(String(client ?? ''));
      if (!run || run.ending || still() || zonesOff() || !el?.isConnected) return null;
      const dur = clock('--gen-reveal-dur', 500);
      const stagger = clock('--gen-reveal-stagger', 40);
      const rise = token('--gen-reveal-rise', '8px');
      const blur = token('--gen-reveal-blur', '3px');
      const easing = token('--gen-ease', EASE);
      const play = typeof motion === 'function' ? motion : animateAs;
      const ends = [];
      const lift = (target, at) => {
        // A part with a filter of its own keeps it: it rises, unblurred.
        const sharp = getComputedStyle(target).filter !== 'none';
        const from = { opacity: 0, translate: `0 ${rise}`, ...(sharp ? {} : { filter: `blur(${blur})` }) };
        const to = { opacity: 1, translate: '0 0', ...(sharp ? {} : { filter: 'blur(0px)' }) };
        ends.push(play(target, [from, to], { duration: dur, delay: at, easing, fill: 'backwards' }).finished.then(() => {}, () => {}));
      };
      const kids = [...el.children].filter((k) => !k.hasAttribute(TRANSIENT) && !SKIP.has(k.tagName));
      const many = kids.length >= 2 && kids.length <= 24;
      if (many) {
        ends.push(play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.round(dur * 0.6), delay, easing, fill: 'backwards' }).finished.then(() => {}, () => {}));
        kids.forEach((kid, i) => lift(kid, delay + i * stagger));
      } else {
        lift(el, delay);
      }
      // Landed once the last of it is within a pixel of its place (six
      // tenths of the way along this curve): the marks lift on that, while
      // the motion's tail still settles.
      const last = delay + (many ? (kids.length - 1) * stagger : 0);
      const near = new Promise((resolve) => setTimeout(resolve, last + dur * 0.6));
      return { done: Promise.race([Promise.all(ends), near]).then(() => {}), duration: dur + (many ? (kids.length - 1) * stagger : 0) };
    };

    api.stats = () => ({ runs: runs.size, said: line.said, up: line.up, outline: [...runs.values()].map((r) => (r.skel ? r.skel.blocks.length - r.skel.landed : 0)) });
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
