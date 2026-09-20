
/* ===== shell ===== */
/* ── the phone shell ────────────────────────────────────────────────────────

   Four pieces of chrome, all of them the page's and none of them the file's:

     .pm-opts   the one new control — the rest of the rail, on request
     .pm-grab   the sheet's own edge, which is also how you shut it
     .pm-scrim  what "tap outside to dismiss" is made of
     .pm-head   the document's name, and the name of the view the bar is lit on

   Everything else the phone layout does is CSS moving elements that were
   already in the file. This script exists for the three things CSS cannot say:
   which view is current *in words*, whether the sheet is open, and where the
   lit pill is in a strip that scrolls.

   Nothing here files an op, because nothing here is a change to the document.
   Which view you are reading is already written on .stage as data-arrange; the
   name in the header is read back out of it, never stored beside it. Open and
   shut is the page's business and lives in a marble- prefixed class, which the
   carrier hands back after a reconcile instead of replacing with the file's
   idea of it.                                                                */

(function () {
  'use strict';

  var rail  = document.querySelector('.rail');
  var nav   = rail && rail.querySelector('.nav');
  var stage = document.querySelector('.stage');
  if (!rail || !nav || !stage) return;          // a different document: do nothing

  var PHONE = 720;
  function isPhone() {
    /* the same question the stylesheet asks: the width of <html>, which is the
       `doc` container, and not the width of the window — a docked host panel
       narrows the one and leaves the other alone */
    return document.documentElement.clientWidth <= PHONE;
  }
  function calm() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── the chrome ───────────────────────────────────────────────────────────

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    n.className = cls;
    n.setAttribute('data-marble-transient', '');
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  // the toggle goes first in the bar, so the order a finger reads it in and the
  // order a keyboard reaches it in are the same order
  var optsLi = el('li', 'pm-opts');
  var optsBtn = el('button', '', {
    type: 'button',
    'aria-expanded': 'false',
    'aria-haspopup': 'dialog',
    'aria-label': 'Document options'
  });
  optsBtn.textContent = '⋯';               // ⋯
  optsLi.appendChild(optsBtn);
  nav.insertBefore(optsLi, nav.firstChild);

  var grab = el('button', 'pm-grab', { type: 'button', 'aria-label': 'Close options' });
  rail.insertBefore(grab, rail.firstChild);

  var scrim = el('div', 'pm-scrim');
  document.body.appendChild(scrim);

  var head = el('div', 'pm-head');
  var headDoc = el('span', 'pm-head-doc');
  var headView = el('span', 'pm-head-view');
  head.appendChild(headDoc);
  head.appendChild(headView);
  stage.insertBefore(head, stage.firstChild);

  // ── open and shut ────────────────────────────────────────────────────────

  var OPEN = 'marble-pm-open';
  var lastFocus = null;

  function open() { return rail.classList.contains(OPEN); }

  function setOpen(on) {
    if (on === open()) return;
    rail.classList.toggle(OPEN, on);
    scrim.classList.toggle('marble-pm-on', on);
    optsBtn.setAttribute('aria-expanded', String(on));
    if (on) {
      lastFocus = document.activeElement;
      grab.focus({ preventScroll: true });
      rail.scrollTop = 0;
    } else if (lastFocus && document.contains(lastFocus)) {
      lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  }

  optsBtn.addEventListener('click', function () { setOpen(!open()); });
  grab.addEventListener('click', function () { setOpen(false); });
  scrim.addEventListener('click', function () { setOpen(false); });

  document.addEventListener('keydown', function (e) {
    if (!open()) return;
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
    if (e.key !== 'Tab') return;
    /* Focus stays inside the sheet while the sheet is over the page, because a
       cursor you cannot see is worse than no cursor. The bar counts as part of
       it — it is literally inside it — so the toggle is the last stop and Tab
       from there comes back round to the top. */
    var stops = rail.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]'
    );
    var live = [];
    for (var i = 0; i < stops.length; i++) {
      var s = stops[i];
      if (s.disabled) continue;
      if (!s.getClientRects().length) continue;
      if (getComputedStyle(s).visibility === 'hidden') continue;
      live.push(s);
    }
    if (!live.length) return;
    var first = live[0], last = live[live.length - 1];
    var at = document.activeElement;
    if (e.shiftKey && (at === first || !rail.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !rail.contains(at))) { e.preventDefault(); first.focus(); }
  }, true);

  // ── what the header says ─────────────────────────────────────────────────

  /* The lit pill is derived by the document itself, from data-arrange and
     data-show, onto every [data-preset] it found at load. So the name of the
     current view is not a ninth thing to keep — it is read back off whichever
     button the document lit. When no preset matches (a pair of dial settings
     nobody gave a name to) the arrangement's own word stands in. */
  function litPreset() {
    return nav.querySelector('button[data-preset].marble-on');
  }

  function viewName() {
    var lit = litPreset();
    if (lit) {
      var n = lit.querySelector('.n');
      var label = lit.textContent || '';
      if (n) label = label.replace(n.textContent, '');
      return label.trim();
    }
    return (stage.getAttribute('data-arrange') || '').trim();
  }

  function derive() {
    var title = document.querySelector('.rail-title');
    headDoc.textContent = title ? (title.textContent || '').trim() : '';
    headView.textContent = viewName();
  }

  /* Bring the lit pill into view — but only when it is actually out of it, so
     this never argues with a strip the reader is scrolling themselves. */
  function reveal(smooth) {
    if (!isPhone()) return;
    var lit = litPreset();
    if (!lit) return;
    var li = lit.closest('li');
    if (!li) return;
    var bar = nav.getBoundingClientRect();
    var pill = li.getBoundingClientRect();
    var maskedLeft = bar.left + optsLi.getBoundingClientRect().width;
    if (pill.left >= maskedLeft - 1 && pill.right <= bar.right + 1) return;
    var to = nav.scrollLeft + (pill.left - maskedLeft) - 8;
    nav.scrollTo({ left: Math.max(0, to), behavior: smooth && !calm() ? 'smooth' : 'auto' });
  }

  var queued = false;
  function refresh(smooth) {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      derive();
      reveal(smooth !== false);
    });
  }

  /* data-arrange and data-show are the facts; the document repaints the pills
     synchronously when they change, so by the time this observer runs the lit
     button is already the right one. This catches every route into a view —
     a pill, a dial, an undo, or the file changing underneath us. */
  new MutationObserver(function () { refresh(true); }).observe(stage, {
    attributes: true,
    attributeFilter: ['data-arrange', 'data-show', 'data-focus']
  });

  // ── phone / not-phone ────────────────────────────────────────────────────

  /* The rail is a plain complementary landmark on a wide screen and a sheet on
     a narrow one, and only one of those is worth telling a screen reader about.
     These attributes are the page's reading of the file, so they are re-applied
     from marble.register: a reconcile against the file is exactly the moment a
     page-applied attribute has just been lost. */
  var wasPhone = null;
  function fit() {
    var phone = isPhone();
    if (phone === wasPhone) return;
    wasPhone = phone;
    if (phone) {
      optsBtn.setAttribute('aria-haspopup', 'dialog');
    } else {
      setOpen(false);
    }
    refresh(false);
  }

  function adopt() {
    /* Re-assert everything the page owns. The carrier hands the whole body to
       what a document registered after it has reconciled against the file,
       which is exactly the moment page-owned chrome has just been read over.
       insertBefore moves a node that is already there, so each of these is
       idempotent and also repairs position, not only presence. */
    if (nav.firstChild !== optsLi) nav.insertBefore(optsLi, nav.firstChild);
    if (rail.firstChild !== grab) rail.insertBefore(grab, rail.firstChild);
    if (!document.body.contains(scrim)) document.body.appendChild(scrim);
    if (stage.firstChild !== head) stage.insertBefore(head, stage.firstChild);
    refresh(false);
  }

  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(document.documentElement);
  } else {
    addEventListener('resize', fit);
  }
  fit();

  addEventListener('DOMContentLoaded', function () { refresh(false); });
  addEventListener('load', function () { refresh(false); });

  function begin(marble) { marble.register(adopt); }
  if (window.marble) begin(window.marble);
  else addEventListener('marble:ready', function () { if (window.marble) begin(window.marble); });
}());

