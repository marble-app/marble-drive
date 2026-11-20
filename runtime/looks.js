// Where each tab is looking is that tab's own.
//
// A view switched, a tab or section picked, a note opened, a row expanded:
// that is looking, not changing. Typing, ticking, adding and every other
// change still reaches every open tab at once. A look does not: two tabs on
// one page can sit in two different sections, and neither moves the other.
//
// The owner's tab still files its looks, so the file (and with it a new tab
// or a share link) opens where they were last. What this tab keeps is its
// own: a look that arrives from another tab, or with a whole-document reread,
// is put back to what this tab was showing, and a reload opens where this tab
// was (sessionStorage, which a browser keeps per tab). An agent's batch still
// moves the page: an agent changing the view is showing the person something.
// Someone in by a share link follows the owner until they move themselves.
//
// Which ops are looking is decided here for every tab, share links included
// (runtime/share.js asks window.marbleLooks.is): an op filed with
// marble.op(op, { look: true }); one a step, an expand or a choose files
// (unless the control says data-marble-look="off"), or a toggle that says
// data-marble-look; and, for pages that switch views from their own script
// without saying so, an attribute named for where a person is (data-view,
// data-tab, data-section, data-active, data-open …). A page that means one of
// those as a change says so with { look: false } or data-marble-look="off" on
// the element.

