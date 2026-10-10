// The phone, for every page the host serves.
//
// A document is written once and read on a desk and in a hand. The hand
// brings three things a desk never does, and each one used to be every app's
// own problem, solved by one (Agents) and missed by the rest:
//
//  - Focusing a field whose type is under 16px makes iOS zoom the page in, and
//    it never zooms back out. The chat, a note's title, a search box: each
//    tap left the page sliding sideways under the thumb.
//  - The keyboard covers the bottom of the screen without telling the page.
//    iOS shrinks the visual viewport and slides it down the layout viewport
//    to keep the caret clear; everything fixed to the layout viewport (a
//    composer, a toolbar, a sheet) then sits behind the keys or floats above
//    them by the slide.
//  - A tap waits to see whether it is a double tap, and paints a grey flash.
//
// So the host loads it on every page, in the <head> before anything the
// page runs itself (an app's inline script can read window.marblePhone), and it:
//
//  1. Settles the viewport: the page reaches under the notch and the home bar
//     (viewport-fit=cover, read back as env(safe-area-inset-*)); on Android the
//     keyboard resizes the layout itself (interactive-widget=resizes-content),
//     so a bar fixed to the bottom rides up on top of it as in a native app;
//     on iOS, maximum-scale=1 stops the zoom on focus. iOS still lets a person
//     pinch to zoom with it (it has ignored the cap for pinches since iOS 10),
//     so nobody loses the zoom they ask for. They only lose the one nobody asked for.
//  2. Publishes where the screen the person can see is, as CSS variables on
//     :root that every page and every shadow root inherits:
//       --vv-h    the height of what is visible (shrinks under the keyboard)
//       --vv-top  how far the visible strip has slid down the layout viewport
//       --kb      how much of the layout viewport's bottom the keyboard covers
//     A surface fixed to the bottom reads `bottom: var(--kb, 0px)`. A sheet
//     reads `max-height: var(--vv-h, 100dvh)`. And <html data-marble-keyboard>
//     is there while the keyboard is up, for what should step aside (a tab
//     bar, a floating button).
//  3. Sets a handful of touch defaults at zero specificity, so any document's
//     own rule wins: no tap delay on controls, no grey flash, no font inflation
//     on rotate.
//  4. Keeps the focused field in view once the keyboard has settled. A browser
//     scrolls the caret into the layout viewport, which on iOS is not the part
//     of the screen anyone can see.
//
// The variables live in a transient <style>, never on the document: they are
// this tab's glass, not the file.

