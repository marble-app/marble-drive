// The work, on the page. While an agent works here, its zone is outlined and
// named (collab.js). This file adds what stays after:
//
//   Dots.   Every part an agent changed keeps a small violet dot, until you
//           clear them. Kept per page in this browser, and drawn only while
//           Show agent dots is on in the chat button's tray: by default the
//           page carries no dots at all (agent-glints.js owns the switch).
//   Rail.   A tick down the page's right edge for each dot, so nothing below
//           the fold is missed. A tick scrolls to its part; Clear clears.
//           It shows and hides with the dots.
//   Where.  When the work you're following is out of view, a small button
//           says which way it is. The page never scrolls by itself.
//   Island. With the chat closed, a pill at the corner carries the turn's
//           line (what it is doing, the time). Point at it and it shows the
//           live view. It opens by itself only to ask, or to say it's done.
//   Review. A walk through a turn's changes, part by part, only when asked.
//
// None of it edits the document: it is transient chrome in one shadow root.

(() => {
  const STYLE = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
      font: 13px/1.4 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--ink, #111); -webkit-font-smoothing: antialiased;
      --agent: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, #111));
      --settle: cubic-bezier(.22, 1, .36, 1); }
    .dot { position: fixed; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%;
      background: #6d55d4; box-shadow: 0 0 0 2px var(--paper, #fafaf7); pointer-events: auto; cursor: pointer; }
    .dot[data-enter] { animation: pop .3s var(--settle) both; }
    .dot:hover { transform: scale(1.4); }
    @keyframes pop { from { opacity: 0; transform: scale(.3); } }

    .rail { position: fixed; top: 72px; bottom: 132px; right: 5px; width: 12px; pointer-events: none; }
    .rail[hidden] { display: none; }
    .rail::before { content: ''; position: absolute; top: 0; bottom: 0; left: 5px; width: 2px; border-radius: 1px;
      background: color-mix(in srgb, #6d55d4 12%, transparent); }
    .tick { position: absolute; left: 1px; width: 10px; height: 4px; margin-top: -2px; border: 0; padding: 0; border-radius: 2px;
      background: #6d55d4; pointer-events: auto; cursor: pointer; opacity: .75; }
    .tick:hover, .tick:focus-visible { opacity: 1; outline: none; height: 6px; margin-top: -3px; }
    .clear { position: absolute; right: 0; bottom: -28px; pointer-events: auto; appearance: none; border: 0; cursor: pointer;
      font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 999px; white-space: nowrap;
      background: var(--card, #fff); color: var(--muted, #5a5a5a); box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 0 0 1px var(--line, #ddd9cf); }
    .clear:hover { color: var(--ink, #111); }

    .where { position: fixed; left: 50%; transform: translateX(-50%); pointer-events: auto; appearance: none; border: 0; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px 5px 9px; border-radius: 999px; font: inherit; font-size: 12px;
      background: var(--card, #fff); color: var(--ink, #111); box-shadow: 0 4px 10px rgba(0,0,0,.1), 0 0 0 1px color-mix(in srgb, #6d55d4 45%, transparent); }
    .where[hidden] { display: none; }
    .where[data-dir="up"] { top: 64px; }
    .where[data-dir="down"] { bottom: 84px; }
    .where i { width: 7px; height: 7px; border-radius: 50%; background: #6d55d4; animation: breathe 1.6s ease-in-out infinite; }
    @keyframes breathe { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }

    .island { position: fixed; right: 76px; bottom: 22px; max-width: min(360px, calc(100vw - 110px)); pointer-events: auto;
      display: flex; flex-direction: column; gap: 8px; padding: 7px 12px 7px 10px; border-radius: 18px;
      background: color-mix(in srgb, var(--card, #fff) 86%, transparent); backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3);
      box-shadow: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12), 0 0 0 1px var(--line, #ddd9cf);
      transition: border-radius .25s var(--settle); }
    .island[hidden] { display: none; }
    .island[data-open] { border-radius: 14px; padding: 10px 12px 12px; }
    .island[data-state="asking"] { box-shadow: 0 4px 10px rgba(0,0,0,.1), 0 0 0 1.5px var(--caution, #a07a2c); }
    .isl-line { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
    .isl-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #6d55d4; }
    .island[data-state="running"] .isl-dot { animation: breathe 1.6s ease-in-out infinite; }
    .island[data-state="asking"] .isl-dot { background: var(--caution, #a07a2c); }
    .island[data-state="completed"] .isl-dot { background: var(--ink, #111); }
    .isl-say { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .isl-time { flex: none; font-size: 12px; color: var(--faint, #8a8a8a); font-variant-numeric: tabular-nums; }
    .isl-view { max-height: 200px; overflow: hidden; border-top: 1px solid var(--line, #ddd9cf); padding-top: 8px; }
    .isl-view[hidden] { display: none; }
    .isl-acts { display: flex; flex-wrap: wrap; gap: 6px; }
    .isl-acts[hidden] { display: none; }
    .isl-acts button { appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 500; padding: 6px 10px; border-radius: 8px;
      background: var(--paper-2, #f3f1ea); color: var(--ink, #111); box-shadow: inset 0 0 0 1px var(--line, #ddd9cf); }
    .isl-acts button.primary { background: var(--ink, #111); color: var(--paper, #fafaf7); box-shadow: none; }

    .outline { position: fixed; pointer-events: none; border-radius: 6px; opacity: 0;
      box-shadow: 0 0 0 2px #6d55d4, 0 0 0 6px color-mix(in srgb, #6d55d4 16%, transparent); transition: opacity .2s ease; }
    .outline.on { opacity: 1; }
    .tour { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); pointer-events: auto;
      display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; border-radius: 999px; font-size: 12.5px;
      background: var(--card, #fff); box-shadow: 0 4px 10px rgba(0,0,0,.1), 0 0 0 1px var(--line, #ddd9cf); }
    .tour[hidden] { display: none; }
    .tour b { font-weight: 600; }
    .tour button { appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 999px;
      background: var(--paper-2, #f3f1ea); color: var(--ink, #111); }
    .tour button.primary { background: var(--ink, #111); color: var(--paper, #fafaf7); }
    @media (prefers-reduced-motion: reduce) { .dot, .where i, .island .isl-dot { animation: none !important; } .outline { transition: none; } }
  `;

  const boot = (marble) => {
    const app = marble?.app;
    if (!app || document.querySelector('marble-work')) return;
    const agent = marble.agent;
    const host = document.createElement('marble-work');
    host.setAttribute('data-marble-transient', '');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="layer">
      <div class="dots"></div>
      <div class="rail" hidden><button type="button" class="clear">Clear</button></div>
      <button type="button" class="where" hidden><i></i><span></span></button>
      <div class="outline"></div>
      <div class="island" hidden><div class="isl-line"><span class="isl-dot"></span><span class="isl-say"></span><span class="isl-time"></span></div><div class="isl-view" hidden></div><div class="isl-acts" hidden></div></div>
      <div class="tour" hidden><span class="tour-where"></span><button type="button" data-a="back">Back</button><button type="button" class="primary" data-a="next">Next</button><button type="button" data-a="done">Done</button></div>
    </div>`;
    document.documentElement.append(host);
    const $ = (s) => root.querySelector(s);
    const dotsEl = $('.dots');
    const rail = $('.rail');
    const where = $('.where');
    const outline = $('.outline');
    const island = $('.island');
    const tour = $('.tour');
    const byId = (id) => document.querySelector(`[data-marble-id="${CSS.escape(String(id))}"]`);
    const stillness = matchMedia('(prefers-reduced-motion: reduce)');

    // ---------------------------------------------------------- dots
    const KEY = `marble-work-dots:${app}`;
    const load = () => { try { return new Map(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Map(); } };
    const dots = load();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...dots].slice(-400))); } catch { /* private mode */ } };
    const fresh = new Set();

    document.addEventListener('marble:ops', ({ detail }) => {
      const client = String(detail?.client ?? '');
      const undo = client.startsWith('agent-undo:');
      if (!client.startsWith('agent:') && !undo) return;
      const conversation = client.slice(client.indexOf(':') + 1);
      let changed = false;
      for (const op of detail?.ops ?? []) {
        const id = op.type === 'insert' ? /data-marble-id="([^"]+)"/.exec(op.html ?? '')?.[1] : op.id;
        if (!id) continue;
        if (undo || op.type === 'remove') { changed = dots.delete(id) || changed; continue; }
        if (!dots.has(id)) fresh.add(id);
        dots.set(id, { conversation, at: Date.now() });
        changed = true;
      }
      if (changed) { save(); schedule(); }
    });
    addEventListener('storage', (event) => { if (event.key === KEY) { const next = load(); dots.clear(); for (const [k, v] of next) dots.set(k, v); schedule(); } });

    $('.clear').addEventListener('click', () => { dots.clear(); save(); schedule(); });

    const absTop = (el) => el.getBoundingClientRect().top + scrollY;
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    // ---------------------------------------------------------- painting
    let frame = 0;
    function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); }
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);

    // The one switch for every agent dot on the page, off unless asked for
    // in Agent settings › Chat (agent-ui.js).
    const DOTS_KEY = 'marble-agent-dots';
    const dotsOn = () => { try { return localStorage.getItem(DOTS_KEY) === '1'; } catch { return false; } };
    addEventListener('marble-agent-dots', schedule);
    addEventListener('marble-agent-prefs', (event) => { if (event.detail?.key === DOTS_KEY) schedule(); });
    addEventListener('storage', (event) => { if (event.key === DOTS_KEY) schedule(); });

    function paint() {
      const live = [...dots.keys()].map((id) => [id, byId(id)]).filter(([, el]) => el && shown(el));
      if (!dotsOn()) {
        dotsEl.replaceChildren();
        rail.hidden = true;
        fresh.clear();
        paintWhere();
        if (tourState) placeOutline(tourState.els[tourState.at]);
        return;
      }
      // Dots, at the top-left corner of each part, where a glint never sits.
      const have = new Map([...dotsEl.children].map((d) => [d.dataset.id, d]));
      for (const [id, el] of live) {
        const r = el.getBoundingClientRect();
        let d = have.get(id);
        if (!d) {
          d = document.createElement('span');
          d.className = 'dot';
          d.dataset.id = id;
          d.title = 'Changed by an agent';
          d.addEventListener('click', () => { flashOutline(byId(id)); });
          if (fresh.has(id) && !stillness.matches) d.setAttribute('data-enter', '');
          dotsEl.append(d);
        }
        have.delete(id);
        const inView = r.bottom > 0 && r.top < innerHeight;
        d.hidden = !inView;
        d.style.left = `${Math.max(6, r.left - 8)}px`;
        d.style.top = `${r.top + 8}px`;
      }
      for (const gone of have.values()) gone.remove();
      fresh.clear();

      // The rail: a tick per part, placed by where it sits in the page.
      const height = Math.max(document.documentElement.scrollHeight, 1);
      rail.hidden = live.length === 0;
      for (const t of [...rail.querySelectorAll('.tick')]) t.remove();
      for (const [id, el] of live) {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'tick';
        t.style.top = `${Math.min(100, (absTop(el) / height) * 100)}%`;
        t.setAttribute('aria-label', `Changed: ${(el.textContent || el.tagName).trim().slice(0, 40)}`);
        t.addEventListener('click', () => reveal(el));
        rail.prepend(t);
      }
      $('.clear').textContent = `Clear ${live.length}`;
      $('.clear').title = 'Clear the marks on what agents changed here';
      paintWhere();
      if (tourState) placeOutline(tourState.els[tourState.at]);
    }

    function reveal(el) {
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: stillness.matches ? 'auto' : 'smooth' });
      flashOutline(el);
    }
    let outlineTimer = 0;
    function placeOutline(el) {
      if (!el) { outline.classList.remove('on'); return; }
      const r = el.getBoundingClientRect();
      Object.assign(outline.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
      outline.classList.add('on');
    }
    function flashOutline(el) {
      placeOutline(el);
      clearTimeout(outlineTimer);
      outlineTimer = setTimeout(() => { if (!tourState) outline.classList.remove('on'); }, 1400);
    }

    // ---------------------------------------------------------- where the work is
    // Only the work you are following: its zone's ids, from presence frames.
    const zones = new Map();
    document.addEventListener('marble:presence', ({ detail }) => {
      const client = String(detail?.client ?? '');
      if (!client.startsWith('agent:')) return;
      const ids = Array.isArray(detail.ids) ? detail.ids : [];
      if (ids.length) zones.set(client.slice('agent:'.length), ids); else zones.delete(client.slice('agent:'.length));
      schedule();
    });
    function paintWhere() {
      let target = null;
      for (const [id, ids] of zones) {
        if (agent?.attending && !agent.attending(id)) continue;
        const els = ids.map(byId).filter(Boolean);
        if (els.length) { target = els; break; }
      }
      if (!target) { where.hidden = true; return; }
      const rects = target.map((el) => el.getBoundingClientRect());
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      if (bottom < 0) { where.dataset.dir = 'up'; where.querySelector('span').textContent = 'Working above ↑'; where.hidden = false; }
      else if (top > innerHeight) { where.dataset.dir = 'down'; where.querySelector('span').textContent = 'Working below ↓'; where.hidden = false; }
      else where.hidden = true;
      where.onclick = () => reveal(target[0]);
    }

    // ---------------------------------------------------------- the island
    const drawerOpen = () => document.querySelector('marble-agent-drawer')?.getAttribute('data-open-state') === 'open';
    let line = null;
    let pointed = false;
    addEventListener('marble-work:line', (event) => {
      const d = event.detail;
      if (!d?.conversation) return;
      if (d.target && String(d.target).replace(/\.mrbl$/, '') !== String(app).replace(/\.mrbl$/, '')) return;
      // A Build mode build says its line in Describe's bar, with its stages
      // (build-mode.js): no pill in the corner for it.
      if (d.conversation === window.marbleBuild?.state?.()?.conversation) { line = null; paintIsland(); return; }
      line = d;
      paintIsland();
    });
    // The drawer opening or closing shows or hides it.
    new MutationObserver(() => paintIsland()).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-open-state'] });
    const drawer = () => document.querySelector('marble-agent-drawer');
    const watchDrawer = () => { const dr = drawer(); if (dr) new MutationObserver(() => paintIsland()).observe(dr, { attributes: true, attributeFilter: ['data-open-state'] }); };
    watchDrawer();

    let clock = 0;
    function paintIsland() {
      const d = line;
      const active = d && (d.state === 'running' || d.state === 'asking' || (d.state === 'completed' && !d.seen));
      island.hidden = !active || drawerOpen();
      clearInterval(clock);
      if (island.hidden) return;
      island.dataset.state = d.state;
      island.querySelector('.isl-say').textContent = d.say || 'Working';
      const time = island.querySelector('.isl-time');
      const tickTime = () => { time.textContent = d.state === 'completed' ? (d.took || '') : d.started ? fmt(Date.now() - d.started) : ''; };
      tickTime();
      if (d.state === 'running') clock = setInterval(tickTime, 1000);
      // It opens by itself only to ask, or to say it's done.
      const opens = d.state === 'asking' || d.state === 'completed';
      const open = opens || pointed;
      island.toggleAttribute('data-open', open);
      const view = island.querySelector('.isl-view');
      view.hidden = !pointed || !d.view;
      if (!view.hidden) {
        // The view is drawn with the chat's own kit rules and the page's tokens.
        const ui = window.marbleAgentUI;
        if (!root.querySelector('style[data-kit]') && ui?.WORK_VIEW_CSS) {
          const st = document.createElement('style');
          st.dataset.kit = '';
          st.textContent = `${ui.TOKENS ?? ''}${ui.WORK_VIEW_CSS}`;
          root.prepend(st);
        }
        view.replaceChildren(d.view.cloneNode(true));
      }
      const acts = island.querySelector('.isl-acts');
      acts.hidden = !opens;
      if (opens) {
        const buttons = d.state === 'asking'
          ? [['Answer', 'open', true]]
          : [...(d.changes ? [['Review changes', 'review', true]] : []), ['Open chat', 'open', !d.changes], ['Done', 'seen', false]];
        acts.replaceChildren(...buttons.map(([label, a, primary]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          if (primary) b.className = 'primary';
          b.addEventListener('click', (e) => { e.stopPropagation(); islandAct(a); });
          return b;
        }));
      }
    }
    const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    function islandAct(a) {
      if (!line) return;
      if (a === 'open') dispatchEvent(new CustomEvent('marble:agent-open', { detail: { id: line.conversation } }));
      if (a === 'review') startTour(line.conversation);
      if (a === 'seen' || a === 'review') { line = { ...line, seen: true }; paintIsland(); }
    }
    island.addEventListener('pointerenter', () => { pointed = true; paintIsland(); });
    island.addEventListener('pointerleave', () => { pointed = false; paintIsland(); });
    island.querySelector('.isl-line').addEventListener('click', () => islandAct('open'));

    // ---------------------------------------------------------- the review walk
    let tourState = null;
    function startTour(conversation) {
      const els = [...dots].filter(([, v]) => !conversation || v.conversation === conversation).map(([id]) => byId(id)).filter((el) => el && shown(el));
      els.sort((a, b) => absTop(a) - absTop(b));
      if (!els.length) return;
      tourState = { els, at: 0 };
      tour.hidden = false;
      step(0);
    }
    function step(delta) {
      if (!tourState) return;
      tourState.at = Math.max(0, Math.min(tourState.els.length - 1, tourState.at + delta));
      const el = tourState.els[tourState.at];
      tour.querySelector('.tour-where').innerHTML = `<b>Change ${tourState.at + 1}</b> of ${tourState.els.length}`;
      tour.querySelector('[data-a="back"]').disabled = tourState.at === 0;
      tour.querySelector('[data-a="next"]').hidden = tourState.at === tourState.els.length - 1;
      el.scrollIntoView({ block: 'center', behavior: stillness.matches ? 'auto' : 'smooth' });
      placeOutline(el);
    }
    function endTour() { tourState = null; tour.hidden = true; outline.classList.remove('on'); }
    tour.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'next') step(1);
      if (a === 'back') step(-1);
      if (a === 'done') endTour();
    });
    addEventListener('keydown', (e) => { if (tourState && e.key === 'Escape') endTour(); });
    addEventListener('marble-work:review', (event) => startTour(event.detail?.conversation ?? null));

    window.marbleWork = { dots: () => [...dots.keys()], clear: () => { dots.clear(); save(); schedule(); }, review: startTour };
    schedule();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
