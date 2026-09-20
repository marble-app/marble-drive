/* ══ the card's controls, on a screen with no undo key ═════════════════════

   Two gestures in a card commit a change to the file in a single tap, and
   both of them were written for a machine with a keyboard attached.

   A dial steps one place round its ring per click. That is fine with a mouse:
   overshoot costs a Mod+Z, or three more clicks to come back round, and both
   are free. A phone has neither — there is no Mod+Z to press, and a 19px pill
   that advances silently is a control you can only operate by guessing. So on
   touch the dial stops stepping and starts asking. The ring opens, every value
   in it is a 44px row, the one the card is on is ticked, and picking is the
   whole gesture. A control that asks is its own way back, which is the one
   thing stepping could never be: to undo a wrong pick you reopen it and pick
   the right one. Nothing new has to be invented to take it back.

   The other is deleting a card, which the carrier hangs in the left gutter as
   an × at `opacity: 0` waiting for a hover. part.css takes that rail away —
   it also holds a drag handle, and a finger cannot start an HTML5 drag, so
   the rail teaches a gesture the page will not accept — and the delete moves
   in here, into the card's own picker, said in words. That is a real loss and
   it is offered back where it happened, by the undo the document already
   records and nothing on a phone could reach.

   All of it is `data-marble-transient`: it belongs to the page, never to the
   file. And all of it stands down without a carrier — not as a guard, as the
   point. The trap only exists because a tap is a commit. With no host a tap
   is not a commit, the document's own stepping is harmless, and there is
   nothing here worth adding. */

