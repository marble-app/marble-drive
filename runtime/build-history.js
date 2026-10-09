// Build mode's History: every version of the app on one timeline, the builds
// and the person's own edits between them, newest first, in the chat's
// sidebar (a view, like Marks and Pieces; agent-ui.js addView).
//
// A hand on an entry lights what it changed on the app; a press holds that
// and opens it: a build opens its status in three layers (build-mode.js
// statusCard: its picture, its stages, a stage's steps, each changed step
// lighting what it touched) and the way back to it; an edit, the way back to
// just before it. Nothing here is kept on the page: the timeline is read from
// the host each time (GET /agent/builds/history, server/build/history.js).
//
// Spec: Notes and Sketches/Build Mode and Asking/Build Mode, History.

(() => {
  if (globalThis.marbleHistory) return;
  const TRANSIENT = 'data-marble-transient';
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';

  const ICON = {
    build: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M4.1 4.1l1.4 1.4M10.5 10.5l1.4 1.4M4.1 11.9l1.4-1.4M10.5 5.5l1.4-1.4"/></svg>',
    edit: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.25 3.25 12.75 5.75 6 12.5l-3.25.75.75-3.25z"/></svg>',
    chat: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.75 4.75c0-.97.78-1.75 1.75-1.75h7c.97 0 1.75.78 1.75 1.75v4.5c0 .97-.78 1.75-1.75 1.75H7.25l-2.75 2.25V11c-.97 0-1.75-.78-1.75-1.75z"/></svg>',
    origin: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  };

  const STYLE = `
    .marble-history { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; pointer-events: auto; }
    .marble-history .hh { flex: none; height: 52px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 16px; }
    .marble-history .hh b { font-size: 14px; font-weight: 600; }
    .marble-history .hh small { color: var(--b-muted); font-size: 12.5px; }
    .marble-history .hh .sp { flex: 1; }
    .marble-history .x { all: unset; box-sizing: border-box; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: var(--b-muted); cursor: pointer; }
    .marble-history .x:hover { background: var(--b-paper-2); color: var(--b-ink); }
    .marble-history .x:focus-visible { outline: 2px solid var(--b-mark); }
    .marble-history .x svg { width: 15px; height: 15px; }
    .marble-history .tl { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; list-style: none; margin: 0; padding: 2px 14px 24px 12px; }
    .marble-history .none { color: var(--b-muted); font-size: 13px; padding: 12px 6px; }

    /* An entry: a dot on the rail, its words, and when. */
    .marble-history .ev { position: relative; padding-left: 22px; }
    .marble-history .ev::before { content: ""; position: absolute; left: 7px; top: 0; bottom: 0; width: 1px; background: var(--b-line); }
    .marble-history .ev:first-child::before { top: 14px; }
    .marble-history .ev:last-child::before { bottom: calc(100% - 14px); }
    .marble-history .ev > .dot { position: absolute; left: 2px; top: 9px; width: 11px; height: 11px; border-radius: 50%; box-sizing: border-box;
      background: var(--b-card); border: 1.5px solid var(--b-faint); }
    .marble-history .ev[data-kind="build"] > .dot { border-color: var(--b-mark); background: var(--b-mark); }
    .marble-history .ev[data-kind="origin"] > .dot { border-style: dashed; }
    .marble-history .ev[data-showing] > .dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--b-accent) 45%, transparent); }
    .marble-history .ev > button.eh { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 16px 1fr auto; column-gap: 8px; align-items: start; width: 100%;
      padding: 6px 8px; border-radius: 8px; cursor: pointer; transition: background 160ms ${EASE}; }
    .marble-history .ev > button.eh:hover, .marble-history .ev[data-lit] > button.eh { background: color-mix(in srgb, var(--b-accent) 18%, transparent); }
    .marble-history .ev > button.eh:focus-visible { outline: 2px solid var(--b-mark); outline-offset: -2px; }
    .marble-history .eh svg { width: 14px; height: 14px; margin-top: 2px; color: var(--b-muted); }
    .marble-history .ev[data-kind="build"] .eh svg { color: var(--b-mark); }
    .marble-history .eh .w { min-width: 0; }
    .marble-history .eh .w b { display: block; font-weight: 600; font-size: 13px; }
    .marble-history .eh .w > span { display: block; color: var(--b-muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-history .ev[data-open] .eh .w > span { white-space: normal; overflow-wrap: anywhere; }
    .marble-history .eh time { color: var(--b-faint); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 1px; }
    .marble-history .eh .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 6px; font-size: 11px; font-weight: 500; line-height: 18px;
      background: color-mix(in srgb, var(--b-accent) 30%, var(--b-card)); color: var(--b-ink); vertical-align: 1px; }
    .marble-history .body { padding: 2px 0 10px 8px; display: flex; flex-direction: column; gap: 8px; }
    .marble-history .ev:not([data-open]) .body { display: none; }
    .marble-history .acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .marble-history .acts small { color: var(--b-muted); font-size: 12px; }
    .marble-history .btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 8px;
      font-size: 12.5px; font-weight: 500; cursor: pointer; background: var(--b-paper-2); color: var(--b-ink); transition: background 160ms ${EASE}; }
    .marble-history .btn:hover { background: var(--b-paper-3); }
    .marble-history .btn:focus-visible { outline: 2px solid var(--b-mark); outline-offset: 1px; }
    .marble-history .btn[aria-disabled="true"] { opacity: .45; cursor: default; }
  `;

  const h = (tag, className = '', text = null) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.setAttribute(TRANSIENT, '');
    if (text != null) node.textContent = text;
    return node;
  };
  const enc = encodeURIComponent;
  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr}h`;
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const boot = () => {
    const B = window.marbleBuild;
    const M = window.marbleMarks;
    if (!B?.addView || !M) return false;
    if (globalThis.marbleHistory) return true;

    const panel = h('section', 'marble-history');
    panel.setAttribute('aria-label', 'History');
    const head = h('div', 'hh');
    const count = h('small');
    const shut = h('button', 'x');
    shut.type = 'button';
    shut.innerHTML = ICON.close;
    shut.setAttribute('aria-label', 'Close History');
    shut.addEventListener('click', () => B.setSide('none'));
    head.append(h('b', '', 'History'), count, h('span', 'sp'), shut);
    const list = h('ol', 'tl');
    list.setAttribute('aria-label', 'Versions, newest first');
    panel.append(head, list);
    B.addView('history', panel, STYLE);

    let open = false;
    let entries = [];
    const opened = new Set();
    const cards = new Map(); // build id → statusCard
    let loading = null;

    const get = async (route, method = 'GET') => {
      const response = await fetch(route, { method });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `${response.status}`);
      return data;
    };
    const load = () => {
      loading ??= get(`/agent/builds/history?path=${enc(B.app)}`)
        .then((got) => { entries = Array.isArray(got?.entries) ? got.entries : []; draw(); })
        .catch(() => {})
        .finally(() => { loading = null; });
      return loading;
    };
    let soon = 0;
    const later = () => { if (!open) return; clearTimeout(soon); soon = setTimeout(load, 900); };

    const buildOf = (id) => (B.state()?.builds ?? []).find((b) => b.id === id) ?? null;
    const busy = () => Boolean((B.state()?.builds ?? []).some((b) => b.status === 'running'));

    /** A build's status, filled with what the host kept of its steps. */
    const cardFor = (entry) => {
      let card = cards.get(entry.id);
      if (!card) { card = B.statusCard(); cards.set(entry.id, card); }
      const build = buildOf(entry.id) ?? entry;
      if (build.log || build.status === 'running' || build.status === 'paused') card.update(build);
      else {
        card.update(build, card.log ?? []);
        if (!card.fetched) {
          card.fetched = true;
          get(`/agent/builds/${enc(entry.id)}/drawn?path=${enc(B.app)}`)
            .then((got) => { card.log = got.log ?? []; card.update({ ...(buildOf(entry.id) ?? entry), drawn: got.drawn ?? null }, card.log); })
            .catch(() => {});
        }
      }
      return card;
    };

    const goBack = async (entry) => {
      if (busy()) { B.say('Wait for the build to finish, or stop it, to go back.'); return; }
      if (entry.kind === 'build' || entry.kind === 'origin') {
        await B.view(entry.id);
      } else if (entry.before) {
        try {
          await get(`/restore?app=${enc(B.app)}&sha=${enc(entry.before)}`, 'POST');
        } catch (err) { B.say(err.message || 'That version is no longer kept.'); return; }
      }
      later();
    };

    const draw = () => {
      if (!open) return;
      const builds = B.state()?.builds ?? [];
      const rows = [];
      const all = [...entries];
      // The app as it was before any build: the first build's start.
      const first = builds[0];
      if (first) all.push({ kind: 'origin', id: 'origin', at: (first.startedAt ?? 0) - 1, title: first.title === 'From your prompt' ? 'Your prompt' : 'Before build 1', showing: Boolean(B.state()?.origin?.showing) });
      count.textContent = all.length ? `${all.length}` : '';
      for (const entry of all) {
        const li = h('li', 'ev');
        li.dataset.kind = entry.kind;
        li.dataset.id = entry.id;
        li.toggleAttribute('data-open', opened.has(entry.id));
        li.toggleAttribute('data-showing', Boolean(entry.showing));
        li.append(h('i', 'dot'));
        const press = h('button', 'eh');
        press.type = 'button';
        press.dataset.lights = '1';
        press.setAttribute('aria-expanded', String(opened.has(entry.id)));
        press.insertAdjacentHTML('afterbegin', ICON[entry.kind] ?? ICON.edit);
        const w = h('span', 'w');
        const name = entry.kind === 'build' ? `Build ${entry.n}` : entry.kind === 'origin' ? entry.title : entry.kind === 'chat' ? 'From a chat' : 'Your edit';
        const b = h('b', '', name);
        if (entry.showing) b.append(h('span', 'tag', 'Showing'));
        if (entry.kind === 'build' && (entry.status === 'running' || entry.status === 'paused')) b.append(h('span', 'tag', entry.status === 'running' ? 'Building' : 'Paused'));
        const words = entry.kind === 'build' ? entry.title
          : entry.kind === 'origin' ? (entry.title === 'Your prompt' ? 'The empty app' : 'The app as it was')
          : entry.said;
        w.append(b, h('span', '', words || ''));
        press.append(w, h('time', '', entry.at ? ago(entry.at) : ''));
        if (entry.at) press.querySelector('time').dateTime = new Date(entry.at).toISOString();
        const ids = entry.ids ?? [];
        press.addEventListener('pointerenter', () => { if (ids.length) { B.light(ids); li.setAttribute('data-lit', ''); } });
        press.addEventListener('pointerleave', () => { B.unlight(); li.removeAttribute('data-lit'); });
        press.addEventListener('click', () => {
          if (opened.has(entry.id)) opened.delete(entry.id); else opened.add(entry.id);
          if (ids.length && opened.has(entry.id)) B.light(ids, { hold: true });
          draw();
        });
        li.append(press);
        if (opened.has(entry.id)) {
          const body = h('div', 'body');
          if (entry.kind === 'build') {
            const card = cardFor(entry);
            body.append(card.node);
          }
          const acts = h('div', 'acts');
          if (entry.kind === 'build' || entry.kind === 'origin') {
            const can = entry.kind === 'origin' || entry.hasEnd;
            if (!entry.showing && can) {
              const back = h('button', 'btn', entry.kind === 'origin' ? 'Go back to this' : `Go back to build ${entry.n}`);
              back.type = 'button';
              back.setAttribute('aria-disabled', String(busy()));
              back.addEventListener('click', () => goBack(entry));
              acts.append(back);
            } else if (entry.showing) acts.append(h('small', '', 'The app is this version now.'));
          } else {
            if (entry.before) {
              const back = h('button', 'btn', 'Go back to before this');
              back.type = 'button';
              back.setAttribute('aria-disabled', String(busy()));
              back.addEventListener('click', () => goBack(entry));
              acts.append(back);
            }
            acts.append(h('small', '', `${ids.length} part${ids.length === 1 ? '' : 's'} changed`));
          }
          if (acts.childElementCount) body.append(acts);
          li.append(body);
        }
        rows.push(li);
      }
      if (!rows.length) rows.push(h('li', 'none', 'Nothing yet. Each build, and each of your own edits, shows here.'));
      list.replaceChildren(...rows);
    };

    const sync = () => {
      const want = B.side === 'history';
      if (want === open) return;
      open = want;
      if (!open) { B.unlight({ held: true }); return; }
      draw();
      load();
    };
    addEventListener('marble-build:side', sync);
    addEventListener('marble-build:state', () => { if (open) { draw(); later(); } });
    document.addEventListener('marble:ops', later);
    sync();

    globalThis.marbleHistory = { reload: load, get open() { return open; } };
    return true;
  };

  if (!boot()) addEventListener('marble-build:ready', () => setTimeout(boot, 0), { once: true });
})();
