// Which text a person can type into, and when.
//
// A page marks almost every piece of its text data-marble-editable: headings,
// labels, captions, the cells of a table. That is what lets build mode change
// any of it in place. Out of build mode most of it is the page's design, and a
// stray keystroke in a heading is a change nobody meant. So outside build mode
// a bare editable is locked, and only the page's writing areas take typing:
//
//   - data-marble-editable="write" on the element itself;
//   - anything under data-marble-write (a sheet's grid, a notes column, a
//     board's cards), so a row added there is writable on arrival;
//   - an editable with a placeholder (placeholder, data-placeholder, data-ph):
//     an empty line that says "Type an idea" is there to be typed into;
//   - anything in a note's or a doc's rich text, or a paper's source
//     (data-marble-rich, -note-body, -code).
//
// Inputs, textareas and the editors a page's own script makes (a whiteboard's
// text, a chat box) never carry the marker, so this never touches them.
//
// The lock is the page's alone. contenteditable is page-only (the carrier
// never files it), so a locked heading is the same heading in the file, and an
// agent's apply_ops changes it exactly as before.
//
// Who is locked comes from the script tag:
//   data-mode="build"  the owner, on an app with build mode: locked until build
//                      mode is on (runtime/agent-marks.js), and again when it
//                      is turned off. A page with no build mode (the Drive's
//                      own page, Build mode turned off in Settings or by the
//                      page) never hears it start, and stays as it was.
//   data-mode="share"  someone on an edit or a view link, who never gets build
//                      mode: always locked.

(() => {
  if (window.marbleWriting) return;
  const MODE = document.currentScript?.dataset.mode ?? 'build';
  const TRANSIENT = 'data-marble-transient';
  const WRITING = [
    '[data-marble-editable="write"]',
    '[data-marble-write]',
    '[data-marble-rich]',
    '[data-marble-note-body]',
    '[data-marble-code]',
  ].join(', ');

  /** Whether an editable is one of the page's writing areas. */
  const writable = (el) => Boolean(
    el.closest(WRITING)
    || el.hasAttribute('placeholder') || el.hasAttribute('data-placeholder') || el.hasAttribute('data-ph'),
  );

  // What each locked element had before, to give it back: plaintext-only from
  // the affordance, true from an older script.
  const was = new WeakMap();
  let locked = false;

  // The affordance script tells the carrier contenteditable is page-only, but
  // a page that wires its editables itself may not, and then a row it files
  // with insert or setInner would carry the lock's "false" into the file,
  // locked for good. Said by the first lock, so a page this never touches
  // keeps its own say.
  let told = false;
  const tell = () => {
    if (told) return;
    told = true;
    if (window.marble?.pageOnly) window.marble.pageOnly('contenteditable');
    else addEventListener('marble:ready', (event) => event.detail?.pageOnly?.('contenteditable'), { once: true });
  };

  const lockOne = (el) => {
    if (!el.hasAttribute('data-marble-editable') || writable(el) || el.closest(`[${TRANSIENT}]`)) return;
    const value = el.getAttribute('contenteditable');
    // Not wired yet: the page's script will set it, and the watch below hears it.
    if (value === null || value === 'false') return;
    tell();
    was.set(el, value);
    if (el === document.activeElement || el.contains(document.activeElement)) document.activeElement.blur();
    el.setAttribute('contenteditable', 'false');
  };
  const lockWithin = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches('[data-marble-editable]')) lockOne(root);
    for (const el of root.querySelectorAll('[data-marble-editable]')) lockOne(el);
  };
  const unlockAll = () => {
    for (const el of document.querySelectorAll('[data-marble-editable][contenteditable="false"]')) {
      const value = was.get(el);
      if (value === undefined) continue;
      was.delete(el);
      el.setAttribute('contenteditable', value);
    }
  };

  // A page wires its editables when it likes (at load, on marble:ready, when a
  // row is added), and an agent's insert arrives already wired. Each one is
  // locked as it gets its contenteditable, and as it moves under a container
  // or loses its placeholder.
  const watch = new MutationObserver((records) => {
    if (!locked) return;
    for (const record of records) {
      if (record.type === 'attributes') lockWithin(record.target);
      else for (const node of record.addedNodes) lockWithin(node);
    }
  });

  const set = (on) => {
    if (locked === on) return;
    locked = on;
    document.documentElement.toggleAttribute('data-marble-locked', on);
    if (on) {
      lockWithin(document.documentElement);
      watch.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'data-marble-editable', 'placeholder', 'data-placeholder', 'data-ph'],
      });
    } else {
      watch.disconnect();
      unlockAll();
    }
  };

  // Locked text keeps the look of text: no caret, no text cursor. A page's own
  // hover tint is the page's, and stays.
  const style = document.createElement('style');
  style.setAttribute(TRANSIENT, '');
  style.textContent = `html[data-marble-locked] [data-marble-editable][contenteditable="false"] { cursor: inherit; }`;
  document.head.append(style);

  window.marbleWriting = {
    get locked() { return locked; },
    writable,
  };

  if (MODE === 'share') {
    set(true);
    return;
  }

  // Build mode exists on this page once Describe has booted with `building`;
  // the page is locked from then on whenever build mode is not on.
  const follow = () => {
    const marks = window.marbleMarks;
    if (!marks?.building) return false;
    set(!marks.describing);
    return true;
  };
  addEventListener('marble-marks:describing', (event) => {
    if (window.marbleMarks?.building) set(!event.detail?.on);
  });
  if (!follow()) addEventListener('marble-marks:ready', follow, { once: true });
})();
