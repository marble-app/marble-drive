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
