
    // This document's own behaviour, and it is two kinds of thing.
    //
    // A command changes the note and does the same two things in the same
    // order: it moves the page, and it writes that change down as an op. The
    // rich-text affordance below is the only command here — every other
    // gesture in this document is one of Marble's own affordances.
    //
    // A derivation reads the document and draws something from it that is the
    // page's rather than the file's. Which contents link is current is a
    // reading of scroll position, so it lands in a marble- prefixed class and
    // files nothing at all.
    (() => {
      const begin = (marble) => {

        // ------------------------------------------------- command: rich text
        //
        // The shared `editable` is a setText affordance — right for a heading,
        // fatal to an <em> in the middle of a sentence, because it replaces the
        // whole contents on every keystroke. A prose paragraph is edited with
        // setInner instead, so its inline markup survives, and it says so in
        // its own attribute rather than pretending to be the other thing.
        marble.pageOnly('contenteditable', 'spellcheck');

        const wired = new WeakSet();
        let held = null;

        const wireRich = (root) => {
          const all = [
            ...(root.matches?.('[data-marble-rich]') ? [root] : []),
            ...root.querySelectorAll('[data-marble-rich]'),
          ];
          for (const el of all) {
            if (wired.has(el)) continue;
            wired.add(el);
            el.setAttribute('contenteditable', 'true');
            el.spellcheck = false;

            el.addEventListener('focus', () => { held = marble.source.inner(el); });

            // One op per visit, filed on leaving — not one per keystroke.
            el.addEventListener('blur', () => {
              const id = marble.id(el);
              const now = marble.source.inner(el);
              if (id && held !== null && now !== held) {
                const op = { type: 'setInner', id, html: now };
                marble.record({ redo: [op], undo: [{ type: 'setInner', id, html: held }] });
                marble.op(op, { immediate: true });
              }
              held = null;
            });

            // A contenteditable will swallow a whole document if you let it,
            // and pasted markup is markup nothing here knows how to edit.
            el.addEventListener('paste', (event) => {
              event.preventDefault();
              const text = event.clipboardData?.getData('text/plain') ?? '';
              document.execCommand('insertText', false, text);
            });
          }
        };

        marble.address(document.querySelectorAll('[data-marble-rich]'));

        // ------------------------------------- derivation: the current section
        //
        // Where you have scrolled to is not a fact about this note, so it is
        // not written to it. The class is prefixed marble-, which is what tells
        // the carrier it belongs to the page and must survive a reconcile.
        const links = [...document.querySelectorAll('.rail a')];
        const sections = links
          .map((link) => document.querySelector(link.getAttribute('href')))
          .filter(Boolean);
        const ratios = new Map();

        const markCurrent = () => {
          let best = null;
          let top = 0;
          for (const [id, ratio] of ratios) if (ratio > top) { top = ratio; best = id; }
          if (!best) return;
          for (const link of links) {
            link.classList.toggle('marble-current', link.getAttribute('href') === '#' + best);
          }
        };

        if (sections.length && 'IntersectionObserver' in window) {
          const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) ratios.set(entry.target.id, entry.intersectionRatio);
            markCurrent();
          }, { threshold: [0, .15, .4, .75, 1] });
          for (const section of sections) observer.observe(section);
        }

        // Both halves run again over anything that arrives later — an insert, an
        // accepted proposal, an edit made to the file in another window.
        marble.register((root) => {
          wireRich(root);
          markCurrent();
        });
      };

      // No carrier, no editing: the note is still a page you can read.
      if (window.marble) begin(window.marble);
      else addEventListener('marble:ready', (event) => begin(event.detail), { once: true });
    })();
  