(() => {
  'use strict';

  /* The same five rings the document's own chip handler reads. Kept here as a
     copy only because this file is injected beside that one; folded into the
     document it is the same `RINGS` const, and the writer below is the same
     `writeUndoable`. Neither should be a second copy for long. */
  const RINGS = {
    form: ['rough', 'abstract', 'concrete', 'complete'],
    state: ['seed', 'active', 'drafting', 'submitted'],
    maturity: ['hunch', 'forming', 'firm'],
    heat: ['cold', 'warm', 'hot'],
    plan: ['someday', 'planned', 'active', 'done'],
  };
  const RING_NAME = {
    form: 'Form', state: 'Status', maturity: 'Maturity', heat: 'Heat', plan: 'Plan',
  };

  /* The same condition part.css gates on, asked of the same two facts: the
     container's width, because a docked panel narrows the document and not
     the screen, and whether there is a pointer that can hover, because that
     is what "a finger" means to a browser. */
  const onTouch = () =>
    matchMedia('(hover: none)').matches &&
    document.documentElement.clientWidth <= 720;

  const carrier = () => (typeof window !== 'undefined' ? window.marble : null);

  const transient = (el) => {
    el.setAttribute('data-marble-transient', '');
    return el;
  };

  /* One writer, and it is the document's: the page moves and the file hears
     it in the same breath, with the inverse recorded so Mod+Z — and the strip
     below — can walk it back. */
  function write(el, name, value) {
    const was = el.getAttribute(name);
    if (was === value) return false;
    el.setAttribute(name, value);
    const marble = carrier();
    const id = marble && marble.id(el);
    if (!id) return true;
    const op = { type: 'setAttr', id, name, value };
    marble.record({ redo: [op], undo: [{ type: 'setAttr', id, name, value: was }] });
    marble.op(op, { immediate: true });
    return true;
  }

  /* A popover sits in the top layer, which is the only place in this document
     a floating thing can sit: every card is its own stacking context and half
     of them are absolutely positioned by the spine. The cost is that the top
     layer has no idea where the card was, so the position is measured and
     written, clamped to the viewport and to the home indicator. */
  function place(sheet, anchor, { prefer = 'below' } = {}) {
    const pad = 12;
    const safe = 12 + (parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--rv-safe')) || 0);
    const box = sheet.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    let top = prefer === 'below' ? anchor.bottom + 8 : anchor.top - box.height - 8;
    if (top + box.height > vh - safe) top = anchor.top - box.height - 8;
    if (top < pad) top = Math.min(anchor.bottom + 8, vh - box.height - safe);
    top = Math.max(pad, Math.min(top, vh - box.height - safe));

    let left = anchor.left;
    left = Math.max(pad, Math.min(left, vw - box.width - pad));

    sheet.style.left = Math.round(left) + 'px';
    sheet.style.top = Math.round(top) + 'px';
  }

  /* ── the ring ─────────────────────────────────────────────────────────── */

  let openSheet = null;

  function closeRing() {
    const sheet = openSheet;
    openSheet = null;
    if (!sheet) return;
    const chip = sheet.__chip;
    if (chip) chip.setAttribute('aria-expanded', 'false');
    try { sheet.hidePopover(); } catch (_) { /* already closed */ }
    sheet.remove();
    if (chip && chip.isConnected) chip.focus({ preventScroll: true });
  }

  function openRing(chip) {
    const name = chip.dataset.cycle;
    const ring = RINGS[chip.dataset.ring];
    if (!name || !ring) return;
    // A dial belongs to the thing it is drawn inside, and that is its parent:
    // a card for the two at the top, the claim for the maturity one, the
    // question for the heat one. Worth spelling out, because "the nearest
    // ancestor that already carries this attribute" — which is how the
    // stepping handler finds its owner — is not the same thing. A question
    // that has never been given a heat has no `data-mark`, so that search
    // walks past it and lands on the card, and setting a question's heat
    // silently rewrites the paper's status instead. The same search is what
    // makes an unset question display the word "submitted".
    const owner = chip.parentElement && chip.parentElement.matches('.item, .claim, .beat')
      ? chip.parentElement
      : (chip.closest('[' + name + ']') || chip.closest('.item, .claim, .beat'));
    if (!owner) return;

    closeRing();

    const sheet = transient(document.createElement('div'));
    sheet.className = 'rv-ring';
    sheet.setAttribute('popover', 'auto');
    sheet.setAttribute('role', 'group');
    sheet.setAttribute('aria-label', (RING_NAME[chip.dataset.ring] || chip.dataset.ring) + ', choose one');
    sheet.__chip = chip;

    const head = transient(document.createElement('span'));
    head.className = 'rv-ring-head';
    head.setAttribute('aria-hidden', 'true');
    head.textContent = RING_NAME[chip.dataset.ring] || chip.dataset.ring;
    sheet.append(head);

    const current = owner.getAttribute(name);
    let focusMe = null;
    for (const value of ring) {
      const opt = transient(document.createElement('button'));
      opt.type = 'button';
      opt.className = 'rv-ring-opt';
      opt.textContent = value;
      // Which one the card is on is one attribute. This reads it; it does not
      // keep a second copy of it.
      if (value === current) {
        opt.setAttribute('aria-current', 'true');
        focusMe = opt;
      }
      opt.addEventListener('click', () => {
        if (write(owner, name, value)) repaint(chip, value, ring);
        closeRing();
      });
      sheet.append(opt);
    }

    document.body.append(sheet);
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', 'true');
    try { sheet.showPopover(); } catch (_) { sheet.style.display = 'block'; }
    place(sheet, chip.getBoundingClientRect());
    openSheet = sheet;
    sheet.addEventListener('toggle', (event) => {
      if (event.newState === 'closed' && openSheet === sheet) closeRing();
    });

    /* Real buttons, so Enter and Space already pick and the focus ring is
       already drawn. What a list of choices owes on top of that is the arrows:
       Tab is for leaving a group, not for walking one. */
    sheet.addEventListener('keydown', (event) => {
      const opts = [...sheet.querySelectorAll('.rv-ring-opt')];
      const at = opts.indexOf(document.activeElement);
      let next = -1;
      if (event.key === 'ArrowDown') next = (at + 1) % opts.length;
      else if (event.key === 'ArrowUp') next = (at - 1 + opts.length) % opts.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = opts.length - 1;
      if (next < 0) return;
      event.preventDefault();
      opts[next].focus({ preventScroll: true });
    });
    (focusMe || sheet.querySelector('.rv-ring-opt'))?.focus({ preventScroll: true });
  }

  /* The chip's face, its tooltip and the sentence a screen reader hears are
     three readings of one attribute, so they are re-derived together the
     moment it changes — the same three the document's own paintChip writes. */
  function repaint(chip, value, ring) {
    chip.textContent = value;
    chip.title = value + ' — tap to choose: ' + ring.join(' → ');
    chip.setAttribute('aria-label', chip.dataset.ring + ': ' + value + '. Tap to choose.');
  }

  /* Capture, so the chip's own stepping handler is never reached — and only
     ever when this file has something better to offer. The card's picker is
     the exception: while it is open a tap on a chip means "this card does not
     wear this field", which is somebody else's sentence and a different one. */
  document.addEventListener('click', (event) => {
    if (!onTouch() || !carrier()) return;
    const chip = event.target.closest && event.target.closest('.chip[data-cycle]');
    if (!chip || !chip.closest('.pool')) return;
    if (!RINGS[chip.dataset.ring]) return;
    const card = chip.closest('.item');
    if (card && card.hasAttribute('data-fields-open')) return;
    event.preventDefault();
    event.stopPropagation();
    openRing(chip);
  }, true);

  /* ── dropping a card ──────────────────────────────────────────────────── */

  let strip = null;
  let stripTimer = 0;

  function closeStrip() {
    clearTimeout(stripTimer);
    const el = strip;
    strip = null;
    if (!el) return;
    try { el.hidePopover(); } catch (_) { /* already closed */ }
    el.remove();
  }

  /* A pill in the corner saying "saved" after a card vanished is precisely
     the wrong message. This says what left, where it left from, and offers it
     back — and it is the document's own recorded inverse doing the work, not
     a second history kept here. */
  function offerBack(label, anchor) {
    const marble = carrier();
    if (!marble || !marble.canUndo) return;
    closeStrip();

    const el = transient(document.createElement('div'));
    el.className = 'rv-undo';
    el.setAttribute('popover', 'manual');
    el.setAttribute('role', 'status');

    const say = transient(document.createElement('span'));
    say.className = 'rv-undo-say';
    say.textContent = label ? 'Removed “' + label + '”' : 'Removed a card';

    const back = transient(document.createElement('button'));
    back.type = 'button';
    back.className = 'rv-undo-do';
    back.textContent = 'Undo';
    back.addEventListener('click', () => {
      const m = carrier();
      closeStrip();
      if (m && m.canUndo) m.undo();
    });

    el.append(say, back);
    document.body.append(el);
    try { el.showPopover(); } catch (_) { el.style.display = 'flex'; }
    place(el, anchor, { prefer: 'above' });
    strip = el;
    stripTimer = setTimeout(closeStrip, 8000);
  }

  function dropCard(card) {
    const marble = carrier();
    const id = marble && marble.id(card);
    if (!id) return;
    // The picker is still open on this card and the document is holding a
    // reference to it, so it is told to close the way a person would close it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // What left, said the way the person would say it: a card is its heading,
    // not every sentence in it run together.
    const title = card.querySelector(':scope > h3');
    const label = ((title ? marble.text(title) : marble.text(card)) || '')
      .trim().replace(/\s+/g, ' ').slice(0, 40);
    const anchor = card.getBoundingClientRect();
    const op = { type: 'remove', id };
    // Inverted against the live node, because after the remove the prior state
    // is gone and there is nothing left to invert against.
    const undo = marble.invert(op);
    card.remove();
    marble.op(op, { immediate: true });
    if (undo) marble.record({ redo: [op], undo: [undo] });
    offerBack(label, anchor);
  }

  function dropRow(card) {
    let row = card.querySelector(':scope > .rv-drop');
    if (row) return row;
    row = transient(document.createElement('button'));
    row.type = 'button';
    row.className = 'rv-drop';
    row.textContent = 'Remove this card';
    row.setAttribute('data-marble-instruction', 'Take this card out of the document.');
    row.addEventListener('click', (event) => {
      // The picker reads every tap inside the card as a field being switched
      // on or off. This one is not a field.
      event.preventDefault();
      event.stopPropagation();
      dropCard(card);
    });
    card.append(row);
    return row;
  }

  /* The picker opens by attribute, and the ghosts it unfolds are appended
     after that attribute lands, so this waits its turn and then puts the
     removal last — under the fields, where a thing you do to the whole card
     belongs. */
  const watch = new MutationObserver((records) => {
    if (!carrier()) return;
    for (const record of records) {
      const card = record.target;
      if (!(card instanceof Element) || !card.matches('.item')) continue;
      const open = card.hasAttribute('data-fields-open') && onTouch();
      const row = card.querySelector(':scope > .rv-drop');
      if (open && !row) queueMicrotask(() => {
        if (card.hasAttribute('data-fields-open')) dropRow(card);
      });
      if (!open && row) row.remove();
    }
  });

  function begin() {
    const pool = document.getElementById('pool');
    if (pool) watch.observe(pool, { subtree: true, attributeFilter: ['data-fields-open'] });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();

  // A manual popover is not dismissed by Escape the way an auto one is, and a
  // strip that cannot be dismissed is chrome that has outstayed its welcome.
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && strip) closeStrip();
  });

  // Neither of these survives the ground moving under them.
  addEventListener('resize', () => { closeRing(); closeStrip(); });
})();
