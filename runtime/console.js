// The Console's page: every drive, shipping, the workshop, and what the console
// has done (docs/superpowers/specs/2026-09-24-the-console-design.md).
//
// Injected by the host into the Console document only, where the console is
// on. Everything here is transient chrome built from /console/api/state and
// kept current by /console/api/events; nothing is written to the file, because
// nothing on this page is the owner's writing. Which view, which drive and
// which job are "your room", kept in this browser.
//
// One rule for the whole page: what it shows is derived from one state object
// (S), and every paint is a function of it. A button is busy because a job of
// its kind is running on its drive, not because it was clicked; so a reload,
// a second tab, or a job started from a terminal all look the same.

(() => {
  const mount = document.querySelector('main[data-console]');
  if (!mount || window.marbleConsoleReady) return;
  // Only a flag and a redraw, for tests: the page keeps its state to itself.
  window.marbleConsoleReady = { redraw: () => { drawn.clear(); paint(); } };

  const TRANSIENT = 'data-marble-transient';
  const VIEWS = [['dashboard', 'Dashboard'], ['drives', 'Drives'], ['ship', 'Ship'], ['workshop', 'Workshop'], ['activity', 'Activity']];
  const LIMITS = [
    ['MARBLE_DRIVE_TAB_HIDDEN_SECONDS', 'A hidden tab rests after', 's', 60],
    ['MARBLE_DRIVE_TAB_IDLE_MINUTES', 'An idle tab rests after', 'min', 10],
    ['MARBLE_DRIVE_STREAM_UNUSED_MINUTES', 'A forgotten tab is closed after', 'min', 15],
    ['MARBLE_DRIVE_ASK_HOLD_MINUTES', 'A question keeps it awake for', 'min', 10],
    ['MARBLE_DRIVE_NO_PROGRESS_MINUTES', 'Stuck work keeps it awake for', 'min', 30],
    ['MARBLE_DRIVE_AWAKE_MAX_HOURS', 'Awake with nobody, at most', 'h', 24],
    ['MARBLE_DRIVE_AGENT_STALL_MINUTES', 'A silent turn is stopped after', 'min', 30],
  ];
  const KNOWN = new Set(LIMITS.map(([k]) => k));
  const LABELS = {
    deploy: ['Deploy main', 'Deploying…', 'Deployed'],
    'deploy-workshop': ["Deploy the workshop's copy", 'Deploying…', 'Deployed'],
    rollback: ['Roll back', 'Rolling back…', 'Rolled back'],
    settings: ['Apply', 'Applying…', 'Applied'],
    passphrase: ['New passphrase', 'Changing…', 'Changed'],
    claude: ['', 'Switching…', 'Switched'],
    signout: ['Sign out of Claude', 'Signing out…', 'Signed out'],
    access: ['', 'Changing…', 'Changed'],
    checkpoint: ['Make a checkpoint', 'Making one…', 'Made'],
    restore: ['Restore', 'Restoring…', 'Restored'],
    remove: ['Remove this drive', 'Removing…', 'Removed'],
    ship: ['Ship', 'Shipping…', 'Shipped'],
    pull: ['Pull', 'Pulling…', 'Pulled'],
    test: ['Run tests', 'Testing…', 'Passed'],
    publish: ['Publish', 'Publishing…', 'Published'],
  };

  // ----------------------------------------------------------------- store

  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(`console.${key}`);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`console.${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  const S = {
    // The Console opens on the dashboard; the other views are a tap away.
    view: 'dashboard',
    drive: store.get('drive'),
    job: store.get('job'),
    open: false, // the detail slid in, on a phone
    fleet: [],
    fleetAt: 0,
    fleetError: null,
    self: null,
    workshop: null,
    jobs: [],
    outputs: new Map(),
    pending: new Map(), // drive → { set: {}, unset: [] }
    checkpoints: new Map(), // drive → { list, at, loading }
    looking: new Set(),
    revealed: new Map(), // drive → passphrase, while shown
    said: new Map(), // control key → { text, until }
    flash: new Map(), // `${target}:${kind}` → until
    seen: new Set(store.get('seenJobs', [])),
    live: 'connecting',
    loaded: false,
    projects: null,
    conversations: null,
    chat: store.get('chat', 'marble-drive'),
    chatConversation: null,
    animateDetail: true,
    animateList: true,
    arrived: new Set(), // views drawn since they were last switched to
    // The dashboard's data, one answer per range, and which cards show a table.
    range: ['24h', '7d', '30d', 'month'].includes(store.get('range')) ? store.get('range') : '7d',
    usage: new Map(), // range → { data, at }
    usageLoading: new Set(),
    usageError: null,
    usageStale: false,
    tables: new Set(store.get('tables', [])),
    heatFor: store.get('heatFor', 'all'),
  };

  // ---------------------------------------------------------------- helpers

  function h(tag, props, ...kids) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className += ` ${v}`;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  async function api(route, { method = 'GET', body } = {}) {
    const res = await fetch(`/console/api/${route}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || `${res.status}`);
      err.job = data?.job;
      throw err;
    }
    return data;
  }

  const MIN = 60_000;
  function ago(when) {
    const t = typeof when === 'number' ? when : Date.parse(when);
    if (!Number.isFinite(t)) return '';
    const d = Date.now() - t;
    if (d < 45_000) return 'now';
    if (d < 60 * MIN) return `${Math.round(d / MIN)}m`;
    if (d < 24 * 60 * MIN) return `${Math.round(d / (60 * MIN))}h`;
    return `${Math.round(d / (24 * 60 * MIN))}d`;
  }
  /** "just now" or "3h ago", for a sentence. */
  const since = (when) => {
    const a = ago(when);
    return a === 'now' ? 'just now' : a ? `${a} ago` : '';
  };
  function clock(when) {
    const t = new Date(typeof when === 'number' ? when : Date.parse(when));
    if (Number.isNaN(t.getTime())) return '';
    const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const days = (Date.now() - t.getTime()) / (24 * 60 * MIN);
    if (new Date().toDateString() === t.toDateString()) return time;
    if (days < 6) return `${t.toLocaleDateString([], { weekday: 'short' })} ${time}`;
    return t.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function span(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function bytes(n) {
    if (!Number.isFinite(n)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i += 1;
    }
    return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
  }
  const releaseSha = (release) => /-([0-9a-f]{7,40})$/.exec(String(release ?? ''))?.[1] ?? null;
  const releaseAt = (release) => {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(String(release ?? ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  };
  const isLocal = (release) => /-local-/.test(String(release ?? ''));
  const person = (d, long = false) => {
    if (d.role === 'owner') return long && d.self ? 'Your drive, and the workshop' : 'Yours';
    const slug = d.name.replace(/^t-/, '');
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  };
  const drive = (name) => S.fleet.find((d) => d.name === name) ?? null;
  const subjectOf = (sha) => (sha && S.workshop?.main?.commits?.find((c) => c.sha.startsWith(sha))?.subject) ?? null;
  const running = (target, kinds) => S.jobs.find((j) => j.state === 'running' && (j.target === target || (j.target === 'fleet' && j.meta?.targets?.includes(target))) && (!kinds || kinds.includes(j.kind) || (j.kind === 'ship' && kinds.includes('deploy'))));
  const failedUnseen = (d) => d.lastJob && d.lastJob.state === 'failed' && !S.seen.has(d.lastJob.id);

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------- painting, once

  // Nothing is rebuilt under a hand: a paint that lands between a press and
  // its release would replace the button being pressed and the click would be
  // lost. A paint asked for while a pointer is down waits for it to come up.
  let frame = 0;
  let holding = false;
  let waiting = false;
  function paint() {
    if (holding) {
      waiting = true;
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }
  addEventListener('pointerdown', () => { holding = true; }, true);
  const letGo = () => {
    holding = false;
    if (waiting) {
      waiting = false;
      // After the click has been dispatched.
      setTimeout(paint, 0);
    }
  };
  addEventListener('pointerup', letGo, true);
  addEventListener('pointercancel', letGo, true);

  // Each region is rebuilt only when what it shows has changed, so a stream of
  // updates about other drives leaves the one being read, and its controls,
  // alone. The minute is part of every key, for the ages.
  const drawn = new Map();
  const changed = (region, value) => {
    const key = JSON.stringify([Math.floor(Date.now() / 60_000), value]);
    if (drawn.get(region) === key) return false;
    drawn.set(region, key);
    return true;
  };
  const notes = (part) => [...S.said].filter(([k, v]) => k.includes(part) && v.until > Date.now()).map(([k, v]) => [k, v.text])
    .concat([...S.flash].filter(([k, until]) => k.includes(part) && until > Date.now()).map(([k]) => [k]));
  const liveJobs = () => S.jobs.filter((j) => j.state === 'running').map((j) => [j.id, j.kind, j.target, j.meta?.source]);

  const say = (key, text) => {
    S.said.set(key, { text, until: Date.now() + 6000 });
    paint();
    setTimeout(paint, 6100);
  };
  const said = (key) => {
    const s = S.said.get(key);
    if (!s || s.until < Date.now()) return null;
    return h('span.said', { role: 'status', text: s.text });
  };

  /** A button whose look follows the job it starts. `key` names it for the
   *  error said under it; `job` is [target, kind] to derive busy and done. */
  function jobButton({ key, target, kind, label, cls = '', disabled = false, onclick, title }) {
    const [idle, busy, done] = LABELS[kind] ?? [label, `${label}…`, label];
    const live = running(target, [kind.replace(/-workshop$/, '')]);
    const liveHere = live && (live.meta?.source === 'workshop') === kind.endsWith('-workshop') ? live : (live && kind !== 'deploy' && kind !== 'deploy-workshop' ? live : null);
    const flashed = (S.flash.get(`${target}:${kind}`) ?? 0) > Date.now();
    const b = h(`button.btn${cls ? `.${cls}` : ''}`, {
      type: 'button',
      'data-key': key,
      'data-busy': liveHere ? true : null,
      'data-done': !liveHere && flashed ? true : null,
      disabled: disabled || (live && !liveHere) ? true : null,
      title,
      onclick: liveHere ? null : onclick,
      text: liveHere ? busy : flashed ? done : (label ?? idle),
    });
    return b;
  }

  async function start(key, call) {
    try {
      const job = await call();
      if (job?.id) upsertJob(job);
      return job;
    } catch (err) {
      if (err.job) upsertJob(err.job);
      say(key, err.message);
      return null;
    }
  }

  // ------------------------------------------------------------- popovers

  let pop = null;
  function closePop() {
    if (pop?.matches(':popover-open')) pop.hidePopover();
  }
  /** Hung under its trigger, in the top layer, grown from the nearest corner. */
  function openPop(trigger, build) {
    closePop();
    pop?.remove();
    pop = h('div.pop', { popover: 'auto', [TRANSIENT]: true, role: 'dialog' });
    pop.append(build(closePop));
    document.body.append(pop);
    const r = trigger.getBoundingClientRect();
    pop.showPopover();
    const w = pop.offsetWidth;
    const alignRight = r.left + w > innerWidth - 12;
    const left = alignRight ? Math.max(12, r.right - w) : Math.max(12, r.left);
    const below = r.bottom + 8 + pop.offsetHeight < innerHeight - 12 || r.top < innerHeight / 2;
    pop.style.left = `${left}px`;
    pop.style.top = below ? `${r.bottom + 6}px` : `${Math.max(12, r.top - 6 - pop.offsetHeight)}px`;
    pop.style.setProperty('--origin', `${below ? 'top' : 'bottom'} ${alignRight ? 'right' : 'left'}`);
    pop.querySelector('input, button.primary')?.focus();
  }

  function confirmTyped(trigger, { title, body, word, action, run }) {
    openPop(trigger, (close) => {
      const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: word, 'aria-label': `Type ${word}` });
      const go = h('button.btn.danger.primary', { type: 'button', disabled: true, text: action });
      input.addEventListener('input', () => { go.disabled = input.value.trim() !== word; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) go.click(); });
      go.addEventListener('click', () => {
        close();
        run(input.value.trim());
      });
      return h('div.pop-body', {},
        h('h4', { text: title }),
        h('p.soft', { text: body }),
        h('div.field', {}, h('label', { text: `Type ${word} to confirm` }), input),
        h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }), go));
    });
  }

  // -------------------------------------------------------------- skeleton

  const root = h('div.cx', { [TRANSIENT]: true, 'data-view': S.view });
  const seg = h('nav.seg', { role: 'tablist', 'aria-label': 'Console views' }, h('span.seg-thumb'));
  for (const [id, label] of VIEWS) {
    seg.append(h('button', {
      type: 'button',
      role: 'tab',
      'data-view': id,
      'aria-selected': String(id === S.view),
      onclick: () => setView(id),
    }, label));
  }
  seg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = VIEWS.findIndex(([v]) => v === S.view);
    const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length][0];
    setView(next);
    seg.querySelector(`[data-view="${next}"]`).focus();
  });
  const live = h('span.cx-live', { 'aria-live': 'polite' }, h('span.dot'), h('span.state'), h('span.when'));
  const primary = h('span.cx-primary');
  const bar = h('header.cx-bar', {}, h('h1.cx-title', { text: document.title || 'Console' }), seg, h('div.cx-bar-end', {}, live, primary));

  const views = {};
  for (const [id] of VIEWS) views[id] = h('section.cx-view', { 'data-view': id, role: 'tabpanel' });
  root.append(bar, h('div.cx-views', {}, Object.values(views)));
  mount.append(root);

  // The drives: a list pane and a detail pane on the well.
  const drivesWell = h('div.well');
  const listScroll = h('div.pane-scroll', { role: 'listbox', 'aria-label': 'Drives' });
  const detailScroll = h('div.pane-scroll');
  const detailPane = h('div.pane.detail', {}, detailScroll);
  drivesWell.append(h('div.pane.list', {}, listScroll), detailPane);
  views.drives.append(drivesWell);

  // Activity: jobs and one job's output.
  const jobsWell = h('div.well');
  const jobsScroll = h('div.pane-scroll', { role: 'listbox', 'aria-label': 'Jobs' });
  const jobPane = h('div.pane.detail');
  jobsWell.append(h('div.pane.list', {}, h('div.pane-head', {}, h('h2', { text: 'What the console has done' })), jobsScroll), jobPane);
  views.activity.append(jobsWell);

  const dashPage = h('div.page.dash');
  views.dashboard.append(dashPage);
  new ResizeObserver(() => {
    drawn.delete('dash');
    if (S.view === 'dashboard') paint();
  }).observe(dashPage);

  const shipPage = h('div.page');
  views.ship.append(shipPage);
  const shopPage = h('div.page');
  views.workshop.append(shopPage);

  function placeThumb() {
    const on = seg.querySelector('[aria-selected="true"]');
    const thumb = seg.querySelector('.seg-thumb');
    if (!on) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  new ResizeObserver(placeThumb).observe(seg);

  function setView(id) {
    if (S.view === id) return;
    S.view = id;
    store.set('view', id);
    root.dataset.view = id;
    S.arrived.delete(id);
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.view === id));
    placeThumb();
    if (id === 'workshop') loadChats();
    if (id === 'dashboard') loadUsage(S.range);
    paint();
  }

  // ------------------------------------------------------------ the list

  const rows = new Map();
  function rowFor(d, i) {
    let row = rows.get(d.name);
    if (!row) {
      row = h('button.row', { type: 'button', role: 'option', 'data-name': d.name, style: { '--i': String(S.animateList ? i : 0) }, onclick: () => pick(d.name) },
        h('span.dot'), h('span.row-title'), h('span.row-age'), h('span.row-meta'));
      rows.set(d.name, row);
      // A row arrives once; re-placing it on a later paint must not replay that.
      row.addEventListener('animationend', () => { row.style.animation = 'none'; }, { once: true });
      if (!S.animateList) row.style.animation = 'none';
    }
    const job = running(d.name);
    const failed = failedUnseen(d);
    const seen = d.seen;
    const state = job ? 'busy' : failed ? 'failed' : d.awake ? 'awake' : 'asleep';
    row.querySelector('.dot').dataset.state = state;
    row.querySelector('.dot').setAttribute('aria-label', state);
    const title = row.querySelector('.row-title');
    title.replaceChildren(d.name, h('span.who', { text: person(d) }));
    const age = row.querySelector('.row-age');
    age.textContent = d.awake ? 'awake' : ago(d.since);
    age.toggleAttribute('data-awake', d.awake);
    const meta = row.querySelector('.row-meta');
    const sha = releaseSha(d.release);
    const facts = [
      sha ? (d.releaseFrom === 'checkpoint'
        ? `${sha.slice(0, 7)} or later`
        : `${sha.slice(0, 7)}${d.behind > 0 ? ` · ${d.behind} behind` : ''}`) : null,
      seen?.claudeAuth === 'login' ? 'Claude login' : seen?.claudeAuth === 'api' ? 'API key' : null,
      d.access,
    ].filter(Boolean);
    meta.textContent = job ? `${job.title}…` : failed ? `${d.lastJob.title} failed` : facts.join(' · ') || 'Not looked inside yet';
    meta.toggleAttribute('data-busy', Boolean(job));
    meta.toggleAttribute('data-failed', Boolean(failed && !job));
    const current = d.name === S.drive && (S.open || !narrow());
    row.setAttribute('aria-current', String(current));
    row.setAttribute('aria-selected', String(current));
    return row;
  }

  function drawList() {
    const groups = [
      ['Yours', S.fleet.filter((d) => d.role !== 'user')],
      ['People', S.fleet.filter((d) => d.role === 'user')],
    ].filter(([, list]) => list.length);
    const kids = [];
    let i = 0;
    for (const [label, list] of groups) {
      kids.push(h('h3.group', {}, label, h('span.count', { text: String(list.length) })));
      for (const d of list) kids.push(rowFor(d, i++));
    }
    if (!S.fleet.length) kids.push(h('p.empty', { text: S.loaded ? (S.fleetError ? `The fleet could not be read: ${S.fleetError}` : 'No drives in the org yet.') : 'Reading the fleet…' }));
    listScroll.replaceChildren(...kids);
    for (const name of rows.keys()) if (!drive(name)) rows.delete(name);
    S.animateList = false;
  }

  function pick(name) {
    if (S.drive !== name) S.animateDetail = true;
    S.drive = name;
    S.open = true;
    store.set('drive', name);
    const d = drive(name);
    if (d?.lastJob) markSeen(d.lastJob.id);
    loadCheckpoints(name);
    if (narrow()) history.pushState({ consoleOpen: name }, '');
    paint();
  }
  const narrow = () => document.documentElement.clientWidth <= 760;
  addEventListener('popstate', () => {
    if (S.open) {
      S.open = false;
      paint();
    }
  });
  listScroll.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const names = [...listScroll.querySelectorAll('.row')].map((r) => r.dataset.name);
    const i = names.indexOf(S.drive);
    const next = names[Math.max(0, Math.min(names.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      pick(next);
      requestAnimationFrame(() => rows.get(next)?.focus());
    }
  });

  function markSeen(id) {
    if (!id || S.seen.has(id)) return;
    S.seen.add(id);
    store.set('seenJobs', [...S.seen].slice(-300));
  }

  // ----------------------------------------------------------- the detail

  function drawDetail() {
    const d = drive(S.drive) ?? S.fleet[0];
    if (d && S.drive !== d.name) {
      S.drive = d.name;
      loadCheckpoints(d.name);
    }
    drivesWell.toggleAttribute('data-open', Boolean(S.open && d));
    if (!d) {
      detailScroll.replaceChildren(h('p.empty', { text: S.loaded ? 'Pick a drive.' : '' }));
      detailPane.querySelector('.pending')?.remove();
      return;
    }
    if (!S.usage.has('7d')) loadUsage('7d');
    if (!changed('detail', [d, S.checkpoints.get(d.name), S.revealed.get(d.name), S.looking.has(d.name), liveJobs(), notes(d.name), S.workshop?.main?.sha, S.open, S.forceDetail, S.usage.get('7d')?.at])) {
      pendingBar(d);
      return;
    }
    S.forceDetail = null;
    // Keep what the hand is in: the focused control and its caret survive a paint.
    const active = document.activeElement;
    const focusKey = detailScroll.contains(active) ? active.dataset?.key : null;
    const caret = focusKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

    const body = h('div.detail-body', { class: S.animateDetail ? null : 'still' },
      head(d), use(d), release(d), health(d), claude(d), access(d), settings(d), checkpoints(d), d.role === 'user' ? remove(d) : null);
    if (!S.animateDetail) body.style.animation = 'none';
    S.animateDetail = false;
    detailScroll.replaceChildren(body);
    pendingBar(d);

    if (focusKey) {
      const again = detailScroll.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        if (caret && again.setSelectionRange) try { again.setSelectionRange(...caret); } catch {}
      }
    }
  }

  function head(d) {
    const since = d.since ? clock(d.since) : '';
    const looking = S.looking.has(d.name);
    return h('div.d-head', {},
      h('div.names', {},
        h('h2.d-name', {},
          h('button.back', { type: 'button', 'aria-label': 'Back to the drives', onclick: () => {
            if (history.state?.consoleOpen) history.back();
            else {
              S.open = false;
              paint();
            }
          } }),
          h('span.dot', { 'data-state': running(d.name) ? 'busy' : d.awake ? 'awake' : 'asleep' }),
          d.name),
        h('p.d-sub', {}, `${person(d, true)} · `, d.awake ? h('span.good', { text: `awake${since ? ` since ${since}` : ''}` }) : `asleep${since ? ` since ${since}` : ''}`)),
      h('div.actions', {},
        h('a.btn', { href: d.url, target: '_blank', rel: 'noopener' }, 'Open drive', h('span.out')),
        h('button.btn', {
          type: 'button',
          'data-key': `look:${d.name}`,
          'data-busy': looking ? true : null,
          title: d.awake ? 'It is awake: looking costs nothing' : 'Wakes it for a moment',
          text: looking ? 'Looking…' : 'Look now',
          onclick: looking ? null : () => look(d.name),
        })),
      said(`look:${d.name}`));
  }

  async function look(name) {
    S.looking.add(name);
    paint();
    try {
      const seen = await api(`drives/${encodeURIComponent(name)}/look`, { method: 'POST' });
      const d = drive(name);
      if (d) d.seen = seen;
    } catch (err) {
      say(`look:${name}`, err.message);
    } finally {
      S.looking.delete(name);
      paint();
    }
  }

  function section(title, note, ...kids) {
    return h('section.sec', {}, h('h3', {}, title, note ? h('span.note', { text: note }) : null), kids);
  }

  const releaseName = (r) => `${(releaseSha(r) ?? r).slice(0, 7)}${isLocal(r) ? ' (workshop copy)' : ''}`;
  function release(d) {
    const seen = d.seen;
    const live = d.release;
    const sha = releaseSha(live);
    const when = releaseAt(live);
    const subject = subjectOf(sha);
    const history = (seen?.history ?? []).filter((r) => r !== live).reverse();
    const status = !live ? h('span.faint', { text: 'Not known yet: Look now reads it' })
      : isLocal(live) ? h('span.warn', { text: "The workshop's copy, not main" })
        : d.releaseFrom === 'checkpoint' ? h('span.soft', { text: d.behind > 0 ? `At most ${d.behind} behind main: known from its last deploy's checkpoint, and a deploy made without one would not show. Look now to be sure.` : 'Known from its last deploy’s checkpoint.' })
        : d.behind === 0 ? h('span.good', { text: 'Up to date with main' })
          : d.behind > 0 ? h('span.warn', { text: `${d.behind} behind main` })
            : h('span.faint', { text: 'Not on main' });
    const source = d.releaseFrom === 'checkpoint' ? 'from a checkpoint' : d.releaseFrom === 'console' ? 'as deployed from here' : seen ? `looked ${since(seen.lookedAt)}` : null;
    return section('Release', source,
      live ? h('p.lede', {}, h('span.sha', { text: sha ? sha.slice(0, 7) : live }), ' ', h('b', { text: subject ?? (isLocal(live) ? 'a working copy' : '') }), when ? h('span.faint', { text: ` · ${clock(when)}` }) : null) : null,
      h('p.lede', {}, status),
      history.length ? h('p.faint', { style: { 'font-size': '.8rem', margin: '.35rem 0 0' } }, `Before it: ${history.map(releaseName).join(', ')}`) : null,
      d.stuckCheckpoints ? h('p.warn', { style: { 'font-size': '.8rem', margin: '.5rem 0 0' } },
        'Checkpoints fail here (Fly’s store is stuck), so deploys skip them. ',
        h('button.btn.quiet', { type: 'button', style: { padding: '0 .3rem' }, onclick: () => start(`stuck:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/checkpoints-ok`, { method: 'POST' }).then(refresh)) }, 'Try them again')) : null,
      h('div.row-actions', {},
        jobButton({ key: `deploy:${d.name}`, target: d.name, kind: 'deploy', onclick: (e) => deployPlan(e.currentTarget, d.name, 'main') }),
        jobButton({ key: `deployw:${d.name}`, target: d.name, kind: 'deploy-workshop', cls: 'quiet', onclick: (e) => deployPlan(e.currentTarget, d.name, 'workshop') }),
        jobButton({ key: `rollback:${d.name}`, target: d.name, kind: 'rollback', cls: 'quiet', disabled: !history.length, title: history.length ? `Back to ${(releaseSha(history[0]) ?? history[0]).slice(0, 7)}` : 'Nothing to go back to', onclick: () => start(`rollback:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/rollback`, { method: 'POST' })) })),
      said(`deploy:${d.name}`), said(`deployw:${d.name}`), said(`rollback:${d.name}`));
  }

  function deployPlan(trigger, name, source) {
    const key = source === 'workshop' ? `deployw:${name}` : `deploy:${name}`;
    openPop(trigger, (close) => {
      const body = h('div.pop-body', {}, h('h4', { text: source === 'workshop' ? `The workshop's copy, to ${name}` : `Main, to ${name}` }), h('p.loading', { text: 'Reading the plan…' }));
      api(`plan?name=${encodeURIComponent(name)}&source=${source}`).then((plan) => {
        body.replaceChildren(
          h('h4', { text: source === 'workshop' ? `The workshop's copy, to ${name}` : `Main, to ${name}` }),
          plan.ok ? h('ul.steps', {},
            source === 'main' ? h('li', {}, h('span.sha', { text: (plan.sha ?? '').slice(0, 7) }), ' ', subjectOf(plan.sha) ?? '') : h('li', { text: 'Everything in the workshop checkout, committed or not' }),
            h('li', { text: `${(plan.marble ?? '').replace('@bdhmin/', '')}${plan.marble?.startsWith('/') ? ' (packed from the workshop)' : ''} · Claude Code ${plan.claude ?? ''}` }),
            h('li', { text: plan.noCheckpoint.includes(name) ? 'No checkpoint (its store is stuck); Roll back still undoes the code' : 'A checkpoint first, so it can be undone' }),
            h('li', { text: name === plan.self ? 'Switches when no agent is working here' : 'Switches as soon as it is ready' })) : h('p.error', { text: plan.error ?? 'The plan could not be read' }),
          h('div.foot', {},
            h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }),
            h('button.btn.primary', {
              type: 'button',
              disabled: !plan.ok,
              text: 'Deploy',
              onclick: () => {
                close();
                start(key, () => api(`drives/${encodeURIComponent(name)}/deploy`, { method: 'POST', body: { source } }));
              },
            })));
      }).catch((err) => body.append(h('p.error', { text: err.message })));
      return body;
    });
  }

  function health(d) {
    const seen = d.seen;
    if (!seen) return section('Health', null, h('p.soft', { text: 'Nothing seen yet. Look now wakes it for a moment and reads it.' }));
    const lines = (seen.log ?? []).slice(-6).join('\n');
    return section('Health', null,
      h('dl.facts', {},
        fact('Working', seen.working === null || seen.working === undefined ? '—' : seen.working ? 'Yes' : 'Idle'),
        fact('Open tabs', seen.health?.streams ?? '—'),
        fact('Documents', seen.documents ?? '—'),
        fact('Drive', bytes(seen.driveBytes)),
        fact('Free', bytes(seen.diskFree)),
        fact('Claude Code', seen.claudeVersion ?? '—'),
        fact('marble', seen.marbleVersion ?? '—')),
      lines ? h('pre.lines', { text: lines }) : null,
      seen.switchLog?.length ? h('pre.lines', { text: seen.switchLog.slice(-4).join('\n') }) : null,
      h('div.row-actions', {}, h('button.btn.quiet', { type: 'button', onclick: (e) => readLog(e.currentTarget, d.name) }, 'Read the log')));
  }
  const fact = (label, value) => h('div', {}, h('dt', { text: label }), h('dd', { text: String(value) }));

  function readLog(trigger, name) {
    openPop(trigger, (close) => {
      const pre = h('pre.lines', { style: { 'max-height': '60vh', margin: '0' }, text: 'Reading…' });
      api(`drives/${encodeURIComponent(name)}/log?lines=400`).then(({ text }) => {
        pre.textContent = text || '(empty)';
        requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
      }).catch((err) => { pre.textContent = err.message; });
      const body = h('div.pop-body', {}, h('h4', { text: `${name}: the host's log` }), pre, h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Close', onclick: close })));
      return body;
    });
    pop.style.width = 'min(46rem, calc(100vw - 2rem))';
  }

  function claude(d) {
    const seen = d.seen;
    const busy = running(d.name, ['claude']);
    const mode = seen?.claudeAuth ?? null;
    const choose = (auth) => {
      if (auth === mode || busy) return;
      start(`claude:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/claude`, { method: 'POST', body: { auth } }));
    };
    const control = segmented([['login', 'Claude login'], ['api', 'API key']], busy ? null : mode, choose, { small: true, busy: Boolean(busy), label: 'Which Claude pays' });
    return section('Claude', null,
      h('div.kv', {},
        h('div.what', {}, h('span', { text: busy ? 'Switching…' : mode === 'login' ? 'Agents here use a Claude login' : mode === 'api' ? 'Agents here use an API key' : 'Not known yet' }),
          seen ? h('small', { text: [seen.claudeLogin ? 'A login is on this machine' : 'No login on this machine', (seen.keys ?? []).includes('anthropic') ? 'an API key is saved' : 'no API key saved'].join(' · ') } ) : null),
        control),
      mode === 'api' && seen && !(seen.keys ?? []).includes('anthropic') ? h('p.warn', { style: { margin: '.7rem 0 0', 'font-size': '.85rem' }, text: 'Its agents cannot run: no API key is saved. Paste one in its Agents settings, or switch it to a Claude login.' }) : null,
      mode === 'login' && seen && !seen.claudeLogin ? h('div', {},
        h('p.warn', { style: { margin: '.7rem 0 0', 'font-size': '.85rem' }, text: 'Sign it in: from your Mac, open its console and run Claude, then /login.' }),
        codeLine(`sprite console -o marble-drive -s ${d.name}`),
        codeLine('~/app/current/marble-drive/node_modules/.bin/claude')) : null,
      seen?.claudeLogin ? h('div.row-actions', {}, jobButton({ key: `signout:${d.name}`, target: d.name, kind: 'signout', cls: 'quiet', onclick: (e) => confirmSignOut(e.currentTarget, d.name) })) : null,
      said(`claude:${d.name}`), said(`signout:${d.name}`));
  }

  function confirmSignOut(trigger, name) {
    openPop(trigger, (close) => h('div.pop-body', {},
      h('h4', { text: `Sign ${name} out of Claude?` }),
      h('p.soft', { text: 'Its agents stop working on the login until someone signs in again. An API key, if saved, is not touched.' }),
      h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }),
        h('button.btn.primary', { type: 'button', text: 'Sign out', onclick: () => { close(); start(`signout:${name}`, () => api(`drives/${encodeURIComponent(name)}/signout`, { method: 'POST' })); } }))));
  }

  function codeLine(text) {
    const b = h('button.btn.quiet', { type: 'button', style: { padding: '.1rem .5rem' }, text: 'Copy' });
    b.addEventListener('click', async () => {
      if (await copy(text)) {
        b.textContent = 'Copied';
        setTimeout(() => { b.textContent = 'Copy'; }, 1600);
      }
    });
    return h('div.code', {}, h('span', { text }), b);
  }

  function segmented(options, current, onPick, { small = false, busy = false, label, disabled = [] } = {}) {
    const el = h(`div.seg${small ? '.seg-sm' : ''}`, { role: 'radiogroup', 'aria-label': label, 'data-busy': busy ? true : null }, h('span.seg-thumb'));
    for (const [value, text] of options) {
      el.append(h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(value === current),
        'aria-pressed': String(value === current),
        disabled: disabled.includes(value) ? true : null,
        title: disabled.includes(value) ? 'Not for this drive' : null,
        onclick: () => onPick(value),
      }, text));
    }
    requestAnimationFrame(() => {
      const on = el.querySelector('[aria-pressed="true"]');
      const thumb = el.querySelector('.seg-thumb');
      if (!on) {
        thumb.style.opacity = '0';
        return;
      }
      thumb.style.transition = 'none';
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.transform = `translateX(${on.offsetLeft}px)`;
    });
    return el;
  }

  function access(d) {
    const busy = running(d.name, ['access']);
    const shown = S.revealed.get(d.name);
    const passKey = `pass:${d.name}`;
    const reveal = async () => {
      if (shown) {
        S.revealed.delete(d.name);
        paint();
        return;
      }
      try {
        S.revealed.set(d.name, (await api(`drives/${encodeURIComponent(d.name)}/reveal`, { method: 'POST' })).passphrase);
        paint();
      } catch (err) {
        say(passKey, err.message);
      }
    };
    const copyPass = async (e) => {
      const b = e.currentTarget;
      try {
        const p = shown ?? (await api(`drives/${encodeURIComponent(d.name)}/reveal`, { method: 'POST' })).passphrase;
        if (await copy(p)) {
          b.textContent = 'Copied';
          setTimeout(() => { b.textContent = 'Copy'; }, 1600);
        }
      } catch (err) {
        say(passKey, err.message);
      }
    };
    const note = async (e) => {
      const b = e.currentTarget;
      try {
        const p = shown ?? (await api(`drives/${encodeURIComponent(d.name)}/reveal`, { method: 'POST' })).passphrase;
        const text = `Hi ${person(d)}, here is your own Marble Drive:\n\n  ${d.url}\n  passphrase: ${p}\n\nIt is yours: nothing you make there is shared with anyone.`;
        if (await copy(text)) {
          b.textContent = 'Note copied';
          setTimeout(() => { b.textContent = 'Copy a note to send'; }, 1800);
        }
      } catch (err) {
        say(passKey, err.message);
      }
    };
    return section('Access', null,
      h('div.kv', {},
        h('div.what', {}, h('a.link', { href: d.url, target: '_blank', rel: 'noopener' }, d.url.replace(/^https:\/\//, ''), h('span.out')),
          h('small', { text: d.access === 'public' ? 'Anyone with the link reaches the passphrase page' : 'Only members of the Fly org reach it' })),
        segmented([['public', 'Public'], ['private', 'Private']], busy ? null : d.access, (to) => {
          if (to === d.access || busy) return;
          start(`access:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/access`, { method: 'POST', body: { to } }));
        }, { small: true, busy: Boolean(busy), label: 'Who reaches the link', disabled: d.self ? ['public'] : [] })),
      h('div.kv', {},
        h('div.what', {}, h('span.secret-value', { text: shown ?? '••••••••••••' }), h('small', { text: 'The passphrase' })),
        h('div.btns', {},
          h('button.btn.quiet', { type: 'button', 'data-key': `show:${d.name}`, text: shown ? 'Hide' : 'Show', onclick: reveal }),
          h('button.btn.quiet', { type: 'button', text: 'Copy', onclick: copyPass }),
          jobButton({ key: `newpass:${d.name}`, target: d.name, kind: 'passphrase', cls: 'quiet', onclick: (e) => confirmNewPass(e.currentTarget, d) }))),
      d.role === 'user' ? h('div.row-actions', {}, h('button.btn.quiet', { type: 'button', text: 'Copy a note to send', onclick: note })) : null,
      said(passKey), said(`access:${d.name}`), said(`newpass:${d.name}`));
  }

  function confirmNewPass(trigger, d) {
    openPop(trigger, (close) => h('div.pop-body', {},
      h('h4', { text: `A new passphrase for ${d.name}?` }),
      h('p.soft', { text: `Everyone signed in to ${d.name} is signed out and needs the new one. It restarts the drive${d.self ? ' when no agent is working' : ''}.` }),
      h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }),
        h('button.btn.primary', { type: 'button', text: 'Make a new one', onclick: () => {
          close();
          S.revealed.delete(d.name);
          start(`newpass:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/passphrase`, { method: 'POST' }));
        } }))));
  }

  // --------------------------------------------------------------- settings

  const pendingOf = (name) => {
    if (!S.pending.has(name)) S.pending.set(name, { set: {}, unset: [] });
    return S.pending.get(name);
  };
  const changes = (name) => {
    const p = S.pending.get(name);
    return p ? Object.keys(p.set).length + p.unset.length : 0;
  };

  function settings(d) {
    const env = new Map((d.seen?.env ?? []).map((e) => [e.key, e]));
    const p = pendingOf(d.name);
    const fields = LIMITS.map(([key, label, unit, fallback]) => {
      const current = env.get(key)?.value ?? '';
      const value = key in p.set ? p.set[key] : p.unset.includes(key) ? '' : current;
      const dirty = key in p.set || p.unset.includes(key);
      const input = h('input', {
        type: 'text',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        'data-key': `set:${d.name}:${key}`,
        placeholder: `${fallback} (default)`,
        value,
        'aria-label': `${label} (${unit})`,
        disabled: !d.seen ? true : null,
      });
      input.addEventListener('input', () => {
        const v = input.value.trim();
        delete p.set[key];
        p.unset = p.unset.filter((k) => k !== key);
        if (v !== current) {
          if (v === '') p.unset.push(key);
          else p.set[key] = v;
        }
        // The field and the bar answer; the rest of the pane stays as it is.
        input.closest('.field').toggleAttribute('data-dirty', key in p.set || p.unset.includes(key));
        pendingBar(d);
      });
      return h('div.field', { 'data-dirty': dirty ? true : null }, h('label', { text: `${label} (${unit})` }), input);
    });
    const others = [...env.values()].filter((e) => !KNOWN.has(e.key));
    return section('Settings', d.seen ? null : 'look inside first',
      h('div.fields', {}, fields),
      others.length ? h('p.others', {}, others.map((e) => h('span', { class: e.secret ? 'secret' : null, text: e.secret ? `${e.key} (set)` : `${e.key}=${e.value}` })),
        h('button.btn.quiet', { type: 'button', style: { padding: '.05rem .45rem', 'font-size': '.78rem' }, onclick: (ev) => addSetting(ev.currentTarget, d) }, 'Add or change one')) : null);
  }

  function addSetting(trigger, d) {
    openPop(trigger, (close) => {
      const key = h('input', { type: 'text', placeholder: 'MARBLE_DRIVE_SOMETHING', autocomplete: 'off', spellcheck: 'false' });
      const value = h('input', { type: 'text', placeholder: 'value (empty removes it)', autocomplete: 'off', spellcheck: 'false' });
      const error = h('p.error');
      const go = () => {
        const k = key.value.trim().toUpperCase();
        if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) return void (error.textContent = 'A setting’s name is capitals, digits and _');
        if (k === 'MARBLE_DRIVE_SECRET') return void (error.textContent = 'The passphrase has its own button, in Access');
        if (/[,\n]/.test(value.value)) return void (error.textContent = 'A value cannot hold a comma');
        const p = pendingOf(d.name);
        delete p.set[k];
        p.unset = p.unset.filter((x) => x !== k);
        if (value.value.trim() === '') p.unset.push(k);
        else p.set[k] = value.value.trim();
        close();
        S.forceDetail = Date.now();
        paint();
      };
      value.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return h('div.pop-body', {},
        h('h4', { text: `A setting on ${d.name}` }),
        h('div.field', {}, h('label', { text: 'Name' }), key),
        h('div.field', {}, h('label', { text: 'Value' }), value),
        error,
        h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }), h('button.btn.primary', { type: 'button', text: 'Add to the changes', onclick: go })));
    });
  }

  function pendingBar(d) {
    const old = detailPane.querySelector('.pending');
    const n = changes(d.name);
    const busy = running(d.name, ['settings']);
    if (old && !changed('pending', [d.name, S.pending.get(d.name), busy?.id, notes(`settings:${d.name}`)])) return;
    if (!n && !busy) {
      old?.remove();
      return;
    }
    const p = pendingOf(d.name);
    const what = [...Object.keys(p.set), ...p.unset.map((k) => `${k} removed`)].map((k) => k.replace(/^MARBLE_DRIVE_/, '').toLowerCase().replace(/_/g, ' '));
    const bar = h('div.pending', { role: 'region', 'aria-label': 'Changes to apply' },
      h('div.say', {}, busy ? 'Applying…' : `${n} change${n === 1 ? '' : 's'}: ${what.join(', ')}`,
        h('small', { text: d.self ? 'Applying restarts this drive when no agent is working.' : `Applying restarts ${d.name}; open tabs reconnect by themselves.` })),
      h('button.btn.quiet', { type: 'button', text: 'Discard', disabled: busy ? true : null, onclick: () => { S.pending.delete(d.name); S.forceDetail = Date.now(); paint(); } }),
      jobButton({ key: `settings:${d.name}`, target: d.name, kind: 'settings', cls: 'primary', onclick: async () => {
        const change = { set: { ...p.set }, unset: [...p.unset] };
        const job = await start(`settings:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/settings`, { method: 'POST', body: change }));
        if (job) {
          S.pending.delete(d.name);
          S.forceDetail = Date.now();
        }
        paint();
      } }),
      said(`settings:${d.name}`));
    if (old) old.replaceWith(bar);
    else detailPane.append(bar);
  }

  // ------------------------------------------------------------- checkpoints

  async function loadCheckpoints(name, force = false) {
    const have = S.checkpoints.get(name);
    // A cold drive would be started by the question; it is asked only on request.
    if (!force && drive(name)?.status === 'cold') return;
    if (have?.loading || (have && !force && Date.now() - have.at < 60_000)) return;
    S.checkpoints.set(name, { ...(have ?? { list: null }), loading: true, at: Date.now() });
    try {
      const { checkpoints } = await api(`drives/${encodeURIComponent(name)}/checkpoints`);
      S.checkpoints.set(name, { list: checkpoints, at: Date.now(), loading: false });
    } catch (err) {
      S.checkpoints.set(name, { list: [], at: Date.now(), loading: false, error: err.message });
    }
    paint();
  }

  function checkpoints(d) {
    const c = S.checkpoints.get(d.name);
    const list = c?.list;
    const cold = d.status === 'cold' && !list && !c?.loading;
    return section('Checkpoints', list ? `${list.length}` : null,
      cold ? h('p.soft', {}, 'It is stopped, and reading its checkpoints would start it. ',
        h('button.btn.quiet', { type: 'button', style: { padding: '0 .35rem' }, text: 'Read them', onclick: () => loadCheckpoints(d.name, true) }))
      : !list ? h('p.loading', { text: 'Reading…' })
        : !list.length ? h('p.soft', { text: c.error ?? 'None yet.' })
          : h('ul.commits', {}, list.slice(0, 8).map((cp, i) => h('li', { style: { '--i': String(i) } },
            h('span.sha', { text: cp.id }),
            h('span.subject', { text: cp.comment || 'no comment' }),
            h('span', { style: { display: 'flex', gap: '.5rem', 'align-items': 'baseline' } },
              h('span.where', { text: clock(cp.at) }),
              d.self ? null : h('button.btn.quiet', { type: 'button', style: { padding: '.05rem .5rem' }, text: 'Restore', onclick: (e) => confirmTyped(e.currentTarget, {
                title: `Restore ${d.name} to ${cp.id}?`,
                body: `Everything since ${clock(cp.at)} goes: the code and the drive itself, documents included. This cannot be undone from here.`,
                word: d.name,
                action: `Restore ${d.name}`,
                run: (confirm) => start(`restore:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/restore`, { method: 'POST', body: { id: cp.id, confirm } })),
              }) }))))),
      h('div.row-actions', {}, jobButton({ key: `checkpoint:${d.name}`, target: d.name, kind: 'checkpoint', cls: 'quiet', onclick: () => start(`checkpoint:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/checkpoint`, { method: 'POST', body: { comment: 'from the console' } })) })),
      said(`checkpoint:${d.name}`), said(`restore:${d.name}`));
  }

  function remove(d) {
    return section('Remove', null,
      h('p.soft', { style: { margin: '0 0 .6rem', 'font-size': '.85rem' }, text: `Destroys ${d.name} and everything in it: ${person(d)}'s whole drive and every checkpoint.` }),
      jobButton({ key: `remove:${d.name}`, target: d.name, kind: 'remove', cls: 'danger', onclick: (e) => confirmTyped(e.currentTarget, {
        title: `Remove ${d.name}?`,
        body: `${person(d)}'s drive, its documents and its checkpoints are destroyed. There is no way back.`,
        word: d.name,
        action: `Remove ${d.name}`,
        run: (confirm) => start(`remove:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/remove`, { method: 'POST', body: { confirm } })),
      }) }),
      said(`remove:${d.name}`));
  }

  // ------------------------------------------------------------------ ship

  function drawShip() {
    if (!changed('ship', [S.fleet, S.workshop?.main, liveJobs(), notes(''), S.arrived.has('ship')])) return;
    const shop = S.workshop;
    const commits = shop?.main?.commits ?? [];
    const known = S.fleet.filter((d) => Number.isFinite(d.behind) && d.releaseFrom !== 'checkpoint');
    const head = commits[0];
    const main = h('div.card.wide', { style: { '--i': '0' } },
      h('div.card-head', {}, h('h2', { text: 'Main' }),
        head ? h('span.soft', {}, h('span.sha', { text: head.sha.slice(0, 7) }), ` · ${since(head.at)}`) : null,
        h('div.end', {},
          jobButton({ key: 'try', target: 't-bryan', kind: 'deploy-workshop', label: 'Try the workshop on t-bryan', cls: 'quiet', onclick: (e) => deployPlan(e.currentTarget, 't-bryan', 'workshop') }))),
      h('div.card-body', {},
        commits.length ? h('ul.commits', {}, commits.slice(0, 10).map((c, i) => {
          const have = known.filter((d) => d.behind <= i).length;
          const all = known.length && have === known.length;
          return h('li', { style: { '--i': String(i) } }, h('span.sha', { text: c.sha.slice(0, 7) }), h('span.subject', { text: c.subject }),
            h('span.where', { 'data-all': all ? true : null, text: known.length ? (all ? 'everywhere' : `on ${have} of ${known.length}`) : ago(c.at) }));
        })) : h('p.loading', { text: shop ? 'The workshop checkout has no main to read.' : 'Reading main…' }),
        said('try'), said('ship')));

    const table = h('table.table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Drive' }), h('th', { text: 'Release' }), h('th', { text: 'Against main' }), h('th', { text: 'Last change' }), h('th'))),
      h('tbody', {}, S.fleet.map((d, i) => {
        const sha = releaseSha(d.release);
        return h('tr', { style: { '--i': String(i) } },
          h('td', {}, h('span.name', {}, h('span.dot', { 'data-state': running(d.name) ? 'busy' : failedUnseen(d) ? 'failed' : d.awake ? 'awake' : 'asleep' }), d.name)),
          h('td', {}, sha ? h('span.sha', { text: sha.slice(0, 7) }) : h('span.faint', { text: '—' }), isLocal(d.release) ? h('span.faint', { text: ' local' }) : null, d.releaseFrom === 'checkpoint' ? h('span.faint', { text: ' or later' }) : null),
          h('td', {}, running(d.name) ? h('span.good', { text: `${running(d.name).title}…` })
            : d.behind === 0 ? h('span.good', { text: 'Up to date' })
              : d.behind > 0 ? h('span.warn', { text: d.releaseFrom === 'checkpoint' ? `Up to ${d.behind} behind` : `${d.behind} behind` }) : h('span.faint', { text: d.release ? 'Not on main' : 'Not known yet' })),
          h('td', {}, d.lastJob ? h('span', { class: d.lastJob.state === 'failed' ? 'bad' : 'soft', text: `${d.lastJob.title.replace(` ${d.name}`, '').replace(/ to$/, '')}${d.lastJob.state === 'failed' ? ', failed' : ''} · ${since(d.lastJob.endedAt)}` }) : h('span.faint', { text: '—' })),
          h('td.acts', {},
            jobButton({ key: `deploy:${d.name}`, target: d.name, kind: 'deploy', label: 'Deploy', cls: 'quiet', onclick: (e) => deployPlan(e.currentTarget, d.name, 'main') }),
            jobButton({ key: `rollback:${d.name}`, target: d.name, kind: 'rollback', cls: 'quiet', disabled: !(d.seen?.history ?? []).filter((r) => r !== d.seen?.release).length, onclick: () => start(`rollback:${d.name}`, () => api(`drives/${encodeURIComponent(d.name)}/rollback`, { method: 'POST' })) })));
      })));
    const drives = h('div.card.wide', { style: { '--i': '1' } },
      h('div.card-head', {}, h('h2', { text: 'Drives' }), h('span.soft', { text: `${S.fleet.filter((d) => d.behind === 0).length} of ${S.fleet.length} up to date` })),
      h('div.card-body.flush', { style: { 'overflow-x': 'auto' } }, table));
    shipPage.replaceChildren(h('div.page-grid', { class: S.arrived.has('ship') ? 'still' : null }, main, drives));
    S.arrived.add('ship');
  }

  function shipPlan(trigger) {
    openPop(trigger, (close) => {
      const body = h('div.pop-body', {}, h('h4', { text: 'Ship main' }), h('p.loading', { text: 'Reading the plan…' }));
      api('plan').then((plan) => {
        const n = plan.targets.length;
        body.replaceChildren(
          h('h4', {}, 'Ship ', h('span.sha', { text: (plan.sha ?? '').slice(0, 7) }), ` to ${n} drive${n === 1 ? '' : 's'}`),
          plan.ok ? h('p.soft', { text: subjectOf(plan.sha) ?? '' }) : h('p.error', { text: plan.error }),
          h('ul.steps', {},
            h('li', { text: `${(plan.marble ?? '').replace('@bdhmin/', '')} · Claude Code ${plan.claude ?? ''}` }),
            h('li', { text: `In this order: ${plan.targets.join(', ')}` }),
            plan.targets.includes(plan.self) ? h('li', { text: `${plan.self} last, switching when no agent is working` }) : null,
            plan.noCheckpoint.length ? h('li', { text: `No checkpoint for ${plan.noCheckpoint.join(' and ')} (their store is stuck)` }) : h('li', { text: 'A checkpoint on each first' }),
            h('li', { text: 'A drive that fails is reported, and the rest go on' })),
          h('div.foot', {},
            h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }),
            h('button.btn.primary', {
              type: 'button',
              disabled: !plan.ok,
              text: `Ship to ${n} drive${n === 1 ? '' : 's'}`,
              onclick: () => {
                close();
                start('ship', () => api('ship', { method: 'POST' }));
              },
            })));
      }).catch((err) => body.append(h('p.error', { text: err.message })));
      return body;
    });
  }

  // -------------------------------------------------------------- workshop

  // The chat card is built once and kept: a <marble-conversation> taken out of
  // the page and put back loses its stream, so only the cards around it are
  // redrawn.
  const shopGrid = h('div.shop');
  const reposHolder = h('div.repos');
  const chatHolder = h('div.card.chat-card', { style: { '--i': '2' } });
  shopGrid.append(reposHolder, chatHolder);
  shopPage.append(shopGrid);
  function drawWorkshop() {
    if (!changed('workshop', [S.workshop, liveJobs(), notes(''), S.chat, S.chatConversation, S.projects, S.conversations, S.arrived.has('workshop')])) return;
    const shop = S.workshop;
    const repos = shop?.repos ?? [];
    shopGrid.classList.toggle('still', S.arrived.has('workshop'));
    S.arrived.add('workshop');
    reposHolder.replaceChildren(...(repos.length ? repos.map((r, i) => repoCard(r, i, shop)) : [h('div.card.wide', {}, h('p.empty', { text: 'Reading the workshop…' }))]));
    chatCard();
  }

  function repoCard(r, i, shop) {
    if (!r.exists) {
      return h('div.card', { style: { '--i': String(i) } }, h('div.card-head', {}, h('h2', { text: r.name })),
        h('div.card-body', {}, h('p.soft', { text: `No checkout at ${r.path}. tools/sprite-workshop.sh makes it.` })));
    }
    const step = r.ahead === 0 && r.behind === 0 ? h('span.good', { text: 'In step with origin' })
      : h('span.warn', { text: [r.ahead ? `${r.ahead} ahead` : null, r.behind ? `${r.behind} behind` : null].filter(Boolean).join(', ') || 'No upstream' });
    const busy = running('workshop');
    return h('div.card', { style: { '--i': String(i) } },
      h('div.card-head', {}, h('h2', { text: r.name }), h('span.soft', { text: r.branch }),
        h('div.end', {},
          jobButton({ key: `pull:${r.name}`, target: 'workshop', kind: 'pull', cls: 'quiet', disabled: Boolean(busy && busy.kind !== 'pull') || r.changed.length > 0, title: r.changed.length ? 'It has changes; a pull only fast-forwards a clean checkout' : null, onclick: () => start(`pull:${r.name}`, () => api(`workshop/${r.name}/pull`, { method: 'POST' })) }),
          jobButton({ key: `test:${r.name}`, target: 'workshop', kind: 'test', cls: 'quiet', disabled: Boolean(busy && busy.kind !== 'test'), onclick: () => start(`test:${r.name}`, () => api(`workshop/${r.name}/test`, { method: 'POST' })) }),
          r.name === 'marble' ? jobButton({ key: 'publish', target: 'workshop', kind: 'publish', disabled: Boolean(busy && busy.kind !== 'publish'), onclick: (e) => publishPlan(e.currentTarget, shop) }) : null)),
      h('div.card-body', {},
        r.head ? h('p.lede', {}, h('span.sha', { text: r.head.sha.slice(0, 7) }), ' ', h('b', { text: r.head.subject }), h('span.faint', { text: ` · ${since(r.head.at)}` })) : null,
        h('p.stat-line', {}, step, r.changed.length ? h('span.warn', { text: `${r.changed.length} changed` }) : h('span', { text: 'Clean' }),
          r.name === 'marble' ? h('span', {}, 'npm ', h('b', { text: shop.marble.npm ?? '—' }), ' · here ', h('b', { text: shop.marble.repo ?? '—' })) : h('span', {}, 'wants marble ', h('b', { text: shop.marble.dependency ?? '—' }), ' · Claude ', h('b', { text: shop.claudePin ?? '—' }))),
        r.changed.length ? h('ul.files', {}, r.changed.slice(0, 40).map((f) => h('li', {}, h('span.st', { text: f.status }), f.file))) : null,
        said(`pull:${r.name}`), said(`test:${r.name}`), r.name === 'marble' ? said('publish') : null));
  }

  function publishPlan(trigger, shop) {
    const next = (() => {
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(shop.marble.repo ?? '');
      return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : 'the next patch';
    })();
    openPop(trigger, (close) => h('div.pop-body', {},
      h('h4', { text: `Publish marble ${next}` }),
      h('ol.steps', {},
        h('li', { text: 'Stops if marble has uncommitted changes' }),
        h('li', { text: `Moves package.json and both plugin manifests to ${next}; commits, tags and pushes` }),
        h('li', { text: 'Publishes to npm, after its own guard and unit tests; npm may print a link for you to approve' }),
        h('li', { text: `marble-drive needs nothing: the next deploy installs ${next}. Nothing reaches a drive until you ship` })),
      h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }),
        h('button.btn.primary', { type: 'button', text: `Publish ${next}`, onclick: () => { close(); start('publish', () => api('workshop/marble/publish', { method: 'POST' })); } }))));
  }

  // The workshop chat: a real conversation, in the project the choice names.
  let convoEl = null;
  let convoKey = '';
  const convoBox = h('div.chat');
  const chatSide = h('div.chat-side');
  const chatBody = h('div.chat-body');
  function chatCard() {
    const hasAgents = Boolean(customElements.get('marble-conversation'));
    const projectFor = (repo) => S.projects?.find((p) => S.workshop?.repos?.some((r) => r.name === repo && r.path === p.path));
    const project = projectFor(S.chat);
    const list = (S.conversations ?? []).filter((c) => project && c.project === project.id).slice(0, 12);
    const choose = segmented([['marble-drive', 'Marble Drive'], ['marble', 'Marble']], S.chat, (v) => {
      S.chat = v;
      store.set('chat', v);
      S.chatConversation = null;
      paint();
    }, { small: true, label: 'Which project' });
    let body;
    if (!hasAgents) body = h('p.empty', { text: 'Agents are off on this drive.' });
    else if (S.projects === null) body = h('p.loading', { style: { padding: '1rem 1.1rem' }, text: 'Reading the projects…' });
    else if (!project) body = h('p.soft', { style: { padding: '1rem 1.1rem' }, text: `No agent project points at the ${S.chat} checkout. tools/sprite-workshop.sh registers it.` });
    else {
      const key = `${project.id}:${S.chatConversation ?? 'new'}`;
      if (!convoEl || convoKey !== key) {
        convoEl = document.createElement('marble-conversation');
        convoEl.setAttribute(TRANSIENT, '');
        convoEl.dataset.chrome = 'pane';
        convoEl.setAttribute('project', project.id);
        convoEl.dataset.prompt = `Ask for a change to ${S.chat === 'marble' ? 'Marble' : 'Marble Drive'}…`;
        if (S.chatConversation) convoEl.setAttribute('conversation', S.chatConversation);
        convoKey = key;
        convoBox.replaceChildren(convoEl);
      }
      chatSide.replaceChildren(
        h('div.chat-side-head', {}, 'Recent', h('button.btn.quiet', { type: 'button', text: 'New chat', onclick: () => { S.chatConversation = null; paint(); } })),
        list.length ? h('ul.chat-list', {}, list.map((c) => h('li', {}, h('a', { href: `/a/Agents?open=${encodeURIComponent(c.id)}`, 'aria-current': String(c.id === S.chatConversation), onclick: (e) => {
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          S.chatConversation = c.id;
          paint();
        } }, h('span.dot', { 'data-state': c.status === 'running' ? 'running' : 'done' }), h('span.t', { text: c.title || c.name || 'Untitled' }), h('span.a', { text: ago(c.updatedAt ?? c.updated ?? c.createdAt) }))))) : h('p.faint', { style: { padding: '0 1.1rem', 'font-size': '.85rem' }, text: 'No chats here yet.' }));
      if (chatBody.firstChild !== convoBox) chatBody.replaceChildren(convoBox, chatSide);
      body = chatBody;
    }
    const headEl = h('div.card-head', {}, h('h2', { text: 'Workshop chat' }), choose,
      h('div.end', {}, S.chatConversation ? h('a.link', { href: `/a/Agents?open=${encodeURIComponent(S.chatConversation)}` }, 'Open in Agents', h('span.out')) : null));
    if (chatHolder.firstChild) chatHolder.firstChild.replaceWith(headEl);
    else chatHolder.append(headEl);
    if (chatHolder.children[1] !== body) {
      if (chatHolder.children[1]) chatHolder.children[1].replaceWith(body);
      else chatHolder.append(body);
    }
  }

  async function loadChats() {
    try {
      const [projects, conversations] = await Promise.all([
        fetch('/agent/projects', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])),
        fetch('/agent/conversations', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])),
      ]);
      S.projects = Array.isArray(projects) ? projects : projects.projects ?? [];
      const list = Array.isArray(conversations) ? conversations : conversations.conversations ?? [];
      S.conversations = list.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    } catch {
      S.projects = [];
      S.conversations = [];
    }
    paint();
  }

  // --------------------------------------------------------------- activity

  const drawnJobs = new Set();
  function drawActivity() {
    const list = S.jobs;
    if (!changed('activity', [list.map((j) => [j.id, j.state, j.endedAt, j.error]), S.job, S.jobOpen])) return;
    jobsWell.toggleAttribute('data-empty', !list.length);
    const fresh = (id) => {
      const first = !drawnJobs.has(id);
      drawnJobs.add(id);
      return first;
    };
    if (!S.job && list[0]) S.job = list[0].id;
    jobsScroll.replaceChildren(...(list.length ? list.map((j, i) => h('button.row', {
      type: 'button',
      role: 'option',
      'aria-current': String(j.id === S.job),
      'aria-selected': String(j.id === S.job),
      style: fresh(j.id) ? { '--i': String(Math.min(i, 20)) } : { animation: 'none' },
      onclick: () => pickJob(j.id),
    }, h('span.dot', { 'data-state': j.state }), h('span.row-title', { text: j.title }), h('span.row-age', { text: ago(j.startedAt) }),
      h('span.row-meta', { 'data-busy': j.state === 'running' ? true : null, 'data-failed': j.state === 'failed' ? true : null,
        text: [stateWord(j), j.endedAt ? span(j.endedAt - j.startedAt) : span(Date.now() - j.startedAt)].filter(Boolean).join(' · ') }))) : [h('p.empty', { text: 'Nothing yet. Deploys, settings and the rest appear here as they run.' })]));
    drawJob();
  }
  const stateWord = (j) => ({ running: 'Running', done: 'Done', failed: j.error ? `Failed: ${j.error}` : 'Failed', stopped: 'Stopped', interrupted: 'Cut off by a restart' }[j.state] ?? j.state);

  let logEl = null;
  let logFor = null;
  // The tools' own step lines (==>) and failures stand out; everything else is
  // what the command printed, as it printed it.
  function logLines(text) {
    const frag = document.createDocumentFragment();
    for (const line of text.split(/(?<=\n)/)) {
      if (/^\s*==>/.test(line)) frag.append(h('span.step', { text: line }));
      else if (/(✗|\berror\b|\bfailed\b|\bFAILED\b|did not)/i.test(line)) frag.append(h('span.err', { text: line }));
      else frag.append(line);
    }
    return frag;
  }
  function drawJob() {
    const j = S.jobs.find((x) => x.id === S.job);
    jobsWell.toggleAttribute('data-open', Boolean(S.jobOpen && j));
    if (!j) {
      jobPane.replaceChildren(h('p.empty', { text: '' }));
      logEl = null;
      logFor = null;
      return;
    }
    const headEl = h('div.pane-head', {},
      h('button.back', { type: 'button', 'aria-label': 'Back to the jobs', onclick: () => { S.jobOpen = false; paint(); } }),
      h('span.dot', { 'data-state': j.state }),
      h('h2', { text: j.title }),
      h('div.end', {},
        h('span.faint', { style: { 'font-size': '.75rem' }, text: `${clock(j.startedAt)}${j.endedAt ? ` · ${span(j.endedAt - j.startedAt)}` : ''}` }),
        j.state === 'running' ? h('button.btn.quiet', { type: 'button', text: 'Stop', onclick: () => api(`jobs/${j.id}/cancel`, { method: 'POST' }).catch(() => {}) }) : null,
        h('button.btn.quiet', { type: 'button', text: 'Copy', onclick: async (e) => { const b = e.currentTarget; if (await copy(S.outputs.get(j.id) ?? '')) { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } } })));
    if (logFor !== j.id || !logEl) {
      logEl = h('pre.log', { 'aria-live': 'off' });
      logFor = j.id;
      logEl.replaceChildren(logLines(S.outputs.get(j.id) ?? ''));
      if (!S.outputs.has(j.id) || j.state !== 'running') {
        api(`jobs/${j.id}/log`).then((text) => {
          S.outputs.set(j.id, text);
          if (logFor === j.id) {
            logEl.replaceChildren(logLines(text));
            logEl.scrollTop = logEl.scrollHeight;
          }
        }).catch(() => {});
      }
      jobPane.replaceChildren(headEl, logEl);
      requestAnimationFrame(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; });
    } else {
      jobPane.firstChild.replaceWith(headEl);
    }
  }

  function pickJob(id) {
    S.job = id;
    S.jobOpen = true;
    store.set('job', id);
    markSeen(id);
    paint();
  }

  function appendOutput(id, text) {
    S.outputs.set(id, (S.outputs.get(id) ?? '') + text);
    if (logFor === id && logEl) {
      // Follow the tail unless the reader has scrolled up to look at something.
      const atEnd = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
      logEl.append(logLines(text));
      if (atEnd) logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function upsertJob(job) {
    const i = S.jobs.findIndex((j) => j.id === job.id);
    const was = i >= 0 ? S.jobs[i] : null;
    if (i >= 0) S.jobs[i] = job;
    else S.jobs.unshift(job);
    if (was?.state === 'running' && job.state !== 'running') {
      const kind = job.kind === 'deploy' && job.meta?.source === 'workshop' ? 'deploy-workshop' : job.kind;
      if (job.state === 'done') {
        S.flash.set(`${job.target}:${kind}`, Date.now() + 2500);
        setTimeout(paint, 2600);
      }
      if (job.kind === 'checkpoint' || job.kind === 'restore') loadCheckpoints(job.target, true);
      if (job.kind === 'provision' || job.kind === 'remove') refresh();
    }
    paint();
  }

  // ----------------------------------------------------------------- the bar

  function drawBar() {
    const anyRunning = S.jobs.some((j) => j.state === 'running');
    const act = seg.querySelector('[data-view="activity"]');
    const mark = act.querySelector('.mark');
    if (anyRunning && !mark) act.append(h('span.mark', { 'aria-label': 'running' }));
    if (!anyRunning && mark) mark.remove();
    placeThumb();

    live.dataset.state = S.live === 'on' ? 'on' : 'off';
    live.querySelector('.dot').dataset.state = S.live === 'on' ? 'awake' : 'warn';
    live.querySelector('.state').textContent = S.live === 'on' ? 'Live' : S.live === 'connecting' ? 'Connecting' : 'Reconnecting';
    live.querySelector('.when').textContent = S.fleetAt ? `· fleet read ${since(S.fleetAt)}` : '';

    let pill = null;
    if (S.view === 'drives') {
      pill = h('button.btn.primary', { type: 'button', text: 'New drive', onclick: (e) => newDrive(e.currentTarget) });
    } else if (S.view === 'ship') {
      pill = jobButton({ key: 'ship', target: 'fleet', kind: 'ship', cls: 'primary', onclick: (e) => shipPlan(e.currentTarget) });
    }
    primary.replaceChildren(...(pill ? [pill] : []));
  }

  function newDrive(trigger) {
    openPop(trigger, (close) => {
      const name = h('input', { type: 'text', placeholder: 'Their first name', autocomplete: 'off', spellcheck: 'false' });
      const key = h('input', { type: 'password', placeholder: 'sk-ant-… (or they add their own)', autocomplete: 'off' });
      const keyField = h('div.field', {}, h('label', { text: 'Their Anthropic API key, optional' }), key);
      let agent = 'api';
      const which = h('div');
      const drawWhich = () => which.replaceChildren(segmented([['api', 'API key'], ['subscription', 'Your Claude login']], agent, (v) => {
        agent = v;
        keyField.hidden = agent !== 'api';
        drawWhich();
      }, { small: true, label: 'Which Claude pays' }));
      drawWhich();
      const make = h('button.btn.primary', { type: 'button', text: 'Make the drive', disabled: true });
      const error = h('p.error');
      const slug = () => name.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      name.addEventListener('input', () => {
        make.disabled = !slug();
        make.textContent = slug() ? `Make t-${slug()}` : 'Make the drive';
      });
      make.addEventListener('click', async () => {
        error.textContent = '';
        make.disabled = true;
        try {
          const job = await api('drives', { method: 'POST', body: { person: name.value.trim(), agent, key: agent === 'api' ? key.value.trim() : '' } });
          upsertJob(job);
          close();
          setView('activity');
          pickJob(job.id);
        } catch (err) {
          error.textContent = err.message;
          make.disabled = false;
        }
      });
      return h('div.pop-body', {},
        h('h4', { text: 'A drive of their own' }),
        h('p.soft', { style: { 'font-size': '.85rem' }, text: 'Makes t-<name> with its own passphrase, deploys main to it, and opens its link behind the passphrase. A few minutes.' }),
        h('div.field', {}, h('label', { text: 'Name' }), name),
        h('div.field', {}, h('label', { text: 'Agents on' }), which),
        keyField,
        error,
        h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }), make));
    });
  }

  // ------------------------------------------------------------- dashboard
  //
  // State, use and cost of every drive over time, from /console/api/usage
  // (server/console/usage.js). One answer per range, refetched when a drive's
  // ledger or status changes, and every minute while it is on screen.

  const CH = () => window.marbleConsoleCharts;
  const RANGES = [['24h', '24 h'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month']];
  const PRODUCT = { ram: ['Memory', 'var(--prod-ram)'], cpu: ['CPU', 'var(--prod-cpu)'], storage: ['Storage', 'var(--prod-storage)'] };
  const WHY_COLOR = { looking: 'var(--why-looking)', idle: 'var(--why-idle)', work: 'var(--why-work)', asks: 'var(--why-asks)', other: 'var(--why-other)', unrecorded: 'var(--why-unrecorded)' };

  let usageTimer = 0;
  async function loadUsage(range, { quiet = false } = {}) {
    if (S.usageLoading.has(range)) return;
    S.usageLoading.add(range);
    if (!quiet) paint();
    try {
      const data = await api(`usage?range=${encodeURIComponent(range)}`);
      S.usage.set(range, { data, at: Date.now() });
      S.usageError = null;
    } catch (err) {
      S.usageError = err.message;
    } finally {
      S.usageLoading.delete(range);
      paint();
    }
  }
  /** Something changed on a drive: fetch again, at most every ten seconds. */
  function usageChanged() {
    S.usageStale = true;
    if (usageTimer) return;
    usageTimer = setTimeout(() => {
      usageTimer = 0;
      if (!S.usageStale) return;
      S.usageStale = false;
      if (S.view === 'dashboard') loadUsage(S.range, { quiet: true });
      if (S.view === 'drives' || S.range !== '7d') S.usage.delete('7d');
      if (S.view === 'drives') loadUsage('7d', { quiet: true });
    }, 10_000);
  }
  setInterval(() => {
    if (document.hidden || window.marbleTabRest?.resting) return;
    if (S.view === 'dashboard') loadUsage(S.range, { quiet: true });
  }, 60_000);

  /** A sprite's colour follows it, never its rank: by when it was made. */
  function spriteColors(data) {
    const order = [...data.sprites].sort((a, b) => String(a.createdAt ?? '~').localeCompare(String(b.createdAt ?? '~')) || a.name.localeCompare(b.name));
    return new Map(order.map((sp, i) => [sp.name, i < 8 ? `var(--s${i + 1})` : 'var(--s-other)']));
  }
  const money = (n) => CH().money(n);
  const tileMoney = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');

  function card(id, title, note, { wide = false, tableOf, drawChart, end = null, i = 0 }) {
    const showTable = S.tables.has(id) && tableOf;
    const body = h('div.card-body.chart-body', { 'data-chart': id });
    const toggle = tableOf ? h('button.btn.quiet.small', {
      type: 'button',
      'aria-pressed': String(Boolean(showTable)),
      text: showTable ? 'Chart' : 'Table',
      onclick: () => {
        if (S.tables.has(id)) S.tables.delete(id);
        else S.tables.add(id);
        store.set('tables', [...S.tables]);
        drawn.delete('dash');
        paint();
      },
    }) : null;
    const el = h(`section.card${wide ? '.wide' : ''}`, { 'data-card': id, style: { '--i': String(i) } },
      h('div.card-head', {}, h('h2', { text: title }), note ? h('span.note', { text: note }) : null, h('div.end', {}, end, toggle)),
      body);
    // Drawn once the card is in the page, so it knows its width.
    requestAnimationFrame(() => {
      if (showTable) body.replaceChildren(tableOf());
      else CH().whenSized(body, () => drawChart(body));
    });
    return el;
  }

  function tile(label, value, sub, { tone = null } = {}) {
    return h('div.tile', { 'data-tone': tone }, h('span.tile-label', { text: label }), h('b.tile-value', { text: value }), sub ? h('span.tile-sub', {}, sub) : null);
  }

  function legend(items) {
    return h('div.legend', {}, items.map(([label, color, cls]) => h('span.key', {}, h('i', { class: cls ?? null, style: color ? { background: color } : null }), label)));
  }

  const bucketsBy = (sp, key) => (sp.buckets ?? []).filter((b) => b.awake > 0).map((b) => ({ t: b.t, v: b[key] ?? 0 }));

  function drawDashboard() {
    const entry = S.usage.get(S.range);
    if (!entry && !S.usageLoading.has(S.range)) loadUsage(S.range);
    const data = entry?.data;
    if (!changed('dash', [S.range, entry?.at, S.usageLoading.has(S.range), S.usageError, [...S.tables], S.heatFor, S.fleet.map((d) => [d.name, d.status])])) return;
    CH()?.hideTip();

    const ranges = segmented(RANGES, S.range, (v) => {
      S.range = v;
      store.set('range', v);
      loadUsage(v);
      paint();
    }, { small: true, label: 'Range' });
    const updated = h('span.dash-when', { text: S.usageLoading.has(S.range) ? 'Reading…' : entry ? `Updated ${since(entry.at)}` : '' });
    const billBtn = h('button.btn.quiet.small', { type: 'button', text: data?.calibration ? 'New bill' : 'Paste a bill', onclick: (e) => pasteBill(e.currentTarget) });
    const budgetBtn = h('button.btn.quiet.small', { type: 'button', text: data?.budget ? `Budget ${money(data.budget)}` : 'Set a budget', onclick: (e) => setBudget(e.currentTarget, data?.budget) });
    const barRow = h('div.dash-bar', {}, ranges, updated, h('span.dash-end', {}, billBtn, budgetBtn));

    if (!data) {
      dashPage.replaceChildren(barRow, h('p.empty', { text: S.usageError ? `Could not read usage: ${S.usageError}` : 'Reading every drive’s ledger…' }));
      return;
    }
    if (!CH()) {
      dashPage.replaceChildren(barRow, h('p.empty', { text: 'The charts did not load. Reload the page.' }));
      return;
    }

    const colors = spriteColors(data);
    const label = (sp) => sp.name;
    const month = data.month;
    const proj = month.projection;
    const over = data.budget && proj.end > data.budget;
    const awakeNow = S.fleet.filter((d) => d.awake);
    const cal = data.calibration;
    const calNote = cal
      ? `calibrated to your bill of ${CH().dayLabel(cal.bill.from)}–${CH().dayLabel(cal.bill.to - 86_400_000)}${cal.factor.ram ? `, memory ×${cal.factor.ram.toFixed(2)}` : ''}`
      : 'estimated from the ledgers';
    const estimatedHours = data.sprites.reduce((a, sp) => a + sp.totals.estimatedHours, 0);

    const tiles = h('div.tiles', {},
      tile('This month so far', tileMoney(month.spent), calNote),
      proj.days
        ? tile('By the end of the month', tileMoney(proj.end), over
          ? h('span.warn', { text: `⚠ over your ${money(data.budget)} budget` })
          : `likely ${money(proj.low)} – ${money(proj.high)}${data.budget ? ` · budget ${money(data.budget)}` : ''}`, { tone: over ? 'caution' : null })
        : tile('By the end of the month', '—', 'needs six hours of ledgers first'),
      tile('Awake now', `${awakeNow.length} of ${S.fleet.length}`, awakeNow.length ? awakeNow.map((d) => d.name).join(', ') : 'every drive is asleep'),
      tile(`Awake, ${RANGES.find(([v]) => v === S.range)[1].toLowerCase()}`, CH().hours(data.totals.awakeHours), `${money(data.totals.total)} in this range${estimatedHours > 0.05 ? ` · ${CH().hours(estimatedHours)} estimated from state` : ''}`));

    const lanes = data.sprites.map((sp) => ({ name: sp.name, label: label(sp), color: colors.get(sp.name), segments: sp.segments }));
    const stateCard = card('state', 'State over time', null, {
      wide: true,
      i: 0,
      end: legend([['Running', 'var(--st-running)'], ['Warm', 'var(--st-warm)'], ['Cold', 'var(--st-cold)'], ['Not known', null, 'hatch']]),
      drawChart: (el) => CH().timeline(el, { from: data.from, to: data.to, lanes }, { onPick: (name) => {
        setView('drives');
        pick(name);
      } }),
      tableOf: () => CH().table(['Drive', 'State', 'From', 'To', 'For'], data.sprites.flatMap((sp) => sp.segments.filter((g) => g.state !== 'unknown').map((g) => [sp.name, CH().STATE_LABEL[g.state], CH().when(g.from), g.to >= data.to - 60_000 ? 'now' : CH().when(g.to), CH().hours((g.to - g.from) / 3_600_000)]))),
    });

    const costRows = data.sprites.map((sp) => {
      const c = sp.totals.cost;
      return {
        name: sp.name,
        label: label(sp),
        color: colors.get(sp.name),
        value: sp.totals.total,
        parts: [['ram', c.ram], ['cpu', c.cpu], ['storage', c.hot + c.cold]].map(([k, v]) => ({ label: PRODUCT[k][0], value: v, color: PRODUCT[k][1] })),
        note: sp.totals.estimatedHours > 0.05 ? `${CH().hours(sp.totals.estimatedHours)} of it estimated: no ledger yet` : null,
      };
    });
    const costCard = card('cost', 'Cost by drive', RANGES.find(([v]) => v === S.range)[1], {
      i: 1,
      drawChart: (el) => CH().hbars(el, { rows: costRows }),
      tableOf: () => CH().table(['Drive', 'Memory', 'CPU', 'Storage', 'Total'], costRows.map((r) => [r.label, ...r.parts.map((p) => money(p.value)), money(r.value)])),
    });

    const whyRows = data.sprites.map((sp) => ({ label: label(sp), parts: CH().WHY_ORDER.map((k) => ({ key: k, value: sp.totals.why[k] ?? 0 })) }));
    const whyCard = card('why', 'Why they were awake', null, {
      i: 2,
      end: null,
      drawChart: (el) => {
        el.replaceChildren();
        const chart = h('div');
        const present = CH().WHY_ORDER.filter((k) => whyRows.some((r) => r.parts.some((p) => p.key === k && p.value > 0)));
        el.append(legend(present.map((k) => [CH().WHY_LABEL[k], WHY_COLOR[k]])), chart);
        CH().whenSized(chart, () => CH().share(chart, { rows: whyRows, colors: WHY_COLOR }));
      },
      tableOf: () => CH().table(['Drive', ...CH().WHY_ORDER.map((k) => CH().WHY_LABEL[k])], whyRows.map((r) => [r.label, ...r.parts.map((p) => CH().hours(p.value / 3600))])),
    });

    let run = 0;
    const cumPoints = month.days.map((d) => {
      run += d.total;
      return { t: Math.min(data.now, Date.parse(`${d.day}T00:00:00Z`) + 86_400_000), v: run };
    });
    const monthEnd = Date.UTC(new Date(data.now).getUTCFullYear(), new Date(data.now).getUTCMonth() + 1, 1);
    const bills = cal && cal.bill.from === month.from ? [{ t: cal.bill.to, v: cal.bill.total, label: 'Fly’s bill' }] : [];
    const spendCard = card('spend', 'Spend this month', cal ? 'calibrated' : 'estimated', {
      i: 3,
      drawChart: (el) => CH().cumulative(el, { from: month.from, to: monthEnd, now: data.now, points: cumPoints, spent: month.spent, projection: proj.days ? proj : null, budget: data.budget, bills }),
      tableOf: () => CH().table(['Day', 'Spent that day', 'By then'], month.days.map((d, i) => [d.day, money(d.total), money(cumPoints[i].v)])),
    });

    const days = month.days.map((d) => ({
      t: Date.parse(`${d.day}T12:00:00Z`),
      label: String(Number(d.day.slice(8))),
      parts: data.sprites.map((sp) => ({ name: sp.name, label: label(sp), color: colors.get(sp.name), value: d.bySprite[sp.name] ?? 0 })),
    }));
    const dailyCard = card('daily', 'Spend per day', 'this month, by drive', {
      i: 4,
      drawChart: (el) => CH().columns(el, { days }),
      tableOf: () => CH().table(['Day', ...data.sprites.map(label), 'Total'], month.days.map((d) => [d.day, ...data.sprites.map((sp) => money(d.bySprite[sp.name] ?? 0)), money(d.total)])),
    });

    const heatSprites = S.heatFor === 'all' ? data.sprites : data.sprites.filter((sp) => sp.name === S.heatFor);
    const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const sp of heatSprites) {
      for (const b of sp.buckets) {
        const d = new Date(b.t);
        cells[(d.getDay() + 6) % 7][d.getHours()] += b.awake / 60;
      }
    }
    const heatPick = h('select.small', { 'aria-label': 'Whose', onchange: (e) => {
      S.heatFor = e.target.value;
      store.set('heatFor', S.heatFor);
      paint();
    } }, h('option', { value: 'all', text: 'Every drive', selected: S.heatFor === 'all' ? true : null }), data.sprites.map((sp) => h('option', { value: sp.name, text: sp.name, selected: S.heatFor === sp.name ? true : null })));
    const heatCard = card('heat', 'When they are awake', 'hour × weekday, your time', {
      i: 5,
      end: heatPick,
      drawChart: (el) => CH().heatmap(el, { cells }),
      tableOf: () => CH().table(['Day', ...Array.from({ length: 24 }, (_, i) => String(i))], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, d) => [n, ...cells[d].map((m) => (m ? Math.round(m) : ''))])),
    });

    const memSeries = data.sprites.map((sp) => ({ label: label(sp), color: colors.get(sp.name), points: bucketsBy(sp, 'mem').filter((p) => p.v !== null) }));
    const cpuSeries = data.sprites.map((sp) => ({ label: label(sp), color: colors.get(sp.name), points: bucketsBy(sp, 'cpu') }));
    const cpuFmt = (v) => (v < 1 ? `${Math.round(v * 100)}%` : `${v.toFixed(1)} CPU`);
    const memCard = card('mem', 'Memory', `GB, averaged per ${data.step >= 3_600_000 ? 'hour' : '5 minutes'} awake`, {
      i: 6,
      drawChart: (el) => CH().lines(el, { series: memSeries, from: data.from, to: data.to, step: data.step, format: (v) => `${v.toFixed(v < 10 ? 1 : 0)} GB`, unitLabel: 'Memory held while awake' }),
      tableOf: () => CH().table(['Drive', 'Average', 'Peak'], memSeries.map((sr) => [sr.label, sr.points.length ? `${(sr.points.reduce((a, p) => a + p.v, 0) / sr.points.length).toFixed(2)} GB` : '—', sr.points.length ? `${Math.max(...sr.points.map((p) => p.v)).toFixed(2)} GB` : '—'])),
    });
    const cpuCard = card('cpu', 'CPU', 'share of one CPU, while awake', {
      i: 7,
      drawChart: (el) => CH().lines(el, { series: cpuSeries, from: data.from, to: data.to, step: data.step, format: cpuFmt, unitLabel: 'CPU used while awake' }),
      tableOf: () => CH().table(['Drive', 'Average', 'Peak'], cpuSeries.map((sr) => [sr.label, sr.points.length ? cpuFmt(sr.points.reduce((a, p) => a + p.v, 0) / sr.points.length) : '—', sr.points.length ? cpuFmt(Math.max(...sr.points.map((p) => p.v))) : '—'])),
    });

    // Activity: turns and documents opened, per day (per hour for 24 h).
    const slot = S.range === '24h' ? 3_600_000 : 86_400_000;
    const slots = [];
    for (let t = Math.floor(data.from / slot) * slot; t < data.to; t += slot) slots.push(t);
    const perSlot = (sp, key) => slots.map((t) => sp.buckets.filter((b) => b.t >= t && b.t < t + slot).reduce((a, b) => a + (b[key] ?? 0), 0));
    const slotLabel = (t) => (slot < 86_400_000 ? CH().when(t) : CH().dayLabel(t));
    const actCard = card('activity', 'What people did', `agent turns and documents opened, per ${slot < 86_400_000 ? 'hour' : 'day'}`, {
      wide: true,
      i: 8,
      drawChart: (el) => {
        const maxTurns = Math.max(1, ...data.sprites.flatMap((sp) => perSlot(sp, 'turns')));
        const maxOpens = Math.max(1, ...data.sprites.flatMap((sp) => perSlot(sp, 'opens')));
        const grid = h('div.act-grid', {}, h('span.act-h'), h('span.act-h', { text: 'Agent turns' }), h('span.act-h', { text: 'Documents opened' }));
        const todo = [];
        for (const sp of data.sprites) {
          const turns = perSlot(sp, 'turns');
          const opens = perSlot(sp, 'opens');
          const a = h('div.act-spark');
          const b = h('div.act-spark');
          grid.append(h('span.act-name', {}, h('i', { style: { background: colors.get(sp.name) } }), sp.name, sp.hasLedger ? null : h('span.faint', { text: ' · no ledger yet' })),
            h('div.act-cell', {}, a, h('b', { text: String(turns.reduce((x, y) => x + y, 0)) })),
            h('div.act-cell', {}, b, h('b', { text: String(opens.reduce((x, y) => x + y, 0)) })));
          todo.push(() => {
            CH().spark(a, { values: turns, color: colors.get(sp.name), max: maxTurns, labels: slots.map(slotLabel), format: (v) => `${v} turn${v === 1 ? '' : 's'}` });
            CH().spark(b, { values: opens, color: colors.get(sp.name), max: maxOpens, labels: slots.map(slotLabel), format: (v) => `${v} opened` });
          });
        }
        el.replaceChildren(grid);
        CH().whenSized(grid, () => todo.forEach((f) => f()));
      },
      tableOf: () => CH().table(['Drive', 'Agent turns', 'Documents opened'], data.sprites.map((sp) => [sp.name, String(sp.totals.turns), String(sp.totals.opens)])),
    });

    dashPage.replaceChildren(barRow, tiles, h('div.page-grid', {}, stateCard, costCard, whyCard, spendCard, dailyCard, heatCard, memCard, cpuCard, actCard));
  }

  function pasteBill(trigger) {
    openPop(trigger, (close) => {
      const area = h('textarea', { rows: '9', placeholder: 'From:\n09/19/2026\nTo:\n09/25/2026\nTotal Spend\n$6.75\n…\nSprites: RAM    $6.05', spellcheck: 'false', 'aria-label': 'The Cost Explorer page, pasted' });
      const error = h('p.error');
      const save = h('button.btn.primary', { type: 'button', text: 'Use this bill' });
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await api('bill', { method: 'POST', body: { text: area.value } });
          close();
          S.usage.clear();
          loadUsage(S.range);
        } catch (err) {
          error.textContent = err.message;
          save.disabled = false;
        }
      });
      return h('div.pop-body', {},
        h('h4', { text: 'What Fly actually charged' }),
        h('p.soft', { style: { 'font-size': '.85rem' }, text: 'Open Billing → Cost Explorer on fly.io, pick a range, select the page and paste it here (the per-app view works too). Every estimate is then scaled to match it.' }),
        area, error,
        h('div.foot', {}, h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }), save));
    });
  }

  function setBudget(trigger, current) {
    openPop(trigger, (close) => {
      const input = h('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: 'e.g. 25', value: current ?? '', 'aria-label': 'Monthly budget in dollars' });
      const error = h('p.error');
      const save = async (value) => {
        try {
          await api('budget', { method: 'PUT', body: { monthly: value } });
          close();
          S.usage.clear();
          loadUsage(S.range);
        } catch (err) {
          error.textContent = err.message;
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(input.value); });
      return h('div.pop-body', {},
        h('h4', { text: 'A monthly budget' }),
        h('p.soft', { style: { 'font-size': '.85rem' }, text: 'Drawn on the month’s chart; the projection turns amber when it would pass it. Nothing is stopped.' }),
        h('div.field', {}, h('label', { text: 'Dollars a month' }), input),
        error,
        h('div.foot', {},
          current ? h('button.btn.quiet', { type: 'button', text: 'No budget', onclick: () => save(null) }) : h('button.btn.quiet', { type: 'button', text: 'Cancel', onclick: close }),
          h('button.btn.primary', { type: 'button', text: 'Save', onclick: () => save(input.value) })));
    });
  }

  /** In a drive's detail: its last seven days, its month so far, and why it was up. */
  function use(d) {
    const data = S.usage.get('7d')?.data;
    const sp = data?.sprites.find((x) => x.name === d.name);
    if (!CH()) return null;
    if (!data) return section('Use', null, h('p.loading', { text: 'Reading…' }));
    if (!sp) return null;
    const colors = spriteColors(data);
    const strip = h('div.use-strip', { 'data-chart': `use-${d.name}` });
    const why = h('div.use-why');
    const mtd = data.month.days.reduce((a, day) => a + (day.bySprite[d.name] ?? 0), 0);
    CH().whenSized(strip, () => CH().timeline(strip, { from: data.from, to: data.to, lanes: [{ name: d.name, label: d.name, color: colors.get(d.name), segments: sp.segments }] }, { compact: true }));
    CH().whenSized(why, () => CH().share(why, { rows: [{ label: 'Why awake', parts: CH().WHY_ORDER.map((k) => ({ key: k, value: sp.totals.why[k] ?? 0 })) }], colors: WHY_COLOR }));
    return section('Use', 'last 7 days',
      h('p.stat-line', {},
        h('span', {}, 'This month ', h('b', { text: money(mtd) })),
        h('span', {}, '7 days ', h('b', { text: money(sp.totals.total) })),
        h('span', {}, 'awake ', h('b', { text: CH().hours(sp.totals.awakeHours) })),
        sp.hasLedger ? null : h('span.faint', { text: 'no ledger yet: from what the Console saw' })),
      strip, why);
  }

  // ------------------------------------------------------------------ draw

  function draw() {
    drawBar();
    if (S.view === 'drives') {
      drawList();
      drawDetail();
    } else {
      // The list is kept current in the background, so coming back is instant.
      drawList();
    }
    if (S.view === 'dashboard') drawDashboard();
    if (S.view === 'ship') drawShip();
    if (S.view === 'workshop') drawWorkshop();
    if (S.view === 'activity') drawActivity();
  }

  // ------------------------------------------------------------------- data

  async function refresh() {
    try {
      const state = await api('state');
      S.fleet = state.fleet;
      S.fleetAt = state.fleetAt;
      S.fleetError = state.fleetError;
      S.self = state.self;
      S.workshop = state.workshop;
      const byId = new Map(S.jobs.map((j) => [j.id, j]));
      for (const j of state.jobs) byId.set(j.id, j);
      S.jobs = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
      S.loaded = true;
      if (!S.drive || !drive(S.drive)) S.drive = S.fleet[0]?.name ?? null;
      if (S.drive) loadCheckpoints(S.drive);
    } catch (err) {
      S.loaded = true;
      S.fleetError = err.message;
    }
    paint();
  }

  const events = new EventSource('/console/api/events');
  events.onopen = () => {
    S.live = 'on';
    paint();
  };
  events.onerror = () => {
    S.live = 'off';
    paint();
  };
  // A tab waking from rest is told once that things changed (runtime/tab-rest.js).
  events.onmessage = (e) => {
    if (e.data === 'changed') refresh();
  };
  events.addEventListener('fleet', (e) => {
    const data = JSON.parse(e.data);
    S.fleet = data.fleet;
    S.fleetAt = data.fleetAt;
    S.fleetError = data.fleetError;
    S.loaded = true;
    paint();
  });
  events.addEventListener('job', (e) => upsertJob(JSON.parse(e.data)));
  // A drive's ledger arrived, or its state changed: the dashboard reads again.
  events.addEventListener('usage', usageChanged);
  events.addEventListener('status', usageChanged);
  events.addEventListener('output', (e) => {
    const { id, text } = JSON.parse(e.data);
    appendOutput(id, text);
  });
  events.addEventListener('workshop', (e) => {
    S.workshop = JSON.parse(e.data);
    paint();
  });

  // Ages move on their own.
  setInterval(() => {
    if (!document.hidden && !window.marbleTabRest?.resting) paint();
  }, 15_000);

  placeThumb();
  refresh();
  loadChats();
  loadUsage(S.range);
  paint();
})();
