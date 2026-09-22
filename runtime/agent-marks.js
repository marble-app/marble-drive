// Marks: mark a document up, then hand what you marked to an agent.
//
// Two tools in the drawer's tray — Select, a marquee over addressed elements,
// and Sketch, ink that is read as a box, an arrow or a scribble over them.
// Neither edits the document: everything drawn here is transient chrome in one
// fixed layer, like the callout. Neither invents a way to send, either. Both
// end at `marble.agent.select`, which is where a text selection and an
// Option-pick already end, so the callout's handle, ⌘J and the tray's Ask here
// are the one door out. What a sketch adds on the way through that door is its
// reading in words, written into the composer for the person to edit.
//
// Spec: docs/superpowers/specs/2026-09-21-marks-in-the-tray-design.md

(() => {
  const TRANSIENT = 'data-marble-transient';
  const G = () => globalThis.marbleMarksGeometry;
  // A stroke's own points are thinned to this, so a slow hand over a long
  // drag does not store a thousand points that all say the same thing.
  const THIN = 1.5;
  // Under this much travel a press is a press, not a stroke.
  const SCRATCH = 10;

  const GLYPHS = {
    // An area, drawn as the marquee itself; ink, drawn as a stroke that is
    // plainly a hand's and not a shape; and a stroke being lifted off.
    select: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/></svg>',
    sketch: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 16.2c2.6-6.4 4.6-9.6 6-9.6 2 0 .4 9.6 2.4 9.6 1.4 0 3.1-3.2 5.1-9.6"/><path d="M4 20.2h16"/></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 18.5 4 14a1.6 1.6 0 0 1 0-2.3l7-7a1.6 1.6 0 0 1 2.3 0l5.2 5.2a1.6 1.6 0 0 1 0 2.3l-6.3 6.3z"/><path d="M9 20h11"/></svg>',
  };

  const STYLE = `
    .marble-marks-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none;
      z-index: 2147483002;
      --marks-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --marks-paper: var(--card, var(--paper, #fff));
      --marks-ink: var(--ink, #222);
      font: 500 12px/1.2 var(--ui-font, system-ui, -apple-system, sans-serif);
      letter-spacing: .01em;
      color: var(--marks-ink);
    }
    /* In the top layer so no document's stacking context can cover it; the UA
       sheet for [popover] would otherwise centre it and give it a border. */
    .marble-marks-layer:popover-open { position: fixed; inset: 0; }

    /* Inside a mode the overlay takes the pointer and nothing else changes:
       wheel still scrolls the page under it. Pinch still works too; a single
       finger is claimed for the drag rather than left free to pan — dropping
       touch-action entirely would let the browser start that pan on the first
       touch, before the first pointermove ever reaches here.

       The hole the clip-path punches in it is the tray's corner: the overlay
       is in the top layer and the tray is not, so without the hole the one
       piece of chrome you need to get back out of a mode would be under it. */
    .marble-marks-overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: pinch-zoom; }
    .marble-marks-overlay[hidden] { display: none; }

    .marble-marks-marquee {
      position: fixed; pointer-events: none; border-radius: 2px;
      border: 1px solid var(--marks-mark);
      background: color-mix(in srgb, var(--marks-mark) 8%, transparent);
    }
    .marble-marks-marquee[hidden] { display: none; }
    /* The same outline the callout's pick mode draws, one per element the
       rectangle means, repainted every frame of the drag. */
    .marble-marks-hit { position: fixed; pointer-events: none; border: 1.5px solid var(--marks-mark); border-radius: 6px; }
    .marble-marks-hit[hidden] { display: none; }

    .marble-marks-ink { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .marble-marks-stroke {
      fill: none; stroke: var(--marks-mark); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
      transition: opacity 180ms cubic-bezier(.2, .8, .3, 1);
    }
    /* Handed over: still yours to look at, no longer the thing being made. */
    .marble-marks-stroke[data-state="sent"] { opacity: .55; }

    /* What the agent will be told about the stroke under the pointer, in
       words, while there is still time to redraw it. */
    .marble-marks-caption {
      position: fixed; pointer-events: none; max-width: 260px; padding: 5px 9px; border-radius: 8px;
      background: color-mix(in srgb, var(--marks-ink) 88%, transparent); color: var(--marks-paper);
      box-shadow: 0 6px 18px rgba(0, 0, 0, .18);
    }
    .marble-marks-caption[hidden] { display: none; }

    @media (prefers-reduced-motion: reduce) {
      .marble-marks-stroke { transition: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app || !G()) return true;
    // The Agents page is the orchestration view already; tools for briefing an
    // agent about a document have no place on the page made of agents.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return true;
    if (document.querySelector('.marble-marks-layer')) return true;

    // --------------------------------------------------------------- the tray
    //
    // The tray is the only way to reach these tools, so it is also the
    // condition for having them: a register that nobody answers means there is
    // no tray on this page, and the layer stands down rather than draw a
    // second affordance in a corner a document may own. The drawer says
    // `marble-tray:ready` when it mounts, and boot is tried again then.

    const claim = (spec) => !dispatchEvent(new CustomEvent('marble-tray:register', { detail: spec, cancelable: true }));
    const update = (spec) => dispatchEvent(new CustomEvent('marble-tray:update', { detail: spec }));
    const LABELS = { select: 'Select an area', sketch: 'Sketch' };
    if (!claim({ id: 'marks-select', order: 10, label: LABELS.select, icon: GLYPHS.select, always: true, onSelect: () => toggleMode('select') })) return false;
    claim({ id: 'marks-sketch', order: 12, label: LABELS.sketch, icon: GLYPHS.sketch, always: true, onSelect: () => toggleMode('sketch') });
    claim({ id: 'marks-clear', order: 14, label: 'Clear sketch', icon: GLYPHS.clear, hidden: true, onSelect: () => clearMarks() });

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    const layer = document.createElement('div');
    layer.className = 'marble-marks-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    try { layer.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }

    const overlay = document.createElement('div');
    overlay.className = 'marble-marks-overlay';
    overlay.setAttribute(TRANSIENT, '');
    overlay.hidden = true;
    const marquee = document.createElement('div');
    marquee.className = 'marble-marks-marquee';
    marquee.setAttribute(TRANSIENT, '');
    marquee.hidden = true;
    const ink = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ink.setAttribute('class', 'marble-marks-ink');
    ink.setAttribute('aria-hidden', 'true');
    ink.setAttribute(TRANSIENT, '');
    const caption = document.createElement('div');
    caption.className = 'marble-marks-caption';
    caption.setAttribute(TRANSIENT, '');
    caption.hidden = true;
    const hits = [];
    layer.append(ink, overlay, marquee, caption);

    let mode = null;
    let drag = null;
    let pen = null;
    let fromUs = false;
    let mine = [];
    const marks = [];

    // ---------------------------------------------------------------- boxes
    //
    // Real documents here are not the size of a test fixture: the Pattern
    // Atlas carries 21,587 addressed elements and a dozen more are past 1,500.
    // Two things keep that from landing on a drag.
    //
    // The first is scope. The marquee is `position: fixed`, so a rectangle
    // drawn in it can only ever mean something on screen: every box whose rect
    // misses the viewport is dropped. Off-screen *ancestors* of a box that was
    // kept stay, because the coalescing rule reads the parent chain and a
    // chain with a hole in it would coalesce wrongly.
    //
    // The second is the parent walk. `closest()` on every element walks to the
    // root every time; `querySelectorAll` hands them back in document order,
    // so a stack of open ancestors answers the same question in one pass.
    const collectBoxes = () => {
      const els = [...document.querySelectorAll('[data-marble-id]')].filter((el) =>
        el !== document.body && el !== document.documentElement && !el.closest(`[${TRANSIENT}]`) && el.getRootNode() === document);
      const parentOf = new Map();
      const rects = new Map();
      const open = [];
      for (const el of els) {
        while (open.length && !open[open.length - 1].contains(el)) open.pop();
        parentOf.set(el, open[open.length - 1] ?? null);
        open.push(el);
        rects.set(el, el.getBoundingClientRect());
      }
      const keep = new Set();
      for (const el of els) {
        const r = rects.get(el);
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        keep.add(el);
        for (let p = parentOf.get(el); p && !keep.has(p); p = parentOf.get(p)) keep.add(p);
      }
      const out = [];
      for (const el of els) {
        if (!keep.has(el)) continue;
        const r = rects.get(el);
        out.push({
          id: el.getAttribute('data-marble-id'),
          parent: parentOf.get(el)?.getAttribute('data-marble-id') ?? null,
          left: r.left, top: r.top, width: r.width, height: r.height,
        });
      }
      return out;
    };
    const paintHits = (ids, boxes) => {
      const byId = new Map(boxes.map((box) => [box.id, box]));
      ids.forEach((id, i) => {
        let hit = hits[i];
        if (!hit) {
          hit = document.createElement('div');
          hit.className = 'marble-marks-hit';
          hit.setAttribute(TRANSIENT, '');
          hits.push(hit);
          marquee.before(hit);
        }
        const box = byId.get(id);
        Object.assign(hit.style, { left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px` });
        hit.hidden = false;
      });
      for (let i = ids.length; i < hits.length; i += 1) hits[i].hidden = true;
    };

    /** The deepest addressed element under a point, or the nearest one to it:
     *  a stroke may well start in a margin, and "nothing" is a worse answer
     *  than "the paragraph six pixels to the left". */
    const elementAt = (x, y) => {
      // Paint order, nearest the eye first, so the first addressed ancestor
      // found is the deepest element actually under the point.
      for (const el of document.elementsFromPoint(x, y)) {
        if (!el.closest || el.closest(`[${TRANSIENT}]`) || el.getRootNode() !== document) continue;
        const addressed = el.closest('[data-marble-id]');
        if (addressed && addressed !== document.body && addressed !== document.documentElement) return addressed;
      }
      let best = null;
      let nearest = Infinity;
      for (const el of document.querySelectorAll('[data-marble-id]')) {
        if (el === document.body || el.closest(`[${TRANSIENT}]`) || el.getRootNode() !== document) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.hypot(dx, dy);
        // Ties go to the deeper element, which `querySelectorAll` hands over
        // later: a point inside a list and its item is 0 from both.
        if (d <= nearest) { nearest = d; best = el; }
      }
      return best;
    };
    const idAt = (x, y) => elementAt(x, y)?.getAttribute('data-marble-id') ?? null;
    const boxOf = (id) => {
      const el = id && document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
      return el ? el.getBoundingClientRect() : null;
    };

    // ---------------------------------------------------------------- Select

    const rectOf = (d) => ({
      left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
    });
    // A page scrolling under a drag moves every box the same distance, and the
    // boxes are in client coordinates, so the scroll is a pure shift:
    // translating what was measured at the press costs nothing, where
    // re-measuring a long document costs the frame. What the shift cannot know
    // is a `position: fixed` element, which does not move with the page —
    // `finish` measures again before any id is committed for that reason.
    const shiftBoxes = () => {
      if (!drag) return;
      const dx = scrollX - drag.scrollX;
      const dy = scrollY - drag.scrollY;
      if (!dx && !dy) return;
      for (const box of drag.boxes) { box.left -= dx; box.top -= dy; }
      drag.scrollX = scrollX;
      drag.scrollY = scrollY;
    };
    const frame = () => {
      if (!drag) return;
      drag.raf = 0;
      shiftBoxes();
      const r = rectOf(drag);
      Object.assign(marquee.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      drag.ids = G().idsInRect(r, drag.boxes);
      paintHits(drag.ids, drag.boxes);
    };
    const scheduleFrame = () => { if (drag && !drag.raf) drag.raf = requestAnimationFrame(frame); };
    // The one place a drag ends: cancel its pending frame, blank the marquee
    // and every outline, and let go of the state.
    const endDrag = () => {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      drag = null;
      marquee.hidden = true;
      // The pool lives for the drag, not for the page: it grows to the largest
      // selection ever painted, and on a document of thousands of addressed
      // elements that is thousands of divs left in the layer.
      for (const hit of hits.splice(0)) hit.remove();
    };

    // ---------------------------------------------------------------- Sketch

    const pathOf = (points) => points.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(' ');
    const newPath = () => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('class', 'marble-marks-stroke');
      el.dataset.state = 'draft';
      ink.append(el);
      return el;
    };
    const endPen = ({ keep = false } = {}) => {
      if (!pen) return null;
      const done = pen;
      pen = null;
      if (keep) return done;
      done.el.remove();
      return null;
    };

    const names = (ids) => {
      if (!ids.length) return 'nothing in particular';
      if (ids.length === 1) return ids[0];
      return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
    };
    /** What the agent will be told about one mark, in the words the person
     *  sees under their own pointer. */
    const phraseOf = (mark) => {
      if (mark.kind === 'box') return `a box around ${names(mark.ids)}`;
      if (mark.kind === 'arrow') return `an arrow from ${mark.from ?? 'nothing'} to ${mark.to ?? 'nothing'}`;
      return `ink over ${names(mark.ids)}`;
    };
    const idsOf = (mark) => (mark.kind === 'arrow' ? [mark.from, mark.to].filter(Boolean) : mark.ids);
    const drafts = () => marks.filter((mark) => !mark.sent);
    const note = () => {
      const phrases = drafts().map(phraseOf);
      if (!phrases.length) return '';
      return `I marked up the page: ${phrases.join('; ')}. `;
    };

    /** Points as they are now, from the anchor's box as it is now. */
    const pointsOf = (part, box) => G().fromFractions(box, part.pairs);
    const repaint = () => {
      for (const mark of marks) {
        const box = boxOf(mark.anchorId);
        for (const part of mark.parts) {
          if (!box) { part.el.setAttribute('d', ''); continue; }
          part.el.setAttribute('d', pathOf(pointsOf(part, box)));
        }
      }
    };
    let repainting = 0;
    const scheduleRepaint = () => { if (!repainting) repainting = requestAnimationFrame(() => { repainting = 0; repaint(); }); };

    const commitStroke = (points) => {
      const geometry = G();
      if (points.length < 3 || geometry.lengthOf(points) < SCRATCH) return false;
      const kind = geometry.readStroke(points);
      // A short stroke at the end of the arrow just drawn is the head someone
      // put on it, not a second mark — and which end it is on is which way the
      // arrow points.
      const last = marks[marks.length - 1];
      if (last && !last.sent) {
        // Measured where the shaft is *now*, not where it was drawn: the page
        // may have scrolled between the two strokes.
        const shaftBox = boxOf(last.anchorId);
        const shaft = shaftBox ? pointsOf(last.parts[0], shaftBox) : last.points;
        const end = geometry.arrowHeadFor({ kind: last.kind, points: shaft }, points, { elapsed: Date.now() - last.at });
        if (end) {
          if (end === 'start') { const from = last.from; last.from = last.to; last.to = from; }
          const box = boxOf(last.anchorId) ?? geometry.boundsOf(points);
          last.parts.push({ pairs: geometry.toFractions(box, points), el: newPath() });
          return true;
        }
      }
      const bounds = geometry.boundsOf(points);
      const centre = geometry.centroidOf(points);
      const anchor = elementAt(centre.x, centre.y);
      if (!anchor) return false;
      const anchorId = anchor.getAttribute('data-marble-id');
      const boxes = collectBoxes();
      const mark = {
        kind,
        anchorId,
        at: Date.now(),
        sent: false,
        points,
        parts: [{ pairs: geometry.toFractions(anchor.getBoundingClientRect(), points), el: newPath() }],
        ids: [],
        from: null,
        to: null,
      };
      if (kind === 'arrow') {
        mark.from = idAt(points[0].x, points[0].y);
        mark.to = idAt(points[points.length - 1].x, points[points.length - 1].y);
      } else {
        mark.ids = geometry.idsInRect(bounds, boxes);
      }
      marks.push(mark);
      return true;
    };

    const clearMarks = () => {
      for (const mark of marks.splice(0)) for (const part of mark.parts) part.el.remove();
      caption.hidden = true;
      syncTools();
      if (fromUs) { fromUs = false; agent.select(null); }
    };
    const undoStroke = () => {
      const mark = marks[marks.length - 1];
      if (!mark || mark.sent) return;
      // The head comes off before the arrow does: it was a separate stroke.
      if (mark.parts.length > 1) mark.parts.pop().el.remove();
      else { marks.pop(); for (const part of mark.parts) part.el.remove(); }
      syncSelection();
      syncTools();
    };

    /** Every element the drafts name, in one selection, which is what lights
     *  the callout's handle and the tray's Ask here. */
    const syncSelection = () => {
      const union = [];
      for (const mark of drafts()) for (const id of idsOf(mark)) if (id && !union.includes(id)) union.push(id);
      if (!union.length) {
        if (fromUs) { fromUs = false; agent.select(null); }
        return;
      }
      mine = union;
      fromUs = true;
      agent.select(union);
    };
    const syncTools = () => {
      const count = drafts().length;
      update({ id: 'marks-clear', hidden: count === 0 });
      // Ask here is the drawer's tool and stays the drawer's; what it says
      // while there is a sketch to send is this layer's business.
      update({ id: 'ask', label: count && fromUs ? 'Ask about the sketch' : 'Ask here' });
    };

    // ------------------------------------------------------------ the switch

    const trayEl = () => document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.tray') ?? null;
    /** The overlay is in the top layer and the tray is not, so the tray would
     *  be under it — and the tray is how you get back out. Clip the corner it
     *  stands in out of the overlay, and the clicks there reach it again. */
    const punch = () => {
      const r = trayEl()?.getBoundingClientRect();
      if (!r?.width || !r?.height) { overlay.style.clipPath = ''; return; }
      const pad = 10;
      const x0 = Math.max(0, Math.round(r.left - pad));
      const y0 = Math.max(0, Math.round(r.top - pad));
      const x1 = Math.round(r.right + pad);
      const y1 = Math.round(r.bottom + pad);
      overlay.style.clipPath = `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z M${x0} ${y0}H${x1}V${y1}H${x0}Z")`;
    };

    function setMode(next) {
      // A mode being left never leaves its drag behind: hiding the overlay
      // takes it out of hit-testing (and drops its pointer capture with it),
      // so a pointerup after this point would never reach `finish`.
      endDrag();
      endPen();
      mode = next;
      layer.dataset.mode = next ?? '';
      overlay.hidden = !next;
      caption.hidden = true;
      if (next) punch();
      for (const [id, name] of [['marks-select', 'select'], ['marks-sketch', 'sketch']]) {
        update({ id, active: mode === name, label: mode === name ? (name === 'select' ? 'Stop selecting' : 'Stop sketching') : LABELS[name] });
      }
      // The callout's handle would be drawn under the overlay and unclickable;
      // it comes back when the mode ends.
      dispatchEvent(new CustomEvent('marble-marks:mode', { detail: { mode } }));
    }
    function toggleMode(name) { setMode(mode === name ? null : name); }

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag || pen) return;
      // The page never sees this press: no text selection starts under it.
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      if (mode === 'select') {
        drag = {
          id: event.pointerId, x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY,
          boxes: collectBoxes(), scrollX, scrollY, ids: [], raf: 0,
        };
        marquee.hidden = false;
        frame();
        return;
      }
      if (mode === 'sketch') {
        caption.hidden = true;
        pen = { id: event.pointerId, points: [{ x: event.clientX, y: event.clientY }], el: newPath() };
        pen.el.setAttribute('d', pathOf(pen.points));
      }
    });
    overlay.addEventListener('pointermove', (event) => {
      if (drag && event.pointerId === drag.id) {
        drag.x1 = event.clientX;
        drag.y1 = event.clientY;
        scheduleFrame();
        return;
      }
      if (pen && event.pointerId === pen.id) {
        // Every point the browser had between frames, so a fast stroke is a
        // curve rather than a polygon.
        const moves = event.getCoalescedEvents?.() ?? [event];
        for (const move of moves) {
          const last = pen.points[pen.points.length - 1];
          if (Math.hypot(move.clientX - last.x, move.clientY - last.y) < THIN) continue;
          pen.points.push({ x: move.clientX, y: move.clientY });
        }
        pen.el.setAttribute('d', pathOf(pen.points));
        return;
      }
      if (mode === 'sketch') hover(event);
    });
    const finish = (event) => {
      if (pen && event.pointerId === pen.id) {
        const done = endPen({ keep: true });
        done.el.remove();
        if (commitStroke(done.points)) {
          repaint();
          syncSelection();
          syncTools();
        }
        return;
      }
      if (!drag || event.pointerId !== drag.id) return;
      cancelAnimationFrame(drag.raf);
      drag.raf = 0;
      // The release point, not the last move: a finger usually travels a few
      // pixels between the two, and the rectangle a person let go of is the
      // one they meant.
      drag.x1 = event.clientX;
      drag.y1 = event.clientY;
      // Measured again, once, before anything is committed. The live outline
      // follows a scroll by translating the boxes from the press, which is
      // wrong for a `position: fixed` element that stayed where it was — so
      // the outline may drift a pixel mid-scroll, while the ids handed to an
      // agent are always measured fresh. A briefly wrong outline and a wrong
      // id reaching an agent are not mistakes of the same order.
      drag.boxes = collectBoxes();
      drag.scrollX = scrollX;
      drag.scrollY = scrollY;
      frame();
      const ids = drag.ids;
      const prior = event.shiftKey ? agent.context().selection : [];
      endDrag();
      const union = [...prior, ...ids.filter((id) => !prior.includes(id))];
      mine = union;
      fromUs = union.length > 0;
      agent.select(union.length ? union : null);
      syncTools();
      setMode(null);
    };
    overlay.addEventListener('pointerup', finish);
    // A cancel is not a release: a pinch during a marquee — which the
    // overlay's `touch-action: pinch-zoom` invites — takes the pointer away
    // mid-rectangle, and committing the half-drawn one would name whatever the
    // hand happened to be over. Escape mid-drag discards; so does this.
    overlay.addEventListener('pointercancel', (event) => {
      if (drag && event.pointerId === drag.id) endDrag();
      if (pen && event.pointerId === pen.id) endPen();
    });

    /** The reading of the stroke under the pointer, in words. */
    const hover = (event) => {
      let found = null;
      for (const mark of marks) {
        const box = boxOf(mark.anchorId);
        if (!box) continue;
        for (const part of mark.parts) {
          const points = pointsOf(part, box);
          // The stroke's own box first: a pointer nowhere near it costs four
          // comparisons rather than a walk down every point in it.
          const span = G().boundsOf(points);
          if (event.clientX < span.left - 14 || event.clientX > span.left + span.width + 14
            || event.clientY < span.top - 14 || event.clientY > span.top + span.height + 14) continue;
          for (const p of points) {
            if (Math.hypot(p.x - event.clientX, p.y - event.clientY) > 14) continue;
            found = mark;
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
      if (!found) { caption.hidden = true; return; }
      caption.textContent = phraseOf(found);
      caption.hidden = false;
      const r = caption.getBoundingClientRect();
      caption.style.left = `${Math.min(Math.max(8, event.clientX + 14), innerWidth - r.width - 8)}px`;
      caption.style.top = `${Math.min(Math.max(8, event.clientY + 16), innerHeight - r.height - 8)}px`;
    };

    // Wheel passes through the overlay and the page moves under the drag; the
    // ink moves with the elements it was drawn on.
    addEventListener('scroll', () => { if (drag) scheduleFrame(); scheduleRepaint(); }, true);
    addEventListener('resize', () => { scheduleRepaint(); if (mode) punch(); });
    // An agent rewriting the page is the other way an anchor moves — and so
    // is the pinned drawer taking a margin off `<html>`, which is a reflow
    // and not a resize of the window. Watching the root catches both, and
    // every reflow a document does to itself besides.
    document.addEventListener('marble:ops', scheduleRepaint);
    new ResizeObserver(scheduleRepaint).observe(document.documentElement);

    addEventListener('keydown', (event) => {
      if (mode === 'sketch' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (!marks.length) return;
        event.preventDefault();
        event.stopPropagation();
        undoStroke();
        return;
      }
      if (event.key !== 'Escape') return;
      // Escape inside a mode leaves it; the ink it drew stays, because it is
      // the brief, not the mode.
      if (mode) { event.preventDefault(); event.stopPropagation(); setMode(null); return; }
      if (fromUs) { fromUs = false; agent.select(null); syncTools(); }
    }, true);

    // A fresh text selection is the person choosing something else; so is any
    // other selection this layer did not make.
    addEventListener('marble:agent-context', () => {
      if (!fromUs) return;
      const now = agent.context().selection;
      if (now.length === mine.length && now.every((id, i) => id === mine[i])) return;
      fromUs = false;
      syncTools();
    });

    // The drawer opening covers the page a mode acts on, and its panel is not
    // in the top layer the overlay is — so the mode ends rather than draw over
    // a panel it cannot reach.
    const panel = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.panel');
    if (panel) {
      new MutationObserver(() => {
        if (panel.dataset.open === 'true' && panel.dataset.pinned !== 'true' && mode) setMode(null);
      }).observe(panel, { attributes: true, attributeFilter: ['data-open', 'data-pinned'] });
    }
    const tray = trayEl();
    if (tray) {
      // The hole follows the tray: it grows a row when a tool appears, and it
      // moves inward with the page's edge when the drawer is pinned.
      new ResizeObserver(() => { if (mode) punch(); }).observe(tray);
      new MutationObserver(() => { if (mode) punch(); }).observe(tray, { attributes: true, attributeFilter: ['style', 'data-away', 'data-open'] });
    }

    // The callout card that a sketch summoned gets the reading as the first
    // sentence of its draft — the person's to edit, and the only thing this
    // layer ever writes into a composer.
    addEventListener('marble-callout:card', (event) => {
      const convo = event.detail?.convo;
      const text = fromUs ? note() : '';
      if (!convo || !text) return;
      const sent = drafts();
      convo.draft?.(text);
      // Dimmed once the brief is actually on its way, not when the card opens:
      // a card that is closed without sending leaves the marks yours.
      convo.addEventListener('conversation', () => {
        for (const mark of sent) {
          mark.sent = true;
          for (const part of mark.parts) part.el.dataset.state = 'sent';
        }
        syncTools();
      }, { once: true });
    });

    setMode(null);
    syncTools();
    return true;
  };

  const start = () => {
    if (boot(window.marble)) return;
    // No tray yet: the drawer says so when it mounts.
    addEventListener('marble-tray:ready', () => boot(window.marble), { once: true });
  };

  if (window.marble?.agent) start();
  else addEventListener('marble:agent', start, { once: true });
})();
