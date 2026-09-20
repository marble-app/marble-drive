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
