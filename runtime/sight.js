// Where a part of the page can actually be seen, for everything drawn over
// it: the change marks (change-marks.js), the zones and the press ring
// (collab.js), the caret in the text (agent-text.js) and the marks an agent
// is working from (agent-marks.js).
//
// A mark stands on its part, so it is seen only where the part is: not on a
// slide that has been switched away, a tab that is closed, a panel faded
// out; not past the edge of the box a part scrolls inside, though that edge
// is well within the window; and not over a bar, a sheet or a menu of the
// page's own that has come up over the part. A rect alone says none of
// that: a part on a hidden slide still has one, where it last stood, and a
// row scrolled out of its list is still within the window. So:
//
//   - shown: the part is rendered and not hidden by visibility or a zero
//     opacity, its own or an ancestor's (checkVisibility);
//   - clipped: the rect is cut to the window and to every box that clips
//     it, following the containing blocks (an absolutely placed part
//     escapes an unpositioned scroller; a fixed one escapes them all);
//   - covered: a few points across what is left are asked what is on top.
//     Anything that paints there and is neither the part, inside it nor
//     round it is over it: its box is cut out of the part's, as a band off
//     an edge (a header the part has scrolled under) or a hole (a menu over
//     its middle). All covered, the part is not seen.
//
// And `watch`, for movement no event tells of: a slide sliding, a sheet
// rising, a part growing as its picture loads. While a layer has something
// drawn, each frame compares the drawn parts' rects with the last paint's,
// and asks for a paint while any animation of the page runs.
//
// Loaded before collab.js; touches the page only to read it.

