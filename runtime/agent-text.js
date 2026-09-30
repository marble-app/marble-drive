// The agent in the text: work on words is shown in the words.
//
// A zone (collab.js) is a box round the thing an agent is working on, and
// for a table rebuilt or a control added that is the right picture. For a
// sentence it is the wrong one: a box round the whole paragraph says that
// something is happening and nothing about where in the text, what it is
// about to write, or when it has started writing rather than reading (v3,
// Notes and Sketches/Ask at Anything). So when the work is inside one block
// of text — a paragraph, a heading, a list item, a cell — this layer takes
// it from the zone and draws the agent the way a collaborator is drawn:
//
//   - a caret in the agent's colour where it will write: the end of the
//     words the person asked about, or the end of the block;
//   - a label hanging from it like a flag: "Agent · thinking" while it reads
//     and plans, "Agent · typing" while its words land;
//   - a faint wash on the words it was asked about while it works;
//   - its edit, typed out after the caret at reading pace (60 characters a
//     second, never more than a second and a half), the words it replaced
//     fading first, and a faint wash on the new words that goes within two
//     seconds of the turn ending.
//
// Nothing here touches the document. The caret and label are transient
// chrome in one fixed layer, and words are marked with the CSS Custom
// Highlight API, which paints ranges without changing a node. Work that is
// not words keeps its zone. A chat this tab is not following is a dot
// (agent-glints.js), not a caret. With reduced motion nothing is typed: the
// words appear at once, with the wash. While the person's own caret is in
// the same block, the agent's caret steps aside and its edit appears at once.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const RATE = 60;          // characters a second
  const LONGEST = 1500;     // ms, however much there is to type
  const SHORTEST = 220;     // ms, so one word is still seen arriving
  const FADE_OLD = 260;     // ms for the replaced words to go
  const WASH_GOES = 2000;   // ms after the turn ends
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const canMark = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';

  const STYLE = `
    .marble-text-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482800;
      --text-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #111)));
      font: 500 11.5px/1 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    .marble-text-caret { position: fixed; width: 2px; border-radius: 1px; background: var(--text-mark); pointer-events: none;
      transition: left 90ms linear, top 90ms linear, height 90ms linear; }
    .marble-text-caret[hidden] { display: none; }
    /* The label hangs from the caret like a flag, its squared corner on the
       caret, so it reads as the caret's name and not as a note on the text. */
    .marble-text-tag { position: absolute; bottom: calc(100% + 3px); left: 0; display: inline-flex; align-items: center; gap: 6px;
      white-space: nowrap; padding: 4px 8px 4px 7px; border-radius: 6px 6px 6px 1px; cursor: pointer; pointer-events: auto;
      font: inherit; color: color-mix(in srgb, var(--text-mark) 70%, var(--ink, #111));
      background: color-mix(in srgb, var(--text-mark) 12%, var(--card, var(--paper, #fff)));
      border: 1px solid color-mix(in srgb, var(--text-mark) 30%, transparent); box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .marble-text-tag:hover { background: color-mix(in srgb, var(--text-mark) 18%, var(--card, var(--paper, #fff))); }
    .marble-text-tag:focus-visible { outline: 2px solid color-mix(in srgb, var(--text-mark) 50%, transparent); outline-offset: 1px; }
    .marble-text-caret.is-flip .marble-text-tag { left: auto; right: 0; border-radius: 6px 6px 1px 6px; }
    .marble-text-caret.is-low .marble-text-tag { bottom: auto; top: calc(100% + 3px); border-radius: 1px 6px 6px 6px; }
    .marble-text-caret.is-low.is-flip .marble-text-tag { border-radius: 6px 1px 6px 6px; }
    .marble-text-tag::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--text-mark); flex: none; }
    /* Motion means work: the dot breathes while the agent thinks, and holds
       still once it types, because then the words are the motion. */
    .marble-text-caret[data-phase="thinking"] .marble-text-tag::before,
    .marble-text-caret[data-phase="reading"] .marble-text-tag::before { animation: marble-text-breathe 2.8s ease-in-out infinite; }
    @keyframes marble-text-breathe { 50% { opacity: .35; } }
    .marble-text-ghost { position: fixed; white-space: pre; pointer-events: none; color: var(--faint, #8a8a8a);
      text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--text-mark) 60%, transparent);
      opacity: 1; transition: opacity ${FADE_OLD}ms ease; }
    .marble-text-ghost.is-out { opacity: 0; }
    @media (prefers-reduced-motion: reduce) {
      .marble-text-caret { transition: none; }
      .marble-text-caret .marble-text-tag::before { animation: none !important; }
      .marble-text-ghost { transition: none; }
    }
  `;
  // Highlights are painted from the page's own sheet, not the layer's.
  const MARKS = `
    ::highlight(marble-agent-scope) { background-color: color-mix(in srgb, var(--accent-ink, #6d55d4) 14%, transparent); }
    ::highlight(marble-agent-typed) { background-color: color-mix(in srgb, var(--accent-ink, #6d55d4) 13%, transparent); }
    ::highlight(marble-agent-typed-2) { background-color: color-mix(in srgb, var(--accent-ink, #6d55d4) 7%, transparent); }
    ::highlight(marble-agent-typed-3) { background-color: color-mix(in srgb, var(--accent-ink, #6d55d4) 3%, transparent); }
    ::highlight(marble-agent-untyped) { color: transparent; background-color: transparent; }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-text-layer')) return;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE + (canMark ? MARKS : '');
    document.head.append(style);
    const layer = document.createElement('div');
    layer.className = 'marble-text-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('aria-live', 'polite');
    document.documentElement.append(layer);

    const byId = (id) => (id ? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`) : null);
    const conversationOf = (client) => {
      const name = String(client ?? '');
      return name.startsWith('agent:') ? name.slice('agent:'.length) || null : null;
    };
    const attended = (client) => {
      const id = conversationOf(client);
      return Boolean(id) && (typeof agent.attending !== 'function' || agent.attending(id));
    };

    // ------------------------------------------------------------ what is text

    const SOLID = 'img, svg, canvas, video, audio, iframe, input, select, textarea, button, table, ul, ol, dl, hr, marble-alt, [data-marble-run]';
    const inline = (el) => getComputedStyle(el).display.startsWith('inline');
    /** The one block of text `el` is in, or null when it is not words: a
     *  block with nothing but inline content, and none of it a control, a
     *  picture or structure. */
    function textBlockOf(el) {
      let node = el?.nodeType === 1 ? el : el?.parentElement;
      while (node && node !== document.body && node.isConnected && inline(node)) node = node.parentElement;
      if (!node || node === document.body || node === document.documentElement || node.closest(`[${TRANSIENT}]`)) return null;
      if (!node.hasAttribute('data-marble-id')) node = node.closest('[data-marble-id]');
      if (!node || node === document.body) return null;
      if (node.querySelector(SOLID) || node.matches(SOLID)) return null;
      for (const child of node.children) {
        const d = getComputedStyle(child).display;
        if (d !== 'none' && d !== 'contents' && !d.startsWith('inline')) return null;
      }
      return node;
    }
    /** One block for a set of ids, or null when they are more than one. */
    function oneBlock(ids) {
      const blocks = new Set((ids ?? []).map(byId).filter(Boolean).map(textBlockOf));
      if (blocks.size !== 1) return null;
      const [block] = blocks;
      return block;
    }

    // Text offsets to DOM positions, walking the block's text nodes.
    function textNodes(root) {
      const out = [];
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest(`[${TRANSIENT}], script, style`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
      return out;
    }
    const textOf = (root) => textNodes(root).map((n) => n.data).join('');
    function point(root, offset) {
      let left = offset;
      const nodes = textNodes(root);
      for (const n of nodes) {
        if (left <= n.length) return [n, left];
        left -= n.length;
      }
      const last = nodes.at(-1);
      return last ? [last, last.length] : [root, root.childNodes.length];
    }
    function rangeOf(root, from, to) {
      const range = document.createRange();
      const [a, ao] = point(root, from);
      const [b, bo] = point(root, to);
      range.setStart(a, ao);
      range.setEnd(b, bo);
      return range;
    }

    // ------------------------------------------------------------ the marks

    const highlights = canMark ? {
      scope: new Highlight(),
      typed: new Highlight(),
      typed2: new Highlight(),
      typed3: new Highlight(),
      untyped: new Highlight(),
    } : null;
    if (highlights) {
      CSS.highlights.set('marble-agent-scope', highlights.scope);
      CSS.highlights.set('marble-agent-typed', highlights.typed);
      CSS.highlights.set('marble-agent-typed-2', highlights.typed2);
      CSS.highlights.set('marble-agent-typed-3', highlights.typed3);
      CSS.highlights.set('marble-agent-untyped', highlights.untyped);
    }
    const mark = (name, range) => { if (highlights && range) highlights[name].add(range); };
    const unmark = (name, range) => { if (highlights && range) highlights[name].delete(range); };

    // ------------------------------------------------------------ agents

    // client -> { client, phase, home, block, words, caret, tag, snap, typing, typed: [] }
    const agents = new Map();
    // Words a card asked about, waiting for their agent's first frame.
    const pendingWords = [];

    function claimed(client) {
      const a = agents.get(client);
      return Boolean(a && a.block?.isConnected && !a.away);
    }
    const announce = () => dispatchEvent(new CustomEvent('marble-text:claims'));

    function stateFor(client) {
      let a = agents.get(client);
      if (a) return a;
      const caret = document.createElement('div');
      caret.className = 'marble-text-caret';
      caret.hidden = true;
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'marble-text-tag';
      tag.addEventListener('click', () => {
        const id = conversationOf(client);
        if (!id) return;
        const offer = new CustomEvent('marble-callout:open', { cancelable: true, detail: { id } });
        if (!document.dispatchEvent(offer)) return;
        agent.open?.(id);
      });
      caret.append(tag);
      layer.append(caret);
      a = { client, phase: 'thinking', home: null, block: null, words: null, caret, tag, snap: new Map(), typing: null, typed: [], away: false };
      agents.set(client, a);
      return a;
    }

    const WORDS = { thinking: 'thinking', reading: 'reading', typing: 'typing' };
    function paintCaret(a) {
      const { caret, tag } = a;
      // Hide work in the tray hides this too; it is the same work.
      const off = document.documentElement.classList.contains('marble-zones-off');
      if (!a.block?.isConnected || a.away || off || personIn(a.block)) { caret.hidden = true; return; }
      const at = caretPoint(a);
      if (!at) { caret.hidden = true; return; }
      caret.hidden = false;
      caret.dataset.phase = a.phase;
      tag.textContent = `Agent · ${WORDS[a.phase] ?? 'working'}`;
      tag.setAttribute('aria-label', `Agent · ${WORDS[a.phase] ?? 'working'} · open its chat`);
      Object.assign(caret.style, { left: `${Math.round(at.x)}px`, top: `${Math.round(at.top)}px`, height: `${Math.max(12, Math.round(at.height))}px` });
      caret.classList.toggle('is-flip', at.x > innerWidth - 150);
      caret.classList.toggle('is-low', at.top < 30);
    }

    /** Where the caret stands: the end of what is being typed, the end of the
     *  words asked about, or the end of the block. */
    function caretPoint(a) {
      let range = null;
      if (a.typing) range = a.typing.at();
      else if (a.words?.startContainer?.isConnected && a.block.contains(a.words.startContainer)) {
        range = a.words.cloneRange();
        range.collapse(false);
      } else {
        const text = textOf(a.block);
        range = rangeOf(a.block, text.replace(/\s+$/, '').length, text.replace(/\s+$/, '').length);
      }
      let rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (!rect || (!rect.height && !rect.width && !rect.top)) rect = null;
      if (!rect) {
        const r = a.block.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(a.block).lineHeight) || 20;
        return { x: r.left + 1, top: r.top, height: Math.min(line, r.height || line) };
      }
      return { x: rect.left, top: rect.top, height: rect.height };
    }

    // The person's own caret in the same block: the agent's steps aside.
    function personIn(block) {
      const active = document.activeElement;
      if (!active?.isContentEditable || active.closest(`[${TRANSIENT}]`)) return false;
      return active === block || active.contains(block) || block.contains(active);
    }

    function setScope(a, range) {
      if (a.scopeRange) unmark('scope', a.scopeRange);
      a.scopeRange = range && !range.collapsed ? range : null;
      mark('scope', a.scopeRange);
    }

    function take(a, block) {
      if (a.block === block) return;
      a.block = block;
      a.snap.set(block, textOf(block));
      announce();
    }

    function onPresence(detail) {
      const client = detail?.client;
      if (!client || !String(client).startsWith('agent:')) return;
      if (!attended(client)) { if (agents.has(client)) end(client); return; }
      const ids = Array.isArray(detail.ids) ? detail.ids.filter(Boolean) : [];
      if (!ids.length) { end(client); return; }
      const phase = detail.phase;
      if (phase === 'acting') { const a = agents.get(client); if (a) { a.away = true; paintCaret(a); announce(); } return; }
      let a = agents.get(client);
      if (phase === 'working' || !a) {
        const block = oneBlock(ids);
        if (!block) {
          if (a) { a.away = true; paintCaret(a); announce(); }
          return;
        }
        a = stateFor(client);
        a.home = block;
        a.away = false;
        // The words a card asked about, if they are in this block.
        const i = pendingWords.findIndex((p) => Date.now() - p.at < 15_000 && block.contains(p.range.startContainer));
        if (i >= 0) {
          a.words = pendingWords[i].range;
          pendingWords.splice(i, 1);
        }
        take(a, block);
        a.phase = 'thinking';
        setScope(a, a.words);
        paintCaret(a);
        return;
      }
      if (phase === 'writing') {
        const block = oneBlock(ids);
        if (!block) {
          // Writing something that is not words, or more than one block:
          // the zone draws that, and the caret waits.
          a.away = true;
          paintCaret(a);
          announce();
          return;
        }
        a.away = false;
        if (block !== a.block) {
          a.block = block;
          a.words = null;
          setScope(a, null);
          announce();
        }
        // Before its edit lands: what the block says now is what the typing
        // is measured from.
        if (!a.typing) a.snap.set(block, textOf(block));
        a.phase = 'typing';
        paintCaret(a);
        return;
      }
      // Reading anything, anywhere: it is still thinking about its words.
      a.phase = a.typing ? 'typing' : phase === 'reading' ? 'reading' : 'thinking';
      if (a.away && a.home) { a.away = false; a.block = a.home; announce(); }
      paintCaret(a);
    }

    function end(client) {
      const a = agents.get(client);
      if (!a) return;
      agents.delete(client);
      a.typing?.finish();
      setScope(a, null);
      a.caret.remove();
      const typed = a.typed;
      a.typed = [];
      settleWash(typed);
      announce();
    }

    // The new words' wash goes in three steps rather than at once, because a
    // highlight cannot be transitioned; stillness takes it off at the end.
    function settleWash(ranges) {
      if (!ranges.length) return;
      const step = (from, to) => { for (const r of ranges) { unmark(from, r); if (to) mark(to, r); } };
      if (stillness.matches) { setTimeout(() => step('typed', null), WASH_GOES); return; }
      setTimeout(() => step('typed', 'typed2'), WASH_GOES * 0.45);
      setTimeout(() => step('typed2', 'typed3'), WASH_GOES * 0.75);
      setTimeout(() => step('typed3', null), WASH_GOES);
    }

    // ------------------------------------------------------------ typing

    function onOps(detail) {
      const client = String(detail?.client ?? '');
      const a = agents.get(client);
      if (!a || a.away) return;
      for (const op of detail.ops ?? []) {
        let block = null;
        let fresh = false;
        if (op.type === 'insert') {
          const inserted = byId(/data-marble-id="([^"]+)"/.exec(String(op.html ?? ''))?.[1]);
          const into = byId(op.parentId);
          if (inserted && textBlockOf(inserted) === inserted) { block = inserted; fresh = true; } else if (into) block = textBlockOf(into);
        } else if (op.id) {
          block = textBlockOf(byId(op.id));
        }
        if (!block) continue;
        if (block !== a.block) {
          a.block = block;
          a.words = null;
          setScope(a, null);
          announce();
        }
        const before = fresh ? '' : a.snap.get(block);
        type(a, block, before);
      }
    }

    function type(a, block, before) {
      a.typing?.finish();
      const after = textOf(block);
      a.snap.set(block, after);
      if (before == null || before === after) { paintCaret(a); return; }
      // What changed is what lies between the common start and the common end.
      let start = 0;
      while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
      let tail = 0;
      while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
      const end = after.length - tail;
      const removed = before.slice(start, before.length - tail);
      a.words = null;
      setScope(a, null);
      if (end <= start) { paintCaret(a); return; }
      const whole = rangeOf(block, start, end);
      // Reduced motion, the person in the same block, or no way to mark
      // words: it appears at once, with the wash.
      if (stillness.matches || personIn(block) || !highlights) {
        mark('typed', whole);
        a.typed.push(whole);
        paintCaret(a);
        return;
      }
      const length = end - start;
      // A short ending the edit left alone ("." after the new words) waits
      // with them, or it would sit alone past the space they are keeping. A
      // long one is the rest of the paragraph, and stays where it is.
      const hideTo = tail <= 40 ? after.length : end;
      const duration = Math.max(SHORTEST, Math.min(LONGEST, (length / RATE) * 1000));
      let shown = start;
      let typedRange = rangeOf(block, start, start);
      let hiddenRange = rangeOf(block, start, hideTo);
      mark('typed', typedRange);
      mark('untyped', hiddenRange);
      a.phase = 'typing';
      const ghost = removed.trim() ? ghostOf(block, start, removed) : null;
      const began = performance.now() + (ghost ? FADE_OLD : 0);
      let raf = 0;
      let done = false;
      const typing = {
        at: () => rangeOf(block, shown, shown),
        finish: () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(raf);
          ghost?.remove();
          unmark('untyped', hiddenRange);
          unmark('typed', typedRange);
          mark('typed', whole);
          a.typed.push(whole);
          if (a.typing === typing) a.typing = null;
          if (agents.get(a.client) === a) paintCaret(a);
        },
      };
      a.typing = typing;
      const frame = (now) => {
        if (done) return;
        if (!block.isConnected) { typing.finish(); return; }
        const t = Math.max(0, now - began) / duration;
        let next = start + Math.round(length * Math.min(1, t));
        // Arrive a word at a time where the words are short enough to.
        if (next < end) {
          const space = after.indexOf(' ', next);
          if (space > 0 && space < end && space - next < 6) next = space;
        }
        if (next !== shown) {
          shown = next;
          unmark('typed', typedRange);
          unmark('untyped', hiddenRange);
          typedRange = rangeOf(block, start, shown);
          hiddenRange = rangeOf(block, shown, shown < end ? hideTo : end);
          mark('typed', typedRange);
          if (shown < end) mark('untyped', hiddenRange);
          paintCaret(a);
        }
        if (t >= 1) { typing.finish(); return; }
        raf = requestAnimationFrame(frame);
      };
      paintCaret(a);
      raf = requestAnimationFrame(frame);
    }

    /** The words that were there, drawn where they stood and faded out, over
     *  the new words while those are still hidden. */
    function ghostOf(block, at, words) {
      const range = rangeOf(block, at, at);
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (!rect) return null;
      const css = getComputedStyle(block);
      const ghost = document.createElement('span');
      ghost.className = 'marble-text-ghost';
      ghost.textContent = words.length > 80 ? `${words.slice(0, 79)}…` : words;
      Object.assign(ghost.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, height: `${rect.height}px`, lineHeight: `${rect.height}px`,
        font: css.font, letterSpacing: css.letterSpacing,
        maxWidth: `${Math.max(40, block.getBoundingClientRect().right - rect.left)}px`, overflow: 'hidden',
      });
      layer.append(ghost);
      requestAnimationFrame(() => ghost.classList.add('is-out'));
      setTimeout(() => ghost.remove(), FADE_OLD + 60);
      return ghost;
    }

    // ------------------------------------------------------------ listening

    document.addEventListener('marble:presence', ({ detail }) => onPresence(detail));
    document.addEventListener('marble:ops', ({ detail }) => onOps(detail));
    addEventListener('marble:attending', () => {
      for (const client of [...agents.keys()]) if (!attended(client)) end(client);
    });
    // A card sent about words says which words (agent-callout.js).
    addEventListener('marble-text:words', (event) => {
      const range = event.detail?.range;
      if (range && !range.collapsed) pendingWords.push({ range: range.cloneRange(), at: Date.now() });
      if (pendingWords.length > 4) pendingWords.shift();
    });
    let raf = 0;
    const relayout = () => { raf = 0; for (const a of agents.values()) paintCaret(a); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(relayout); };
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('input', schedule, true);
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    window.marbleText = {
      claims: claimed,
      textBlockOf,
      agents: () => [...agents.values()].map((a) => ({ client: a.client, phase: a.phase, block: a.block?.getAttribute('data-marble-id') ?? null, typing: Boolean(a.typing), away: a.away })),
    };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