(() => {
  if (window.marblePhone) return;
  const root = document.documentElement;
  const ua = navigator.userAgent || '';
  const iOS = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const coarse = matchMedia('(pointer: coarse)');

  // ------------------------------------------------------------ 1. viewport

  const settleViewport = () => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.setAttribute('data-marble-transient', '');
      (document.head || root).prepend(meta);
    }
    const parts = new Map();
    for (const piece of String(meta.content || '').split(',')) {
      const [key, value] = piece.split('=').map((s) => s?.trim());
      if (key) parts.set(key.toLowerCase(), value ?? '');
    }
    const before = meta.content;
    if (!parts.has('width')) parts.set('width', 'device-width');
    if (!parts.has('initial-scale')) parts.set('initial-scale', '1');
    if (!parts.has('viewport-fit')) parts.set('viewport-fit', 'cover');
    if (!parts.has('interactive-widget')) parts.set('interactive-widget', 'resizes-content');
    // Only where the zoom on focus happens, and only if the page has not
    // chosen its own cap: on Android a cap would also stop the pinch.
    if (iOS && !parts.has('maximum-scale') && !parts.has('user-scalable')) parts.set('maximum-scale', '1');
    const next = [...parts].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(', ');
    if (next !== before) meta.content = next;
  };

  // ------------------------------------------------------------ 2. the visible strip

  const vars = document.createElement('style');
  vars.setAttribute('data-marble-transient', '');
  vars.id = 'marble-phone-vars';

  // 3. Touch defaults. :where() keeps them at zero specificity, so a
  // document's own rule for any of these wins without a fight.
  const base = document.createElement('style');
  base.setAttribute('data-marble-transient', '');
  base.id = 'marble-phone-base';
  base.textContent = `
:where(html) { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
:where(a, button, label, summary, select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [data-marble-toggle], [data-marble-choose]) { touch-action: manipulation; }
`;

  const mount = () => {
    const head = document.head || root;
    if (!base.isConnected) head.prepend(base);
    if (!vars.isConnected) head.append(vars);
  };

  const KEYBOARD_MIN = 80; // less than this is a toolbar or a URL bar, not keys
  let last = '';
  let keyboard = false;
  const listeners = new Set();

  const editable = (el) => Boolean(el && (
    el.isContentEditable
    || (el.tagName === 'TEXTAREA')
    || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(el.type))
    || el.tagName === 'SELECT'));

  /** The deepest focused element, through open shadow roots (the chat's
   *  composer is inside one). */
  const focused = () => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };

  // The tallest the layout has been at this width: on Android the layout
  // itself shrinks under the keyboard (resizes-content), so --kb stays 0
  // there, and what was lost against this is the keyboard.
  let tallest = { width: 0, height: 0 };
  const measure = () => {
    const vv = window.visualViewport;
    const h = Math.round(vv?.height ?? window.innerHeight);
    const top = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
    const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    if (tallest.width !== window.innerWidth) tallest = { width: window.innerWidth, height: 0 };
    tallest.height = Math.max(tallest.height, window.innerHeight);
    const shrunk = tallest.height - window.innerHeight;
    // What the keys cover is what the visible strip lost, wherever it slid
    // to: slid all the way down, --kb is 0 but the strip is still short.
    // At zoom 1 only: a pinch shrinks the visible strip too, and a person
    // zoomed in on a field has not raised any keys.
    const covered = vv && (vv.scale ?? 1) < 1.05 ? Math.round(window.innerHeight - vv.height) : 0;
    const up = coarse.matches && editable(focused()) && (covered >= KEYBOARD_MIN || shrunk >= KEYBOARD_MIN * 2);
    return { h, top, kb, up };
  };

  // The carrier loads after this script. Once it is here, tell it the
  // keyboard's attribute is the page's, not the file's, so a patch that
  // reads <html> back from the file does not take it down with the keys up.
  let taught = false;
  const teach = () => {
    if (taught || typeof window.marble?.pageOnly !== 'function') return;
    window.marble.pageOnly('data-marble-keyboard');
    taught = true;
  };

  const sync = () => {
    teach();
    mount();
    const { h, top, kb, up } = measure();
    const text = `:root { --vv-h: ${h}px; --vv-top: ${top}px; --kb: ${kb}px; }`;
    if (text !== last) { vars.textContent = text; last = text; }
    if (up !== keyboard) {
      keyboard = up;
      root.toggleAttribute('data-marble-keyboard', up);
      for (const fn of listeners) { try { fn(api.state()); } catch { /* one listener's fault */ } }
      if (up) keepCaretInView();
    }
  };

  // ------------------------------------------------------------ 4. caret in view

  let caretTimer = 0;
  const keepCaretInView = () => {
    clearTimeout(caretTimer);
    // After the keyboard's own animation: measuring mid-slide lands short.
    caretTimer = setTimeout(() => {
      const el = focused();
      if (!editable(el) || !window.visualViewport) return;
      const vv = window.visualViewport;
      const r = el.getBoundingClientRect();
      const visibleTop = vv.offsetTop;
      const visibleBottom = vv.offsetTop + vv.height;
      // A tall field (a note's body) only needs its caret seen, which the
      // browser already does; this is for a field the keys came down over.
      if (r.height > vv.height * 0.6) return;
      const margin = 12;
      if (r.bottom > visibleBottom - margin || r.top < visibleTop + margin) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }, 320);
  };

  // ------------------------------------------------------------ api

  const api = {
    iOS,
    /** Whether this is a hand, not a desk. */
    get touch() { return coarse.matches; },
    get keyboard() { return keyboard; },
    state: () => ({ keyboard, ...measure() }),
    /** Called with the new state whenever the keyboard comes up or goes. */
    onKeyboard(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    sync,
  };
  window.marblePhone = api;

  settleViewport();
  sync();
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  addEventListener('resize', sync);
  addEventListener('orientationchange', sync);
  // Focus moving between fields changes whether the keyboard is up before
  // any resize says so (and a hardware keyboard never resizes at all).
  document.addEventListener('focusin', () => requestAnimationFrame(sync), true);
  document.addEventListener('focusout', () => setTimeout(sync, 60), true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { settleViewport(); sync(); }, { once: true });
})();
