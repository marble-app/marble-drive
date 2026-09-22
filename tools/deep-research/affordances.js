
(() => {
  const begin = (marble) => {
    const TRANSIENT = 'data-marble-transient';
    const ID = 'data-marble-id';

    const isTransient = (el) => el.hasAttribute(TRANSIENT);
    const persistentChildren = (el) => [...el.children].filter((c) => !isTransient(c));

    function nextPersistentSibling(el) {
      let sibling = el.nextElementSibling;
      while (sibling && isTransient(sibling)) sibling = sibling.nextElementSibling;
      return sibling;
    }

    // An element can hold several roles at once — a beat is both editable and a
    // sortable item — so wiring is tracked per role, not per element.
    const roles = new WeakMap();
    function claim(el, role) {
      const held = roles.get(el) ?? new Set();
      if (held.has(role)) return false;
      held.add(role);
      roles.set(el, held);
      return true;
    }

    const within = (root, selector) => [
      ...(root.matches?.(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];

    // Each part contributes its own styling, its own wiring pass, and the
    // selector for what it makes touchable — so removing a part removes all
    // three and nothing dangles.
    const css = [];
    const wirers = [];
    const addressable = [];

    // A subtree that isn't in the document yet can't be addressed by path, so
    // it carries its ids with it — they are serialized into the insert op.
    function assignIdsIn(root) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (isTransient(el) || marble.id(el)) continue;
        if (el === root || el.matches(ADDRESSABLE)) el.setAttribute(ID, marble.newId());
      }
    }

    css.push(`
      .marble-item { position: relative; }
      .marble-item.marble-dragging { opacity: .4; }
      .marble-grip {
        position: absolute; left: -1.5rem; top: .1rem;
        display: flex; flex-direction: column; gap: 2px;
        opacity: 0; transition: opacity .12s ease;
      }
      .marble-item:hover > .marble-grip, .marble-grip:focus-within { opacity: 1; }
      /* A pointer is not the only way in. Without this the grip is invisible on
         a tablet, which means nothing in the document can be deleted or
         reordered there at all. */
      @media (hover: none) { .marble-grip { opacity: .45; } }
      .marble-btn {
        width: 1.1rem; height: 1.1rem; padding: 0; border: 0; border-radius: 3px;
        background: none; color: currentColor; opacity: .35;
        font: 500 11px/1.1rem ui-monospace, SFMono-Regular, Menlo, monospace;
        text-align: center; cursor: pointer;
      }
      .marble-btn:hover { opacity: 1; background: rgba(127, 127, 127, .14); }
      .marble-btn:focus-visible {
        opacity: 1; outline: 2px solid currentColor; outline-offset: 1px;
      }
      .marble-btn:active { transform: scale(.92); }
      @media (prefers-reduced-motion: reduce) { .marble-btn:active { transform: none; } }
    `);

    function grip(item) {
      let grip = item.querySelector(':scope > .marble-grip');
      if (!grip) {
        grip = document.createElement('div');
        grip.className = 'marble-grip';
        grip.setAttribute(TRANSIENT, '');
        // The item may itself be editable, so the chrome has to be an atomic
        // island the caret can't wander into.
        grip.setAttribute('contenteditable', 'false');
        item.prepend(grip);
        item.classList.add('marble-item');
      }
      return grip;
    }

    // These live in the page and never in the file, which the carrier has no
    // way to know until it is told.
    marble.pageOnly('contenteditable', 'spellcheck');
    addressable.push('[data-marble-editable]');
    wirers.push(wireEditable);

    function wireEditable(root) {
      for (const el of within(root, '[data-marble-editable]')) {
        if (!claim(el, 'editable')) continue;

        // plaintext-only keeps the browser from injecting <div> and <br> soup
        // on Enter, so textContent stays the whole truth and setText is safe.
        el.setAttribute('contenteditable', 'plaintext-only');
        if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
        el.spellcheck = false;

        // One undo step per edit session: prior text is captured on focus, and
        // keystrokes coalesce against that same entry until blur.
        let prior = null;
        el.addEventListener('focus', () => {
          prior = marble.text(el);
        });
        el.addEventListener('input', () => {
          const id = marble.id(el);
          const text = marble.text(el);
          const op = { type: 'setText', id, text };
          if (prior !== null && text !== prior) {
            marble.record(
              { redo: [op], undo: [{ type: 'setText', id, text: prior }] },
              { coalesce: true },
            );
          }
          marble.op(op);
        });
        el.addEventListener('blur', () => {
          prior = null;
          marble.flush();
        });

        // Most editable nodes here are a heading or a single line, where Enter
        // means "done" and a newline buried in the text is a mistake you can't
        // see. Shift-Enter still breaks the line where a break is wanted.
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
            event.preventDefault();
            el.blur();
          }
        });
      }
    }

    css.push(`.marble-remove:hover, .marble-remove:focus-visible { color: #b4544f; }`);
    addressable.push('[data-marble-removable]');
    wirers.push(wireRemovable);

    function wireRemovable(root) {
      for (const el of within(root, '[data-marble-removable]')) {
        if (!claim(el, 'removable')) continue;

        const button = document.createElement('button');
        button.className = 'marble-btn marble-remove';
        button.setAttribute(TRANSIENT, '');
        button.setAttribute('aria-label', 'Delete');
        button.title = 'Delete';
        button.textContent = '×';
        button.addEventListener('click', () => {
          const id = marble.id(el);
          // Both captured against the live node — after remove, they are gone.
          const inverse = marble.invert({ type: 'remove', id });
          const label = marble.text(el);
          el.remove();
          const op = { type: 'remove', id };
          if (inverse) marble.record({ redo: [op], undo: [inverse] });
          marble.op(op, { immediate: true });
          // The corner pill says "saved", which is the wrong thing to hear
          // when something has just gone. Say what left, and offer it back.
          if (typeof offerUndo === 'function' && inverse) {
            const what = label.trim();
            offerUndo(what ? `Removed “${what.slice(0, 40)}”` : 'Removed');
          }
        });
        grip(el).append(button);
      }
    }

    // Reorder, on a pointer rather than on the drag-and-drop API.
    //
    // Same file behaviour as Marble's: items move freely between containers
    // sharing a group name, the element moves live and the op is filed once on
    // release. What changes is the input — `pointerdown`/`pointermove` are the
    // events a finger, a pen and a mouse all produce, and `touch-action: none`
    // on the handle is what stops the browser scrolling the page instead.
    //
    // The keyboard path is here for the same reason and not as an extra: a drag
    // that only exists as a gesture is a document a keyboard cannot reorder,
    // and the handle is already a focusable button.

    css.push(`
      .marble-handle { cursor: grab; touch-action: none; }
      .marble-handle:active { cursor: grabbing; }
      .marble-handle:focus-visible { opacity: 1; outline: 2px solid currentColor; outline-offset: 1px; }
      /* The pointer is captured by the handle, so a drag over a text run would
         otherwise leave a selection behind it across the whole page. */
      body.marble-dragging-now, body.marble-dragging-now * { user-select: none !important; }
    `);
    addressable.push('[data-marble-sortable]', '[data-marble-sortable] > *');
    wirers.push(wireSortable);

    let dragging = null;
    let origin = null;

    const group = (el) => el?.closest('[data-marble-sortable]')?.getAttribute('data-marble-sortable') ?? null;

    // Where would the dragged item land in this container, given a y? The child
    // whose midpoint the pointer has passed, or null for the end.
    const targetIn = (container, y) =>
      persistentChildren(container)
        .filter((child) => child !== dragging)
        .find((child) => {
          const rect = child.getBoundingClientRect();
          return y < rect.top + rect.height / 2;
        }) ?? null;

    // Under the pointer, but the *innermost* sortable of the same group — the
    // same rule Marble's dragover has, arrived at from the other direction
    // because there is no bubbling to stop.
    function containerAt(x, y) {
      const wanted = group(origin.parent);
      let node = document.elementFromPoint(x, y);
      while (node) {
        const container = node.closest?.('[data-marble-sortable]');
        if (!container) return null;
        if (container.getAttribute('data-marble-sortable') === wanted) return container;
        node = container.parentElement;
      }
      return null;
    }

    function wireSortableItem(item) {
      if (!claim(item, 'sortable-item')) return;

      const handle = document.createElement('button');
      handle.className = 'marble-btn marble-handle';
      handle.setAttribute(TRANSIENT, '');
      handle.setAttribute('aria-label', 'Reorder — drag, or focus and press the arrow keys');
      handle.title = 'Drag to reorder';
      handle.textContent = '⠿';

      // The listeners live on the window for the duration of a drag rather than
      // on the handle, and there is no `setPointerCapture` here at all. Capture
      // looks like the right tool and is not: reordering moves the item — and
      // the handle inside it — in the DOM, which releases the capture on the
      // first insertBefore. The drag then kept working visually, because
      // `elementFromPoint` still answered, and silently stopped filing the op,
      // because pointerup was being delivered somewhere else.
      let lift = null;

      const onMove = (event) => {
        if (!lift) return;
        event.preventDefault();
        const container = containerAt(event.clientX, event.clientY);
        if (!container) return;
        const target = targetIn(container, event.clientY);
        const settled = item.parentElement === container && target === nextPersistentSibling(item);
        if (!settled) container.insertBefore(item, target);
      };

      const onUp = () => {
        if (!lift) return;
        lift = null;
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onUp);
        item.classList.remove('marble-dragging');
        document.body.classList.remove('marble-dragging-now');
        commitMove();
        dragging = null;
        origin = null;
      };

      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        lift = true;
        dragging = item;
        origin = { parent: item.parentElement, before: nextPersistentSibling(item) };
        item.classList.add('marble-dragging');
        document.body.classList.add('marble-dragging-now');
        addEventListener('pointermove', onMove, { passive: false });
        addEventListener('pointerup', onUp);
        addEventListener('pointercancel', onUp);
      });

      // One step per press, committed immediately: a keyboard reorder is a
      // sequence of moves rather than one drag, and each is separately undoable
      // because each is separately a thing you meant.
      handle.addEventListener('keydown', (event) => {
        const up = event.key === 'ArrowUp';
        const down = event.key === 'ArrowDown';
        if (!up && !down) return;
        const parent = item.parentElement;
        const siblings = persistentChildren(parent);
        const at = siblings.indexOf(item);
        const to = up ? at - 1 : at + 1;
        if (to < 0 || to >= siblings.length) return;
        event.preventDefault();

        origin = { parent, before: nextPersistentSibling(item) };
        dragging = item;
        parent.insertBefore(item, up ? siblings[to] : siblings[to].nextElementSibling);
        commitMove();
        dragging = null;
        origin = null;
        handle.focus();
      });

      grip(item).prepend(handle);
    }

    function wireSortable(root) {
      for (const container of within(root, '[data-marble-sortable]')) {
        for (const item of persistentChildren(container)) wireSortableItem(item);
        claim(container, 'sortable');
      }
    }

    function commitMove() {
      const parent = dragging.parentElement;
      const before = nextPersistentSibling(dragging);
      if (parent === origin.parent && before === origin.before) return;

      const op = {
        type: 'move',
        id: marble.id(dragging),
        parentId: marble.id(parent),
        beforeId: marble.id(before),
      };
      const inverse = {
        type: 'move',
        id: marble.id(dragging),
        parentId: marble.id(origin.parent),
        beforeId: marble.id(origin.before),
      };
      marble.record({ redo: [op], undo: [inverse] });
      marble.op(op, { immediate: true });
    }

    // <button data-marble-add="#tpl-section" data-marble-into="#outline">
    wirers.push(wireAdders);

    function wireAdders(root) {
      for (const button of within(root, '[data-marble-add]')) {
        if (!claim(button, 'adder')) continue;

        button.addEventListener('click', () => {
          const template = document.querySelector(button.dataset.marbleAdd);
          const into = button.dataset.marbleInto;
          // "prev" targets the list right before the button, so per-item adders
          // don't each need a unique selector.
          const container =
            into === 'prev' ? button.previousElementSibling : document.querySelector(into);
          const seed = template?.content?.firstElementChild;
          if (!seed || !container) {
            console.error('[marble] add: missing template or container', button.dataset);
            return;
          }

          const node = seed.cloneNode(true);
          assignIdsIn(node);
          // Serialized before wiring, so no transient chrome lands in the file.
          const html = marble.source.outer(node);

          container.append(node);
          marble.adopt(node);
          const op = { type: 'insert', html, parentId: marble.id(container), beforeId: null };
          const inverse = marble.invert(op);
          if (inverse) marble.record({ redo: [op], undo: [inverse] });
          marble.op(op, { immediate: true });

          node.querySelector('[data-marble-editable]')?.focus();
        });
      }
    }

    // Five interactions that every real document turned out to need and, before
    // they were named, hand-rolled — a checkable row, a view switcher, a
    // disclosure, a counter, a note. Hand-rolled they were written well only if
    // whoever wrote it remembered to, which is why the corpus has 177 hover
    // rules and 8 focus-visible ones. Named, they are written well once.
    //
    // All five share one shape. The fact lives in **one attribute on one target**
    // and everything else is derived from it: the appearance by the document's
    // CSS, the announced state by the wiring below, and both re-derived from a
    // MutationObserver so an undo, a hand edit, or another tab writing the file
    // can never leave the two disagreeing.
    //
    //   data-marble-of="<selector>"  the target, via closest(). Default: itself.

    marble.pageOnly('aria-pressed', 'aria-expanded', 'aria-current', 'aria-disabled', 'tabindex', 'role');

    // The target has to be in the file before an op can name it.
    function resolve(el) {
      const selector = el.getAttribute('data-marble-of');
      const node = selector ? el.closest(selector) : el;
      if (!node) return null;
      if (!marble.id(node)) marble.address([node]);
      return marble.id(node) ? node : null;
    }

    // One attribute, one op, and its inverse — the whole of what these five do.
    function setAttr(node, name, value) {
      const id = marble.id(node);
      if (!id) return;
      const prior = node.getAttribute(name);
      node.setAttribute(name, value);
      const op = { type: 'setAttr', id, name, value };
      marble.record({ redo: [op], undo: [{ type: 'setAttr', id, name, value: prior }] });
      marble.op(op, { immediate: true });
    }

    const observe = (node, name, sync) =>
      new MutationObserver(sync).observe(node, { attributes: true, attributeFilter: [name] });

    // A <button> is focusable, announces itself, and fires on Enter and Space
    // for free. Anything else needs all four of tabindex, role, the keys, and
    // the ARIA state, or it is furniture with a cursor.
    function control(el, role) {
      if (!(el instanceof HTMLButtonElement)) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        if (!el.hasAttribute('role')) el.setAttribute('role', role);
        el.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          el.click();
        });
      }
      // The sentence that tells the intent layer what this is for is also the
      // only description a screen reader has, when the control is a bare glyph.
      const instruction = el.getAttribute('data-marble-instruction');
      if (instruction && !el.hasAttribute('aria-label') && !marble.text(el).trim()) {
        el.setAttribute('aria-label', instruction);
      }
    }

    // ---- toggle: data-marble-toggle="data-done:yes|no"

    addressable.push('[data-marble-toggle]');
    wirers.push(wireToggle);

    function wireToggle(root) {
      for (const el of within(root, '[data-marble-toggle]')) {
        if (!claim(el, 'toggle')) continue;
        const spec = el.getAttribute('data-marble-toggle') || '';
        const cut = spec.indexOf(':');
        const name = spec.slice(0, cut).trim();
        const [on, off] = spec.slice(cut + 1).split('|').map((v) => v.trim());
        const node = resolve(el);
        if (!name || !on || off === undefined || !node) continue;

        control(el, 'button');
        const sync = () => el.setAttribute('aria-pressed', String(node.getAttribute(name) === on));
        sync();
        observe(node, name, sync);
        el.addEventListener('click', () => {
          setAttr(node, name, node.getAttribute(name) === on ? off : on);
          sync();
        });
      }
    }

    // ---- choose: one of a set is current
    //
    //   <span data-marble-choose="data-view" data-marble-of=".comp">
    //     <button data-marble-value="list">Reading</button>
    //     <button data-marble-value="cal">Front page</button>
    //   </span>

    addressable.push('[data-marble-choose]');
    wirers.push(wireChoose);

    function wireChoose(root) {
      for (const box of within(root, '[data-marble-choose]')) {
        if (!claim(box, 'choose')) continue;
        const name = (box.getAttribute('data-marble-choose') || '').trim();
        const node = resolve(box);
        const options = [...box.querySelectorAll('[data-marble-value]')];
        if (!name || !node || !options.length) continue;

        if (!box.hasAttribute('role')) box.setAttribute('role', 'group');
        const sync = () => {
          const current = node.getAttribute(name);
          for (const option of options) {
            option.setAttribute('aria-pressed', String(option.getAttribute('data-marble-value') === current));
          }
        };
        for (const option of options) {
          control(option, 'button');
          option.addEventListener('click', () => {
            setAttr(node, name, option.getAttribute('data-marble-value'));
            sync();
          });
        }
        sync();
        observe(node, name, sync);

        // A segmented control is one stop on the tab ring and the arrows move
        // within it — what every other segmented control on the platform does.
        box.addEventListener('keydown', (event) => {
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
          const at = options.indexOf(document.activeElement);
          if (!step || at < 0) return;
          event.preventDefault();
          options[(at + step + options.length) % options.length].focus();
        });
      }
    }

    // ---- expand: a second reading, in place

    addressable.push('[data-marble-expand]');
    wirers.push(wireExpand);

    function wireExpand(root) {
      for (const el of within(root, '[data-marble-expand]')) {
        if (!claim(el, 'expand')) continue;
        const node = resolve(el);
        if (!node) continue;
        const NAME = 'data-expanded';

        control(el, 'button');
        const panel = el.getAttribute('data-marble-controls');
        const panelId = panel && marble.id(document.querySelector(panel));
        if (panelId) el.setAttribute('aria-controls', panelId);

        const sync = () => el.setAttribute('aria-expanded', String(node.getAttribute(NAME) === 'yes'));
        sync();
        observe(node, NAME, sync);
        el.addEventListener('click', () => {
          setAttr(node, NAME, node.getAttribute(NAME) === 'yes' ? 'no' : 'yes');
          sync();
        });
      }
    }

    // ---- step: data-marble-step="data-weeks:1:12" data-marble-by="-1"

    addressable.push('[data-marble-step]');
    wirers.push(wireStep);

    function wireStep(root) {
      for (const el of within(root, '[data-marble-step]')) {
        if (!claim(el, 'step')) continue;
        const [name, min, max] = (el.getAttribute('data-marble-step') || '').split(':').map((v) => v.trim());
        const node = resolve(el);
        const low = Number(min);
        const high = Number(max);
        const by = Number(el.getAttribute('data-marble-by') || 1);
        if (!name || !node || !Number.isFinite(low) || !Number.isFinite(high)) continue;

        control(el, 'button');
        const at = () => {
          const now = Number(node.getAttribute(name));
          return Number.isFinite(now) ? now : low;
        };
        // A stepper at its bound stays where it is and says so, rather than
        // going quiet and leaving you pressing a live-looking button.
        const sync = () => {
          const blocked = at() + by < low || at() + by > high;
          el.setAttribute('aria-disabled', String(blocked));
          el.classList.toggle('marble-at-end', blocked);
        };
        sync();
        observe(node, name, sync);
        el.addEventListener('click', () => {
          const next = Math.min(high, Math.max(low, at() + by));
          if (next === at()) return;
          setAttr(node, name, String(next));
          sync();
        });
      }
    }

    // ---- note: say something about a row without changing the row
    //
    // The annotation is ordinary content in the file, so it is addressable,
    // editable, greppable and diffable — which is what turns a note from a
    // comment into an instruction a later run can act on.

    css.push(`
      .marble-note:hover, .marble-note:focus-visible { color: #6f8fb0; }
      [data-marble-note-body] { margin: .25rem 0 0; }
      [data-marble-note-body]:empty::before {
        content: attr(data-ph); opacity: .4; font-style: italic;
      }
    `);
    addressable.push('[data-marble-note]');
    wirers.push(wireNote);

    function wireNote(root) {
      for (const el of within(root, '[data-marble-note]')) {
        if (!claim(el, 'note')) continue;

        const button = document.createElement('button');
        button.className = 'marble-btn marble-note';
        button.setAttribute(TRANSIENT, '');
        button.setAttribute('aria-label', 'Add a note');
        button.title = 'Add a note';
        button.textContent = '✎';
        button.addEventListener('click', () => {
          let body = el.querySelector(':scope > [data-marble-note-body]');
          if (!body) {
            const id = marble.newId();
            const op = {
              type: 'insert',
              parentId: marble.id(el),
              beforeId: null,
              html: `<p data-marble-id="${id}" data-marble-note-body data-marble-editable data-ph="Note"></p>`,
            };
            // apply adopts what it inserts, so the note is editable on arrival.
            marble.apply(op);
            marble.op(op);
            marble.record({ redo: [op], undo: [{ type: 'remove', id }] });
            body = marble.byId(id);
          }
          body?.focus();
        });
        grip(el).append(button);
      }
    }

    // The carrier records an inverse for every gesture above. Until something
    // draws a way to reach it, that history is a correct, complete, unreachable
    // thing — which is what half the documents in the corpus shipped.
    //
    // This is also what a confirm dialog is for, done better. A dialog asks
    // before every delete and trains people to dismiss it; a reversal offered
    // where the loss happened costs nothing until you need it.

    css.push(`
      .marble-reversal {
        position: fixed; left: 1rem; bottom: 1rem; z-index: 9999;
        display: flex; align-items: center; gap: .6rem;
        padding: .45rem .5rem .45rem .8rem; border-radius: 8px;
        font: 500 12px/1.3 system-ui, sans-serif;
        background: rgba(20, 22, 26, .94); color: #dfe4ea;
        border: 1px solid rgba(255,255,255,.12);
        box-shadow: 0 6px 24px rgba(0,0,0,.3);
        opacity: 0; transform: translateY(4px);
        transition: opacity .18s ease, transform .18s ease;
        pointer-events: none;
      }
      .marble-reversal[data-open] { opacity: 1; transform: none; pointer-events: auto; }
      .marble-reversal button {
        border: 0; border-radius: 5px; padding: .25rem .55rem; cursor: pointer;
        font: 600 12px system-ui, sans-serif;
        background: rgba(255,255,255,.14); color: #fff;
      }
      .marble-reversal button:hover { background: rgba(255,255,255,.24); }
      .marble-reversal button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) {
        .marble-reversal { transition: opacity .18s ease; transform: none; }
      }
    `);

    const reversal = document.createElement('div');
    reversal.className = 'marble-reversal';
    reversal.setAttribute(TRANSIENT, '');
    // Announced when it appears, so the offer is not pointer-only.
    reversal.setAttribute('role', 'status');
    const reversalText = document.createElement('span');
    const reversalButton = document.createElement('button');
    reversalButton.textContent = 'Undo';
    reversal.append(reversalText, reversalButton);
    document.body.append(reversal);

    let reversalTimer = null;
    function offerUndo(label) {
      reversalText.textContent = label;
      reversal.setAttribute('data-open', '');
      clearTimeout(reversalTimer);
      reversalTimer = setTimeout(() => reversal.removeAttribute('data-open'), 7000);
    }
    reversalButton.addEventListener('click', () => {
      reversal.removeAttribute('data-open');
      if (marble.canUndo) marble.undo();
      syncHistory();
    });

    // Whether there is a way back is a live fact about the document, so it is
    // derived into a marble- class like any other — never mirrored into a
    // variable a script has to remember to update.
    function syncHistory() {
      document.body.classList.toggle('marble-can-undo', !!marble.canUndo);
      document.body.classList.toggle('marble-can-redo', !!marble.canRedo);
    }
    addEventListener('pointerup', syncHistory, true);
    addEventListener('keyup', syncHistory, true);
    wirers.push(syncHistory);

    // Undo/redo is a carrier capability; binding the keys is the app's call,
    // same as drawing a save indicator. Native inputs keep the browser's own
    // undo — marble editables preventDefault so the stacks do not fight.
    addEventListener('keydown', (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement &&
          target.isContentEditable &&
          !target.hasAttribute('data-marble-editable') &&
          !target.closest('[data-marble-editable]'))
      ) {
        return;
      }

      // A staged proposal is not history yet — Mod+Z discards it instead.
      if (isUndo && typeof marble.discardStaged === 'function' && marble.discardStaged()) {
        event.preventDefault();
        return;
      }

      if (isUndo && marble.canUndo) {
        event.preventDefault();
        marble.undo();
      } else if (isRedo && marble.canRedo) {
        event.preventDefault();
        marble.redo();
      }
    });

    // The carrier reports whether a change reached the file; drawing that is
    // the app's call, and an app that wants no save indicator deletes this.

    css.push(`
      .marble-status {
        position: fixed; right: 1rem; bottom: 1rem; z-index: 9999;
        padding: .3rem .6rem; border-radius: 999px;
        font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .04em; pointer-events: none;
        opacity: 0; transition: opacity .25s ease;
        background: rgba(20, 22, 26, .92); color: #b7c0cc; border: 1px solid rgba(255,255,255,.12);
      }
      .marble-status[data-state="saving"] { opacity: 1; }
      .marble-status[data-state="saved"]  { opacity: .55; }
      .marble-status[data-state="error"]  { opacity: 1; background: #46201f; color: #ff9b9b; }
    `);

    const status = document.createElement('div');
    status.className = 'marble-status';
    status.setAttribute(TRANSIENT, '');
    document.body.append(status);

    let statusTimer = null;
    document.addEventListener('marble:status', ({ detail }) => {
      status.dataset.state = detail.state;
      status.textContent =
        detail.state === 'saving'
          ? 'saving…'
          : detail.state === 'saved'
            ? 'saved'
            : `error — ${detail.message}`;
      clearTimeout(statusTimer);
      if (detail.state === 'saved') {
        statusTimer = setTimeout(() => (status.dataset.state = 'idle'), 1200);
      }
    });

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = css.join('\n');
    document.head.append(style);

    // Anything a hand can act on has to be addressable in the file first.
    const ADDRESSABLE = addressable.join(', ');
    marble.address(document.querySelectorAll(ADDRESSABLE));

    // Runs now over the document as it stands, and again over anything that
    // arrives later — an insert, an accepted proposal, an edit made to the file
    // in another window.
    marble.register((root) => {
      for (const wirer of wirers) wirer(root);
    });
  };

  // The carrier is injected after the document has been parsed, so this waits
  // rather than the other way round. No carrier, no affordances: the document
  // is still a page you can read, it just isn't one you can change.
  if (window.marble) begin(window.marble);
  else addEventListener('marble:ready', (event) => begin(event.detail), { once: true });
})();
  