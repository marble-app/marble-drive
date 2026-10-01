// The Console's Features view: every change the owner is making to Marble, as
// a line from spec to every drive (drive: Notes and Sketches/Features view).
//
// runtime/console.js mounts it as a view and hands it the page's own helpers,
// so it is drawn and refreshed like every other view: transient chrome built
// from /console/api/features, nothing written to the file. The board is the
// triage skill's (agent-plugin/skills/triage), saved when the owner asks for
// it; where each feature is on its stops and drives is the server's, from git
// (server/console/features.js). What the owner changes here (a name, a stage,
// a next line, hidden) goes to the server as a correction and outlives every
// triage.

(() => {
  const STOPS = [['spec', 'Spec'], ['plan', 'Plan'], ['build', 'Build'], ['commit', 'Commit'], ['push', 'Push']];
  const RINGS = [['yours', 'Yours'], ['tb', 't-bryan'], ['all', 'Everyone']];
  const TABS = [['lines', 'Lines'], ['drives', 'Drives'], ['chats', 'Chats']];
  const REPO_URL = 'https://github.com/marble-app/marble-drive';
  const WHERE = { spec: 'a spec', plan: 'a plan', build: 'built, not committed', commit: 'committed, not pushed', push: 'pushed, on no drive' };
  const rank = (stop) => STOPS.findIndex(([s]) => s === stop);

  function mount(page, ctx) {
    const { h, api, ago, segmented, paint } = ctx;
    const pref = (key, fallback) => {
      try {
        const v = localStorage.getItem(`console.features.${key}`);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    };
    const keep = (key, value) => {
      try {
        localStorage.setItem(`console.features.${key}`, JSON.stringify(value));
      } catch {}
    };

    // The page's own room: which tab, which lines are open. Not the file's,
    // and not the server's; kept in this browser like the rest of the Console.
    const F = {
      data: null,
      error: null,
      loading: false,
      tab: TABS.some(([t]) => t === pref('tab')) ? pref('tab') : 'lines',
      open: new Set(pref('open', [])),
      showHidden: false,
      triage: pref('triage', null), // { id, at } of the chat running triage
      said: null,
      focus: ctx.feature ?? null,
    };
    let drawnKey = null;

    async function load() {
      if (F.loading) return;
      F.loading = true;
      try {
        F.data = await api('features');
        F.error = null;
      } catch (err) {
        F.error = err.message;
      }
      F.loading = false;
      drawnKey = null;
      paint();
    }

    // ------------------------------------------------------------ actions

    async function correct(id, patch) {
      try {
        await api(`features/${encodeURIComponent(id)}/correct`, { method: 'POST', body: patch });
        await load();
      } catch (err) {
        F.said = { id, text: err.message };
        drawnKey = null;
        paint();
      }
    }

    function toggle(id, open = !F.open.has(id)) {
      if (open) F.open.add(id);
      else F.open.delete(id);
      keep('open', [...F.open].slice(-40));
      drawnKey = null;
      paint();
    }

    function jump(id) {
      F.tab = 'lines';
      keep('tab', 'lines');
      toggle(id, true);
      requestAnimationFrame(() => page.querySelector(`.fx-feat[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }

    async function runTriage() {
      const agent = window.marble?.agent;
      if (!agent) {
        F.said = { id: 'triage', text: 'Agents are off on this drive, so triage cannot run here. Ask for it in a chat on your drive.' };
        drawnKey = null;
        paint();
        return;
      }
      if (F.triage && (Date.now() - F.triage.at) < 20 * 60_000 && chatRunning(F.triage.id)) {
        agent.open?.(F.triage.id);
        return;
      }
      try {
        const settings = await agent.settings().catch(() => ({}));
        const id = await agent.start({ provider: settings.defaultProvider });
        F.triage = { id, at: Date.now() };
        keep('triage', F.triage);
        await agent.send(id, {
          prompt: 'Triage my features: use the marble-drive:triage skill, save the board, and tell me what moved since the last read.',
          target: 'Console',
          viewing: 'Console',
          selection: [],
          also: [],
        });
      } catch (err) {
        F.said = { id: 'triage', text: err.message };
      }
      drawnKey = null;
      paint();
    }
    const chatRunning = (id) => Boolean(F.data?.chats?.[`drive:${id}`]?.running);

    // ------------------------------------------------------------- pieces

    const placedChats = (f) => f.chats.map((c) => ({ ...c, ...(F.data.chats[`${c.source}:${c.id}`] ?? { title: c.id }) }));
    const drivesIn = (ring) => (F.data?.drives ?? []).filter((d) => d.ring === ring);
    const rings = () => RINGS.filter(([r]) => drivesIn(r).length);
    const allDrives = () => F.data?.drives ?? [];

    function whereNow(f) {
      if (f.kind === 'drive') return 'in your drive only';
      if (f.kind === 'skill') return 'your skill';
      const n = f.on.length;
      if (!n) return WHERE[f.at] ?? 'a spec';
      // Drives whose release is not known yet say nothing either way.
      const known = allDrives().filter((d) => d.sha).length;
      if (n === allDrives().length || n === known) return 'on every drive';
      const yours = drivesIn('yours').map((d) => d.key);
      if (yours.length && n === yours.length && yours.every((k) => f.on.includes(k))) return 'on your drives';
      return `on ${n} of ${allDrives().length} drives`;
    }

    function chatLink(c) {
      if (c.source === 'terminal') {
        return h('span.fx-term', {}, h('span', { text: c.title || 'A terminal session' }), h('span.fx-path', { text: `${c.folder || 'marble-drive'} · ${c.id.slice(0, 8)}` }));
      }
      return h('a', { href: `/a/Agents?open=${encodeURIComponent(c.id)}`, text: c.title || 'Untitled' });
    }
    const chatAge = (c) => h('span.fx-age', { 'data-running': c.running ? true : null, text: c.running ? 'working now' : ago(c.at) });

    /** The line itself: a stop for each stage, and a ring of dots per group
     *  of drives, drawn from where the server placed the feature. */
    function line(f) {
      const host = f.kind === 'host';
      const seq = host ? [...STOPS.map(([s]) => s), ...rings().map(([r]) => r)] : ['spec', 'plan', 'build'];
      const ringOf = (s) => RINGS.some(([r]) => r === s);
      const reached = seq.map((s) => (!ringOf(s)
        ? f.on.length > 0 || rank(s) <= rank(f.at)
        : drivesIn(s).some((d) => f.on.includes(d.key))));
      const here = reached.lastIndexOf(true);
      const el = h('div.fx-line', { role: 'img', 'aria-label': `${f.name}: ${whereNow(f)}` });
      seq.forEach((s, i) => {
        const ring = ringOf(s);
        const skip = !ring && reached[i] && i !== here && f.skip.includes(s);
        const cls = ['fx-cell', ring ? 'ring' : '', reached[i] ? 'on' : '', i === here ? 'here' : '', i === 0 ? 'first' : '', i === seq.length - 1 ? 'last' : '',
          i > 0 && reached[i] && reached[i - 1] ? 'l' : '', i < seq.length - 1 && reached[i] && reached[i + 1] ? 'r' : '', skip ? 'skip' : ''].filter(Boolean).join('.');
        const cell = h(`span.${cls}`, { 'data-c': s });
        if (!ring) {
          const label = STOPS.find(([x]) => x === s)[1];
          cell.append(h('i.fx-dot', { 'aria-label': `${label}: ${i === here ? 'here now' : skip ? 'passed, none written' : reached[i] ? 'done' : 'not yet'}` }));
        } else {
          const pill = h('span.fx-pill');
          for (const d of drivesIn(s)) {
            const has = f.on.includes(d.key);
            const tried = (f.tried ?? []).includes(d.key);
            pill.append(h(`i.fx-dv${has ? '.lit' : tried ? '.tried' : ''}`, { 'aria-label': `${d.name}: ${has ? 'has it' : tried ? 'tried with --local' : d.sha ? 'not yet' : 'release not known'}` }));
          }
          cell.append(pill);
        }
        el.append(cell);
      });
      return el;
    }

    function stageControl(f) {
      if (f.kind !== 'host' || f.on.length) return null;
      return segmented(STOPS, f.corrected.includes('at') ? f.at : null, (value) => correct(f.id, { at: value === f.at && f.corrected.includes('at') ? null : value }), { small: true, label: 'Set its stage' });
    }

    function textField(f, key, label, value, placeholder) {
      const input = h('input', { type: 'text', value: value ?? '', placeholder, 'aria-label': label, 'data-key': `fx:${f.id}:${key}`, spellcheck: 'false' });
      const commit = () => {
        const v = input.value.trim();
        if (v === (value ?? '')) return;
        correct(f.id, { [key]: v || null });
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = value ?? '';
          input.blur();
        }
      });
      input.addEventListener('blur', commit);
      return h('label.fx-field', {}, h('span', { text: label }), input);
    }

    function more(f) {
      const chats = placedChats(f);
      const cols = [];
      cols.push(h('div.fx-col', {}, h('h4', { text: 'Chats' }),
        chats.length ? h('ul', {}, chats.map((c) => h('li', { 'data-running': c.running ? true : null }, chatLink(c), chatAge(c))))
          : h('p.soft', { text: 'No chat found for this work.' })));
      const docs = [
        ...f.specs.map((p) => ({ p, kind: 'spec' })),
        ...f.plans.map((p) => ({ p, kind: 'plan' })),
        ...f.docs.map((p) => ({ p, kind: 'app' })),
      ];
      const files = [
        ...docs.map(({ p, kind }) => h('li', {}, p.startsWith('docs/')
          ? h('a', { href: `${REPO_URL}/blob/main/${p}`, target: '_blank', rel: 'noopener', text: p.split('/').pop() })
          : h('a', { href: `/a/${p.split('/').map(encodeURIComponent).join('/')}`, text: p.split('/').pop() }), h('span.fx-kind', { text: kind }))),
        ...f.loose.map((t) => h('li', {}, h('span.fx-path', { text: t.path.replace(/^.*\/(?=[^/]+\/\.claude\/worktrees\/)/, '').replace(/^.*\/3rd-year-projects\//, '') }),
          h('span.fx-kind', { text: t.changed ? `${t.changed} changed` : t.branch ?? 'worktree' }))),
      ];
      if (files.length) cols.push(h('div.fx-col', {}, h('h4', { text: 'Documents and files' }), h('ul', {}, files)));
      if (f.commits.length) {
        cols.push(h('div.fx-col', {}, h('h4', { text: 'Commits' }), h('ul.fx-commits', {}, f.commits.map((sha) => h('li', {},
          h('a.fx-sha', { href: `${REPO_URL}/commit/${sha}`, target: '_blank', rel: 'noopener', text: sha.slice(0, 7) }),
          h('span', { text: F.data.subjects?.[Object.keys(F.data.subjects).find((k) => k.startsWith(sha)) ?? ''] ?? '' }))))));
      }
      const said = F.said?.id === f.id ? h('span.said', { role: 'status', text: F.said.text }) : null;
      const stage = stageControl(f);
      return h('div.fx-more', {},
        h('div.fx-cols', {}, cols),
        h('div.fx-edit', {},
          textField(f, 'name', 'Name', f.name, 'What it is, in a few words'),
          textField(f, 'next', 'Next', f.next, 'The one next step'),
          stage ? h('div.fx-stage', {}, h('span', { text: 'Before a drive, it is at' }), stage) : null,
          h('button.btn.quiet.small', { type: 'button', text: f.hidden ? 'Show this line' : 'Hide this line', onclick: () => correct(f.id, { hidden: !f.hidden }) }),
          said));
    }

    function row(f) {
      const open = F.open.has(f.id);
      const chats = f.chats.length;
      const meta = [chats ? `${chats} chat${chats === 1 ? '' : 's'}` : null, f.commits.length ? `${f.commits.length} commit${f.commits.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'No chats or commits';
      const working = placedChats(f).some((c) => c.running);
      const el = h('article.fx-feat', { 'data-id': f.id, 'data-open': open ? true : null, 'data-hidden': f.hidden ? true : null },
        h('div.fx-id', {},
          h('button.fx-open', { type: 'button', 'aria-expanded': String(open), 'aria-label': open ? 'Close this line' : 'Open this line', onclick: () => toggle(f.id) }),
          h('span.fx-name', { 'data-working': working ? true : null, text: f.name }),
          h('span.fx-meta', { text: meta })),
        line(f),
        f.kind !== 'host' ? h('span.fx-lives', { text: f.lives ?? (f.kind === 'skill' ? 'A skill in your drive' : 'Lives in your drive') }) : null,
        h('span.fx-next', { 'data-wait': f.wait ? true : null, text: f.next ?? '' }),
        open ? more(f) : null);
      el.querySelector('.fx-line').addEventListener('click', () => toggle(f.id));
      return el;
    }

    // --------------------------------------------------------------- tabs

    // One grid for the whole board, its lines named by stop and ring, so the
    // head, the groups and every line align through subgrid. A ring is as
    // wide as its drives. Narrow, the name and next span the row and the line
    // takes the width under them.
    function columns(narrow = false) {
      const r = rings().map(([ring]) => {
        const n = drivesIn(ring).length;
        return narrow ? `[${ring}] minmax(0, ${Math.max(1, n * 0.42).toFixed(2)}fr)` : `[${ring}] minmax(${Math.max(2.2, n * 0.75 + 1)}rem, ${Math.max(1, n * 0.42).toFixed(2)}fr)`;
      }).join(' ');
      if (narrow) return `[name spec] minmax(0, 1fr) ${STOPS.slice(1).map(([s]) => `[${s}] minmax(0, 1fr)`).join(' ')} ${r} [next end]`;
      return `[name] minmax(11rem, 15rem) ${STOPS.map(([s]) => `[${s}] minmax(2.2rem, 1fr)`).join(' ')} ${r} [next] minmax(9rem, 13rem) [end]`;
    }

    function lines() {
      const list = F.data.features.filter((f) => F.showHidden || !f.hidden);
      const hidden = F.data.features.filter((f) => f.hidden).length;
      const areas = [...new Set([...(F.data.areas ?? []), ...list.map((f) => f.area)])].filter((a) => list.some((f) => f.area === a));
      const head = h('div.fx-head', {},
        h('span.h-name', { 'data-c': 'name', text: 'Feature' }),
        STOPS.map(([s, label]) => h('span', { 'data-c': s, text: label })),
        rings().map(([r, label]) => {
          const names = drivesIn(r).map((d) => d.name);
          const sub = r === 'all' ? `${names.length} drives` : names.join(', ') === label ? null : names.join(', ');
          return h('span', { 'data-c': r }, label, sub ? h('small', { text: sub }) : null);
        }),
        h('span.h-next', { 'data-c': 'next', text: 'Next' }));
      const grid = h('div.fx-lines', { style: { '--fx-cols': columns(), '--fx-cols-narrow': columns(true) } }, head,
        areas.map((a) => h('section.fx-group', {}, h('h3', { text: a }), list.filter((f) => f.area === a).map(row))));
      const loose = (F.data.loose ?? []).map((c) => ({ ...c, ...(F.data.chats[`${c.source}:${c.id}`] ?? { title: c.id }) }));
      const foot = [];
      if (loose.length) foot.push(h('p.fx-loose', {}, 'Not placed yet: ', loose.map((c, i) => [i ? ', ' : '', c.source === 'drive' ? h('a', { href: `/a/Agents?open=${encodeURIComponent(c.id)}`, text: c.title }) : h('span', { text: c.title })])));
      if (hidden) foot.push(h('p.fx-loose', {}, h('button.btn.quiet.small', { type: 'button', text: F.showHidden ? `Put away ${hidden} hidden` : `Show ${hidden} hidden`, onclick: () => { F.showHidden = !F.showHidden; drawnKey = null; paint(); } })));
      return [grid, ...foot];
    }

    function drivesTab() {
      const feats = F.data.features.filter((f) => f.kind === 'host' && !f.hidden);
      // A place and what has not reached it. `sha` false: a place with no
      // release of its own (the checkouts); null: a release not known yet,
      // which says so instead of listing everything as missing.
      const node = (name, role, sha, list, label, none) => h('div.fx-node', {},
        h('div.nm', { text: name }), role ? h('div.role', { text: role }) : null, sha ? h('code.rel', { text: sha.slice(0, 7) }) : null,
        h('div.fx-waits', {}, sha === null
          ? h('div.none', { text: 'Release not known yet. The next deploy, or Look now in Drives, tells the Console.' })
          : list.length
            ? [h('div.wl', { text: label }), list.map((f) => h('button', { type: 'button', text: f.name, onclick: () => jump(f.id) }))]
            : h('div.none', { text: none })));
      const cols = [];
      const loose = feats.filter((f) => !f.on.length && ['build', 'commit'].includes(f.at));
      cols.push(h('div.fx-ring', { 'data-ring': 'src' }, h('h3', { text: 'Workshop' }),
        node('This Mac’s checkouts', 'main and its worktrees', false, loose, 'Not on GitHub yet', 'Everything here is pushed')));
      const pushed = feats.filter((f) => !f.on.length && f.at === 'push');
      cols.push(h('div.fx-ring', { 'data-ring': 'gh' }, h('h3', { text: 'GitHub' }),
        node('origin/main', 'marble-app/marble-drive', F.data.origin, pushed, 'Pushed, on no drive', 'Everything pushed is on a drive')));
      for (const [ring, label] of rings()) {
        cols.push(h('div.fx-ring', { 'data-ring': ring }, h('h3', { text: label }), drivesIn(ring).map((d) => {
          const missing = feats.filter((f) => (f.on.length || f.at === 'push') && !f.on.includes(d.key));
          const role = d.key === 'mac' ? 'your drive, at home' : ring === 'yours' ? 'standby and workshop' : ring === 'tb' ? 'not used for testing now' : null;
          return node(d.name, role, d.sha, missing, 'Not here yet', 'Has everything on main');
        })));
      }
      return h('div.fx-drives', {}, cols);
    }

    function chatsTab() {
      const byChat = new Map();
      for (const f of F.data.features) {
        if (f.hidden) continue;
        for (const c of placedChats(f)) {
          const key = `${c.source}:${c.id}`;
          const have = byChat.get(key) ?? { ...c, feats: [] };
          have.feats.push(f);
          byChat.set(key, have);
        }
      }
      const rows = [...byChat.values()].sort((a, b) => (Number(b.running) - Number(a.running)) || ((b.at ?? 0) - (a.at ?? 0)));
      const loose = (F.data.loose ?? []).map((c) => ({ ...c, ...(F.data.chats[`${c.source}:${c.id}`] ?? { title: c.id }) }));
      return h('div.fx-chats', {},
        rows.map((c) => h('div.fx-crow', { 'data-running': c.running ? true : null },
          h('div.fx-chead', {}, chatLink(c), chatAge(c)),
          h('div.fx-cfeats', {}, c.feats.map((f) => h('button', { type: 'button', onclick: () => jump(f.id) }, h('span', { text: f.name }), h('span.wh', { text: whereNow(f) })))))),
        loose.length ? h('div.fx-crow', {}, h('div.fx-chead', {}, h('span.soft', { text: 'Not placed yet' })),
          h('div.fx-cloose', {}, loose.map((c) => (c.source === 'drive' ? h('a', { href: `/a/Agents?open=${encodeURIComponent(c.id)}`, text: c.title }) : h('span', { text: c.title }))))) : null);
    }

    // --------------------------------------------------------------- draw

    function draw() {
      if (!F.data && !F.error && !F.loading) load();
      const key = JSON.stringify([Math.floor(Date.now() / 60_000), F.data, F.error, F.tab, [...F.open], F.showHidden, F.said, F.triage]);
      if (key === drawnKey) return;
      // Keep what the hand is in: a field being typed in is never redrawn.
      if (page.contains(document.activeElement) && document.activeElement.matches('input')) return;
      drawnKey = key;
      const d = F.data;
      const readLine = d?.readAt
        ? `Read ${ago(d.readAt) === 'now' ? 'just now' : `${ago(d.readAt)} ago`}${d.by ? '' : ''} · ${d.features.length} features · ${allDrives().length} drives`
        : null;
      const triageBusy = F.triage && chatRunning(F.triage.id);
      const head = h('div.card-head', {},
        h('h2', { text: 'Features' }),
        readLine ? h('span.soft', { text: readLine }) : null,
        h('div.end', {},
          segmented(TABS, F.tab, (t) => { F.tab = t; keep('tab', t); drawnKey = null; paint(); }, { small: true, label: 'Show features as' }),
          h('button.btn.primary', { type: 'button', 'data-busy': triageBusy ? true : null, onclick: runTriage, text: triageBusy ? 'Triage running…' : 'Run triage' })));
      let body;
      if (F.error) body = h('p.empty', { text: `Features could not be read: ${F.error}` });
      else if (!d) body = h('p.loading', { text: 'Reading features…' });
      else if (!d.features.length) body = h('p.empty', { text: 'No triage yet. Run triage reads your chats, checkouts and drives, and draws each feature here.' });
      else body = F.tab === 'drives' ? drivesTab() : F.tab === 'chats' ? chatsTab() : lines();
      const said = F.said?.id === 'triage' ? h('p.said.fx-said', { role: 'status', text: F.said.text }) : null;
      const note = d?.note ? h('p.soft.fx-note', { text: d.note }) : null;
      page.replaceChildren(h('section.card.wide.fx', {}, head, said, note, h('div.card-body.flush', {}, body)));
      if (F.focus && d) {
        const id = F.focus;
        F.focus = null;
        if (d.features.some((f) => f.id === id)) jump(id);
      }
    }

    return { draw, load };
  }

  window.marbleConsoleFeatures = { mount };
})();
