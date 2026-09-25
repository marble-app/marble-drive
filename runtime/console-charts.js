// The Console's charts: plain SVG, drawn from the dashboard's data
// (docs/superpowers/specs/2026-09-25-console-dashboard-design.md).
//
// Each chart is a function (el, data, opts) that fills `el`, sized to its
// width, with a hover layer: one tooltip for the page, in the top layer (every
// card is its own stacking context). Colours are CSS tokens (runtime/
// console.css: --st-*, --s1..--s8, --heat-*, --prod-*), so dark mode is the
// stylesheet's business. One axis per chart, always.

(() => {
  if (window.marbleConsoleCharts) return;
  const NS = 'http://www.w3.org/2000/svg';
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  function s(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
    for (const kid of kids.flat()) if (kid) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }

  // ---------------------------------------------------------------- tooltip

  let tip = null;
  function tipEl() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'cx-tip';
    tip.setAttribute('popover', 'manual');
    tip.setAttribute('data-marble-transient', '');
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
    return tip;
  }
  /** Show lines of text near a point: [title, ...[label, value] | string]. */
  function showTip(x, y, lines) {
    const t = tipEl();
    t.replaceChildren();
    for (const [i, line] of lines.entries()) {
      const row = document.createElement('div');
      if (i === 0) {
        row.className = 'tip-title';
        row.textContent = line;
      } else if (Array.isArray(line)) {
        row.className = 'tip-row';
        const sw = document.createElement('i');
        if (line[2]) sw.style.background = line[2];
        else sw.hidden = true;
        const a = document.createElement('span');
        a.textContent = line[0];
        const b = document.createElement('b');
        b.textContent = line[1];
        row.append(sw, a, b);
      } else {
        row.className = 'tip-note';
        row.textContent = line;
      }
      t.append(row);
    }
    if (!t.matches(':popover-open')) t.showPopover();
    const w = t.offsetWidth;
    const hgt = t.offsetHeight;
    const left = Math.min(innerWidth - w - 8, Math.max(8, x + 14));
    const top = y + 16 + hgt > innerHeight - 8 ? Math.max(8, y - hgt - 12) : y + 16;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  }
  function hideTip() {
    if (tip?.matches(':popover-open')) tip.hidePopover();
  }
  addEventListener('scroll', hideTip, true);

  /** Hover and touch on an SVG, answered by `find(x, y)` → lines or null. */
  function hover(svg, find) {
    const at = (e) => {
      // In the chart's own units, should the page have scaled it.
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const kx = vb?.width ? vb.width / r.width : 1;
      const ky = vb?.height ? vb.height / r.height : 1;
      const lines = find((e.clientX - r.left) * kx, (e.clientY - r.top) * ky);
      if (lines) showTip(e.clientX, e.clientY, lines);
      else hideTip();
    };
    svg.addEventListener('pointermove', at);
    svg.addEventListener('pointerdown', at);
    svg.addEventListener('pointerleave', hideTip);
  }

  // ----------------------------------------------------------------- format

  const money = (n) => {
    if (!Number.isFinite(n)) return '—';
    if (n > 0 && n < 0.01) return '<$0.01';
    return `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;
  };
  const hours = (h) => {
    if (!Number.isFinite(h) || h <= 0) return '0m';
    if (h < 1) return `${Math.round(h * 60)}m`;
    return h < 10 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h)}h`;
  };
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const when = (t) => {
    const d = new Date(t);
    const today = new Date();
    return d.toDateString() === today.toDateString() ? time(t) : `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time(t)}`;
  };
  const dayLabel = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

  /** Time ticks for a range, thinned so labels `px` wide never touch. */
  function ticks(from, to, px = Infinity, labelPx = 58) {
    const all = allTicks(from, to);
    const fit = Math.max(2, Math.floor(px / labelPx));
    if (all.length <= fit) return all;
    const every = Math.ceil(all.length / fit);
    return all.filter((_, i) => i % every === 0);
  }
  function allTicks(from, to) {
    const span = to - from;
    const out = [];
    if (span <= 1.5 * DAY) {
      const step = span <= 12 * HOUR ? 2 * HOUR : 4 * HOUR;
      const d = new Date(from);
      d.setMinutes(0, 0, 0);
      let t = d.getTime();
      while (t < from || new Date(t).getHours() % (step / HOUR)) t += HOUR;
      for (; t <= to; t += step) out.push({ t, label: new Date(t).toLocaleTimeString([], { hour: 'numeric' }) });
      return out;
    }
    const everyDays = span <= 8 * DAY ? 1 : span <= 16 * DAY ? 2 : 5;
    const d = new Date(from);
    d.setHours(24, 0, 0, 0);
    let i = 0;
    for (let t = d.getTime(); t <= to; t = new Date(new Date(t).setDate(new Date(t).getDate() + 1)).getTime(), i += 1) {
      if (i % everyDays) continue;
      out.push({ t, label: everyDays === 1 ? new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' }) : dayLabel(t) });
    }
    return out;
  }

  /** Run `fn` once `el` has a width: a chart drawn into a hidden box would
   *  guess, and a guess wider than a phone pushes the page sideways. */
  function whenSized(el, fn) {
    if (el.isConnected && el.clientWidth > 0) return fn();
    const ro = new ResizeObserver(() => {
      if (!el.isConnected || el.clientWidth <= 0) return;
      ro.disconnect();
      fn();
    });
    ro.observe(el);
    return undefined;
  }

  /** The width a chart can draw in: the box inside its padding. */
  const widthOf = (el, floor = 260) => {
    const cs = getComputedStyle(el);
    const inner = (el.clientWidth || el.getBoundingClientRect().width || floor) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return Math.max(floor, Math.floor(inner));
  };
  const empty = (el, text) => {
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = text;
    el.replaceChildren(p);
  };

  // ---------------------------------------------------------------- charts

  const STATE_LABEL = { running: 'Running', warm: 'Warm (paused)', cold: 'Cold (stopped)', unknown: 'Not known' };

  /**
   * State over time: one lane per sprite, segments coloured by state.
   * data: { from, to, lanes: [{ name, label, sub, color, segments }] }
   */
  function timeline(el, data, { onPick, compact = false } = {}) {
    const lanes = data.lanes ?? [];
    if (!lanes.length) return empty(el, 'No drives yet.');
    const W = widthOf(el);
    const labelW = compact ? 0 : Math.min(128, Math.max(86, W * 0.18));
    const laneH = compact ? 18 : 22;
    const gap = compact ? 0 : 10;
    const axisH = compact ? 16 : 22;
    const H = lanes.length * (laneH + gap) - gap + axisH + 4;
    const x0 = labelW;
    const x1 = W - 2;
    const x = (t) => x0 + ((t - data.from) / (data.to - data.from)) * (x1 - x0);
    const svg = s('svg', { class: 'chart timeline', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'State of each drive over time' });
    const defs = s('defs', {}, s('pattern', { id: `hatch-${el.dataset.chart ?? 'tl'}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 6, height: 6, class: 'st-unknown-bg' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'st-hatch' })));
    svg.append(defs);
    const hatch = `url(#hatch-${el.dataset.chart ?? 'tl'})`;
    const grid = s('g', { class: 'grid' });
    for (const tk of ticks(data.from, data.to, x1 - x0)) {
      grid.append(s('line', { x1: x(tk.t), x2: x(tk.t), y1: 0, y2: H - axisH, class: 'tick' }));
      grid.append(s('text', { x: x(tk.t), y: H - 6, class: 'axis', 'text-anchor': 'middle' }, tk.label));
    }
    svg.append(grid);
    const hits = [];
    lanes.forEach((lane, i) => {
      const y = i * (laneH + gap);
      if (!compact) {
        const g = s('g', { class: 'lane-label', 'data-name': lane.name, style: onPick ? 'cursor:pointer' : null });
        g.append(s('circle', { cx: 5, cy: y + laneH / 2, r: 4, style: `fill:${lane.color}` }));
        g.append(s('text', { x: 15, y: y + laneH / 2 + 4, class: 'lane-name' }, lane.label));
        if (onPick) g.addEventListener('click', () => onPick(lane.name));
        svg.append(g);
      }
      svg.append(s('rect', { x: x0, y, width: x1 - x0, height: laneH, rx: 4, class: 'lane-bg' }));
      for (const seg of lane.segments ?? []) {
        const a = Math.max(x0, x(seg.from));
        const b = Math.min(x1, x(seg.to));
        if (b - a < 0.3) continue;
        const r = s('rect', {
          x: a,
          y,
          width: Math.max(0.6, b - a),
          height: laneH,
          class: `seg st-${seg.state}${seg.coldEdge ? ' cold-edge' : ''}`,
          style: seg.state === 'unknown' ? `fill:${hatch}` : null,
        });
        svg.append(r);
        hits.push({ a, b, y, h: laneH, seg, lane });
      }
    });
    const nowX = x(Math.min(data.to, Date.now()));
    svg.append(s('line', { x1: nowX, x2: nowX, y1: -2, y2: H - axisH, class: 'now' }));
    hover(svg, (px, py) => {
      const hit = hits.find((h) => px >= h.a - 1 && px <= h.b + 1 && py >= h.y - gap / 2 && py <= h.y + h.h + gap / 2);
      if (!hit) return null;
      const { seg, lane } = hit;
      const lines = [`${lane.label} · ${STATE_LABEL[seg.state]}`, ['From', when(seg.from)], ['To', seg.to >= data.to - 60_000 ? 'now' : when(seg.to)], ['For', hours((seg.to - seg.from) / HOUR)]];
      if (seg.state === 'running' && seg.cost !== undefined) {
        lines.push(['Cost', money(seg.cost)]);
        if (seg.peakMem) lines.push(['Peak memory', `${seg.peakMem.toFixed(1)} GB`]);
        const why = Object.entries(seg.why ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
        if (why) lines.push(['Mostly', WHY_LABEL[why[0]]]);
      }
      if (seg.coldEdge) lines.push('It stopped some time in this gap; when is not known.');
      if (seg.source === 'observed' && seg.state === 'running') lines.push('Seen by the Console; no ledger for this stretch.');
      return lines;
    });
    el.replaceChildren(svg);
  }

  const WHY_LABEL = { looking: 'Someone looking', idle: 'A tab open, nobody looking', work: 'An agent working', asks: 'Waiting on a question', other: 'Nothing of ours', unrecorded: 'Not recorded (no ledger yet)' };
  const WHY_ORDER = ['looking', 'idle', 'work', 'asks', 'other', 'unrecorded'];

  /** Horizontal bars, one per row, sorted by value; `parts` shown on hover. */
  function hbars(el, { rows, format = money, unit = '' }) {
    const list = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    if (!list.length) return empty(el, 'Nothing spent in this range yet.');
    const W = widthOf(el);
    const labelW = Math.min(118, W * 0.28);
    const valueW = 64;
    const barH = 16;
    const gap = 12;
    const H = list.length * (barH + gap) - gap + 4;
    const max = list[0].value;
    const svg = s('svg', { class: 'chart hbars', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cost by drive' });
    const hits = [];
    list.forEach((row, i) => {
      const y = i * (barH + gap);
      const w = Math.max(2, ((W - labelW - valueW) * row.value) / max);
      svg.append(s('text', { x: 0, y: y + barH - 3, class: 'label' }, row.label));
      svg.append(s('path', { d: roundedRight(labelW, y, w, barH, 4), style: `fill:${row.color}` }));
      svg.append(s('text', { x: labelW + w + 6, y: y + barH - 3, class: 'value' }, `${format(row.value)}${unit}`));
      hits.push({ y, row });
    });
    hover(svg, (px, py) => {
      const hit = hits.find((h) => py >= h.y - gap / 2 && py <= h.y + barH + gap / 2);
      if (!hit) return null;
      return [hit.row.label, ...(hit.row.parts ?? []).map((p) => [p.label, format(p.value), p.color]), ['Total', format(hit.row.value)], ...(hit.row.note ? [hit.row.note] : [])];
    });
    el.replaceChildren(svg);
  }

  function roundedRight(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  }
  function roundedTop(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function yAxis(svg, { x0, x1, y, max, format, steps = 4 }) {
    for (let i = 0; i <= steps; i += 1) {
      const v = (max * i) / steps;
      const yy = y(v);
      svg.append(s('line', { x1: x0, x2: x1, y1: yy, y2: yy, class: i ? 'gridline' : 'baseline' }));
      svg.append(s('text', { x: x0 - 6, y: yy + 4, class: 'axis', 'text-anchor': 'end' }, format(v)));
    }
  }

  /**
   * Spend this month: the cumulative line, the projection dashed to the month's
   * end with its band, the budget as a rule, pasted bills as dots.
   * data: { from, to, points: [{t, v}], projection: {end, low, high}, now, budget, bills: [{t, v, label}] }
   */
  function cumulative(el, data) {
    const W = widthOf(el);
    const H = 210;
    const padL = 48;
    const padB = 22;
    const padT = 10;
    const top = Math.max(data.projection?.high ?? 0, data.budget ?? 0, ...(data.points ?? []).map((p) => p.v), ...(data.bills ?? []).map((b) => b.v), 0.01);
    const max = niceMax(top * 1.05);
    const x = (t) => padL + ((t - data.from) / (data.to - data.from)) * (W - padL - 8);
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const svg = s('svg', { class: 'chart cumulative', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Spend this month' });
    yAxis(svg, { x0: padL, x1: W - 8, y, max, format: (v) => `$${v >= 10 ? Math.round(v) : v.toFixed(v < 1 ? 2 : 1)}` });
    for (const tk of ticks(data.from, data.to, W - padL)) svg.append(s('text', { x: x(tk.t), y: H - 5, class: 'axis', 'text-anchor': 'middle' }, tk.label));
    const pts = [{ t: data.from, v: 0 }, ...(data.points ?? [])];
    const last = { t: data.now, v: data.spent ?? pts.at(-1).v };
    if (data.projection && data.to > data.now) {
      svg.append(s('path', { class: 'band', d: `M${x(last.t)},${y(last.v)}L${x(data.to)},${y(data.projection.high)}L${x(data.to)},${y(data.projection.low)}Z` }));
      svg.append(s('line', { class: 'projection', x1: x(last.t), y1: y(last.v), x2: x(data.to), y2: y(data.projection.end) }));
      svg.append(s('text', { class: 'end-label', x: x(data.to) - 4, y: y(data.projection.end) - 8, 'text-anchor': 'end' }, `${money(data.projection.end)} by the end`));
    }
    if (data.budget) {
      svg.append(s('line', { class: 'budget', x1: padL, x2: W - 8, y1: y(data.budget), y2: y(data.budget) }));
      svg.append(s('text', { class: 'budget-label', x: padL + 4, y: y(data.budget) - 5 }, `Budget ${money(data.budget)}`));
    }
    svg.append(s('path', { class: 'spend', d: [...pts, last].map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('') }));
    svg.append(s('circle', { class: 'spend-now', cx: x(last.t), cy: y(last.v), r: 4 }));
    for (const b of data.bills ?? []) {
      if (b.t < data.from || b.t > data.to) continue;
      svg.append(s('circle', { class: 'bill-dot', cx: x(b.t), cy: y(b.v), r: 5 }));
    }
    hover(svg, (px) => {
      const t = data.from + ((px - padL) / (W - padL - 8)) * (data.to - data.from);
      if (t > data.now && data.projection) {
        const f = (t - data.now) / (data.to - data.now);
        return ['Projected', ['By then', money(last.v + f * (data.projection.end - last.v))], ['Month end', money(data.projection.end)], ['Range', `${money(data.projection.low)} – ${money(data.projection.high)}`], ...(data.budget ? [['Budget', money(data.budget)]] : [])];
      }
      const p = [...pts, last].filter((q) => q.t <= t).at(-1) ?? pts[0];
      const bill = (data.bills ?? []).find((b) => Math.abs(x(b.t) - px) < 8);
      return [dayLabel(p.t), ['Spent by then', money(p.v)], ...(bill ? [['Billed', money(bill.v)], bill.label] : [])];
    });
    el.replaceChildren(svg);
  }

  /** Stacked columns, one per day. data: { days: [{t, label, parts:[{name,label,color,value}]}] } */
  function columns(el, { days, format = money }) {
    if (!days.length || !days.some((d) => d.parts.some((p) => p.value > 0))) return empty(el, 'Nothing spent this month yet.');
    const W = widthOf(el);
    const H = 190;
    const padL = 44;
    const padB = 22;
    const padT = 8;
    const max = niceMax(Math.max(...days.map((d) => d.parts.reduce((a, p) => a + p.value, 0))));
    const slot = (W - padL - 4) / days.length;
    const bw = Math.max(3, Math.min(28, slot * 0.7));
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const svg = s('svg', { class: 'chart columns', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Spend per day, by drive' });
    yAxis(svg, { x0: padL, x1: W - 4, y, max, format: (v) => `$${v >= 10 ? Math.round(v) : v.toFixed(v < 1 ? 2 : 1)}` });
    const every = Math.ceil(days.length / Math.max(1, Math.floor((W - padL) / 46)));
    days.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2;
      let acc = 0;
      const visible = d.parts.filter((p) => p.value > 0);
      visible.forEach((p, j) => {
        const y1 = y(acc + p.value);
        const y0 = y(acc);
        acc += p.value;
        const hgt = Math.max(0, y0 - y1 - (j < visible.length - 1 ? 2 : 0));
        if (hgt <= 0) return;
        svg.append(j === visible.length - 1 ? s('path', { d: roundedTop(cx - bw / 2, y1, bw, hgt + 0.01, 3), style: `fill:${p.color}` }) : s('rect', { x: cx - bw / 2, y: y1 + (j < visible.length - 1 ? 0 : 0), width: bw, height: hgt, style: `fill:${p.color}` }));
      });
      if (i % every === 0) svg.append(s('text', { x: cx, y: H - 5, class: 'axis', 'text-anchor': 'middle' }, d.label));
    });
    hover(svg, (px) => {
      const i = Math.floor((px - padL) / slot);
      const d = days[i];
      if (!d) return null;
      const parts = d.parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
      return [dayLabel(d.t), ...parts.map((p) => [p.label, format(p.value), p.color]), ['Total', format(parts.reduce((a, p) => a + p.value, 0))]];
    });
    el.replaceChildren(svg);
  }

  /** 100 % bars: one per row, split by part. data: { rows: [{label, color, parts: [{key, label, value}]}], colors: {key: css} } */
  function share(el, { rows, colors, labels = WHY_LABEL, order = WHY_ORDER }) {
    const list = rows.filter((r) => r.parts.reduce((a, p) => a + p.value, 0) > 0);
    if (!list.length) return empty(el, 'No awake time in this range.');
    const W = widthOf(el);
    const labelW = Math.min(118, W * 0.28);
    const barH = 16;
    const gap = 12;
    const H = list.length * (barH + gap) - gap + 4;
    const svg = s('svg', { class: 'chart share', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Why each drive was awake' });
    const hits = [];
    list.forEach((row, i) => {
      const y = i * (barH + gap);
      const sumv = row.parts.reduce((a, p) => a + p.value, 0);
      svg.append(s('text', { x: 0, y: y + barH - 3, class: 'label' }, row.label));
      let x = labelW;
      const parts = order.map((k) => row.parts.find((p) => p.key === k)).filter((p) => p && p.value > 0);
      const avail = W - labelW - 2 - 2 * (parts.length - 1);
      parts.forEach((p) => {
        const w = Math.max(1, (avail * p.value) / sumv);
        svg.append(s('rect', { x, y, width: w, height: barH, rx: 2, style: `fill:${colors[p.key]}` }));
        x += w + 2;
      });
      hits.push({ y, row, sumv, parts });
    });
    hover(svg, (px, py) => {
      const hit = hits.find((h) => py >= h.y - gap / 2 && py <= h.y + barH + gap / 2);
      if (!hit) return null;
      return [hit.row.label, ...hit.parts.map((p) => [labels[p.key], `${hours(p.value / 3600)} · ${Math.round((100 * p.value) / hit.sumv)}%`, colors[p.key]])];
    });
    el.replaceChildren(svg);
  }

  /** Hour of day × day of week, shaded by awake minutes. cells[day 0=Mon][hour] = minutes. */
  function heatmap(el, { cells, days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }) {
    const W = widthOf(el);
    const padL = 34;
    const padB = 18;
    const cw = (W - padL) / 24;
    const ch = Math.min(22, Math.max(14, cw * 0.9));
    const H = 7 * ch + padB;
    const max = Math.max(1, ...cells.flat());
    const svg = s('svg', { class: 'chart heatmap', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'When drives are awake, by hour and weekday' });
    for (let d = 0; d < 7; d += 1) {
      svg.append(s('text', { x: padL - 6, y: d * ch + ch / 2 + 4, class: 'axis', 'text-anchor': 'end' }, days[d]));
      for (let hr = 0; hr < 24; hr += 1) {
        const v = cells[d][hr];
        const level = v <= 0 ? 0 : Math.min(6, 1 + Math.floor((5.999 * v) / max));
        svg.append(s('rect', { x: padL + hr * cw + 1, y: d * ch + 1, width: Math.max(1, cw - 2), height: ch - 2, rx: 2, class: `heat heat-${level}` }));
      }
    }
    for (const hr of [0, 6, 12, 18]) svg.append(s('text', { x: padL + hr * cw + cw / 2, y: H - 4, class: 'axis', 'text-anchor': 'middle' }, new Date(2026, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' })));
    hover(svg, (px, py) => {
      const hr = Math.floor((px - padL) / cw);
      const d = Math.floor(py / ch);
      if (hr < 0 || hr > 23 || d < 0 || d > 6) return null;
      const label = `${days[d]} ${new Date(2026, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' })}`;
      return [label, ['Awake', hours(cells[d][hr] / 60)]];
    });
    el.replaceChildren(svg);
  }

  /** One line per series over time, broken where the drive was asleep. */
  function lines(el, { series, from, to, step, format, unitLabel }) {
    const all = series.flatMap((sr) => sr.points);
    if (!all.length) return empty(el, 'No awake time in this range.');
    const W = widthOf(el);
    const H = 170;
    const padL = 44;
    const padB = 22;
    const padT = 8;
    const max = niceMax(Math.max(...all.map((p) => p.v)) * 1.05);
    const x = (t) => padL + ((t - from) / (to - from)) * (W - padL - 6);
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const svg = s('svg', { class: 'chart linechart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': unitLabel });
    yAxis(svg, { x0: padL, x1: W - 6, y, max, format });
    for (const tk of ticks(from, to, W - padL)) svg.append(s('text', { x: x(tk.t), y: H - 5, class: 'axis', 'text-anchor': 'middle' }, tk.label));
    // Each bucket is an average over its whole width, so it is drawn as a
    // step across it: an hour awake in a week is a short visible run, not a
    // point, and a gap is sleep.
    for (const sr of series) {
      let d = '';
      let prev = null;
      for (const p of sr.points) {
        const a = x(p.t).toFixed(1);
        const b = Math.max(x(p.t + step), x(p.t) + 2).toFixed(1);
        const py = y(p.v).toFixed(1);
        d += prev !== null && p.t - prev <= step * 1.01 ? `L${a},${py}H${b}` : `M${a},${py}H${b}`;
        prev = p.t;
      }
      svg.append(s('path', { d, class: 'series', style: `stroke:${sr.color}` }));
    }
    const cross = s('line', { class: 'cross', y1: padT, y2: H - padB, x1: -10, x2: -10 });
    svg.append(cross);
    hover(svg, (px) => {
      const t = from + ((px - padL) / (W - padL - 6)) * (to - from);
      const b = Math.floor(t / step) * step;
      cross.setAttribute('x1', x(b + step / 2));
      cross.setAttribute('x2', x(b + step / 2));
      const rows = series.map((sr) => [sr.label, sr.points.find((p) => p.t === b), sr.color]).filter(([, p]) => p).map(([l, p, c]) => [l, format(p.v), c]);
      if (!rows.length) return [when(b), 'Asleep, all of them'];
      return [when(b), ...rows];
    });
    svg.addEventListener('pointerleave', () => {
      cross.setAttribute('x1', -10);
      cross.setAttribute('x2', -10);
    });
    el.replaceChildren(svg);
  }

  /** A row of small columns: one per day. */
  function spark(el, { values, color, max, labels, format = (v) => String(v) }) {
    const W = widthOf(el, 80);
    const H = 28;
    const n = values.length || 1;
    const slot = W / n;
    const bw = Math.max(1.5, slot * 0.66);
    const top = max || Math.max(1, ...values);
    const svg = s('svg', { class: 'chart spark', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    svg.append(s('line', { x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, class: 'baseline' }));
    values.forEach((v, i) => {
      if (!(v > 0)) return;
      const hgt = Math.max(2, (v / top) * (H - 3));
      svg.append(s('path', { d: roundedTop(i * slot + (slot - bw) / 2, H - hgt, bw, hgt, 2), style: `fill:${color}` }));
    });
    hover(svg, (px) => {
      const i = Math.floor(px / slot);
      if (i < 0 || i >= values.length) return null;
      return [labels?.[i] ?? '', ['', format(values[i])]];
    });
    el.replaceChildren(svg);
  }

  /** The same numbers as a table. rows: [[...cells]], head: [...labels]. */
  function table(head, rows) {
    const t = document.createElement('table');
    t.className = 'table chart-table';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const hcell of head) {
      const th = document.createElement('th');
      th.textContent = hcell;
      tr.append(th);
    }
    thead.append(tr);
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const r = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        r.append(td);
      }
      tbody.append(r);
    }
    t.append(thead, tbody);
    return t;
  }

  window.marbleConsoleCharts = { whenSized, timeline, hbars, cumulative, columns, share, heatmap, lines, spark, table, money, hours, when, dayLabel, hideTip, WHY_LABEL, WHY_ORDER, STATE_LABEL };
})();