/* ===== band ===== */
/* The band's strip, and the one thing CSS cannot say about it.
   ────────────────────────────────────────────────────────────
   On a phone the band is a horizontal scroller with its scrollbar hidden, and a
   scroller you cannot reach from a keyboard is a part of the document that only
   exists for people with a finger. Every card in the strip is already a button,
   so tabbing walks through them and the strip follows — but the strip itself
   should also be a place you can land and push with the arrow keys, the way a
   browser now makes any scroller that shows a scrollbar.

   `tabindex` is the page's here and never the file's. It is not a fact about
   this document, it is a fact about whether the strip happens to overflow the
   width it was given right now, so it is derived from that and re-derived every
   time the answer could have changed — including after the carrier reconciles
   the page against the file, which is exactly when a derived attribute has just
   been lost. With no host at all none of this is any different: nothing here
   asks the carrier for anything it cannot do without. */
(() => {
  const carrier = typeof window !== 'undefined' ? window.marble : null;

  // So a host never writes this attribute into the file.
  try { carrier && carrier.pageOnly && carrier.pageOnly('tabindex'); } catch (e) { /* older carrier */ }

  let watched = null;

  function reach() {
    const band = document.querySelector('.band');
    if (!band) return;
    const scrolls = band.scrollWidth - band.clientWidth > 1;
    if (scrolls) {
      if (band.getAttribute('tabindex') !== '0') band.setAttribute('tabindex', '0');
    } else if (band.hasAttribute('tabindex')) {
      // Do not leave a tab stop on a strip that has nothing to scroll: on a wide
      // screen the band is a plain row and stopping there says nothing.
      band.removeAttribute('tabindex');
    }
    watch(band);
  }

  // The answer changes when the container is resized, and when a card is pinned
  // or unpinned — which is a child list change the strip's own size never sees.
  function watch(band) {
    if (watched === band) return;
    watched = band;
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(reach);
      ro.observe(band);
      ro.observe(document.documentElement);
    } else {
      window.addEventListener('resize', reach);
    }
    if (typeof MutationObserver === 'function') {
      new MutationObserver(reach).observe(band, { childList: true });
    }
  }

  if (carrier && carrier.register) carrier.register(reach);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reach);
  else reach();
})();

