// Projects: the drive's work grouped by what it is for, ranked by what
// matters now, as a gallery, along a timeline, and one project at a time
// (Notes and Sketches/App Designs/Projects design, in the owner's drive).
//
// Injected by the host into a page that carries <meta name="marble-projects">
// (templates/projects.mrbl). The split is the page's whole design:
//
//   The file holds what only the owner can say. Each project is an
//   <article class="project"> with its name, its one sentence, its level
//   (main, side, resting), its start and end, the places it lives in
//   (ul.p-members), its threads, its dates, and the morning run's
//   suggestions. Every change to those is an op, with an undo.
//
//   Everything that can be counted is read live and never written: the
//   chats (marble.agent), which are running, how many each week, which
//   documents changed (marble.drive). So the file never turns into a log.
//
//   The views are drawn around the file's own elements. In the gallery the
//   articles are the cards; opened, the article takes the window. What the
//   script adds is data-marble-transient, and which view is showing is
//   looking, filed with { look: true }.
//
// A chat belongs to one project: the one it was started in or filed in by
// hand, else the one listing its document, else the one listing a folder
// its document is in (the deepest wins), else the one whose code it ran in.

(() => {
  const mount = document.querySelector('main[data-projects]');
  if (!mount || window.marbleProjects) return;

  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const TRANSIENT = 'data-marble-transient';
  const LEVELS = ['main', 'side', 'resting'];
  const LEVEL_WORD = { main: 'Main', side: 'Side', resting: 'Resting' };
  // Pages every drive is seeded with. A chat on one of them is about the
  // app, not a project of the owner's, until a project says otherwise.
  const SYSTEM_DOCS = new Set(['drive', 'Agents', 'Chat', 'Board', 'Console', 'Design System', "Design Don'ts", 'Projects', 'start-here', 'Start here']);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // What the page has read. None of it is the file's.
  const S = {
    chats: new Map(),     // id -> summary
    docs: [],             // { path, title, modified } for every document
    folders: [],          // every folder path
    checkouts: [],        // where a chat can run: { id, name, path }
    agentFolders: [],     // Agents' own folders of chats
    provider: null,       // the provider a new chat starts with
    order: null,          // the ranked order, settled on open and on Rank
    loaded: false,
    hasAgents: false,
  };
  let M = null;

  // ---------------------------------------------------------------- helpers

  const h = (tag, cls = '', text = null) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== null && text !== undefined) el.textContent = text;
    return el;
  };
  const x = (tag, cls = '', text = null) => {
    const el = h(tag, cls, text);
    el.setAttribute(TRANSIENT, '');
    return el;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = (inner, view = '0 0 16 16') => `<svg viewBox="${view}" aria-hidden="true">${inner}</svg>`;
  const ICON_X = svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>');
  const ICON_UP = svg('<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>');
  const chev = (dir = '') => { const c = x('span', `x-chev ${dir}`.trim()); c.setAttribute('aria-hidden', 'true'); return c; };

  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  // Weeks start on Monday, as the owner's own calendar does.
  const weekStart = (t) => { const d = new Date(startOfDay(t)); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
  const dayMonth = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const whenWord = (t, now = Date.now()) => {
    const days = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days > 1 && days < 7) return WEEKDAYS[new Date(t).getDay()];
    return dayMonth(t);
  };
  const ago = (t, now = Date.now()) => {
    const s = Math.max(0, (now - t) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    const days = Math.floor(s / 86400);
    if (days < 7) return WEEKDAYS[new Date(t).getDay()];
    return dayMonth(t);
  };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const lastPart = (p) => String(p ?? '').split('/').pop();
  const under = (path, folder) => path === folder || path.startsWith(`${folder}/`);

  // ------------------------------------------------------------- the file

  const list = () => mount.querySelector(':scope > .prj-list');
  const declinedList = () => mount.querySelector(':scope > .prj-declined');
  const articles = () => [...(list()?.children ?? [])].filter((el) => el.matches('article.project'));
  const idOf = (el) => el?.getAttribute('data-marble-id') ?? null;
  const byId = (id) => (id ? mount.querySelector(`[data-marble-id="${CSS.escape(id)}"]`) : null);
  const kid = (el, sel) => el.querySelector(`:scope > ${sel}`);

  const read = (el) => {
    const members = [...(kid(el, '.p-members')?.children ?? [])].map((li) => ({
      el: li,
      id: idOf(li),
      kind: li.getAttribute('data-kind') ?? 'doc',
      path: li.getAttribute('data-path') ?? '',
      runsIn: li.getAttribute('data-runs-in') ?? '',
      chat: li.getAttribute('data-chat') ?? '',
      thread: li.getAttribute('data-thread') ?? '',
      main: li.hasAttribute('data-main'),
    }));
    const threads = [...(kid(el, '.p-threads')?.children ?? [])].map((li) => ({
      el: li, id: idOf(li), nameEl: li.querySelector(':scope > .t-name'),
      name: (li.querySelector(':scope > .t-name')?.textContent ?? '').trim() || 'Untitled thread',
    }));
    const dates = [...(kid(el, '.p-dates')?.children ?? [])].map((li) => ({
      el: li, id: idOf(li), at: parseIso(li.getAttribute('data-date')),
      nameEl: li.querySelector(':scope > .d-name'),
      name: (li.querySelector(':scope > .d-name')?.textContent ?? '').trim(),
    })).filter((d) => d.at !== null).sort((a, b) => a.at - b.at);
    const suggest = [...(kid(el, '.p-suggest')?.children ?? [])].map((li) => ({
      el: li, id: idOf(li), kind: li.getAttribute('data-kind') ?? 'doc', path: li.getAttribute('data-path') ?? '',
      why: (li.textContent ?? '').trim(),
    })).filter((s) => s.path);
    const level = LEVELS.includes(el.getAttribute('data-level')) ? el.getAttribute('data-level') : 'side';
    return {
      el, id: idOf(el),
      nameEl: kid(el, '.p-name'), sentenceEl: kid(el, '.p-sentence'),
      name: (kid(el, '.p-name')?.textContent ?? '').trim() || 'Untitled project',
      level,
      start: parseIso(el.getAttribute('data-start')),
      end: parseIso(el.getAttribute('data-end')),
      members, threads, dates, suggest,
    };
  };

  // One gesture: the page moves, the file is told, and Mod+Z can take it back.
  const commit = (ops, { undoable = true } = {}) => {
    const list = [].concat(ops).filter(Boolean);
    if (!list.length || !M) return;
    const undo = undoable ? list.map((op) => M.invert(op)).reverse() : [];
    for (const op of list) { M.apply(op); M.op(op); }
    if (undoable && undo.length && undo.every(Boolean)) M.record({ redo: list, undo });
    paint();
  };
  // Where someone is looking: filed so the page opens where its owner left
  // it, marked as looking so someone else's tab keeps its own.
  const look = (name, value) => {
    const id = idOf(mount);
    if (!M || !id) { value === null ? mount.removeAttribute(name) : mount.setAttribute(name, value); paint(); return; }
    if ((mount.getAttribute(name) ?? null) === value) return;
    const op = { type: 'setAttr', id, name, value };
    M.apply(op);
    M.op(op, { look: true });
    paint();
  };
  const setAttr = (el, name, value) => ({ type: 'setAttr', id: idOf(el), name, value });
  const newId = () => M.newId();

  const projectHtml = ({ name, level = 'side', members = [] }) => {
    const li = members.map((m) => {
      const attrs = [`data-kind="${esc(m.kind)}"`];
      if (m.path) attrs.push(`data-path="${esc(m.path)}"`);
      if (m.runsIn) attrs.push(`data-runs-in="${esc(m.runsIn)}"`);
      if (m.chat) attrs.push(`data-chat="${esc(m.chat)}"`);
      return `<li data-marble-id="${newId()}" ${attrs.join(' ')}></li>`;
    }).join('');
    return `<article data-marble-id="${newId()}" class="project" data-level="${esc(level)}" data-start="" data-end="">`
      + `<h2 data-marble-id="${newId()}" class="p-name">${esc(name)}</h2>`
      + `<p data-marble-id="${newId()}" class="p-sentence"></p>`
      + `<ul data-marble-id="${newId()}" class="p-members">${li}</ul>`
      + `<ol data-marble-id="${newId()}" class="p-threads"></ol>`
      + `<ol data-marble-id="${newId()}" class="p-dates"></ol>`
      + `<ol data-marble-id="${newId()}" class="p-suggest"></ol>`
      + '</article>';
  };
  const memberHtml = (m) => {
    const attrs = [`data-kind="${esc(m.kind)}"`];
    if (m.path) attrs.push(`data-path="${esc(m.path)}"`);
    if (m.runsIn) attrs.push(`data-runs-in="${esc(m.runsIn)}"`);
    if (m.chat) attrs.push(`data-chat="${esc(m.chat)}"`);
    return `<li data-marble-id="${newId()}" ${attrs.join(' ')}></li>`;
  };

  // ------------------------------------------------------------- counting

  // Which project each chat belongs to, and what each project adds up to.
  const tally = () => {
    const now = Date.now();
    const ps = articles().map(read);
    const byChat = new Map();
    const byDoc = new Map();
    const byFolder = [];
    const byCode = new Map();
    for (const p of ps) {
      for (const m of p.members) {
        if (m.kind === 'chat' && m.chat) byChat.set(m.chat, [p, m]);
        else if (m.kind === 'doc' && m.path) byDoc.set(m.path, [p, m]);
        else if (m.kind === 'folder' && m.path) byFolder.push([m.path, p, m]);
        else if (m.kind === 'code' && m.runsIn) byCode.set(m.runsIn, [p, m]);
      }
    }
    byFolder.sort((a, b) => b[0].length - a[0].length);
    const home = (chat) => {
      const target = chat.target ?? '';
      return byChat.get(chat.id)
        ?? byDoc.get(target)
        ?? (() => { const hit = byFolder.find(([f]) => target && under(target, f)); return hit ? [hit[1], hit[2]] : null; })()
        ?? (chat.project && chat.project !== 'drive' ? byCode.get(chat.project) : null)
        ?? null;
    };
    const thisWeek = weekStart(now);
    const stats = new Map(ps.map((p) => [p.id, {
      p, chats: [], weeks: new Map(), week: 0, lastWeek: 0, running: 0, asking: 0, unseen: 0,
      first: null, last: null, threads: new Map(p.threads.map((t) => [t.id, { chats: [], weeks: new Map() }])),
    }]));
    const unfiled = [];
    for (const chat of S.chats.values()) {
      const found = home(chat);
      if (!found) { unfiled.push(chat); continue; }
      const [p, m] = found;
      const st = stats.get(p.id);
      st.chats.push(chat);
      const made = chat.createdAt ?? chat.updatedAt ?? now;
      const wk = weekStart(made);
      st.weeks.set(wk, (st.weeks.get(wk) ?? 0) + 1);
      if (now - made < WEEK) st.week++;
      else if (now - made < 2 * WEEK) st.lastWeek++;
      if (chat.running && !chat.asking) st.running++;
      if (chat.asking) st.asking++;
      // Finished unread, lately: an old unread chat is history, not news.
      if (!chat.running && chat.needsReview && now - (chat.lastFinishedAt ?? chat.updatedAt ?? 0) < DAY) st.unseen++;
      st.first = Math.min(st.first ?? made, made);
      st.last = Math.max(st.last ?? 0, chat.updatedAt ?? made);
      st.lastChat = Math.max(st.lastChat ?? 0, chat.updatedAt ?? made);
      const thread = m?.thread && st.threads.get(m.thread);
      if (thread) { thread.chats.push(chat); thread.weeks.set(wk, (thread.weeks.get(wk) ?? 0) + 1); }
    }
    // The documents each project lives in, and the newest change among them.
    for (const st of stats.values()) {
      const docs = S.docs.filter((d) => st.p.members.some((m) => (m.kind === 'doc' && m.path === d.path) || (m.kind === 'folder' && under(d.path, m.path))));
      st.docs = docs.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
      const edited = st.docs[0]?.modified ?? null;
      if (edited) st.last = Math.max(st.last ?? 0, edited);
      st.next = st.p.dates.find((d) => d.at >= startOfDay(now)) ?? null;
      if (!st.next && st.p.end && st.p.end >= startOfDay(now)) st.next = { at: st.p.end, name: 'Ends' };
      st.start = st.p.start ?? st.first ?? (st.docs.length ? Math.min(...st.docs.map((d) => d.created ?? d.modified ?? now)) : null);
    }
    return { ps, stats, unfiled, thisWeek, now };
  };

  // The order: Main, then Side, then Resting; inside a level, a date this
  // week or a chat waiting goes first, then this week's work, a running chat
  // counting as a day's work. It settles when the page opens and on Rank.
  const scoreOf = (st, now) => {
    const soon = st.next && st.next.at - now < 7 * DAY;
    return {
      level: LEVELS.indexOf(st.p.level),
      urgent: st.asking > 0 || soon ? 1 : 0,
      work: st.week + 3 * st.running,
      last: st.last ?? 0,
    };
  };
  const ranked = (T) => {
    const sort = mount.getAttribute('data-sort') || 'ranked';
    const all = [...T.stats.values()];
    const by = {
      ranked: (a, b) => {
        const x1 = scoreOf(a, T.now); const x2 = scoreOf(b, T.now);
        return x1.level - x2.level || x2.urgent - x1.urgent || x2.work - x1.work || x2.last - x1.last || a.p.name.localeCompare(b.p.name);
      },
      recent: (a, b) => (b.last ?? 0) - (a.last ?? 0) || a.p.name.localeCompare(b.p.name),
      due: (a, b) => (a.next?.at ?? Infinity) - (b.next?.at ?? Infinity) || LEVELS.indexOf(a.p.level) - LEVELS.indexOf(b.p.level),
      name: (a, b) => a.p.name.localeCompare(b.p.name),
    }[sort] ?? (() => 0);
    return all.sort(by).map((st) => st.p.id);
  };

  // The line under a card: why it is where it is, in words, not a score.
  const reasonOf = (st, now) => {
    if (st.asking) return { state: 'waiting', text: st.asking === 1 ? 'Waiting for you' : `${st.asking} waiting for you` };
    if (st.next && st.next.at - now < 14 * DAY) {
      const what = st.next.name ? `: ${st.next.name}` : '';
      return { state: st.running ? 'working' : null, text: `Due ${whenWord(st.next.at, now)}${what}`, lead: st.running ? `${st.running} working · ` : '' };
    }
    if (st.running) return { state: 'working', text: `${st.running} working` };
    if (st.unseen) return { state: 'unseen', text: `${plural(st.unseen, 'chat')} finished unread` };
    if (st.week) return { state: null, text: st.lastWeek && st.week > st.lastWeek * 1.5 ? `Up from ${st.lastWeek} last week` : `Last chat ${ago(st.lastChat, now)}` };
    if (st.lastChat) return { state: null, text: st.lastWeek ? `Quiet since ${dayMonth(st.lastChat)} · ${st.lastWeek} chats the week before` : `Quiet since ${dayMonth(st.lastChat)}` };
    return { state: null, text: 'No chats yet' };
  };

  // ---------------------------------------------------------- suggestions

  // What the chats suggest is a project and is not one yet: a top-level
  // folder (or the subfolders of one that holds several), a document of its
  // own at the top, an Agents folder, or a code checkout. Shown, not applied.
  const proposals = (T) => {
    const declined = new Set([...(declinedList()?.children ?? [])].map((li) => li.getAttribute('data-key')));
    const taken = new Set();
    for (const p of T.ps) for (const m of p.members) taken.add(`${m.kind}:${m.kind === 'code' ? m.runsIn : m.kind === 'chat' ? m.chat : m.path}`);
    const groups = new Map();
    const add = (key, make, chat) => {
      if (!groups.has(key)) groups.set(key, { key, ...make(), chats: [] });
      groups.get(key).chats.push(chat);
    };
    // Subfolders of a top folder that has several busy ones are each their own.
    const sub = new Map();
    for (const chat of T.unfiled) {
      const parts = (chat.target ?? '').split('/');
      if (parts.length > 2) sub.set(`${parts[0]}/${parts[1]}`, (sub.get(`${parts[0]}/${parts[1]}`) ?? 0) + 1);
    }
    const splitTops = new Set();
    const busyByTop = new Map();
    for (const [path, n] of sub) if (n >= 3) busyByTop.set(path.split('/')[0], (busyByTop.get(path.split('/')[0]) ?? 0) + 1);
    for (const [top, n] of busyByTop) if (n >= 2) splitTops.add(top);
    const names = new Map(S.checkouts.map((c) => [c.id, c.name]));
    for (const chat of T.unfiled) {
      const target = chat.target ?? '';
      const parts = target.split('/');
      if (target && !SYSTEM_DOCS.has(target)) {
        if (parts.length === 1) add(`doc:${target}`, () => ({ name: target, members: [{ kind: 'doc', path: target }], where: target }), chat);
        else if (splitTops.has(parts[0]) && parts.length > 2) {
          const path = `${parts[0]}/${parts[1]}`;
          add(`folder:${path}`, () => ({ name: parts[1], members: [{ kind: 'folder', path }], where: path }), chat);
        } else add(`folder:${parts[0]}`, () => ({ name: parts[0], members: [{ kind: 'folder', path: parts[0] }], where: parts[0] }), chat);
      } else if (chat.project && chat.project !== 'drive' && names.has(chat.project)) {
        add(`code:${chat.project}`, () => ({ name: names.get(chat.project), members: [{ kind: 'code', runsIn: chat.project }], where: `Code in ${names.get(chat.project)}` }), chat);
      }
    }
    // Agents' own folders: a hand-made group of chats is a project already.
    for (const folder of S.agentFolders) {
      const ids = (folder.openIds ?? []).filter((id) => T.unfiled.some((c) => c.id === id));
      if (ids.length < 2) continue;
      const key = `agents:${folder.id}`;
      groups.set(key, {
        key, name: folder.name, where: 'A folder in Agents',
        members: ids.map((id) => ({ kind: 'chat', chat: id })),
        chats: ids.map((id) => S.chats.get(id)).filter(Boolean),
      });
    }
    // One guess per name: an Agents folder and a drive folder with the same
    // name are the same work, so their places and chats go together.
    const byName = new Map();
    for (const g of groups.values()) {
      const k = g.name.trim().toLowerCase();
      const had = byName.get(k);
      if (!had) { byName.set(k, g); continue; }
      const [keep, other] = had.key.startsWith('agents:') ? [g, had] : [had, g];
      keep.members = [...keep.members, ...other.members.filter((m) => m.kind !== 'chat' || !keep.chats.some((c) => c.id === m.chat))];
      const seen = new Set(keep.chats.map((c) => c.id));
      keep.chats = [...keep.chats, ...other.chats.filter((c) => !seen.has(c.id))];
      byName.set(k, keep);
    }
    const now = T.now;
    return [...byName.values()]
      .filter((g) => g.chats.length >= 3 || (g.key.startsWith('agents:') && g.chats.length >= 2))
      .filter((g) => !declined.has(g.key) && !g.members.every((m) => taken.has(`${m.kind}:${m.kind === 'code' ? m.runsIn : m.kind === 'chat' ? m.chat : m.path}`)))
      .map((g) => {
        const week = g.chats.filter((c) => now - (c.createdAt ?? 0) < WEEK).length;
        const fortnight = g.chats.filter((c) => now - (c.updatedAt ?? 0) < 2 * WEEK).length;
        return { ...g, week, level: week >= 5 ? 'main' : fortnight ? 'side' : 'resting', last: Math.max(...g.chats.map((c) => c.updatedAt ?? 0)) };
      })
      .sort((a, b) => b.week - a.week || b.chats.length - a.chats.length)
      .slice(0, 16);
  };

  const accept = (g) => {
    const html = projectHtml({ name: g.name, level: g.level, members: g.members });
    S.order = null;
    commit({ type: 'insert', parentId: idOf(list()), beforeId: null, html });
  };
  const decline = (key) => {
    commit({ type: 'insert', parentId: idOf(declinedList()), beforeId: null, html: `<li data-marble-id="${newId()}" data-key="${esc(key)}"></li>` });
  };

  // ---------------------------------------------------------------- paint

  let painting = false;
  let pending = false;
  const typing = () => {
    const a = document.activeElement;
    return Boolean(a && mount.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)) && !a.closest('.x-bar'));
  };
  let queued = 0;
  const schedule = (ms = 120) => {
    clearTimeout(queued);
    queued = setTimeout(() => paint(), ms);
  };

  function paint() {
    if (painting) return;
    // What someone is typing into is never redrawn under them; the page
    // catches up when they leave the field.
    if (typing()) { pending = true; return; }
    painting = true;
    pending = false;
    try {
      const T = tally();
      if (!S.order || S.order.some((id) => !T.stats.has(id)) || [...T.stats.keys()].some((id) => !S.order.includes(id))) {
        S.order = S.loaded || !S.hasAgents ? ranked(T) : [...T.stats.keys()];
      }
      const open = mount.getAttribute('data-open');
      if (open && !T.stats.has(open)) mount.removeAttribute('data-open');
      paintOrder(T);
      paintBar(T);
      paintSuggested(T);
      paintCards(T);
      paintTail(T);
      paintTimeline(T);
      paintOpen(T);
    } finally {
      painting = false;
    }
  }

  // The ranking is drawn with CSS order, so the file's elements never move
  // to be sorted: a rank is looking, not a change.
  const paintOrder = (T) => {
    let style = mount.querySelector(':scope > style.x-order');
    if (!style) { style = x('style', 'x-order'); mount.prepend(style); }
    const open = mount.getAttribute('data-open');
    const rules = S.order.map((id, i) => `main[data-projects] .prj-list > [data-marble-id="${CSS.escape(id)}"] { order: ${i}; }`);
    if (open) rules.push(`main[data-projects][data-open] .prj-list > [data-marble-id="${CSS.escape(open)}"] { display: grid; }`);
    const css = rules.join('\n');
    if (style.textContent !== css) style.textContent = css;
  };

  const seg = (options, current, onPick, label) => {
    const wrap = x('div', 'x-seg');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', label);
    for (const [value, word] of options) {
      const b = x('button', '', word);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(value === current));
      b.addEventListener('click', () => onPick(value));
      wrap.append(b);
    }
    return wrap;
  };

  const paintBar = (T) => {
    let bar = mount.querySelector(':scope > .x-bar');
    if (!bar) { bar = x('header', 'x-bar'); mount.prepend(bar); }
    const keep = bar.contains(document.activeElement) ? document.activeElement?.dataset?.k : null;
    bar.replaceChildren();
    const open = mount.getAttribute('data-open');
    const view = mount.getAttribute('data-view') === 'timeline' ? 'timeline' : 'gallery';
    if (open) {
      const back = x('button', 'x-quiet x-back');
      back.type = 'button';
      back.dataset.k = 'back';
      back.append(chev('left'), x('span', '', 'Projects'));
      back.addEventListener('click', () => closeProject());
      bar.append(back, x('span', 'x-sp'));
    } else {
      const title = x('h1', 'x-title', (document.title || 'Projects').trim());
      bar.append(title);
      bar.append(seg([['gallery', 'Gallery'], ['timeline', 'Timeline']], view, (v) => look('data-view', v), 'View'));
      if (view === 'timeline') {
        const zoom = mount.getAttribute('data-zoom') || 'quarter';
        bar.append(seg([['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']], zoom, (v) => look('data-zoom', v), 'How much calendar'));
      } else {
        const wrap = x('label', 'x-sortw');
        const sel = x('select');
        sel.dataset.k = 'sort';
        sel.setAttribute('aria-label', 'Order');
        for (const [v, w] of [['ranked', 'Ranked'], ['recent', 'Recent'], ['due', 'Due date'], ['name', 'Name']]) {
          const o = x('option', '', w); o.value = v; sel.append(o);
        }
        sel.value = mount.getAttribute('data-sort') || 'ranked';
        sel.addEventListener('change', () => { S.order = null; look('data-sort', sel.value); });
        wrap.append(sel, chev());
        bar.append(wrap);
        // Rank, only when what is happening would order them differently.
        const fresh = ranked(T);
        if (fresh.join() !== S.order.join()) {
          const rank = x('button', 'x-quiet', 'Rank');
          rank.type = 'button';
          rank.dataset.k = 'rank';
          rank.addEventListener('click', () => { S.order = ranked(tally()); paint(); });
          bar.append(rank);
        }
      }
      const working = [...T.stats.values()].reduce((n, st) => n + st.running, 0);
      const waiting = [...T.stats.values()].reduce((n, st) => n + st.asking, 0);
      const ctx = x('span', 'x-ctx', [working ? `${working} working` : '', waiting ? `${waiting} waiting for you` : ''].filter(Boolean).join(' · '));
      bar.append(x('span', 'x-sp'), ctx);
    }
    const nw = x('button', 'x-new', 'New');
    nw.type = 'button';
    nw.dataset.k = 'new';
    nw.addEventListener('click', () => newProject());
    bar.append(nw);
    if (keep) bar.querySelector(`[data-k="${keep}"]`)?.focus();
  };

  const sparkOf = (weeks, max, now, small = false) => {
    const sp = x('span', small ? 'x-spark sm' : 'x-spark');
    sp.setAttribute('aria-hidden', 'true');
    const w0 = weekStart(now);
    for (let i = 3; i >= 0; i--) {
      const wk = addDays(w0, -7 * i);
      const n = weeks.get(wk) ?? 0;
      const bar = x('i', i === 0 ? 'now' : '');
      bar.style.setProperty('--h', String(max ? n / max : 0));
      sp.append(bar);
    }
    return sp;
  };
  const sparkMax = (T) => {
    const w0 = weekStart(T.now);
    let max = 1;
    for (const st of T.stats.values()) for (let i = 0; i < 4; i++) max = Math.max(max, st.weeks.get(addDays(w0, -7 * i)) ?? 0);
    return max;
  };

  const clearX = (el) => { for (const c of [...el.children]) if (c.hasAttribute(TRANSIENT)) c.remove(); };

  const paintCards = (T) => {
    const max = sparkMax(T);
    const open = mount.getAttribute('data-open');
    const empty = list().querySelector(':scope > .x-empty');
    if (!T.ps.length) {
      if (!empty) {
        const p = x('p', 'x-empty', 'No projects yet. Press New to start one, or add a suggestion above.');
        list().append(p);
      }
    } else empty?.remove();
    for (const p of T.ps) {
      const st = T.stats.get(p.id);
      const el = p.el;
      el.setAttribute('tabindex', open ? '-1' : '0');
      el.setAttribute('role', open ? 'region' : 'button');
      if (open === p.id) continue; // the open one is drawn by paintOpen
      clearX(el);
      for (const c of [p.nameEl, p.sentenceEl]) if (c?.isContentEditable) c.removeAttribute('contenteditable');
      const lvl = x('button', 'x-level', LEVEL_WORD[p.level]);
      lvl.type = 'button';
      lvl.setAttribute('aria-label', `${LEVEL_WORD[p.level]}. Press to make it ${LEVEL_WORD[LEVELS[(LEVELS.indexOf(p.level) + 1) % 3]]}`);
      lvl.addEventListener('click', (e) => { e.stopPropagation(); cycleLevel(p); });
      (p.nameEl ?? el.firstChild)?.after(lvl);
      // No sentence yet: the latest chat says what the work is doing.
      const latest = !p.sentenceEl?.textContent.trim() && p.level !== 'resting'
        ? [...st.chats].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] : null;
      if (latest) {
        const l = x('p', 'x-latest');
        l.append(x('span', '', 'Latest: '), x('b', '', latest.title || 'Untitled chat'));
        (p.sentenceEl ?? lvl).after(l);
      }
      if (p.level !== 'resting') {
        const live = x('div', 'x-live');
        const n = st.week;
        live.append(sparkOf(st.weeks, max, T.now), x('span', 'x-count', S.hasAgents ? `${plural(n, 'chat')} this week` : ''));
        (el.querySelector(':scope > .x-latest') ?? p.sentenceEl ?? lvl).after(live);
      }
      const foot = x('div', 'x-foot');
      const why = reasonOf(st, T.now);
      if (why.state) { const d = x('span', 'x-dot'); d.dataset.state = why.state; foot.append(d); }
      foot.append(x('span', why.state === 'working' || why.state === 'waiting' ? '' : 'x-why', `${why.lead ?? ''}${why.text}`));
      el.append(foot);
    }
  };

  let showAllSuggested = false;
  const paintSuggested = (T) => {
    let box = mount.querySelector(':scope > .x-suggested');
    const props = S.hasAgents && S.loaded ? proposals(T) : [];
    if (!props.length || mount.getAttribute('data-view') === 'timeline') { box?.remove(); return; }
    // Before there are projects, the guesses are the page; after, they wait
    // below the cards, a line each.
    const after = T.ps.length > 0;
    if (!box) box = x('section', 'x-suggested');
    box.classList.toggle('after', after);
    if (after) { if (box.previousElementSibling !== list()) list().after(box); }
    else if (box.nextElementSibling !== list()) list().before(box);
    box.replaceChildren();
    box.append(x('h2', '', after ? 'Suggested from your chats' : 'Your chats suggest these projects'));
    const grid = x('div', 'x-sug-list');
    const shown = after && !showAllSuggested ? props.slice(0, 5) : props;
    for (const g of shown) {
      const card = x('div', 'x-sug');
      card.append(x('b', '', g.name), x('span', 'x-where', `${g.where} · ${plural(g.chats.length, 'chat')}${g.week ? `, ${g.week} this week` : ''}`));
      const acts = x('div', 'x-acts');
      const yes = x('button', 'x-out', 'Add project');
      yes.type = 'button';
      yes.addEventListener('click', () => accept(g));
      const no = x('button', 'x-quiet', 'Not a project');
      no.type = 'button';
      no.addEventListener('click', () => decline(g.key));
      acts.append(yes, no);
      card.append(acts);
      grid.append(card);
    }
    box.append(grid);
    if (shown.length < props.length) {
      box.append(quietButton(`Show ${props.length - shown.length} more`, () => { showAllSuggested = true; paint(); }));
      box.lastChild.classList.add('x-more');
    }
  };

  const paintTail = (T) => {
    let tail = mount.querySelector(':scope > .x-tail');
    if (!tail) { tail = x('p', 'x-tail'); list().after(tail); }
    const n = T.unfiled.length;
    tail.textContent = S.hasAgents && S.loaded && T.ps.length && n ? `${plural(n, 'chat')} aren’t in any project` : '';
    // The morning run, said in words beside its own buttons.
    const run = mount.querySelector(':scope > .prj-run');
    if (!run) return;
    let said = run.querySelector(':scope > .x-said');
    if (!said) { said = x('span', 'x-said'); run.prepend(said); }
    const trigger = run.querySelector('[data-marble-run]');
    const paused = trigger?.hasAttribute('data-marble-paused');
    const title = `Kept alive · ${lastPart(M?.app ?? 'Projects')} · ${idOf(trigger) ?? ''}`;
    const last = [...S.chats.values()].filter((c) => c.title === title).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const when = last ? ` · last ran ${ago(last.updatedAt) === 'now' ? 'just now' : ago(last.updatedAt)}` : '';
    said.textContent = paused ? 'Sentences and suggestions are paused' : `Sentences and suggestions update every morning at 7:00${when}`;
  };

  // ------------------------------------------------------------- timeline

  const rangeOf = (zoom, now) => {
    if (zoom === 'month') { const from = addDays(weekStart(now), -28); return { from, to: addDays(from, 63) }; }
    if (zoom === 'year') { const y = new Date(now).getFullYear(); return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() }; }
    const from = addDays(weekStart(now), -35);
    return { from, to: addDays(from, 7 * 16) };
  };

  const expanded = () => new Set((mount.getAttribute('data-expanded') ?? '').split(' ').filter(Boolean));

  const paintTimeline = (T) => {
    let tl = mount.querySelector(':scope > .x-timeline');
    if (!tl) { tl = x('section', 'x-timeline'); tl.setAttribute('aria-label', 'Timeline'); list().after(tl); }
    if (mount.getAttribute('data-view') !== 'timeline' || mount.getAttribute('data-open')) { tl.replaceChildren(); return; }
    if (tl.querySelector('.x-tl-end.held')) return; // a drag is drawing it
    tl.replaceChildren();
    const zoom = mount.getAttribute('data-zoom') || 'quarter';
    const { from, to } = rangeOf(zoom, T.now);
    const span = to - from;
    const pct = (t) => `${Math.max(0, Math.min(100, ((t - from) / span) * 100)).toFixed(3)}%`;
    const width = (a, b) => `${Math.max(0, ((Math.min(b, to) - Math.max(a, from)) / span) * 100).toFixed(3)}%`;
    const today = T.now;

    // The axis: months, or weeks at Month zoom.
    const axis = x('div', 'x-tl-row x-tl-axis');
    axis.append(x('span'));
    const atr = x('div', 'x-tl-tr');
    const marks = [];
    if (zoom === 'month') for (let t = from; t < to; t = addDays(t, 7)) marks.push([t, dayMonth(t)]);
    else {
      const d = new Date(from); d.setDate(1); if (d.getTime() < from) d.setMonth(d.getMonth() + 1);
      for (; d.getTime() < to; d.setMonth(d.getMonth() + 1)) marks.push([d.getTime(), zoom === 'year' ? MONTHS[d.getMonth()] : MONTHS_LONG[d.getMonth()]]);
    }
    for (const [t, word] of marks) { const m = x('span', 'x-tl-mo', word); m.style.left = pct(t); atr.append(m); }
    axis.append(atr);
    tl.append(axis);

    const body = x('div', 'x-tl-body');
    const grid = x('div', 'x-tl-grid');
    for (const [t] of marks) { const i = x('i'); i.style.left = pct(t); grid.append(i); }
    if (today >= from && today < to) {
      const i = x('i', 'today'); i.style.left = pct(today); grid.append(i);
      const s = x('span', '', 'Today'); s.style.left = pct(today); grid.append(s);
    }
    body.append(grid);

    // One scale for every row: the busiest week anywhere is full strength.
    let max = 1;
    for (const st of T.stats.values()) for (const n of st.weeks.values()) max = Math.max(max, n);
    const cellsOf = (weeks, first) => {
      const bar = x('span', 'x-tl-bar');
      const a = Math.max(weekStart(first), from);
      bar.style.left = pct(a);
      bar.style.width = width(a, today);
      for (let w = weekStart(a); w < today && w < to; w = addDays(w, 7)) {
        const n = weeks.get(w) ?? 0;
        const cell = x('i');
        const shown = Math.min(addDays(w, 7), today) - Math.max(w, a);
        cell.style.flexGrow = String(Math.max(0.1, shown / WEEK));
        cell.style.setProperty('--o', n ? (0.15 + 0.85 * (n / max)).toFixed(2) : '0.07');
        bar.append(cell);
      }
      return bar;
    };

    // Every project's chats together, so a light week shows as one.
    const all = new Map();
    let first = null;
    for (const st of T.stats.values()) {
      for (const [w, n] of st.weeks) all.set(w, (all.get(w) ?? 0) + n);
      if (st.first) first = Math.min(first ?? st.first, st.first);
    }
    if (first) {
      const row = x('div', 'x-tl-row sum');
      const nm = x('span', 'x-tl-nm'); nm.append(x('span', 'x-tl-gap'), x('span', '', 'All projects'));
      const tr = x('div', 'x-tl-tr');
      let allMax = 1; for (const n of all.values()) allMax = Math.max(allMax, n);
      const bar = cellsOf(new Map([...all].map(([w, n]) => [w, (n / allMax) * max])), first);
      tr.append(bar);
      row.append(nm, tr);
      tr.dataset.name = 'All projects';
      body.append(row);
    }

    const open = expanded();
    for (const id of S.order) {
      const st = T.stats.get(id);
      if (!st) continue;
      const p = st.p;
      const row = x('div', `x-tl-row${p.level === 'resting' ? ' rest' : ''}`);
      const nm = x('button', 'x-tl-nm');
      nm.type = 'button';
      if (p.threads.length) {
        const tw = x('span', 'x-tl-tw');
        tw.setAttribute('role', 'button');
        tw.setAttribute('tabindex', '0');
        tw.setAttribute('aria-expanded', String(open.has(id)));
        tw.setAttribute('aria-label', `${open.has(id) ? 'Hide' : 'Show'} ${p.name}’s threads`);
        tw.append(chev());
        const toggle = (e) => {
          e.stopPropagation();
          const set = expanded();
          set.has(id) ? set.delete(id) : set.add(id);
          look('data-expanded', [...set].join(' ') || null);
        };
        tw.addEventListener('click', toggle);
        tw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
        nm.append(tw);
      } else nm.append(x('span', 'x-tl-gap'));
      nm.append(x('span', '', p.name));
      nm.addEventListener('click', () => openProject(id));
      const tr = x('div', 'x-tl-tr');
      tr.dataset.name = p.name;
      const begin = st.start ?? st.first;
      if (begin && begin < today) tr.append(cellsOf(st.weeks, begin));
      // The plan: dashed from today to its end, or open-ended while the
      // project is still going and nobody has said when it stops.
      const end = p.end;
      if (end && end > today) { const plan = x('span', 'x-tl-plan'); plan.style.left = pct(today); plan.style.width = width(today, end); tr.append(plan); }
      else if (!end && p.level !== 'resting' && begin) { const plan = x('span', 'x-tl-plan open'); plan.style.left = pct(today); plan.style.width = width(today, to); tr.append(plan); }
      for (const d of p.dates) {
        if (d.at < from || d.at >= to) continue;
        const ms = x('span', 'x-tl-ms'); ms.style.left = pct(d.at); ms.setAttribute('aria-hidden', 'true');
        tr.append(ms);
        if (d.name) { const ml = x('span', 'x-tl-ml', d.name); ml.style.left = pct(d.at); tr.append(ml); }
      }
      if (begin) tr.append(endHandle(p, end ?? today, { pct, from, span, tr }));
      row.append(nm, tr);
      body.append(row);
      if (open.has(id)) {
        for (const t of p.threads) {
          const ts = st.threads.get(t.id);
          const sub = x('div', 'x-tl-row sub');
          const tn = x('span', 'x-tl-nm'); tn.append(x('span', '', t.name));
          const ttr = x('div', 'x-tl-tr');
          ttr.dataset.name = t.name;
          const tfirst = ts.chats.length ? Math.min(...ts.chats.map((c) => c.createdAt ?? T.now)) : null;
          if (tfirst) ttr.append(cellsOf(ts.weeks, tfirst));
          sub.append(tn, ttr);
          body.append(sub);
        }
      }
    }
    tl.append(body);
  };

  // The end of a project, held and dragged to say when it stops: it tracks
  // the pointer one to one and files one op on release.
  const endHandle = (p, at, { from, span, tr }) => {
    const hd = x('button', 'x-tl-end');
    hd.type = 'button';
    const say = (t) => (p.end ? `Ends ${dayMonth(t)}` : 'No end set');
    hd.setAttribute('aria-label', `${p.name}: ${say(at)}. Drag, or press the arrow keys, to move when it ends`);
    hd.style.left = `${(((at - from) / span) * 100).toFixed(3)}%`;
    const toDay = (clientX) => {
      const r = tr.getBoundingClientRect();
      const t = from + ((clientX - r.left) / r.width) * span;
      return startOfDay(t + DAY / 2);
    };
    let held = null;
    hd.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hd.setPointerCapture(e.pointerId);
      hd.classList.add('held');
      const tip = x('span', 'x-tl-tip');
      tr.append(tip);
      const plan = tr.querySelector('.x-tl-plan') ?? (() => { const pl = x('span', 'x-tl-plan'); tr.append(pl); return pl; })();
      held = { tip, plan, t: at };
      const move = (ev) => {
        held.t = toDay(ev.clientX);
        const left = `${(((held.t - from) / span) * 100).toFixed(3)}%`;
        hd.style.left = left;
        tip.style.left = left;
        tip.textContent = dayMonth(held.t);
        const now = Date.now();
        if (held.t > now) {
          plan.classList.remove('open');
          plan.style.left = `${(((now - from) / span) * 100).toFixed(3)}%`;
          plan.style.width = `${(((held.t - now) / span) * 100).toFixed(3)}%`;
        } else plan.style.width = '0';
      };
      move(e);
      hd.onpointermove = move;
      hd.onpointerup = hd.onpointercancel = () => {
        hd.onpointermove = hd.onpointerup = hd.onpointercancel = null;
        hd.classList.remove('held');
        tip.remove();
        const value = iso(held.t);
        held = null;
        if (value !== p.el.getAttribute('data-end')) commit(setAttr(p.el, 'data-end', value));
        else paint();
      };
    });
    hd.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const base = p.end ?? startOfDay(Date.now());
      const t = addDays(base, e.key === 'ArrowRight' ? 7 : -7);
      commit(setAttr(p.el, 'data-end', iso(t)));
      requestAnimationFrame(() => mount.querySelector('.x-timeline [data-name="' + CSS.escape(p.name) + '"] .x-tl-end')?.focus());
    });
    return hd;
  };

  // ----------------------------------------------------- a project, opened

  const openProject = (id) => { look('data-open', id); scrollTo({ top: 0 }); };
  const closeProject = () => {
    const was = mount.getAttribute('data-open');
    look('data-open', null);
    requestAnimationFrame(() => byId(was)?.focus({ preventScroll: false }));
  };

  // Words the owner edits: plain text, one setText per pause, Mod+Z back.
  const wired = new WeakSet();
  const touched = new WeakSet();
  const editable = (el, { target = el, onFirst = null, enter = 'blur' } = {}) => {
    if (!el) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('spellcheck', 'true');
    if (wired.has(el)) return;
    wired.add(el);
    let before = null;
    el.addEventListener('focus', () => { before = target.textContent; touched.delete(el); });
    el.addEventListener('input', () => {
      const text = el.textContent;
      const op = { type: 'setText', id: idOf(target), text };
      if (target !== el) M.apply(op);
      M.op(op);
      M.record({ redo: [op], undo: [{ type: 'setText', id: idOf(target), text: before ?? '' }] }, { coalesce: true });
      // The first keystroke of a visit, for a caller that marks who wrote it.
      if (onFirst && !touched.has(el)) { touched.add(el); onFirst(); }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && enter === 'blur') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); el.blur(); }
    });
  };

  const block = (title, ...extra) => {
    const b = x('section', 'x-blk');
    const h3 = x('h3', '', title);
    for (const e of extra) h3.append(e);
    b.append(h3);
    return b;
  };
  const quietButton = (word, fn, label = null) => {
    const b = x('button', 'x-quiet', word);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  };
  const removeButton = (label, fn) => {
    const b = x('button', 'x-x');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = ICON_X;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  };

  const stateOf = (c) => (c.asking ? 'waiting' : c.running ? 'working' : c.lastOutcome === 'failed' ? 'failed' : c.needsReview ? 'unseen' : 'idle');
  const memberLabel = (m) => {
    if (m.kind === 'code') { const c = S.checkouts.find((k) => k.id === m.runsIn); return [c?.name ?? 'Code', `Code · ${c?.path ?? m.runsIn}`]; }
    if (m.kind === 'chat') { const c = S.chats.get(m.chat); return [c?.title || 'A chat', 'Chat, filed here']; }
    if (m.kind === 'folder') return [lastPart(m.path), m.path.includes('/') ? `Folder in ${m.path.split('/').slice(0, -1).join('/')}` : 'Folder'];
    return [lastPart(m.path), m.path.includes('/') ? m.path.split('/').slice(0, -1).join('/') : 'Document'];
  };
  const hrefOf = (path) => (M?.href ? M.href(path) : `/a/${encodeURIComponent(path)}`);

  const paintOpen = (T) => {
    const openId = mount.getAttribute('data-open');
    if (!openId) return;
    const st = T.stats.get(openId);
    if (!st) return;
    const p = st.p;
    const el = p.el;
    // Half-typed fields outlive a redraw: a chat finishing elsewhere must
    // not take back a date someone was halfway through adding.
    const kept = new Map([...el.querySelectorAll('[data-k]')].map((f) => [f.dataset.k, f.value]));
    const keep = (field, key) => { field.dataset.k = key; if (kept.get(key)) field.value = kept.get(key); return field; };
    clearX(el);
    editable(p.nameEl);
    editable(p.sentenceEl, { onFirst: () => { if (p.sentenceEl.getAttribute('data-by') !== 'you') commit(setAttr(p.sentenceEl, 'data-by', 'you'), { undoable: false }); } });

    // Under the name: the level, when it began, when it ends, its size.
    const meta = x('div', 'x-meta');
    const lv = x('select');
    lv.setAttribute('aria-label', 'How much it matters');
    for (const l of LEVELS) { const o = x('option', '', LEVEL_WORD[l]); o.value = l; lv.append(o); }
    lv.value = p.level;
    lv.addEventListener('change', () => { S.order = null; commit(setAttr(el, 'data-level', lv.value)); });
    meta.append(lv);
    if (st.start) meta.append(x('span', '', `Since ${dayMonth(st.start)}`));
    const endLabel = x('label');
    endLabel.append(x('span', '', 'Ends'));
    const endInput = x('input');
    endInput.type = 'date';
    endInput.value = p.end ? iso(p.end) : '';
    endInput.setAttribute('aria-label', 'When it ends');
    endInput.addEventListener('change', () => commit(setAttr(el, 'data-end', endInput.value || '')));
    endLabel.append(endInput);
    meta.append(endLabel);
    if (S.hasAgents) meta.append(x('span', '', `${plural(st.chats.length, 'chat')}${st.docs.length ? ` on ${plural(new Set(st.chats.map((c) => c.target).filter(Boolean)).size, 'document')}` : ''}`));
    p.nameEl.after(meta);

    const body = x('div', 'x-body');
    const left = x('div', 'x-col');
    const right = x('div', 'x-col');
    body.append(left, right);

    // Chats: what is working on it now, then the latest.
    if (S.hasAgents) {
      const chats = [...st.chats].sort((a, b) => {
        const rank = (c) => (c.asking ? 0 : c.running ? 1 : c.needsReview ? 2 : 3);
        return rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      });
      const busy = chats.filter((c) => c.running || c.asking).length;
      const blk = block(busy ? 'Working now' : 'Chats');
      const shown = chats.slice(0, Math.max(6, busy));
      if (!shown.length) blk.append(x('p', 'x-note', 'No chats yet. Ask below to start one in this project.'));
      for (const c of shown) {
        const row = x('a', 'x-row');
        row.href = `${hrefOf('Agents')}?open=${encodeURIComponent(c.id)}`;
        const d = x('span', 'x-dot'); d.dataset.state = stateOf(c);
        row.append(d, x('span', 'x-a', c.title || 'Untitled chat'), x('span', 'x-age', ago(c.updatedAt ?? c.createdAt ?? T.now, T.now)));
        row.append(x('span', 'x-b', [c.target || 'No document', c.activity].filter(Boolean).join(' · ')));
        blk.append(row);
      }
      if (chats.length > shown.length) {
        const more = x('p', 'x-note', `and ${plural(chats.length - shown.length, 'earlier chat')}`);
        blk.append(more);
      }
      left.append(blk);
    }

    // Threads: the named parts of a big project.
    const threads = block('Threads', quietButton('Add thread', () => addThread(p), 'Add a thread to this project'));
    if (!p.threads.length) threads.append(x('p', 'x-note', 'Split this project into parts, and give each part its places below.'));
    const max = sparkMax(T);
    for (const t of p.threads) {
      const ts = st.threads.get(t.id);
      const row = x('div', 'x-row plain');
      const name = x('span', 'x-a', t.nameEl?.textContent ?? t.name);
      if (t.nameEl) editable(name, { target: t.nameEl });
      const places = p.members.filter((m) => m.thread === t.id).map((m) => memberLabel(m)[0]);
      row.append(name, S.hasAgents ? sparkOf(ts.weeks, max, T.now, true) : x('span'), removeButton(`Remove the thread ${t.name}`, () => removeThread(p, t)));
      row.append(x('span', 'x-b', [S.hasAgents ? plural(ts.chats.length, 'chat') : '', places.join(', ') || 'No places yet'].filter(Boolean).join(' · ')));
      threads.append(row);
    }
    left.append(threads);

    // The morning run's suggestions, each a press away from joining.
    if (p.suggest.length) {
      const sug = block('Suggested');
      for (const s of p.suggest) {
        const row = x('div', 'x-row plain');
        row.append(x('span', 'x-a', lastPart(s.path)));
        const acts = x('span', 'x-acts');
        const yes = x('button', 'x-out', 'Add'); yes.type = 'button';
        yes.addEventListener('click', () => commit([
          { type: 'insert', parentId: idOf(kid(el, '.p-members')), beforeId: null, html: memberHtml({ kind: s.kind, path: s.path }) },
          { type: 'remove', id: s.id },
        ]));
        const no = x('button', 'x-quiet', 'No'); no.type = 'button';
        no.addEventListener('click', () => commit([
          { type: 'insert', parentId: idOf(declinedList()), beforeId: null, html: `<li data-marble-id="${newId()}" data-key="${esc(`${s.kind}:${s.path}`)}"></li>` },
          { type: 'remove', id: s.id },
        ]));
        acts.append(yes, no);
        row.append(acts, x('span'));
        row.append(x('span', 'x-b', s.why && s.why !== s.path ? s.why : s.path));
        sug.append(row);
      }
      left.append(sug);
    }

    // Dates: what it has to meet. The nearest one ranks the project.
    const dates = block('Dates');
    if (!p.dates.length) dates.append(x('p', 'x-note', 'No dates yet.'));
    for (const d of p.dates) {
      const row = x('div', 'x-row plain');
      const name = x('span', 'x-a', d.nameEl?.textContent || '');
      if (d.nameEl) editable(name, { target: d.nameEl });
      else name.textContent = 'Untitled date';
      row.append(name, x('span', 'x-age', `${WEEKDAYS[new Date(d.at).getDay()]} ${dayMonth(d.at)}`), removeButton(`Remove ${d.name || 'this date'}`, () => commit({ type: 'remove', id: d.id })));
      dates.append(row);
    }
    const addDate = x('form', 'x-add');
    const dIn = x('input'); dIn.type = 'date'; keep(dIn, 'date'); dIn.required = true; dIn.setAttribute('aria-label', 'Date');
    const nIn = keep(x('input'), 'due'); nIn.placeholder = 'What is due'; nIn.setAttribute('aria-label', 'What is due'); nIn.enterKeyHint = 'done';
    const dGo = x('button', 'x-out', 'Add'); dGo.type = 'submit';
    addDate.append(dIn, nIn, dGo);
    addDate.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!dIn.value) { dIn.focus(); return; }
      const html = `<li data-marble-id="${newId()}" data-date="${esc(dIn.value)}"><span data-marble-id="${newId()}" class="d-name">${esc(nIn.value.trim())}</span></li>`;
      dIn.value = ''; nIn.value = '';
      dIn.blur(); nIn.blur();
      commit({ type: 'insert', parentId: idOf(kid(el, '.p-dates')), beforeId: null, html });
    });
    dates.append(addDate);
    right.append(dates);

    // What changed this week among the places it lives in.
    const week = st.docs.filter((d) => T.now - (d.modified ?? 0) < WEEK).slice(0, 8);
    if (week.length) {
      const ch = block('Changed this week');
      for (const d of week) {
        const row = x('a', 'x-row plain');
        row.href = hrefOf(d.path);
        row.append(x('span', 'x-a', d.title || lastPart(d.path)), x('span', 'x-age', ago(d.modified, T.now)));
        ch.append(row);
      }
      right.append(ch);
    }

    // Where it lives: the folders, documents, code and chats that make it up.
    const lives = block('Lives in');
    if (!p.members.length) lives.append(x('p', 'x-note', 'Nothing yet. Add a folder or document, and its chats join the project.'));
    for (const m of p.members) {
      const [name, where] = memberLabel(m);
      const row = x(m.kind === 'doc' ? 'a' : 'div', 'x-row plain');
      if (m.kind === 'doc') row.href = hrefOf(m.path);
      row.append(x('span', 'x-a', name));
      if (p.threads.length) {
        const sel = x('select');
        sel.setAttribute('aria-label', `Which thread ${name} is in`);
        const none = x('option', '', 'No thread'); none.value = ''; sel.append(none);
        for (const t of p.threads) { const o = x('option', '', t.name); o.value = t.id; sel.append(o); }
        sel.value = m.thread;
        sel.addEventListener('click', (e) => e.stopPropagation());
        sel.addEventListener('change', () => commit(setAttr(m.el, 'data-thread', sel.value || null)));
        row.append(sel);
      } else row.append(x('span'));
      row.append(removeButton(`Take ${name} out of this project`, () => commit({ type: 'remove', id: m.id })));
      row.append(x('span', 'x-b', where));
      lives.append(row);
    }
    const addPlace = x('form', 'x-add');
    const pIn = keep(x('input'), 'place');
    pIn.placeholder = 'Add a folder, document or code';
    pIn.setAttribute('aria-label', 'Add a folder, document or code');
    pIn.enterKeyHint = 'done';
    const dl = x('datalist');
    dl.id = `x-places-${openId}`;
    pIn.setAttribute('list', dl.id);
    for (const f of S.folders) { const o = x('option'); o.value = `${f}/`; dl.append(o); }
    for (const d of S.docs) { const o = x('option'); o.value = d.path; dl.append(o); }
    for (const c of S.checkouts) { const o = x('option'); o.value = `Code: ${c.name}`; dl.append(o); }
    const pGo = x('button', 'x-out', 'Add'); pGo.type = 'submit';
    addPlace.append(pIn, dl, pGo);
    addPlace.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = pIn.value.trim();
      if (!v) return;
      let m = null;
      const code = /^Code:\s*(.+)$/i.exec(v);
      if (code) { const c = S.checkouts.find((k) => k.name === code[1].trim()); if (c) m = { kind: 'code', runsIn: c.id }; }
      else if (v.endsWith('/') || S.folders.includes(v)) m = { kind: 'folder', path: v.replace(/\/+$/, '') };
      else if (S.docs.some((d) => d.path === v)) m = { kind: 'doc', path: v };
      if (!m) { pIn.setCustomValidity('Pick a folder, document or code from the list'); pIn.reportValidity(); pIn.addEventListener('input', () => pIn.setCustomValidity(''), { once: true }); return; }
      pIn.value = '';
      pIn.blur();
      commit({ type: 'insert', parentId: idOf(kid(el, '.p-members')), beforeId: null, html: memberHtml(m) });
    });
    lives.append(addPlace);
    right.append(lives);

    el.append(body);

    // The box that starts work inside the project.
    if (S.hasAgents) {
      const form = x('form', 'x-composer');
      const ta = keep(x('textarea'), 'ask');
      ta.rows = 1;
      ta.placeholder = `Ask in ${p.name}…`;
      ta.setAttribute('aria-label', `Start a chat in ${p.name}`);
      ta.enterKeyHint = 'send';
      const target = mainDoc(p, st);
      const on = x('span', 'x-on', target ? `on ${lastPart(target)}` : '');
      const go = x('button', 'x-send');
      go.type = 'submit';
      go.disabled = true;
      go.setAttribute('aria-label', 'Start the chat');
      go.innerHTML = ICON_UP;
      ta.addEventListener('input', () => {
        go.disabled = !ta.value.trim();
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        go.disabled = true;
        ta.disabled = true;
        try {
          await startChat(p, st, text);
          ta.value = '';
          ta.disabled = false;
          ta.blur();
        } catch (err) {
          ta.disabled = false;
          go.disabled = false;
          on.textContent = `Couldn’t start it: ${err?.message ?? 'the host refused'}`;
        }
      });
      form.append(ta, on, go);
      el.append(form);
    }
  };

  // The document a chat started here works on: the one marked main, else
  // the one changed last, else the first document it lists.
  const mainDoc = (p, st) => p.members.find((m) => m.kind === 'doc' && m.main)?.path
    ?? st.docs[0]?.path
    ?? p.members.find((m) => m.kind === 'doc')?.path
    ?? null;

  const briefOf = (p, st) => {
    const now = Date.now();
    const places = p.members.map((m) => {
      if (m.kind === 'code') return `code: ${S.checkouts.find((c) => c.id === m.runsIn)?.path ?? m.runsIn}`;
      if (m.kind === 'chat') return null;
      return `${m.kind}: ${m.path}`;
    }).filter(Boolean);
    const lines = [
      `This chat was started inside the project "${p.name}" on the Projects page (${M?.app ?? 'Projects'}).`,
      p.sentenceEl?.textContent?.trim() ? `What it is doing: ${p.sentenceEl.textContent.trim()}` : '',
      places.length ? `It lives in: ${places.join('; ')}.` : 'It lists no folders or documents yet.',
      p.threads.length ? `Its threads: ${p.threads.map((t) => t.name).join(', ')}.` : '',
      p.dates.filter((d) => d.at >= startOfDay(now)).length ? `Coming dates: ${p.dates.filter((d) => d.at >= startOfDay(now)).map((d) => `${iso(d.at)} ${d.name}`).join('; ')}.` : '',
      st.docs.filter((d) => now - (d.modified ?? 0) < WEEK).length ? `Changed this week: ${st.docs.filter((d) => now - (d.modified ?? 0) < WEEK).slice(0, 8).map((d) => d.path).join(', ')}.` : '',
      'New documents for this project belong in one of its folders.',
    ];
    return lines.filter(Boolean).join('\n');
  };

  const startChat = async (p, st, text) => {
    const agent = M.agent;
    const runsIn = p.members.find((m) => m.kind === 'code')?.runsIn ?? null;
    const target = mainDoc(p, st);
    const id = await agent.start({ provider: S.provider ?? undefined, project: runsIn });
    await agent.send(id, { prompt: text, target: target ?? M.app, viewing: target ?? M.app, brief: briefOf(p, st) });
    // Started here, so filed here, whatever document it goes on to touch.
    commit({ type: 'insert', parentId: idOf(kid(p.el, '.p-members')), beforeId: null, html: memberHtml({ kind: 'chat', chat: id }) }, { undoable: false });
    agent.conversations?.().then((all) => { for (const c of all) S.chats.set(c.id, c); schedule(); }).catch(() => {});
  };

  // ------------------------------------------------------------- gestures

  const cycleLevel = (p) => {
    const next = LEVELS[(LEVELS.indexOf(p.level) + 1) % LEVELS.length];
    S.order = null;
    commit(setAttr(p.el, 'data-level', next));
  };

  const newProject = () => {
    const html = projectHtml({ name: 'New project', level: 'side' });
    const id = /data-marble-id="([^"]+)"/.exec(html)[1];
    S.order = null;
    commit({ type: 'insert', parentId: idOf(list()), beforeId: null, html });
    openProject(id);
    requestAnimationFrame(() => {
      const name = kid(byId(id), '.p-name');
      if (!name) return;
      name.focus();
      const r = document.createRange(); r.selectNodeContents(name);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  };

  const addThread = (p) => {
    const html = `<li data-marble-id="${newId()}"><span data-marble-id="${newId()}" class="t-name">New thread</span></li>`;
    commit({ type: 'insert', parentId: idOf(kid(p.el, '.p-threads')), beforeId: null, html });
    requestAnimationFrame(() => {
      const names = mount.querySelectorAll('.x-body .x-blk:nth-of-type(2) .x-row .x-a');
      const last = [...mount.querySelectorAll('.x-body [contenteditable]')].find((n) => n.textContent === 'New thread') ?? names[names.length - 1];
      if (last) { last.focus(); const r = document.createRange(); r.selectNodeContents(last); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
  };
  const removeThread = (p, t) => {
    const ops = p.members.filter((m) => m.thread === t.id).map((m) => setAttr(m.el, 'data-thread', null));
    ops.push({ type: 'remove', id: t.id });
    commit(ops);
  };

  // A card is a button until it is open; the level word is its own button.
  mount.addEventListener('click', (e) => {
    if (mount.getAttribute('data-open')) return;
    const card = e.target.closest?.('article.project');
    if (!card || !list()?.contains(card) || e.target.closest('button, a, input, select, textarea')) return;
    openProject(idOf(card));
  });
  mount.addEventListener('keydown', (e) => {
    const card = e.target;
    if (!mount.getAttribute('data-open') && card?.matches?.('article.project') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openProject(idOf(card));
    }
  });
  addEventListener('keydown', (e) => {
    const a = document.activeElement;
    const inField = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    if (e.key === 'Escape' && !inField && mount.getAttribute('data-open')) { e.preventDefault(); closeProject(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z' && !inField && M) {
      e.preventDefault();
      if (e.shiftKey) M.redo(); else M.undo();
      S.order = null;
      schedule(0);
    }
  });
  mount.addEventListener('focusout', () => { setTimeout(() => { if (pending && !typing()) paint(); }, 0); });

  // ---------------------------------------------------------------- loading

  // The listing hands titles over as they are written in the page's <title>.
  const unescape = (s) => { if (!s || !/&/.test(s)) return s; const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
  const flatten = (node, docs, folders) => {
    for (const c of node?.children ?? []) {
      if (c.kind === 'folder') { folders.push(c.path); flatten(c, docs, folders); }
      else if (c.kind === 'doc') docs.push({ path: c.path, title: unescape(c.title), modified: c.modified ? new Date(c.modified).getTime() : null, created: c.created ? new Date(c.created).getTime() : null });
    }
  };
  const loadTree = async () => {
    if (!M.drive?.tree) return;
    const tree = await M.drive.tree('', { files: false });
    const docs = []; const folders = [];
    flatten(tree, docs, folders);
    S.docs = docs;
    S.folders = folders.sort();
  };
  const loadChats = async () => {
    const agent = M.agent;
    if (!agent) return;
    const [live, archived] = await Promise.all([agent.conversations(), agent.conversations({ archived: true }).catch(() => [])]);
    S.chats = new Map([...archived, ...live].map((c) => [c.id, c]));
  };
  const load = async () => {
    const agent = M.agent;
    S.hasAgents = Boolean(agent);
    const jobs = [loadTree().catch(() => {})];
    if (agent) {
      jobs.push(loadChats().catch(() => {}));
      jobs.push(agent.projects().then((ps) => { S.checkouts = (ps ?? []).filter((c) => !c.builtIn && c.id !== 'drive'); }).catch(() => {}));
      jobs.push(agent.settings().then((s) => { S.provider = s?.defaultProvider ?? null; }).catch(() => {}));
      jobs.push(agent.folders().then((f) => { S.agentFolders = Array.isArray(f) ? f : (f?.folders ?? []); }).catch(() => {}));
    }
    await Promise.all(jobs);
    S.loaded = true;
    S.order = null;
    paint();
  };

  const boot = (marble) => {
    M = marble;
    marble.pageOnly('contenteditable', 'spellcheck', 'tabindex', 'role');
    window.marbleProjects = { redraw: () => { S.order = null; paint(); }, state: S };
    paint();
    const start = () => {
      load();
      const agent = M.agent;
      if (agent) {
        agent.on('*', (summary) => {
          if (!summary?.id || summary.kind) return;
          if (summary.removed) S.chats.delete(summary.id);
          else S.chats.set(summary.id, summary);
          schedule(400);
        });
        addEventListener('marble:agent-reopened', () => loadChats().then(() => schedule()).catch(() => {}));
      }
      let treeTimer = 0;
      M.drive?.on?.('*', () => { clearTimeout(treeTimer); treeTimer = setTimeout(() => loadTree().then(() => schedule()).catch(() => {}), 800); });
    };
    if (marble.agent || !document.querySelector('script[src*="agent.js"]')) start();
    else addEventListener('marble:agent', start, { once: true });
    // The file changed underneath (another tab, an agent, the morning run).
    document.addEventListener('marble:ops', () => schedule(60));
    marble.register?.(() => schedule(60));
    // Ages move on even when nothing else does.
    setInterval(() => { if (!document.hidden) schedule(0); }, 60_000);
  };

  if (window.marble) boot(window.marble);
  else addEventListener('marble:ready', (event) => boot(event.detail), { once: true });
})();