(() => {
  if (window.marbleLooks) return;

  const ID = 'data-marble-id';
  const keyOf = (id, name) => `${id}\n${name}`;

  // ------------------------------------------------------- which are looking

  const LOOKS = [
    ['data-marble-step', true],
    ['data-marble-expand', true],
    ['data-marble-choose', true],
    ['data-marble-toggle', false],
  ];
  // The attribute a control sets (lib/affordances.js): `data-x:1:7` for a
  // step, `data-x:on|off` for a toggle, `data-x` for a choose.
  const nameOf = (control, kind) =>
    kind === 'data-marble-expand' ? 'data-expanded' : (control.getAttribute(kind) || '').split(':')[0].trim();
  const targetOf = (control) => {
    const selector = control.getAttribute('data-marble-of');
    try {
      return selector ? control.closest(selector) : control;
    } catch {
      return null;
    }
  };
  // What a page's own script calls the place a person is in it. Settings and
  // arrangements (a theme, a layout, a width) are not here: those are saved
  // and shared like any change.
  const VIEW_NAMES = new Set([
    'data-view', 'data-views', 'data-tab', 'data-section', 'data-page', 'data-pane', 'data-panel',
    'data-lens', 'data-active', 'data-current', 'data-sel', 'data-selected', 'data-step', 'data-slide',
    'data-screen', 'data-overview', 'data-focus', 'data-zoom', 'data-open', 'data-expanded',
    'data-collapsed', 'data-folded', 'data-fold', 'aria-expanded', 'aria-selected', 'aria-current', 'open',
  ]);
  // Attributes a look was filed or heard for, by `id\nname`: a page that says
  // { look: true } once is believed for that attribute from then on.
  const known = new Set();

  // What the controls on the page say, by target and attribute: read once
  // for a pass and forgotten after it, since a batch can touch many
  // attributes and a page can hold many controls.
  let controls = null;
  function controlsSay() {
    if (controls) return controls;
    controls = new Map();
    for (const [kind, byDefault] of LOOKS) {
      for (const control of document.querySelectorAll(`[${kind}]`)) {
        const name = nameOf(control, kind);
        const target = targetOf(control);
        if (!name || !target) continue;
        let names = controls.get(target);
        if (!names) controls.set(target, (names = new Map()));
        if (names.has(name)) continue;
        const says = control.getAttribute('data-marble-look');
        names.set(name, says === null ? byDefault : says !== 'off');
      }
    }
    queueMicrotask(() => {
      controls = null;
    });
    return controls;
  }
  // What a control that sets `name` on `el` says, or undefined if none does.
  const byControl = (el, name) => controlsSay().get(el)?.get(name);

  function isLook(el, name, flag) {
    if (flag === true) return true;
    if (flag === false || !el || !name) return false;
    const id = el.getAttribute(ID);
    if (id && known.has(keyOf(id, name))) return true;
    const said = byControl(el, name);
    if (said !== undefined) return said;
    if (el.getAttribute('data-marble-look') === 'off') return false;
    return VIEW_NAMES.has(name);
  }

  /** Whether `op`, filed with `flag` (marble.op's `look` option), is looking. */
  const is = (op, flag) => {
    if (op?.type !== 'setAttr') return false;
    if (flag === undefined && op.look === true) flag = true;
    return isLook(window.marble?.byId(op.id) ?? null, op.name, flag);
  };

  // ------------------------------------------------------ this tab's own looks

  // What this tab shows for each look it has made or kept, by `id\nname`.
  const held = new Map();
  const STORE_MAX = 60;
  const storeKey = () => `marble-looks:${window.marble?.app ?? location.pathname}`;
  let saving = 0;
  const save = () => {
    clearTimeout(saving);
    saving = setTimeout(() => {
      const list = [...held.values()].slice(-STORE_MAX).map(({ id, name, value }) => [id, name, value]);
      try {
        sessionStorage.setItem(storeKey(), JSON.stringify(list));
      } catch {
        // Private browsing or a full store: the tab still keeps its place until it reloads.
      }
    }, 150);
  };
  const hold = (id, name, value, el = null) => {
    const key = keyOf(id, name);
    const was = held.get(key);
    if (was && was.value === value && (!el || was.el === el)) return;
    // Most recent last, so the store keeps the newest when it trims.
    held.delete(key);
    held.set(key, { id, name, value, el: el ?? was?.el ?? null });
    save();
  };
  const elOf = (entry) => {
    if (entry.el?.isConnected) return entry.el;
    entry.el = window.marble?.byId(entry.id) ?? null;
    return entry.el;
  };
  const put = (el, name, value) => {
    if (value === null || value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };

  // Every attribute change, with what it was before. Those the carrier makes
  // while applying someone else's batch or rereading the file are taken by
  // putBack below, in the same task; whatever is delivered here was this
  // tab's own doing, and a look among them is where this tab now is.
  const seen = new MutationObserver((records) => {
    for (const record of records) {
      const id = record.target.getAttribute?.(ID);
      if (!id) continue;
      const entry = held.get(keyOf(id, record.attributeName));
      if (entry) hold(id, record.attributeName, record.target.getAttribute(record.attributeName), record.target);
    }
  });
  seen.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true });

  // Someone in by a share link follows the owner around the page until they
  // move themselves (runtime/share.js tells this file each look they make):
  // only what they have moved to is kept. The owner's own tabs follow nobody.
  const following = () => document.documentElement.hasAttribute('data-marble-share');

  // The last whole-page pass, for the marble:ops that follows it.
  let pass = null;

  // After another writer's batch is applied, and after the page is read again
  // from the file, the carrier offers the whole body to its wirers: this tab's
  // looks go back to what it was showing before either.
  function putBack(root) {
    if (root !== document.body) return;
    const before = new Map();
    for (const record of seen.takeRecords()) {
      const el = record.target;
      const id = el.getAttribute?.(ID);
      if (!id || !el.isConnected) continue;
      const key = keyOf(id, record.attributeName);
      if (!before.has(key)) before.set(key, { el, id, name: record.attributeName, old: record.oldValue });
    }
    const kept = new Map();
    const keep = (key, el, id, name, mine) => {
      const theirs = el.getAttribute(name);
      if (theirs !== mine) {
        put(el, name, mine);
        kept.set(key, { el, id, name, theirs });
      }
      hold(id, name, mine, el);
    };
    const visitor = following();
    for (const [key, change] of before) {
      const entry = held.get(key);
      if (visitor && !entry) continue;
      if (!isLook(change.el, change.name)) continue;
      keep(key, change.el, change.id, change.name, entry ? entry.value : change.old);
    }
    // An element put back whole (a setInner around it, a reread that could
    // not keep the node) is a new node with no record: it gets this tab's
    // look again by id.
    for (const [key, entry] of held) {
      if (before.has(key)) continue;
      const el = elOf(entry);
      if (el && el.getAttribute(entry.name) !== entry.value) keep(key, el, entry.id, entry.name, entry.value);
    }
    pass = { before, kept };
    queueMicrotask(() => {
      pass = null;
    });
  }

  // The batch the pass was for, named. Heard first (capture, on window), so a
  // page that listens for marble:ops finds this tab where it was.
  addEventListener(
    'marble:ops',
    (event) => {
      const { ops, by } = event.detail ?? {};
      if (!pass || !Array.isArray(ops)) return;
      const { before, kept } = pass;
      for (const op of ops) {
        if (op?.type !== 'setAttr') continue;
        const key = keyOf(op.id, op.name);
        if (by === 'agent') {
          // An agent moving the view is showing the person something.
          const undone = kept.get(key);
          if (undone) {
            put(undone.el, undone.name, undone.theirs);
            hold(undone.id, undone.name, undone.theirs, undone.el);
            kept.delete(key);
          }
          continue;
        }
        // A look this pass could not tell by its attribute, said by its op.
        if (op.look !== true) continue;
        known.add(key);
        const change = before.get(key);
        if (!change || kept.has(key) || held.has(key) || following()) continue;
        const theirs = change.el.getAttribute(change.name);
        if (theirs !== change.old) {
          put(change.el, change.name, change.old);
          kept.set(key, { el: change.el, id: change.id, name: change.name, theirs });
        }
        hold(change.id, change.name, change.old, change.el);
      }
    },
    true,
  );

  // A reload opens where this tab was, not where another tab left the file.
  function restore() {
    let list = [];
    try {
      list = JSON.parse(sessionStorage.getItem(storeKey()) || '[]');
    } catch {
      list = [];
    }
    for (const item of Array.isArray(list) ? list : []) {
      const [id, name, value] = Array.isArray(item) ? item : [];
      if (typeof id !== 'string' || typeof name !== 'string') continue;
      const el = window.marble?.byId(id);
      if (!el) continue;
      known.add(keyOf(id, name));
      if (el.getAttribute(name) !== value) put(el, name, value ?? null);
      hold(id, name, value ?? null, el);
    }
    // The restore is this tab's own doing, not a batch to put back.
    seen.takeRecords();
  }

  // ----------------------------------------------------------------- filing

  // A look this tab files is where it now is, and goes to the host saying it
  // is a look, so the host never counts it as a change to anything.
  const wrap = (marble) => {
    if (!marble || marble.looksWrapped) return;
    marble.looksWrapped = true;
    const send = marble.op;
    marble.op = (op, options = {}) => {
      const flag = options?.look;
      let looks = 0;
      const list = Array.isArray(op) ? op : [op];
      for (const one of list) {
        if (!is(one, flag)) continue;
        looks += 1;
        known.add(keyOf(one.id, one.name));
        hold(one.id, one.name, one.value ?? null);
      }
      if (looks && !Array.isArray(op) && flag === undefined && !op.look) options = { ...options, look: true };
      return send.call(marble, op, options);
    };
    restore();
    marble.register?.(putBack);
  };

  window.marbleLooks = {
    is,
    // A look a share link's tab keeps without sending (runtime/share.js), so
    // its reload opens where it was too.
    keep: (op) => {
      if (op?.type !== 'setAttr' || typeof op.id !== 'string') return;
      known.add(keyOf(op.id, op.name));
      hold(op.id, op.name, op.value ?? null);
    },
    held: () => [...held.values()].map(({ id, name, value }) => ({ id, name, value })),
  };

  if (window.marble) wrap(window.marble);
  else addEventListener('marble:ready', (event) => wrap(event.detail), { once: true });
})();