/* ===== columns ===== */
/* ── sideways, made legible ───────────────────────────────────────────────
   The stylesheet turned the three laned boards into a carousel. This is the
   part CSS cannot do: say which column you are in, and let you get to one
   without swiping through the five in front of it.

   Two pieces of chrome, both the page's and neither the file's. A strip of
   segments above the board — one per column, lit for the one being read,
   tappable. And a pill that surfaces while the board is moving and names the
   column it has landed on, because the lane header cannot stay in view: the
   pool is its own scrollport and it does not scroll vertically, so there is
   nothing for a sticky header to stick to.

   Everything here is derived from where the board is scrolled to and from the
   lane elements already in the file. Nothing is stored, nothing is filed, and
   every use of the carrier is guarded — with no host at all this still works,
   it just forgets nothing, because there was never anything to remember. */
(() => {
  const stage = document.querySelector('.stage');
  const pool = document.querySelector('.pool');
  if (!stage || !pool) return;

  const LANED = ['form', 'when', 'term'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* The breakpoint is written down once, in the container query, and read
     back from here. A script that measures the window for itself is a second
     copy of that decision, and the two go out of step the first time a host
     docks a panel beside the document. */
  const phone = () =>
    getComputedStyle(pool).getPropertyValue('--rv-phone').trim() === '1';

  const arrange = () => stage.getAttribute('data-arrange');
  const carousel = () => phone() && LANED.includes(arrange());

  const lanes = () =>
    [...pool.children].filter(
      (el) => el.classList.contains('lane') && el.getClientRects().length > 0,
    );

  // ── the chrome ─────────────────────────────────────────────────────────
  let strip = null;
  let count = null;
  let track = null;
  let hud = null;

  function ensureChrome() {
    if (!strip || !strip.isConnected) {
      strip = document.createElement('nav');
      strip.className = 'rv-cols';
      strip.setAttribute('data-marble-transient', '');
      strip.setAttribute('aria-label', 'Columns');

      count = document.createElement('span');
      count.className = 'rv-cols-n';
      strip.append(count);

      track = document.createElement('span');
      track.className = 'rv-cols-track';
      strip.append(track);

      builtFor = '';
      pool.parentElement.insertBefore(strip, pool);
    }
    if (!hud || !hud.isConnected) {
      hud = document.createElement('div');
      hud.className = 'rv-hud';
      hud.setAttribute('data-marble-transient', '');
      // The strip's buttons carry aria-current, which is the accessible
      // answer to the same question. The pill is the visual echo of it, and
      // announcing both would only say it twice.
      hud.setAttribute('aria-hidden', 'true');
      document.body.append(hud);
    }
  }

  /* One button per lane. Rebuilt only when the set of lanes changes — which
     is a view switch, not a scroll — so a swipe touches nothing but two
     attributes and a string. */
  let builtFor = '';
  function buildTrack(list) {
    const key = arrange() + ':' + list.length;
    if (key === builtFor) return;
    builtFor = key;
    track.textContent = '';
    list.forEach((lane, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'rv-dot';
      dot.setAttribute('data-marble-transient', '');
      const head = lane.querySelector('h4');
      dot.setAttribute('aria-label', (head && head.textContent.trim()) || 'Column ' + (i + 1));
      dot.addEventListener('click', () => {
        lane.scrollIntoView({
          inline: 'start',
          block: 'nearest',
          behavior: reduced.matches ? 'auto' : 'smooth',
        });
        // The pill is the receipt for a tap as much as for a swipe: the board
        // is about to move under a finger that is not on it.
        flash();
      });
      track.append(dot);
    });
  }

  // ── which column ───────────────────────────────────────────────────────
  /* Measured against the snapport rather than by arithmetic on scrollLeft:
     the column width is a min() of two units and the trailing padding is a
     calc() of a third, so the browser's own numbers are the only ones worth
     trusting here. */
  function currentIndex(list) {
    const left = pool.getBoundingClientRect().left;
    const pad = parseFloat(getComputedStyle(pool).scrollPaddingLeft) || 0;
    let best = 0;
    let nearest = Infinity;
    list.forEach((lane, i) => {
      const d = Math.abs(lane.getBoundingClientRect().left - left - pad);
      if (d < nearest) { nearest = d; best = i; }
    });
    return best;
  }

  let shown = -1;
  function sync() {
    ensureChrome();
    if (!carousel()) {
      builtFor = '';
      shown = -1;
      hud.removeAttribute('data-rv-on');
      hud.classList.remove('rv-lit');
      return;
    }
    const list = lanes();
    if (!list.length) return;
    buildTrack(list);
    hud.setAttribute('data-rv-on', '');

    const at = currentIndex(list);
    if (at === shown) return;
    shown = at;

    const place = (at + 1) + ' / ' + list.length;
    count.textContent = place;
    [...track.children].forEach((dot, i) => {
      if (i === at) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });

    const head = list[at].querySelector('h4');
    hud.textContent = '';
    const n = document.createElement('b');
    n.textContent = place;
    hud.append(n, document.createTextNode((head && head.textContent.trim()) || ''));
  }

  // ── the pill's life ────────────────────────────────────────────────────
  let fade = 0;
  function flash() {
    if (!carousel()) return;
    hud.classList.add('rv-lit');
    clearTimeout(fade);
    fade = setTimeout(() => hud.classList.remove('rv-lit'), 1100);
  }

  /* A scroll fires far faster than anything on screen can change, so the work
     is coalesced onto one frame and the listener itself does nothing but ask
     for that frame. */
  let queued = false;
  pool.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
      flash();
    });
  }, { passive: true });

  // ── the full bleed ─────────────────────────────────────────────────────
  /* Everything that scrolls sideways on a phone — the board and each framing
     — is pulled out to the screen edges, so what cuts the next column off is
     the screen and not a text margin. How far out is the stage's own side
     padding, which is not a number this file gets to assume: it is measured.

     The answer is published through a page-only stylesheet rather than as an
     inline style on the pool, because the pool is an element in the file and
     the framings are in a different part of it. One derived declaration on
     <body>, inherited by both, and nothing addressable is touched. */
  let sheet = null;
  let bled = '';
  function bleed() {
    if (!sheet || !sheet.isConnected) {
      sheet = document.createElement('style');
      sheet.setAttribute('data-marble-transient', '');
      // In the body rather than the head, because that is where a carrier
      // looks for what belongs to the page. If it goes missing anyway the
      // two lengths fall back to the ones written in the stylesheet, which
      // are the ones this document has today — so the worst case is that the
      // board stops keeping up with a padding change, not that it breaks.
      document.body.append(sheet);
      bled = '';
    }
    const host = pool.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const l = box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const r = document.documentElement.clientWidth
      - (box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight));
    const next = 'body{--rv-bleed-l:' + Math.max(0, Math.round(l)) + 'px;'
      + '--rv-bleed-r:' + Math.max(0, Math.round(r)) + 'px}';
    if (next === bled) return;
    bled = next;
    sheet.textContent = next;
  }

  // ── the map, on a phone ────────────────────────────────────────────────
  /* The map arrangement switches the pool's canvas affordance on, because on
     a wide screen the whole point of the view is moving cards around. At this
     width the stylesheet has stacked those cards in file order, so a drag
     would file coordinates describing a layout nobody can see — and the
     inverse of that op is another set of coordinates, so undo would not even
     make it right.

     The affordance itself is left alone: turning it off is a fact about the
     document, it would file an op, and it would still be off when the same
     file opened on a laptop tomorrow. What is suppressed is the gesture, and
     only at this width. A listener in the capture phase on the pool runs
     before the pool's own pointerdown handler, which is where a drag begins.
     Clicks, taps and typing are separate events and are untouched. */
  pool.addEventListener('pointerdown', (event) => {
    if (!phone() || arrange() !== 'map') return;
    event.stopPropagation();
  }, true);

  // ── keeping up ─────────────────────────────────────────────────────────
  /* A view switch changes which lanes exist and how many of them. It also
     leaves the board scrolled to wherever the last view was left, which on a
     narrower board is a column that is no longer there — so every switch
     opens on the first column, the way arriving at a board should. */
  new MutationObserver(() => {
    bleed();
    if (carousel()) pool.scrollTo({ left: 0, behavior: 'auto' });
    shown = -1;
    builtFor = '';
    sync();
  }).observe(stage, { attributes: true, attributeFilter: ['data-arrange'] });

  new ResizeObserver(() => {
    bleed();
    shown = -1;
    sync();
  }).observe(document.documentElement);

  /* A reconcile against the file is exactly the moment a page-only node has
     just been lost and a derived value has just gone stale, so the carrier is
     asked to say when that happens. With no host it never does, and the call
     below is the whole of it. */
  function adopt(marble) {
    if (!marble || !marble.register) return;
    marble.register(() => { ensureChrome(); bleed(); shown = -1; sync(); });
  }
  if (window.marble) adopt(window.marble);
  else addEventListener('marble:ready', (e) => adopt(e.detail), { once: true });

  ensureChrome();
  bleed();
  sync();
})();