(() => {
  if (window.marbleSight) return;

  // A layer of marks is never what covers a part: it is drawn over the part
  // on purpose. Each carries this attribute.
  const OVERLAY = 'data-marble-overlay';
  const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'PROGRESS', 'METER']);
  const EDGE = 3;        // px in from an edge a sample is taken
  const TALL = 240;      // px past which a part gets two more rows of samples
  const SLIVER = 2;      // px a visible box must have each way to count
  const FAR = 100000;    // px a clip reaches on a side that is not cut

  const transparent = (colour) => !colour || colour === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(colour) || /\/\s*0\)$/.test(colour);
  const visibleOpts = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };

  /** One paint's worth of looking. Styles and clips are asked once per
   *  element per paint, since siblings share their ancestors. */
  function look() {
    const styles = new Map();
    const clipsAt = new Map();
    const paints = new Map();
    const style = (el) => {
      let cs = styles.get(el);
      if (!cs) { cs = getComputedStyle(el); styles.set(el, cs); }
      return cs;
    };
    const html = document.documentElement;
    const view = { left: 0, top: 0, right: html.clientWidth || innerWidth, bottom: html.clientHeight || innerHeight };
    const htmlClips = (() => { const cs = style(html); return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'; })();

    const parentOf = (el) => el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

    /** Whether a box is the containing block of fixed descendants. */
    const holdsFixed = (cs) => (cs.transform && cs.transform !== 'none') || (cs.filter && cs.filter !== 'none')
      || (cs.perspective && cs.perspective !== 'none') || /paint|layout|strict|content/.test(cs.contain || '')
      || /transform|filter|perspective/.test(cs.willChange || '') || (cs.backdropFilter && cs.backdropFilter !== 'none');

    /** The box an ancestor clips its content to, in the window's terms. */
    function clipBox(p, cs) {
      const x = cs.overflowX !== 'visible' || /paint|strict|content/.test(cs.contain || '');
      const y = cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain || '');
      if (!x && !y) return null;
      const r = p.getBoundingClientRect();
      const sx = p.offsetWidth ? r.width / p.offsetWidth : 1;
      const sy = p.offsetHeight ? r.height / p.offsetHeight : 1;
      const left = r.left + p.clientLeft * sx;
      const top = r.top + p.clientTop * sy;
      return {
        left: x ? left : -FAR,
        right: x ? left + (p.clientWidth || r.width) * sx : FAR,
        top: y ? top : -FAR,
        bottom: y ? top + (p.clientHeight || r.height) * sy : FAR,
      };
    }

    /** Every box between a part and the window that clips it, met. */
    function clipOf(el) {
      if (clipsAt.has(el)) return clipsAt.get(el);
      let box = { ...view };
      let pos = style(el).position;
      for (let p = parentOf(el); p && p !== html; p = parentOf(p)) {
        if (p === document.body && !htmlClips) break;
        const cs = style(p);
        if (cs.display === 'contents') continue;
        // Only the containing blocks clip: an absolute part leaves every
        // unpositioned box behind; a fixed one leaves all but a transformed one.
        if (pos === 'fixed' && !holdsFixed(cs)) continue;
        if (pos === 'absolute' && cs.position === 'static' && !holdsFixed(cs)) continue;
        const c = clipBox(p, cs);
        if (c) {
          box = {
            left: Math.max(box.left, c.left), top: Math.max(box.top, c.top),
            right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom),
          };
          if (box.right - box.left < SLIVER || box.bottom - box.top < SLIVER) break;
        }
        pos = cs.position;
      }
      clipsAt.set(el, box);
      return box;
    }

    /** Whether what was hit at a point paints there, or lets the page
     *  behind it show through (a transparent wrapper, a click-catcher). */
    function paintsAt(el) {
      if (paints.has(el)) return paints.get(el);
      let out;
      if (REPLACED.has(el.tagName) || el instanceof SVGElement) out = true;
      else {
        const cs = style(el);
        out = !transparent(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')
          || (cs.backdropFilter && cs.backdropFilter !== 'none')
          || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      }
      if (out && el.checkVisibility && !el.checkVisibility(visibleOpts)) out = false;
      paints.set(el, out);
      return out;
    }

    /** The deepest element at a point, through open shadow roots. */
    function deepest(el, x, y) {
      let node = el;
      for (let i = 0; i < 8 && node?.shadowRoot; i++) {
        const inner = node.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === node) break;
        node = inner;
      }
      return node;
    }

    /** What covers a part at one point: null when the part is on top there. */
    function coverAt(el, x, y, skip) {
      const stack = document.elementsFromPoint(x, y);
      for (const hit of stack) {
        if (hit === el || el.contains(hit) || hit.contains(el)) return null;
        if (hit.closest(`[${OVERLAY}]`) || skip?.(hit)) continue;
        const node = deepest(hit, x, y);
        if (node !== hit && (node.closest(`[${OVERLAY}]`) || skip?.(node))) continue;
        if (paintsAt(node)) return node;
      }
      return null;
    }

    const lines = (from, to) => {
      const span = to - from;
      if (span < EDGE * 4) return [(from + to) / 2];
      const out = [from + EDGE, (from + to) / 2, to - EDGE];
      if (span > TALL) out.push(from + span / 4, from + (span * 3) / 4);
      return out;
    };

    /** Where `el` is seen. `rect` is its rect if the caller has it;
     *  `skip` names more of the caller's own chrome to look through. */
    function of(el, { rect = null, skip = null, cover = true } = {}) {
      if (!el?.isConnected) return { shown: false, why: 'gone' };
      const r = rect ?? el.getBoundingClientRect();
      if (!r.width && !r.height) return { shown: false, why: 'hidden', rect: r };
      if (el.checkVisibility ? !el.checkVisibility(visibleOpts) : style(el).visibility === 'hidden') return { shown: false, why: 'hidden', rect: r };
      const clip = clipOf(el);
      const v = {
        left: Math.max(r.left, clip.left), top: Math.max(r.top, clip.top),
        right: Math.min(r.right, clip.right), bottom: Math.min(r.bottom, clip.bottom),
      };
      const side = r.top >= view.bottom ? 'below' : r.bottom <= view.top ? 'above' : null;
      if (v.right - v.left < SLIVER || v.bottom - v.top < SLIVER) {
        // Out of the window, or out of the box it scrolls in: which way.
        const inBox = clip.bottom - clip.top >= SLIVER;
        const way = side ?? (inBox && r.top >= clip.bottom ? 'below' : inBox && r.bottom <= clip.top ? 'above' : null);
        return { shown: false, why: side ? 'outside' : 'clipped', rect: r, side: way };
      }
      const holes = [];
      if (cover && style(el).pointerEvents !== 'none') {
        // Points across what is left; a part that cannot be hit cannot be
        // asked, and is taken as seen.
        const seen = new Map();
        let covered = 0;
        let asked = 0;
        for (const y of lines(v.top, v.bottom)) {
          for (const x of lines(v.left, v.right)) {
            asked += 1;
            const over = coverAt(el, x, y, skip);
            if (!over) continue;
            covered += 1;
            if (!seen.has(over)) seen.set(over, over.getBoundingClientRect());
          }
        }
        if (covered && covered === asked) return { shown: false, why: 'covered', rect: r };
        for (const o of seen.values()) {
          const h = { left: Math.max(o.left, v.left), top: Math.max(o.top, v.top), right: Math.min(o.right, v.right), bottom: Math.min(o.bottom, v.bottom) };
          if (h.right - h.left < 1 || h.bottom - h.top < 1) continue;
          // A band across a whole edge cuts that edge; anything else is a hole.
          const across = h.left <= v.left + 1 && h.right >= v.right - 1;
          const down = h.top <= v.top + 1 && h.bottom >= v.bottom - 1;
          if (across && h.top <= v.top + 1) v.top = h.bottom;
          else if (across && h.bottom >= v.bottom - 1) v.bottom = h.top;
          else if (down && h.left <= v.left + 1) v.left = h.right;
          else if (down && h.right >= v.right - 1) v.right = h.left;
          else holes.push(h);
        }
        if (v.right - v.left < SLIVER || v.bottom - v.top < SLIVER) return { shown: false, why: 'covered', rect: r };
      }
      const cut = { top: v.top > r.top + 0.5, right: v.right < r.right - 0.5, bottom: v.bottom < r.bottom - 0.5, left: v.left > r.left + 0.5 };
      return { shown: true, rect: r, visible: v, cut, holes: merge(holes, v), whole: !cut.top && !cut.right && !cut.bottom && !cut.left && !holes.length };
    }

    return { of, style };
  }

  /** Holes that overlap would cancel out under evenodd: each overlapping
   *  pair becomes the box round both. */
  function merge(holes, v) {
    const out = holes.map((h) => ({ left: Math.max(h.left, v.left), top: Math.max(h.top, v.top), right: Math.min(h.right, v.right), bottom: Math.min(h.bottom, v.bottom) }));
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length && !again; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i];
          const b = out[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            out[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
            out.splice(j, 1);
            again = true;
            break;
          }
        }
      }
    }
    return out;
  }

  const n = (x) => Math.round(x * 10) / 10;

  /** The clip-path that keeps a mark drawn at `box` (the window's terms)
   *  to where its part is seen: '' when nothing of it is cut. A side the
   *  part is not cut on is left open, so a mark that stands out past its
   *  part (a ring, words beside it) keeps that. */
  function clipFor(sight, box) {
    if (!sight?.shown || sight.whole) return '';
    const { visible: v, cut } = sight;
    const left = cut.left ? v.left - box.left : -FAR;
    const top = cut.top ? v.top - box.top : -FAR;
    const right = cut.right ? v.right - box.left : FAR;
    const bottom = cut.bottom ? v.bottom - box.top : FAR;
    if (!sight.holes.length) {
      return `polygon(${n(left)}px ${n(top)}px, ${n(right)}px ${n(top)}px, ${n(right)}px ${n(bottom)}px, ${n(left)}px ${n(bottom)}px)`;
    }
    let d = `M${n(left)} ${n(top)}H${n(right)}V${n(bottom)}H${n(left)}Z`;
    for (const h of sight.holes) {
      d += `M${n(h.left - box.left)} ${n(h.top - box.top)}H${n(h.right - box.left)}V${n(h.bottom - box.top)}H${n(h.left - box.left)}Z`;
    }
    return `path(evenodd, "${d}")`;
  }

  /** Set a mark's clip, writing only when it changed. */
  function clip(el, sight, box) {
    const value = clipFor(sight, box);
    if (el.marbleClip === value) return;
    el.marbleClip = value;
    el.style.clipPath = value;
  }

  // ---------------------------------------------------------------- watching

  const watchers = new Set();
  const NONE = { left: 0, top: 0, width: 0, height: 0 };
  let loop = 0;
  let frames = 0;

  /** Whether the page itself is moving: an animation or a transition that
   *  is not one of the marks' own. */
  function pageMoving() {
    if (typeof document.getAnimations !== 'function') return false;
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue;
      const target = a.effect?.target;
      const el = target?.nodeType === 1 ? target : target?.parentElement;
      if (el && !el.closest?.(`[${OVERLAY}]`) && !el.getRootNode?.()?.host?.closest?.(`[${OVERLAY}]`)) return true;
    }
    return false;
  }

  function tick() {
    loop = 0;
    frames += 1;
    let any = false;
    const moving = frames % 2 === 0 ? pageMoving() : false;
    for (const w of watchers) {
      const parts = w.parts();
      if (!parts) continue;
      any = true;
      // Every few frames a paint whatever the rects say, for what covers a
      // part without moving it (a menu of the page's own opening on hover).
      if (moving || frames % 30 === 0) { w.paint(); continue; }
      for (const [el, was] of parts) {
        if (!el?.isConnected) { w.paint(); break; }
        // A part not measured last paint had no box: it was hidden.
        const last = was ?? NONE;
        const r = el.getBoundingClientRect();
        if (Math.abs(r.left - last.left) > 0.5 || Math.abs(r.top - last.top) > 0.5
          || Math.abs(r.width - last.width) > 0.5 || Math.abs(r.height - last.height) > 0.5) { w.paint(); break; }
      }
    }
    if (any) loop = requestAnimationFrame(tick);
  }

  /** Keep a layer's marks on their parts. `parts()` gives [element, rect at
   *  the last paint] pairs while there is anything drawn, or null; `paint()`
   *  asks the layer for a paint. Call the returned function after a paint
   *  that drew something, to keep watching. */
  function watch({ parts, paint }) {
    const w = { parts, paint };
    watchers.add(w);
    return () => { if (!loop) loop = requestAnimationFrame(tick); };
  }

  // What moves the page with no scroll on window and no mutation: the
  // visual viewport (pinch zoom, the keys coming up), a picture or a font
  // loading, a transition starting or ending, fullscreen.
  const kick = () => { for (const w of watchers) if (w.parts()) w.paint(); };
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', kick);
    visualViewport.addEventListener('scroll', kick);
  }
  for (const type of ['load', 'transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel', 'toggle']) {
    document.addEventListener(type, (event) => {
      const t = event.target;
      if (t?.nodeType === 1 && t.closest(`[${OVERLAY}]`)) return;
      kick();
    }, true);
  }
  document.addEventListener('fullscreenchange', kick);
  document.fonts?.addEventListener?.('loadingdone', kick);

  window.marbleSight = { OVERLAY, look, clip, clipFor, watch };
})();
