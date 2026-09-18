// Usage history charts for the agent settings Usage tab: a GitHub-style daily
// heatmap, summary tiles, weekly bars by model. The first half is pure helpers
// (Node tests import this file for its side effect); `render` below is the DOM.
// Classic IIFE so the host can inject it as a script tag.

(() => {
  const DAY_MS = 86_400_000;
  const FAMILIES = ['opus', 'sonnet', 'fable', 'haiku', 'other'];
  const FAMILY_LABEL = { opus: 'Opus', sonnet: 'Sonnet', fable: 'Fable', haiku: 'Haiku', other: 'Other' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const utc = (date) => Date.parse(`${date}T00:00:00Z`);
  const weekday = (date) => new Date(utc(date)).getUTCDay();
  const shiftDate = (date, days) => new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);

  // ------------------------------------------------------------ helpers

  const unit = (metric) => (metric === 'messages' ? 'messages' : 'tokens');

  const value = (day, { metric = 'tokens', model = 'all' } = {}) => {
    if (!day) return 0;
    const key = unit(metric);
    if (model === 'all') return key === 'tokens' ? day.tokens ?? 0 : day.messages ?? 0;
    return day.byModel?.[model]?.[key] ?? 0;
  };

  // Level 0 is "nothing"; 1-4 are quartiles of the non-zero values, so the
  // scale adapts to the person's own range instead of a fixed threshold.
  const levelFn = (values) => {
    const live = values.filter((v) => v > 0).sort((a, b) => a - b);
    const pick = (p) => live[Math.floor(p * (live.length - 1))];
    const flat = !live.length || live[0] === live.at(-1);
    const [t1, t2, t3] = flat ? [0, 0, 0] : [pick(0.25), pick(0.5), pick(0.75)];
    return (v) => {
      if (!(v > 0)) return 0;
      if (flat) return 4;
      if (v <= t1) return 1;
      if (v <= t2) return 2;
      if (v <= t3) return 3;
      return 4;
    };
  };

  const grid = (days, { minWeeks = 12 } = {}) => {
    if (!days?.length) return { weeks: [], months: [] };
    const first = days.findIndex((d) => d.messages > 0);
    const room = Math.max(0, days.length - minWeeks * 7);
    const start = first < 0 ? room : Math.min(first, room);
    const slice = days.slice(start);
    const cells = [...Array(weekday(slice[0].date)).fill(null), ...slice];
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    const months = [];
    let prev = -1;
    weeks.forEach((col, index) => {
      const cell = col.find(Boolean);
      const month = Number(cell.date.slice(5, 7)) - 1;
      if (month !== prev) months.push({ col: index, label: MONTHS[month] });
      prev = month;
    });
    // A label crowded by the next one would print on top of it.
    const spaced = months.filter((m, i) => !months[i + 1] || months[i + 1].col - m.col >= 2);
    return { weeks, months: spaced };
  };

  const summary = (days, opts = {}) => {
    const v = (days ?? []).map((d) => value(d, opts));
    const n = v.length;
    const sum = (from, to) => v.slice(Math.max(0, from), Math.max(0, to)).reduce((a, b) => a + b, 0);
    const last7 = sum(n - 7, n);
    const prev7 = sum(n - 14, n - 7);
    const first = (days ?? []).findIndex((d) => d.messages > 0);
    let best = -1;
    v.forEach((x, i) => { if (x > 0 && (best < 0 || x >= v[best])) best = i; });
    const active = v.filter((x) => x > 0).length;

    let i = n - 1;
    if (i >= 0 && v[i] === 0) i -= 1; // today has not happened yet
    let streak = 0;
    while (i >= 0 && v[i] > 0) { streak += 1; i -= 1; }
    let longest = 0;
    let run = 0;
    for (const x of v) { run = x > 0 ? run + 1 : 0; longest = Math.max(longest, run); }

    const total = v.reduce((a, b) => a + b, 0);
    return {
      last7,
      prev7,
      delta: prev7 > 0 ? (last7 - prev7) / prev7 : null,
      busiest: best < 0 ? null : { date: days[best].date, value: v[best] },
      activeDays: active,
      totalDays: first < 0 ? 0 : n - first,
      streak,
      longest,
      avgActive: active ? total / active : 0,
    };
  };

  const weekly = (days, { weeks = 12, metric = 'tokens' } = {}) => {
    const buckets = new Map();
    for (const day of days ?? []) {
      const start = shiftDate(day.date, -weekday(day.date));
      const bucket = buckets.get(start) ?? { start, total: 0, byModel: Object.fromEntries(FAMILIES.map((f) => [f, 0])) };
      for (const family of FAMILIES) {
        const x = day.byModel?.[family]?.[unit(metric)] ?? 0;
        bucket.byModel[family] += x;
        bucket.total += x;
      }
      buckets.set(start, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(-weeks);
  };

  const share = (days, { metric = 'tokens' } = {}) => {
    const sums = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
    for (const day of days ?? []) {
      for (const family of FAMILIES) sums[family] += day.byModel?.[family]?.[unit(metric)] ?? 0;
    }
    const total = FAMILIES.reduce((a, f) => a + sums[f], 0);
    if (!total) return [];
    return FAMILIES.filter((f) => sums[f] > 0).map((family) => ({ family, value: sums[family], share: sums[family] / total }));
  };

  const compact = (n) => {
    const x = Math.max(0, Number(n) || 0);
    if (x < 1000) return String(Math.round(x));
    const steps = [[1e3, 'k'], [1e6, 'M'], [1e9, 'B']];
    let i = 0;
    while (i < steps.length - 1 && Math.round((x / steps[i][0]) * 10) / 10 >= 1000) i += 1;
    const scaled = Math.round((x / steps[i][0]) * 10) / 10;
    return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}${steps[i][1]}`;
  };

  // ------------------------------------------------------------ DOM

  // Both palettes were run through the dataviz validator (2026-09-18). Light
  // aqua and yellow sit under 3:1 on the surface, so every model is also named
  // with its share in the legend, and the weekly bars have a table view.
  const CSS = `
    .uh {
      position: relative; display: flex; flex-direction: column; gap: 20px; color: var(--ink);
      --uh-opus: #2a78d6; --uh-sonnet: #eb6834; --uh-fable: #1baf7a; --uh-haiku: #eda100; --uh-other: #9a9a94;
      --uh-l1: #b7d3f6; --uh-l2: #6da7ec; --uh-l3: #2a78d6; --uh-l4: #104281;
    }
    @media (prefers-color-scheme: dark) {
      .uh:not([data-mode="light"]) {
        --uh-opus: #3987e5; --uh-sonnet: #d95926; --uh-fable: #199e70; --uh-haiku: #c98500; --uh-other: #71767a;
        --uh-l1: #184f95; --uh-l2: #256abf; --uh-l3: #3987e5; --uh-l4: #86b6ef;
      }
    }
    .uh[data-mode="dark"] {
      --uh-opus: #3987e5; --uh-sonnet: #d95926; --uh-fable: #199e70; --uh-haiku: #c98500; --uh-other: #71767a;
      --uh-l1: #184f95; --uh-l2: #256abf; --uh-l3: #3987e5; --uh-l4: #86b6ef;
    }
    .uh-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; margin: 0 0 10px; }
    .uh-head h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
    .uh-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .uh-metric, .uh-view { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px; background: var(--paper-3); }
    .uh button.uh-toggle, .uh-metric button, .uh-view button {
      appearance: none; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px;
      padding: .12rem .6rem; border-radius: 999px; cursor: pointer;
    }
    .uh-metric button[aria-pressed="true"], .uh-view button[aria-pressed="true"] { color: var(--ink); background: var(--card); box-shadow: 0 1px 3px rgba(74,66,52,.12); }
    .uh-metric button:hover, .uh-view button:hover, .uh-chip:hover { color: var(--ink); }
    .uh button:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 1px; }
    .uh-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .uh-chip {
      appearance: none; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px;
      color: var(--muted); background: none; border: 1px solid var(--line); border-radius: 999px; padding: .1rem .55rem; cursor: pointer;
    }
    .uh-chip[aria-pressed="true"] { color: var(--ink); background: var(--accent-soft); border-color: var(--accent-ink); }
    .uh-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; background: var(--uh-other); }
    [data-family="opus"] > .uh-dot, .uh-dot[data-family="opus"] { background: var(--uh-opus); }
    [data-family="sonnet"] > .uh-dot, .uh-dot[data-family="sonnet"] { background: var(--uh-sonnet); }
    [data-family="fable"] > .uh-dot, .uh-dot[data-family="fable"] { background: var(--uh-fable); }
    [data-family="haiku"] > .uh-dot, .uh-dot[data-family="haiku"] { background: var(--uh-haiku); }

    .uh-heatwrap { container-type: inline-size; }
    .uh-heat {
      --gap: 3px; --cell: clamp(9px, calc((100cqw - 34px) / var(--weeks) - var(--gap)), 22px);
      display: grid; grid-template-columns: 30px auto; grid-template-rows: auto auto; column-gap: 4px; row-gap: 4px; align-items: start;
    }
    .uh-months, .uh-grid { display: grid; grid-template-columns: repeat(var(--weeks), var(--cell)); column-gap: var(--gap); }
    .uh-months { grid-column: 2; font-size: 11px; color: var(--faint); height: 14px; }
    /* One column wide, on row 1, text overflowing rightwards: a span would overlap its
       neighbour, get auto-placed onto a hidden second row, or add implicit columns. */
    .uh-month { grid-row: 1; white-space: nowrap; overflow: visible; }
    .uh-dow { grid-row: 2; display: grid; grid-template-rows: repeat(7, var(--cell)); row-gap: var(--gap); font-size: 10.5px; color: var(--faint); text-align: right; align-items: center; }
    .uh-grid { grid-column: 2; grid-row: 2; grid-template-rows: repeat(7, var(--cell)); grid-auto-flow: column; row-gap: var(--gap); }
    .uh-cell, .uh-pad { width: var(--cell); height: var(--cell); }
    .uh-cell {
      appearance: none; border: 0; padding: 0; border-radius: 3px; cursor: default;
      background: var(--paper-3); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 7%, transparent);
    }
    .uh-cell[data-level="1"] { background: var(--uh-l1); }
    .uh-cell[data-level="2"] { background: var(--uh-l2); }
    .uh-cell[data-level="3"] { background: var(--uh-l3); }
    .uh-cell[data-level="4"] { background: var(--uh-l4); }
    .uh-cell[data-level]:not([data-level="0"]) { box-shadow: none; }
    .uh-cell[data-today] { outline: 1.5px solid color-mix(in srgb, var(--ink) 55%, transparent); outline-offset: 1px; }
    .uh-cell:hover, .uh-cell:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
    .uh-scale { display: flex; align-items: center; gap: 4px; justify-content: flex-end; margin-top: 8px; font-size: 11px; color: var(--faint); }
    .uh-scale i { width: 11px; height: 11px; border-radius: 3px; background: var(--paper-3); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 7%, transparent); }
    .uh-scale i[data-level="1"] { background: var(--uh-l1); box-shadow: none; }
    .uh-scale i[data-level="2"] { background: var(--uh-l2); box-shadow: none; }
    .uh-scale i[data-level="3"] { background: var(--uh-l3); box-shadow: none; }
    .uh-scale i[data-level="4"] { background: var(--uh-l4); box-shadow: none; }

    .uh-tip {
      position: absolute; z-index: 5; pointer-events: none; max-width: min(24rem, 100%);
      padding: 6px 10px; font-size: 12.5px; line-height: 1.35; color: var(--ink); white-space: pre-line;
      background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow-lift);
    }
    .uh-tip[hidden] { display: none; }

    .uh-top { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px 24px; align-items: start; }
    .uh-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 8px; }
    /* Wide sheet: the grid keeps a fixed cell and the tiles use the room beside it. */
    @media (min-width: 820px) {
      .uh-top { grid-template-columns: max-content minmax(0, 1fr); }
      .uh-heatwrap { container-type: normal; }
      .uh-heat { --cell: 18px; }
      .uh-tiles { grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); }
    }
    .uh-tile { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--card); min-width: 0; }
    .uh-tile-label { font-size: 11.5px; color: var(--muted); }
    .uh-tile-value { margin-top: 2px; font-size: 20px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .uh-tile-sub { margin-top: 2px; font-size: 11.5px; color: var(--faint); }

    .uh-share { display: flex; gap: 2px; height: 10px; margin: 0 0 8px; }
    .uh-share i { display: block; height: 100%; min-width: 3px; border-radius: 3px; }
    .uh-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0 0 14px; padding: 0; list-style: none; font-size: 12.5px; }
    .uh-legend li { display: inline-flex; align-items: center; gap: 6px; }
    .uh-legend b { font-weight: 500; }
    .uh-legend span { color: var(--faint); }
    .uh-bars { display: flex; align-items: flex-end; gap: 6px; height: 156px; }
    .uh-bar { flex: 1 1 0; max-width: 72px; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; height: 100%; }
    .uh-bar-total { font-size: 10.5px; color: var(--muted); text-align: center; margin-bottom: 3px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .uh-stack { display: flex; flex-direction: column-reverse; gap: 2px; }
    .uh-seg { min-height: 2px; background: var(--uh-other); }
    .uh-seg[data-family="opus"] { background: var(--uh-opus); }
    .uh-seg[data-family="sonnet"] { background: var(--uh-sonnet); }
    .uh-seg[data-family="fable"] { background: var(--uh-fable); }
    .uh-seg[data-family="haiku"] { background: var(--uh-haiku); }
    .uh-seg:last-child { border-radius: 4px 4px 0 0; }
    .uh-seg:hover { filter: brightness(1.08); }
    .uh-xs { display: flex; gap: 6px; margin-top: 5px; }
    .uh-x { flex: 1 1 0; max-width: 72px; min-width: 0; font-size: 10.5px; color: var(--faint); text-align: center; white-space: nowrap; overflow: hidden; }
    .uh-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .uh-table th, .uh-table td { padding: 4px 8px; text-align: right; border-bottom: 1px solid var(--line); }
    .uh-table th:first-child, .uh-table td:first-child { text-align: left; }
    .uh-table th { color: var(--muted); font-weight: 500; }
    .uh-foot { margin: 0; font-size: 11.5px; color: var(--faint); }
    .uh-empty { margin: 0; color: var(--faint); font-size: 13px; }
    .uh-skel { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 12px); gap: 3px; }
    .uh-skel i { width: 12px; height: 12px; border-radius: 3px; background: var(--paper-3); animation: uh-pulse 1.4s ease-in-out infinite; }
    @keyframes uh-pulse { 50% { opacity: .5; } }
    .uh-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (max-width: 560px) {
      .uh-bar-total { display: none; }
      .uh-x:nth-child(even) { visibility: hidden; }
    }
    @media (prefers-reduced-motion: reduce) { .uh-skel i { animation: none; } }
  `;

  const mk = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const dateOf = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const longDate = (date) => dateOf(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const shortDate = (date) => dateOf(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const count = (n) => Math.round(n).toLocaleString();
  const amount = (n, metric) => (metric === 'messages' ? `${count(n)} ${Math.round(n) === 1 ? 'message' : 'messages'}` : `${compact(n)} tokens`);
  const short = (n, metric) => (metric === 'messages' ? count(n) : compact(n));
  const pct = (x) => `${Math.round(x * 100)}%`;

  const familySplit = (day, metric) => {
    const parts = FAMILIES.map((family) => [family, day.byModel?.[family]?.[unit(metric)] ?? 0]).filter(([, v]) => v > 0);
    const total = parts.reduce((sum, [, v]) => sum + v, 0);
    return parts.sort((a, b) => b[1] - a[1]).map(([family, v]) => `${FAMILY_LABEL[family]} ${pct(v / total)}`);
  };

  const dayText = (day, state) => {
    const v = value(day, state);
    if (!v) return `${longDate(day.date)} · No ${state.model === 'all' ? '' : `${FAMILY_LABEL[state.model]} `}activity`;
    const bits = [longDate(day.date), amount(v, state.metric)];
    if (state.model === 'all' && state.metric === 'tokens') bits.push(`${count(day.messages)} messages`);
    // The split is its own line, so a wrap never lands inside "Fable 31%".
    const split = state.model === 'all' ? familySplit(day, state.metric) : [];
    return split.length > 1 ? `${bits.join(' · ')}\n${split.join(' · ')}` : bits.join(' · ');
  };

  const themeMode = () => {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' || theme === 'light' ? theme : '';
  };

  const legendItem = (family, text, sub) => {
    const li = mk('li');
    li.dataset.family = family;
    li.append(mk('i', 'uh-dot'), mk('b', '', text));
    if (sub) li.append(mk('span', '', sub));
    return li;
  };

  const renderLoading = (host) => {
    const skel = mk('div', 'uh-skel');
    skel.setAttribute('aria-label', 'Loading usage history');
    for (let i = 0; i < 12 * 7; i += 1) skel.append(document.createElement('i'));
    const root = mk('div', 'uh');
    root.append(skel);
    host.replaceChildren(root);
  };

  const renderMessage = (host, text) => {
    const root = mk('div', 'uh');
    root.append(mk('p', 'uh-empty', text));
    host.replaceChildren(root);
  };

  const render = (host, history, initial = {}) => {
    const days = history?.days ?? [];
    if (!days.length) return renderMessage(host, "Couldn't read usage history.");
    if (!days.some((day) => day.messages > 0)) return renderMessage(host, 'No Claude Code activity found on this Mac yet.');

    const state = { metric: initial.metric === 'messages' ? 'messages' : 'tokens', model: initial.model ?? 'all', view: 'chart' };
    const present = FAMILIES.filter((family) => days.some((day) => (day.byModel?.[family]?.messages ?? 0) > 0));
    if (!present.includes(state.model)) state.model = 'all';

    const root = mk('div', 'uh');
    const applyMode = () => {
      const mode = themeMode();
      if (mode) root.dataset.mode = mode;
      else root.removeAttribute('data-mode');
    };
    applyMode();
    const observer = new MutationObserver(() => (root.isConnected ? applyMode() : observer.disconnect()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const tip = mk('div', 'uh-tip');
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');
    const showTip = (el) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = root.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const left = Math.max(0, Math.min(b.left - r.left + b.width / 2 - t.width / 2, r.width - t.width));
      let top = b.top - r.top - t.height - 6;
      if (top < 0) top = b.bottom - r.top + 6;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    };
    root.addEventListener('pointerover', (event) => {
      const el = event.target.closest?.('[data-tip]');
      if (el) showTip(el);
      else tip.hidden = true;
    });
    root.addEventListener('pointerleave', () => { tip.hidden = true; });
    root.addEventListener('focusin', (event) => {
      const el = event.target.closest?.('[data-tip]');
      if (el) showTip(el);
    });
    root.addEventListener('focusout', () => { tip.hidden = true; });

    // ---- activity heatmap
    const heatSection = mk('section');
    const heatHead = mk('div', 'uh-head');
    heatHead.append(mk('h3', '', 'Activity'));
    const controls = mk('div', 'uh-controls');
    const metric = mk('div', 'uh-metric');
    metric.setAttribute('role', 'group');
    metric.setAttribute('aria-label', 'Measure');
    const metricButtons = [['tokens', 'Tokens'], ['messages', 'Messages']].map(([key, label]) => {
      const b = mk('button', '', label);
      b.type = 'button';
      b.dataset.metric = key;
      return b;
    });
    metric.append(...metricButtons);
    const chips = mk('div', 'uh-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Model');
    const chipButtons = ['all', ...present].map((family) => {
      const b = mk('button', 'uh-chip');
      b.type = 'button';
      b.dataset.model = family;
      if (family !== 'all') {
        b.dataset.family = family;
        b.append(mk('i', 'uh-dot'));
      }
      b.append(document.createTextNode(family === 'all' ? 'All' : FAMILY_LABEL[family]));
      return b;
    });
    chips.append(...chipButtons);
    controls.append(chips, metric);
    heatHead.append(controls);

    const wrap = mk('div', 'uh-heatwrap');
    const heat = mk('div', 'uh-heat');
    wrap.append(heat);
    const scale = mk('div', 'uh-scale');
    scale.append(document.createTextNode('Less'));
    for (let level = 0; level <= 4; level += 1) {
      const swatch = document.createElement('i');
      swatch.dataset.level = String(level);
      scale.append(swatch);
    }
    scale.append(document.createTextNode('More'));
    const table = mk('table', 'uh-sr');
    const heatBlock = mk('div', 'uh-heatblock');
    heatBlock.append(wrap, scale);
    const tiles = mk('section', 'uh-tiles');
    const top = mk('div', 'uh-top');
    top.append(heatBlock, tiles);
    heatSection.append(heatHead, top, table);

    const paintHeat = () => {
      const { weeks, months } = grid(days);
      const level = levelFn(days.map((day) => value(day, state)));
      heat.replaceChildren();
      heat.style.setProperty('--weeks', String(weeks.length));
      const monthRow = mk('div', 'uh-months');
      for (const m of months) {
        const label = mk('span', 'uh-month', m.label);
        label.style.gridColumn = String(m.col + 1);
        monthRow.append(label);
      }
      const dow = mk('div', 'uh-dow');
      dow.setAttribute('aria-hidden', 'true');
      for (const name of ['', 'Mon', '', 'Wed', '', 'Fri', '']) dow.append(mk('span', '', name));
      const cellsEl = mk('div', 'uh-grid');
      cellsEl.setAttribute('role', 'group');
      cellsEl.setAttribute('aria-label', 'Daily activity');
      const cells = [];
      for (const col of weeks) {
        for (const day of col) {
          if (!day) {
            cellsEl.append(mk('span', 'uh-pad'));
            continue;
          }
          const cell = mk('button', 'uh-cell');
          cell.type = 'button';
          cell.tabIndex = -1;
          cell.dataset.date = day.date;
          cell.dataset.level = String(level(value(day, state)));
          const text = dayText(day, state);
          cell.dataset.tip = text;
          cell.setAttribute('aria-label', text.replace('\n', ' · '));
          if (day.date === history.to) cell.dataset.today = '';
          cells.push(cell);
          cellsEl.append(cell);
        }
      }
      if (cells.length) cells.at(-1).tabIndex = 0;
      // One tab stop for the whole grid; arrows move by day (up/down) and week (left/right).
      cellsEl.addEventListener('keydown', (event) => {
        const at = cells.indexOf(document.activeElement) >= 0 ? cells.indexOf(document.activeElement) : cells.indexOf(event.target);
        const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
        let next = at;
        if (step) next = Math.max(0, Math.min(cells.length - 1, at + step));
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = cells.length - 1;
        else return;
        event.preventDefault();
        cells[at].tabIndex = -1;
        cells[next].tabIndex = 0;
        cells[next].focus();
      });
      heat.append(monthRow, dow, cellsEl);

      table.replaceChildren();
      table.append(mk('caption', '', 'Daily Claude Code usage'));
      const head = mk('tr');
      for (const name of ['Date', 'Messages', 'Tokens']) head.append(mk('th', '', name));
      table.append(head);
      for (const day of days.filter((d) => d.messages > 0)) {
        const row = mk('tr');
        row.append(mk('td', '', day.date), mk('td', '', String(day.messages)), mk('td', '', String(day.tokens)));
        table.append(row);
      }
    };

    // ---- summary tiles
    const paintTiles = () => {
      const s = summary(days, state);
      const total = days.reduce((sum, day) => sum + value(day, state), 0);
      const tile = (label, big, sub) => {
        const el = mk('div', 'uh-tile');
        el.append(mk('div', 'uh-tile-label', label), mk('div', 'uh-tile-value', big), mk('div', 'uh-tile-sub', sub));
        return el;
      };
      const delta = s.delta == null
        ? 'Nothing the 7 days before'
        : `${s.delta >= 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(s.delta * 100))}% vs the 7 days before`;
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      tiles.replaceChildren(
        tile('Last 7 days', short(s.last7, state.metric), delta),
        tile('Busiest day', s.busiest ? short(s.busiest.value, state.metric) : '—', s.busiest ? shortDate(s.busiest.date) : 'No activity'),
        tile('Active days', `${s.activeDays} of ${s.totalDays}`, 'days with any usage'),
        tile('Current streak', plural(s.streak, 'day'), `Longest ${plural(s.longest, 'day')}`),
        tile('Daily average', short(s.avgActive, state.metric), 'on active days'),
        tile('Total', short(total, state.metric), state.metric === 'messages' ? 'messages' : 'tokens'),
      );
    };

    // ---- models: share strip + weekly bars (always all models)
    const modelSection = mk('section');
    const modelHead = mk('div', 'uh-head');
    modelHead.append(mk('h3', '', 'By model'));
    const view = mk('div', 'uh-view');
    view.setAttribute('role', 'group');
    view.setAttribute('aria-label', 'Weekly view');
    const viewButtons = [['chart', 'Chart'], ['table', 'Table']].map(([key, label]) => {
      const b = mk('button', '', label);
      b.type = 'button';
      b.dataset.view = key;
      return b;
    });
    view.append(...viewButtons);
    modelHead.append(view);
    const shareEl = mk('div', 'uh-share');
    shareEl.setAttribute('aria-hidden', 'true');
    const legend = mk('ul', 'uh-legend');
    const weeklyEl = mk('div', 'uh-weekly');
    modelSection.append(modelHead, shareEl, legend, weeklyEl);

    const paintModels = () => {
      const parts = share(days, state);
      shareEl.replaceChildren(...parts.map((part) => {
        const seg = document.createElement('i');
        seg.style.flex = `${part.share} 1 0`;
        seg.style.background = `var(--uh-${part.family})`;
        return seg;
      }));
      legend.replaceChildren(...parts.map((part) => legendItem(part.family, `${FAMILY_LABEL[part.family]} ${pct(part.share)}`, short(part.value, state.metric))));

      // Weeks before the first activity are not history, just empty axis.
      const all = weekly(days, { weeks: 12, metric: state.metric });
      const weeks = all.slice(Math.max(0, all.findIndex((week) => week.total > 0)));
      weeklyEl.replaceChildren();
      if (state.view === 'table') {
        const t = mk('table', 'uh-table');
        const head = mk('tr');
        head.append(mk('th', '', 'Week of'));
        for (const family of present) head.append(mk('th', '', FAMILY_LABEL[family]));
        head.append(mk('th', '', 'Total'));
        const thead = mk('thead');
        thead.append(head);
        const tbody = mk('tbody');
        for (const week of weeks) {
          const row = mk('tr');
          row.append(mk('td', '', shortDate(week.start)));
          for (const family of present) row.append(mk('td', '', short(week.byModel[family], state.metric)));
          row.append(mk('td', '', short(week.total, state.metric)));
          tbody.append(row);
        }
        t.append(thead, tbody);
        weeklyEl.append(t);
        return;
      }
      const max = Math.max(1, ...weeks.map((week) => week.total));
      const bars = mk('div', 'uh-bars');
      bars.setAttribute('role', 'group');
      bars.setAttribute('aria-label', 'Weekly usage by model');
      const xs = mk('div', 'uh-xs');
      for (const week of weeks) {
        const bar = mk('div', 'uh-bar');
        bar.append(mk('div', 'uh-bar-total', short(week.total, state.metric)));
        const stack = mk('div', 'uh-stack');
        stack.style.height = `${Math.max(2, Math.round((week.total / max) * 118))}px`;
        for (const family of FAMILIES) {
          const v = week.byModel[family];
          if (!v) continue;
          const seg = mk('div', 'uh-seg');
          seg.dataset.family = family;
          seg.style.flex = `${v} 1 0`;
          seg.dataset.tip = `Week of ${shortDate(week.start)} · ${FAMILY_LABEL[family]} ${amount(v, state.metric)} (${pct(v / week.total)})`;
          stack.append(seg);
        }
        bar.append(stack);
        bars.append(bar);
        xs.append(mk('div', 'uh-x', shortDate(week.start)));
      }
      weeklyEl.append(bars, xs);
    };

    const foot = mk('p', 'uh-foot', `Claude Code on this Mac · days in ${history.tz ?? 'local time'} · cache reads are not counted in tokens`);

    const paintControls = () => {
      for (const b of metricButtons) b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric));
      for (const b of chipButtons) b.setAttribute('aria-pressed', String(b.dataset.model === state.model));
      for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    };
    const paint = () => { paintControls(); paintHeat(); paintTiles(); paintModels(); };
    metric.addEventListener('click', (event) => {
      const b = event.target.closest?.('[data-metric]');
      if (b) { state.metric = b.dataset.metric; paint(); }
    });
    chips.addEventListener('click', (event) => {
      const b = event.target.closest?.('[data-model]');
      if (b) { state.model = b.dataset.model; paint(); }
    });
    view.addEventListener('click', (event) => {
      const b = event.target.closest?.('[data-view]');
      if (b) { state.view = b.dataset.view; paint(); }
    });

    root.append(heatSection, modelSection, foot, tip);
    host.replaceChildren(root);
    paint();
  };

  globalThis.marbleUsageCharts = {
    FAMILIES, FAMILY_LABEL, value, levelFn, grid, summary, weekly, share, compact, CSS, render, renderLoading, renderMessage,
  };
})();
