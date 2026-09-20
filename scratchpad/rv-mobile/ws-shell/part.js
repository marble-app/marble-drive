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
