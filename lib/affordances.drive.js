// Affordance parts that replace Marble's, part-for-part, by name.
//
// `server/gallery.js` reads Marble's `lib/affordances.js` and this file, and
// where both declare a part this one wins. That is the whole mechanism: a part
// is a cut of a closure, so an override only has to keep the same helpers and
// the same contract.
//
// Only one part is overridden today, and the reason is the `k-touch` card: a
// remote host makes a phone a first-class client on day one, whether or not
// that was the plan. Marble's sortable is built on HTML5 drag-and-drop, which
// fires no events for a finger — so reorder is the one gesture in the
// affordance library a phone simply cannot perform. Everything else is pointer
// driven already.

// ==== part: sortable ====

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
