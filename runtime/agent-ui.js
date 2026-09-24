// The agent drawer and the conversation view it shows.
//
// Both are custom elements with open shadow roots: no document's stylesheet
// reaches in, and nothing in here reaches out, which is what lets the same
// drawer sit on top of a slide deck, a spreadsheet and the Drive itself. The
// chrome still copies the page's palette so it matches what you are looking
// at. Both are transient — nothing they draw is ever the document — and the
// file on disk only changes when an agent edits it.
//
// Agent text is shown, never interpreted: renderText builds nodes from a small
// safe subset of Markdown with textContent, and only http(s) links become links.

(() => {
  if (customElements.get('marble-conversation')) return;

  // ------------------------------------------------------------------ tokens

  // Drive UIST warm / Dusk stay as fallbacks. When the open document names a
  // palette (--paper, --ink, … on :root) or paints the body, the chrome copies
  // those colors so a conversation on a white starter or a custom theme matches
  // the page it is sitting on — not a second, Drive-only sheet. Colors only:
  // the type is the design system's own UI stack on every page (see
  // applyPageTheme).
  const TOKENS = `
    :host {
      --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #ddd9cf;
      /* Read, not glanced at: the faint tone the chrome uses for marks does
         not clear 4.5:1, and a placeholder is body text until you type. */
      --placeholder: #767676;
      --paper: #fafaf7; --paper-2: #f3f1ea; --paper-3: #eceae1; --card: #ffffff;
      --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
      --danger: #b4533e; --caution: #a07a2c;
      --shadow-lift: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12);
      /* Lift is for a thing held above the page — a menu, a peek. Rest is for
         a thing lying on it: the composer's card is a millimetre off the
         paper, not a floor above it. */
      --shadow-rest: 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08);
      --settle: cubic-bezier(.22, 1, .36, 1); --snap: cubic-bezier(.4, 0, .2, 1);
      --radius: 12px;
      font: 14px/1.5 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      .scrub {
        --e-low: #8b9096; --e-medium: #7d9dc4; --e-high: #5d9bf0;
        --e-xhigh: #8a7ff0; --e-max: #c07ff0;
      }
      :host {
        --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #2f3438;
        --placeholder: #8d9296;
        --paper: #16181a; --paper-2: #1e2124; --paper-3: #262a2e; --card: #1c1f22;
        --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
        --danger: #e08a74; --caution: #d9b25e;
        --shadow-lift: 0 6px 16px rgba(0,0,0,.45), 0 18px 36px rgba(0,0,0,.35);
        --shadow-rest: 0 1px 2px rgba(0,0,0,.40), 0 8px 20px rgba(0,0,0,.28);
      }
    }
  `;

  const PAGE_TOKEN_NAMES = [
    'ink', 'muted', 'faint', 'line', 'paper', 'paper-2', 'paper-3', 'card',
    'accent', 'accent-soft', 'accent-ink', 'danger', 'caution', 'radius',
  ];

  function parseRgb(color) {
    if (!color) return null;
    const s = String(color).trim();
    const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (rgba) {
      let alpha = rgba[4] === undefined ? 1 : String(rgba[4]).endsWith('%') ? Number.parseFloat(rgba[4]) / 100 : Number(rgba[4]);
      if (alpha > 1) alpha /= 255;
      if (alpha < 0.08) return null;
      return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    }
    const hex = s.match(/^#([0-9a-f]{3,8})$/i);
    if (!hex) return null;
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    if (alpha < 0.08) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function mixRgb(a, b, t) {
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  }

  function pageTheme(rootStyle, bodyStyle) {
    const theme = {};
    for (const name of PAGE_TOKEN_NAMES) {
      const value = (rootStyle.getPropertyValue?.(`--${name}`) || '').trim();
      if (value) theme[name] = value;
    }
    if (!theme.paper) {
      const bg = parseRgb(bodyStyle.backgroundColor) || parseRgb(rootStyle.backgroundColor);
      if (bg) theme.paper = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
    }
    if (!theme.ink && theme.paper) {
      const fg = parseRgb(bodyStyle.color);
      if (fg) theme.ink = `rgb(${fg[0]}, ${fg[1]}, ${fg[2]})`;
    }
    const paper = parseRgb(theme.paper);
    const ink = parseRgb(theme.ink);
    if (paper && ink) {
      if (!theme['paper-2']) theme['paper-2'] = mixRgb(paper, ink, 0.06);
      if (!theme['paper-3']) theme['paper-3'] = mixRgb(paper, ink, 0.11);
      if (!theme.card) theme.card = mixRgb(paper, ink, 0.035);
      if (!theme.line) theme.line = mixRgb(paper, ink, 0.16);
      if (!theme.muted) theme.muted = mixRgb(ink, paper, 0.38);
      if (!theme.faint) theme.faint = mixRgb(ink, paper, 0.58);
    }
    const accent = parseRgb(theme['accent-ink'] || theme.accent);
    if (paper && accent && !theme['accent-soft']) theme['accent-soft'] = mixRgb(paper, accent, 0.14);
    if (ink && !theme['shadow-lift']) {
      theme['shadow-lift'] = `0 4px 10px rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, .12), 0 14px 28px rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, .16)`;
    }
    return theme;
  }

  function applyPageTheme(el, theme) {
    const next = theme || pageTheme(getComputedStyle(document.documentElement), getComputedStyle(document.body));
    for (const [name, value] of Object.entries(next)) el.style.setProperty(`--${name}`, value);
    // Colour is the page's, type is not. A document picks its body face to be
    // read in — Avenir, a serif, whatever it was written in — and the chrome is
    // not the document: a log, a composer and a row of buttons set in the
    // page's reading face stop being the same piece of furniture from one
    // document to the next. The chrome keeps the design system's UI stack. A
    // page that really means to restyle it can still say so by declaring
    // --ui-font, which this no longer overwrites.
    el.style.removeProperty('--ui-font');
  }

  function watchPageTheme(el) {
    // A visual is a frame, so the palette does not cascade into it: a page that
    // changes colour has to be told to it. Nothing reloads — the frame swaps
    // one stylesheet.
    const paint = () => {
      applyPageTheme(el);
      el.repaintVisuals?.();
    };
    paint();
    const mo = new MutationObserver(paint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    addEventListener('marble:ready', paint);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', paint);
    return () => {
      mo.disconnect();
      removeEventListener('marble:ready', paint);
      mq.removeEventListener?.('change', paint);
    };
  }

  // ------------------------------------------------------------ safe text

  const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;

  /** Inline marks, and — when a `chip` hook is given — the `[image n]` /
   *  `[pasted text n]` tokens a sent message carries, as the chips they name. */
  function inline(parent, text, chip = null) {
    if (!chip) {
      inlineMarks(parent, text);
      return;
    }
    let last = 0;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
      const node = chip(m[1], Number(m[2]));
      if (!node) continue;
      inlineMarks(parent, text.slice(last, m.index));
      parent.append(node);
      last = m.index + m[0].length;
    }
    inlineMarks(parent, text.slice(last));
  }

  function inlineMarks(parent, text) {
    let last = 0;
    // matchAll walks its own copy of the regex: marks nest, so this recurses,
    // and a shared lastIndex reset by the inner call re-found the same `**…**`
    // forever.
    for (const match of text.matchAll(INLINE)) {
      if (match.index > last) parent.append(text.slice(last, match.index));
      const [whole] = match;
      let node;
      if (match[1]) {
        node = document.createElement('code');
        node.textContent = whole.slice(1, -1);
      } else if (match[2]) {
        // Marks nest: `**the \`.mrbl\` file**` is bold with code in it.
        node = document.createElement('strong');
        inlineMarks(node, whole.slice(2, -2));
      } else if (match[3]) {
        node = document.createElement('em');
        inlineMarks(node, whole.slice(1, -1));
      } else if (match[4]) {
        node = document.createElement('del');
        inlineMarks(node, whole.slice(2, -2));
      } else {
        node = document.createElement('a');
        inlineMarks(node, /^\[([^\]]+)\]/.exec(whole)[1]);
        node.href = match[6];
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
      parent.append(node);
      last = match.index + whole.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const FENCE = /^\s*```/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?(.*)$/;
  // The row under a table's header: pipes, dashes, and a colon where a column
  // says how it is aligned. Nothing else looks like it.
  const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  // The whole protocol for a visual: what the info string says. The caption
  // after it, and everything done with the block, is chat-visual.js's.
  const VISUAL_FENCE = /^marble-visual\b/i;
  // The same fence, found in a message that is still arriving.
  const VISUAL_OPEN = /(^|\n)[ \t]*```[ \t]*marble-visual\b/i;

  const indentOf = (line) => /^\s*/.exec(line)[0].replace(/\t/g, '    ').length;
  /** The cells of one table row. A pipe inside backticks is the code's, and
   *  `\|` is a pipe the writer meant as a character. */
  function cellsOf(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    const cells = [];
    let cell = '';
    let code = false;
    for (let k = 0; k < row.length; k += 1) {
      const c = row[k];
      if (c === '\\' && row[k + 1] === '|') { cell += '|'; k += 1; continue; }
      if (c === '`') code = !code;
      if (c === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
      cell += c;
    }
    cells.push(cell.trim());
    return cells;
  }
  const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length
    && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')
    && (lines[i + 1].includes('|') || cellsOf(lines[i]).length > 1);
  /** Where a paragraph stops: at a blank line, or where another block begins. */
  const startsBlock = (lines, i) => FENCE.test(lines[i]) || HEADING.test(lines[i])
    || RULE.test(lines[i]) || QUOTE.test(lines[i]) || LIST_ITEM.test(lines[i]) || isTableStart(lines, i);

  function renderText(text, { chip = null, visual = null } = {}) {
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    return renderBlocks(lines, { chip, visual });
  }

  function renderBlocks(lines, opts) {
    const { chip, visual } = opts;
    const out = document.createDocumentFragment();
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (FENCE.test(line)) {
        const info = line.replace(FENCE, '').trim();
        const body = [];
        for (i += 1; i < lines.length && !FENCE.test(lines[i]); i += 1) body.push(lines[i]);
        i += 1;
        // A fence the agent tagged `marble-visual` is the one piece of its text
        // that is not read as text. It is not read by this page either: the
        // card hands it to a sandboxed frame. Anything else is code.
        const card = VISUAL_FENCE.test(info) ? visual?.(info, body.join('\n')) : null;
        if (card) {
          out.append(card);
          continue;
        }
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = body.join('\n');
        pre.append(code);
        out.append(pre);
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      // A heading in a chat is a section of one reply, not a page title: `#`
      // and `##` both land on the reply's largest step, and the rest step down
      // from there. The level the agent wrote survives as aria-level.
      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1].length;
        const node = document.createElement(`h${Math.min(6, Math.max(3, level + 1))}`);
        node.className = 'md-h';
        node.dataset.level = String(Math.min(level, 4));
        inline(node, heading[2], chip);
        out.append(node);
        i += 1;
        continue;
      }
      // A rule is checked before a list: `* * *` is a rule, not an item.
      if (RULE.test(line)) {
        out.append(document.createElement('hr'));
        i += 1;
        continue;
      }
      if (QUOTE.test(line)) {
        const body = [];
        for (; i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines, i)); i += 1) {
          const m = QUOTE.exec(lines[i]);
          body.push(m ? m[1] : lines[i]);
        }
        const quote = document.createElement('blockquote');
        quote.append(renderBlocks(body, opts));
        out.append(quote);
        continue;
      }
      if (isTableStart(lines, i)) {
        const head = cellsOf(line);
        const align = cellsOf(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');
        const row = (cells, tag) => {
          const tr = document.createElement('tr');
          head.forEach((_, k) => {
            const cell = document.createElement(tag);
            if (align[k]) cell.style.textAlign = align[k];
            inline(cell, cells[k] ?? '', chip);
            tr.append(cell);
          });
          return tr;
        };
        thead.append(row(head, 'th'));
        for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|') && !FENCE.test(lines[i]); i += 1) {
          tbody.append(row(cellsOf(lines[i]), 'td'));
        }
        table.append(thead, tbody);
        // The frame scrolls, not the reply: a wide table in a narrow pane
        // keeps its columns and slides.
        const wrap = document.createElement('div');
        wrap.className = 'md-table';
        wrap.append(table);
        out.append(wrap);
        continue;
      }
      if (LIST_ITEM.test(line)) {
        out.append(renderList(lines, i, opts, (next) => { i = next; }));
        continue;
      }
      const paragraph = document.createElement('p');
      let first = true;
      for (; i < lines.length && lines[i].trim() && (first || !startsBlock(lines, i)); i += 1) {
        if (!first) paragraph.append(document.createElement('br'));
        inline(paragraph, lines[i].trim(), chip);
        first = false;
      }
      out.append(paragraph);
    }
    return out;
  }

  /** One list, from the item at `start`. An item owns every line indented
   *  past its marker — a second paragraph, a nested list, a fence — and a
   *  blank line between two items of the same kind does not end the list
   *  (so `1.` … `2.` with space between them stays one list, numbered on). */
  function renderList(lines, start, opts, done) {
    const first = LIST_ITEM.exec(lines[start]);
    const base = indentOf(lines[start]);
    const ordered = /\d/.test(first[2]);
    const list = document.createElement(ordered ? 'ol' : 'ul');
    if (ordered) {
      const n = parseInt(first[2], 10);
      if (n !== 1) list.start = n;
    }
    const sameKind = (m) => m && indentOf(m[0]) <= base + 1 && /\d/.test(m[2]) === ordered;
    let i = start;
    let loose = false;
    while (i < lines.length) {
      const m = LIST_ITEM.exec(lines[i]);
      if (!sameKind(m)) break;
      const body = [m[3]];
      const inset = indentOf(lines[i]) + m[2].length + 1;
      let gap = false;
      for (i += 1; i < lines.length; i += 1) {
        const l = lines[i];
        if (!l.trim()) {
          gap = true;
          body.push('');
          continue;
        }
        const ind = indentOf(l);
        if (ind > base && (ind >= Math.min(inset, base + 2) || !gap)) {
          // Indented past the marker: this item's. A lazy line straight under
          // it (no blank between, no indent) continues its paragraph too.
          body.push(l.replace(new RegExp(`^\\s{0,${Math.min(ind, inset)}}`), ''));
          gap = false;
          continue;
        }
        if (!gap && ind <= base && !startsBlock(lines, i)) {
          body.push(l.trim());
          continue;
        }
        break;
      }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      // A blank line before the next item of this list makes it loose.
      if (gap && sameKind(LIST_ITEM.exec(lines[i] ?? ''))) loose = true;
      const item = document.createElement('li');
      const task = /^\[([ xX])\]\s+/.exec(body[0]);
      if (task) {
        body[0] = body[0].slice(task[0].length);
        item.className = 'md-task';
        item.dataset.done = String(task[1] !== ' ');
      }
      const content = renderBlocks(body, opts);
      // A tight item is its words, not a paragraph holding them.
      if (content.firstChild?.nodeName === 'P') {
        const p = content.firstChild;
        p.replaceWith(...p.childNodes);
      }
      item.append(content);
      list.append(item);
      if (gap && !sameKind(LIST_ITEM.exec(lines[i] ?? ''))) break;
    }
    if (loose) list.classList.add('loose');
    done(i);
    return list;
  }

  // ------------------------------------------------------------ motion

  /** A critically damped spring on one number. It starts from wherever the
   *  value is now and at whatever velocity it is moving, which is what makes an
   *  animation interruptible: a new target is a new spring from the present. */
  function spring({ from, to, velocity = 0, response = 0.34, damping = 1, onFrame, onDone }) {
    const omega = (2 * Math.PI) / response;
    let x = from;
    let v = velocity;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;
      // Damping 1 settles without overshoot; below it, a release that
      // carried momentum is allowed a little bounce.
      v += (-omega * omega * (x - to) - 2 * damping * omega * v) * dt;
      x += v * dt;
      if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.01) {
        onFrame(to, 0);
        onDone?.();
        return;
      }
      onFrame(x, v);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }

  /** Where a released gesture would come to rest (Apple's projection). */
  const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

  /** Past a boundary, things resist rather than stop: the further you drag, the
   *  less of the drag the thing takes. A hard stop reads as frozen. */
  const rubberband = (overshoot, dimension, constant = 0.55) =>
    (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

  // ------------------------------------------------------------ helpers

  const h = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const fillSelect = (select, items, { empty = 'Default', value = '' } = {}) => {
    select.replaceChildren();
    const blank = h('option', '', empty);
    blank.value = '';
    select.append(blank);
    for (const item of items) {
      const option = h('option', '', item.label ?? item);
      option.value = item.id ?? item;
      select.append(option);
    }
    if (value && ![...select.options].some((option) => option.value === value)) {
      const extra = h('option', '', value);
      extra.value = value;
      select.append(extra);
    }
    select.value = value ?? '';
  };

  const radioValue = (root, name) => root.querySelector(`input[type="radio"][name="${name}"]:checked`)?.value ?? '';
  const setRadioValue = (root, name, id) => {
    const match = [...root.querySelectorAll(`input[type="radio"][name="${name}"]`)].find((input) => input.value === (id ?? ''));
    const pick = match ?? root.querySelector(`input[type="radio"][name="${name}"]`);
    if (pick) pick.checked = true;
  };
  const syncSegCurrent = (box) => {
    const current = box.querySelector('.seg-current');
    const checked = box.querySelector('input:checked + span');
    if (current) {
      current.textContent = checked?.textContent?.trim() || 'Choose';
      current.hidden = !box.classList.contains('is-drop');
    }
  };
  /** These sheets are popovers, which is how they get out from under the chat
   *  next door. Fixed positioning escapes the pane's clip but not its paint
   *  order: the dock places every conversation as `position: absolute;
   *  z-index: 2`, so each one is its own stacking context and the sheet's
   *  z-index only ever competes inside the chat that opened it. A later
   *  sibling covers the whole subtree, fixed children included. The top layer
   *  is above every stacking context on the page by definition, and a popover
   *  gets there while staying in its own shadow root — so the markup, the
   *  styles, the radios and the listeners are all untouched.
   *
   *  `manual`, not `auto`: auto popovers light-dismiss on their own schedule
   *  and would fight armSegDismiss, which already closes these correctly and
   *  knows about the trigger. An engine without popovers keeps the old
   *  behaviour, which is right everywhere except under a second pane. */
  const asPopover = (menu) => {
    if (menu && 'popover' in menu && menu.popover !== 'manual') menu.popover = 'manual';
    return menu;
  };
  const inTopLayer = (menu) => {
    try {
      return Boolean(menu?.matches?.(':popover-open'));
    } catch {
      return false;
    }
  };
  const raiseMenu = (menu) => {
    if (!menu?.showPopover || inTopLayer(menu)) return;
    try {
      menu.showPopover();
    } catch { /* not connected, or no popover on this engine */ }
  };
  const dropMenu = (menu) => {
    if (!menu?.hidePopover || !inTopLayer(menu)) return;
    try {
      menu.hidePopover();
    } catch { /* already gone */ }
  };
  /** A menu inside a pane is inside that pane's `overflow: hidden`, so an
   *  absolutely positioned one gets its edges shaved off by the frame — which
   *  is what clipped the first letter of every setup. Fixed positioning leaves
   *  the clip behind; the position has to be measured, and clamped so the menu
   *  never hangs off the window either. Called on open, and cleared on close so
   *  the sheet goes back to its own stylesheet. */
  const floatMenu = (anchor, menu, { align = 'end', hug = true } = {}) => {
    if (!anchor || !menu) return;
    menu.style.position = 'fixed';
    menu.style.bottom = 'auto';
    menu.style.top = '0px';
    menu.style.left = '0px';
    menu.style.right = 'auto';
    menu.style.maxHeight = '';
    const a = anchor.getBoundingClientRect();
    // The sheet's `min-width: max(100%, …)` resolves against the containing
    // block, which once fixed is the viewport — so it has to be told what
    // 100% means out here, or the menu spans the window. A sheet that does
    // not hug its trigger keeps its own width instead.
    menu.style.minWidth = hug ? `${Math.max(Math.round(a.width), 176)}px` : '';
    menu.style.width = 'max-content';
    menu.style.maxWidth = `${Math.round(Math.min(innerWidth - 16, 360))}px`;
    // The layout box, not a client rect: this runs on the frame the sheet
    // starts growing, and a client rect carries the entry transform with it —
    // the menu would be measured 4% small and placed a few pixels off, then
    // slide to the wrong resting spot. offsetWidth/Height have no transform.
    const m = { width: menu.offsetWidth, height: menu.offsetHeight };
    const pad = 8;
    // Above the trigger when there is room, below when there is not.
    const above = a.top - pad - m.height;
    const top = above >= pad ? above : Math.min(a.bottom + pad, innerHeight - pad - m.height);
    const want = align === 'center' ? a.left + a.width / 2 - m.width / 2
      : align === 'start' ? a.left
        : a.right - m.width;
    const left = Math.min(Math.max(pad, want), innerWidth - pad - m.width);
    menu.style.top = `${Math.max(pad, Math.round(top))}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.maxHeight = `${Math.round(Math.max(120, innerHeight - 2 * pad))}px`;
    // It grows out of the control that opened it: the origin is the trigger's
    // middle, on the edge the sheet actually opened from. A sheet that scales
    // up from its own centre reads as a thing that appeared; one that scales
    // up from the button reads as that button opening.
    const originX = Math.round(Math.min(Math.max(a.left + a.width / 2 - left, 0), m.width));
    menu.style.transformOrigin = `${originX}px ${above >= pad ? '100%' : '0%'}`;
  };
  const unfloatMenu = (menu) => {
    if (!menu) return;
    for (const prop of ['position', 'top', 'left', 'right', 'bottom', 'maxHeight', 'minWidth', 'width', 'maxWidth', 'transformOrigin']) menu.style[prop] = '';
  };
  /** How long the sheet takes to leave, in ms — the exit half of the rules
   *  under `.seg-menu`. Only the unfloat delay reads it; the animation itself
   *  is CSS, and shortening it there without changing this only unfloats a
   *  little late. */
  const MENU_MS = 180;
  const segMenuOf = (box) => box?.querySelector(':scope > .seg-menu, :scope > .presets-menu') ?? null;
  const segTriggerOf = (box) => box?.querySelector(':scope > .seg-current, :scope > .presets-more') ?? null;
  /** The one sheet open on this page, if any. Page-wide and not per
   *  conversation on purpose: every one of these is fixed-positioned and
   *  floats over every pane, so two open at once — one per chat — are two
   *  menus over one document with no way to say which a click belongs to.
   *  A pointerdown inside one conversation's shadow root never reaches
   *  another's, so no conversation can police this for itself. */
  let openSeg = null;
  let segDismissArmed = false;
  const armSegDismiss = () => {
    if (segDismissArmed || typeof document === 'undefined') return;
    segDismissArmed = true;
    // Capture on the document: pointer and key events are composed, so one
    // listener here sees every click in every conversation, in the drawer,
    // and in the page behind them. Out here `event.target` has retargeted to
    // the host element — composedPath() is the only honest way to ask whether
    // the click landed inside the sheet that is open.
    document.addEventListener('pointerdown', (event) => {
      if (!openSeg) return;
      const path = event.composedPath?.() ?? [];
      if (path.includes(openSeg.menu) || path.includes(openSeg.trigger)) return;
      closeOpenSeg();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeOpenSeg();
    }, true);
    // A menu left hanging over a window you have tabbed away from is a menu
    // nobody asked for when they come back.
    addEventListener('blur', () => closeOpenSeg());
  };

  /** Hold ⌃⌥ and the setups come up as a scrubber; the arrows walk it; letting
   *  go commits. Held on the module rather than per conversation for the same
   *  reason the dismiss is: the keys have to be heard wherever focus is, and
   *  only one scrubber may be up at a time.
   *
   *  Two shortcuts share this pair and neither is ours to win. ⌃⌥ is
   *  VoiceOver's own modifier on macOS, so with VoiceOver running the arrows
   *  move its cursor and never reach the page. On a European keyboard layout
   *  AltGr reports as ctrl+alt, so typing one of its characters raises the
   *  scrubber for as long as the key is down. Both are the cost of the
   *  gesture the shortcut is; changing either means changing the pair. */
  const SCRUB_KEYS = {
    ArrowLeft: { axis: 'model', delta: -1 },
    ArrowRight: { axis: 'model', delta: 1 },
    ArrowDown: { axis: 'effort', delta: -1 },
    ArrowUp: { axis: 'effort', delta: 1 },
  };
  let scrubOpen = null;
  let scrubArmed = false;
  let lastFocusedChat = null;
  /** The chat a ⌃⌥ belongs to. Focus inside an open shadow root retargets to
   *  the host, so a composer being typed in reads as its own conversation.
   *  Failing that, the last one that held focus — you often click out onto
   *  the canvas between writing and choosing, and the keys should still go
   *  where you were. Failing that, the only chat on the page, which is the
   *  drawer and the single pane. Two idle chats and no history is the one
   *  case with no answer, and it does nothing rather than guess. */
  const scrubTarget = () => {
    if (scrubOpen) return scrubOpen;
    const active = document.activeElement;
    if (active?.tagName === 'MARBLE-CONVERSATION') return active;
    if (lastFocusedChat?.isConnected) return lastFocusedChat;
    const all = document.querySelectorAll('marble-conversation');
    return all.length === 1 ? all[0] : null;
  };
  const armScrubKeys = () => {
    if (scrubArmed || typeof document === 'undefined') return;
    scrubArmed = true;
    document.addEventListener('focusin', (event) => {
      const chat = (event.composedPath?.() ?? []).find((node) => node?.tagName === 'MARBLE-CONVERSATION');
      if (chat) lastFocusedChat = chat;
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.metaKey || !event.ctrlKey || !event.altKey) return;
      // Sideways is the model, up and down is how hard it works.
      const step = SCRUB_KEYS[event.key];
      // Anything else held with the pair is somebody else's shortcut.
      if (!step && event.key !== 'Control' && event.key !== 'Alt') return;
      const target = scrubTarget();
      if (!target?.openScrub?.()) return;
      if (!step) return;
      // Or the caret walks the prompt underneath while the scrubber moves.
      event.preventDefault();
      event.stopPropagation();
      if (step.axis === 'model') target.moveScrub(step.delta);
      else target.tuneScrub(step.delta);
    }, true);
    document.addEventListener('keyup', (event) => {
      if (!scrubOpen) return;
      if (!event.ctrlKey || !event.altKey) scrubOpen.closeScrub();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (scrubOpen && event.key === 'Escape') scrubOpen.closeScrub({ commit: false });
    }, true);
    // Tabbing away never delivers the keyup, so without this the scrubber is
    // still up — and still holding the keys down — when you come back.
    addEventListener('blur', () => scrubOpen?.closeScrub());
  };
  /** A shortcut nobody can see is a shortcut nobody uses, and a line of help
   *  standing permanently under the bar would cost more than it teaches. So
   *  it waits: rest on the setup button long enough to have been looking for
   *  something, and the keys are named. Moving on takes it away.
   *  Raised like the sheets are, for the same reason — it has the pane next
   *  door to clear. */
  const HINT_DELAY = 750;
  let hintEl = null;
  const hideHint = () => {
    if (!hintEl) return;
    const tip = hintEl;
    hintEl = null;
    tip.classList.remove('is-open');
    clearTimeout(tip._unfloat);
    tip._unfloat = setTimeout(() => {
      if (tip.classList.contains('is-open')) return;
      dropMenu(tip);
      unfloatMenu(tip);
    }, reduceMotion() ? 0 : MENU_MS + 60);
  };
  const showHint = (anchor, tip) => {
    if (!anchor?.isConnected || hintEl === tip) return;
    hideHint();
    hintEl = tip;
    tip.classList.add('is-open');
    clearTimeout(tip._unfloat);
    raiseMenu(tip);
    // Left edges together, not centred: a tip wider than the little button it
    // describes would otherwise hang off the pane beside it.
    floatMenu(anchor, tip, { align: 'start', hug: false });
  };
  /** Hook a trigger up to its own tip. The tip lives beside the trigger so it
   *  keeps the conversation's styles; only the top layer is borrowed. */
  const armHint = (anchor, text) => {
    if (!anchor || anchor.dataset.hinted) return;
    anchor.dataset.hinted = '1';
    const tip = asPopover(h('div', 'keytip'));
    tip.setAttribute('role', 'tooltip');
    // A tip on a toggle has to say what the toggle is now, so the text is read
    // when it opens rather than when it was hooked up.
    const say = typeof text === 'function' ? text : () => text;
    const word = () => {
      const said = say();
      tip.textContent = said;
      tip.classList.toggle('is-multi', said.includes('\n'));
    };
    word();
    anchor.after(tip);
    let timer = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      if (hintEl === tip) hideHint();
    };
    anchor.addEventListener('pointerenter', (event) => {
      // A finger has no hover, and a tip it cannot dismiss would sit there.
      if (event.pointerType === 'touch') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        word();
        showHint(anchor, tip);
      }, HINT_DELAY);
    });
    anchor.addEventListener('pointerleave', cancel);
    anchor.addEventListener('pointerdown', cancel);
    anchor.addEventListener('blur', cancel);
  };
  const collapseSegBox = (box) => {
    if (!box) return;
    if (openSeg?.box === box) openSeg = null;
    if (!box.classList.contains('is-open')) return;
    box.classList.remove('is-open');
    segTriggerOf(box)?.setAttribute('aria-expanded', 'false');
    const menu = segMenuOf(box);
    if (!menu) return;
    // Fixed while it is open, and it has to stay fixed until it has finished
    // leaving: stripping the geometry on the same frame teleports the sheet
    // back to its anchor and plays the fade somewhere else on the screen.
    // The same goes for the top layer, which is why `overlay` is in the
    // transition — the browser holds the sheet up there until the fade ends.
    clearTimeout(menu._unfloat);
    const settle = () => {
      if (box.classList.contains('is-open')) return;
      dropMenu(menu);
      unfloatMenu(menu);
    };
    if (reduceMotion()) settle();
    else menu._unfloat = setTimeout(settle, MENU_MS + 60);
  };
  const closeSegMenus = (root) => {
    const host = root?.querySelectorAll ? root : root?.shadowRoot;
    if (!host) return;
    for (const box of host.querySelectorAll('.seg-opts.is-open, .presets.is-open')) collapseSegBox(box);
  };
  const closeOpenSeg = () => collapseSegBox(openSeg?.box);
  const openSegBox = (box) => {
    if (!box) return;
    const trigger = segTriggerOf(box);
    const menu = segMenuOf(box);
    closeOpenSeg();
    closeSegMenus(box.getRootNode());
    box.classList.add('is-open');
    trigger?.setAttribute('aria-expanded', 'true');
    if (menu) {
      clearTimeout(menu._unfloat);
      // Into the top layer first: floatMenu measures the sheet, and it can
      // only be measured once it is rendered somewhere.
      raiseMenu(menu);
      floatMenu(trigger, menu);
    }
    openSeg = { box, menu, trigger };
    armSegDismiss();
  };
  const toggleSegBox = (box) => {
    if (box?.classList.contains('is-open')) collapseSegBox(box);
    else openSegBox(box);
  };
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ensureThumb = (track) => {
    let thumb = track.querySelector(':scope > .seg-thumb');
    if (!thumb) {
      thumb = document.createElement('div');
      thumb.className = 'seg-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      track.prepend(thumb);
    }
    return thumb;
  };
  const slideThumb = (track, { animate = true } = {}) => {
    if (!track || track.hidden || track.classList.contains('is-drop')) {
      const hidden = track?.querySelector?.(':scope > .seg-thumb');
      if (hidden) hidden.style.opacity = '0';
      return;
    }
    const thumb = ensureThumb(track);
    const checked = track.classList.contains('presets')
      ? track.querySelector(':scope > .preset input:checked + span')
      : track.querySelector('input:checked + span');
    if (!checked) {
      thumb.style.opacity = '0';
      return;
    }
    const trackBox = track.getBoundingClientRect();
    const box = checked.getBoundingClientRect();
    if (!trackBox.width || !box.width) {
      thumb.style.opacity = '0';
      return;
    }
    const to = {
      x: box.left - trackBox.left,
      y: box.top - trackBox.top,
      w: box.width,
      h: box.height,
    };
    const apply = (at) => {
      track._thumbAt = at;
      thumb.style.opacity = '1';
      thumb.style.width = `${at.w}px`;
      thumb.style.height = `${at.h}px`;
      thumb.style.transform = `translate(${at.x}px, ${at.y}px)`;
    };
    if (track._thumbStop) {
      for (const stop of track._thumbStop) stop();
      track._thumbStop = null;
    }
    const from = track._thumbAt;
    const skip = !animate || !from || reduceMotion()
      || (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.w - to.w) < 0.5 && Math.abs(from.h - to.h) < 0.5);
    if (skip) {
      apply(to);
      return;
    }
    const now = { ...from };
    const stops = [];
    let pending = 4;
    const tick = () => apply({ ...now });
    for (const key of ['x', 'y', 'w', 'h']) {
      stops.push(spring({
        from: from[key],
        to: to[key],
        velocity: track._thumbVel?.[key] ?? 0,
        response: 0.34,
        onFrame: (value, velocity) => {
          now[key] = value;
          track._thumbVel = { ...(track._thumbVel ?? {}), [key]: velocity };
          tick();
        },
        onDone: () => {
          now[key] = to[key];
          pending -= 1;
          if (pending <= 0) {
            apply(to);
            track._thumbStop = null;
          }
        },
      }));
    }
    track._thumbStop = stops;
  };
  const armSeg = (track) => {
    if (!track || track.dataset.armed) return;
    track.dataset.armed = '1';
    track.addEventListener('pointerdown', (event) => {
      const input = event.target.closest?.('label')?.querySelector('input[type="radio"]');
      if (!input || input.disabled) return;
      if (!input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      slideThumb(track, { animate: true });
    });
  };
  const fillRadios = (box, name, items, { empty = 'Default', value = '', disabled = new Set() } = {}) => {
    const list = [];
    if (empty != null) list.push({ id: '', label: empty });
    for (const item of items ?? []) {
      list.push(item && typeof item === 'object' ? { id: item.id, label: item.label ?? item.id } : { id: item, label: String(item) });
    }
    if (value && !list.some((item) => item.id === value)) list.push({ id: value, label: value });
    box.classList.remove('is-drop', 'is-open');
    box.replaceChildren();
    box._thumbAt = null;
    box._thumbVel = null;
    const thumb = ensureThumb(box);
    thumb.style.opacity = '0';
    const current = document.createElement('button');
    current.type = 'button';
    current.className = 'seg-current';
    current.setAttribute('aria-haspopup', 'listbox');
    current.setAttribute('aria-expanded', 'false');
    current.hidden = true;
    const menu = asPopover(document.createElement('div'));
    menu.className = 'seg-menu';
    menu.setAttribute('role', 'listbox');
    let selected = list.some((item) => item.id === (value ?? '')) ? (value ?? '') : list[0]?.id ?? '';
    for (const item of list) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = item.id;
      input.checked = item.id === selected;
      input.disabled = disabled.has(item.id);
      const text = document.createElement('span');
      text.textContent = item.label;
      label.append(input, text);
      menu.append(label);
    }
    box.append(current, menu);
    current.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSegBox(box);
    });
    armSeg(box);
    syncSegCurrent(box);
    requestAnimationFrame(() => slideThumb(box, { animate: false }));
  };
  /** When even every segment folded into a dropdown does not fit beside the
   *  bar's buttons, the setup takes its own line. Set here, cleared by
   *  fitSetup before each pass, so a wider box gets its one row back. */
  const wrapBarFor = (node) => {
    const bar = node.closest('.bar');
    if (!bar || bar.dataset.wrap) return false;
    bar.dataset.wrap = '1';
    return true;
  };
  /** The last thing to give. Saved setups and the Custom toggle ride together
   *  so that a squeeze folds the track rather than stranding one word on a row
   *  of its own — but in a pane narrow enough that the track cannot hold even
   *  the chosen setup's name beside Custom, the name is worth more than the
   *  line, and Custom steps below. Cleared by fitSetup before each pass. */
  const wrapRowFor = (node) => {
    const row = node.closest('.setup-row');
    if (!row || row.dataset.wrap) return false;
    row.dataset.wrap = '1';
    return true;
  };
  const fitPicker = (picker) => {
    if (!picker || picker.hidden) return;
    const segs = [...picker.querySelectorAll('.seg-opts')].filter((box) => !box.closest('.seg')?.hidden);
    const overflowed = () => picker.scrollWidth > picker.clientWidth + 1;
    for (const box of segs) {
      collapseSegBox(box);
      box.classList.remove('is-drop');
    }
    for (const box of [...segs].reverse()) {
      if (!overflowed()) break;
      box.classList.add('is-drop');
      syncSegCurrent(box);
    }
    if (overflowed() && wrapBarFor(picker)) {
      fitPicker(picker);
      return;
    }
    for (const box of segs) {
      syncSegCurrent(box);
      slideThumb(box, { animate: false });
    }
  };
  const MORE_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3.2" cy="7" r="1.15" fill="currentColor"/><circle cx="7" cy="7" r="1.15" fill="currentColor"/><circle cx="10.8" cy="7" r="1.15" fill="currentColor"/></svg>';
  const ensurePresetOverflow = (track) => {
    let more = track.querySelector(':scope > .presets-more');
    let menu = track.querySelector(':scope > .presets-menu');
    if (!more) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'presets-more';
      more.setAttribute('aria-haspopup', 'listbox');
      more.setAttribute('aria-label', 'More setups');
      more.innerHTML = MORE_ICON;
      more.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSegBox(track);
      });
      track.append(more);
      armHint(more, 'Hold ⌃⌥ · ← → model, ↑ ↓ effort');
    }
    if (!menu) {
      menu = asPopover(document.createElement('div'));
      menu.className = 'presets-menu';
      menu.setAttribute('role', 'listbox');
      track.append(menu);
    }
    return { more, menu };
  };
  const restorePresetOrder = (track, more, menu) => {
    const chips = [...track.querySelectorAll('.preset'), ...menu.querySelectorAll('.preset')]
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    for (const chip of chips) track.insertBefore(chip, more);
  };
  /** The one word the packed control wears. The checked setup names itself;
   *  nothing checked means the setup is not one of the saved ones — a model
   *  tuned off its resting effort, or one chosen in the custom row — and the
   *  word then has to be the model actually set. It used to fall back to the
   *  first chip in the menu, which told everybody they were on Sonnet High
   *  whatever they had picked. `data-custom` is written by markCustomSetup
   *  just before this runs. */
  const nameCurrentPreset = (track, more, menu) => {
    const span = menu.querySelector('input:checked + span');
    if (span) {
      more.replaceChildren(span.cloneNode(true));
      more.classList.add('is-current');
      more.setAttribute('aria-label', `Setup: ${span.textContent.trim()}`);
      return;
    }
    const label = track.dataset.custom || '';
    if (!label) return;
    // The same node a chip wears — a span holding the brand mark and the name
    // — so a setup nobody saved reads at exactly the weight and size of one
    // that is. BRAND is this file's own constant; the name is text.
    const wrap = h('span');
    wrap.innerHTML = BRAND[track.dataset.customBrand] ?? '';
    wrap.append(document.createTextNode(label));
    more.replaceChildren(wrap);
    more.classList.add('is-current');
    more.setAttribute('aria-label', `Setup: ${label}`);
  };
  const fitPresets = (track) => {
    if (!track || track.hidden) return;
    const { more, menu } = ensurePresetOverflow(track);
    restorePresetOrder(track, more, menu);
    more.hidden = true;
    more.classList.remove('is-current');
    more.innerHTML = MORE_ICON;
    more.setAttribute('aria-label', 'More setups');
    // Through the close rather than by dropping the class: a repaint with the
    // sheet open has to take it out of the top layer too, or it lingers up
    // there invisible and the next open thinks it is already raised.
    collapseSegBox(track);
    more.setAttribute('aria-expanded', 'false');
    track.classList.remove('is-packed');
    const overflowed = () => track.scrollWidth > track.clientWidth + 1;
    // A row of setups laid out as capsules is a row of decisions competing
    // with the one that matters, which is the prompt. The setup you are on is
    // a word; the rest are a menu away. It also ends the packing problem for
    // good — one word cannot overflow, at any pane width.
    const all = [...track.querySelectorAll(':scope > .preset')];
    if (all.length) {
      more.hidden = false;
      track.classList.add('is-packed');
      for (const chip of all) menu.append(chip);
      nameCurrentPreset(track, more, menu);
      slideThumb(track, { animate: false });
      return;
    }
    if (!overflowed()) {
      slideThumb(track, { animate: false });
      return;
    }
    more.hidden = false;
    track.classList.add('is-packed');
    const chips = [...track.querySelectorAll(':scope > .preset')];
    const pack = (chip) => menu.append(chip);
    const visible = (chip) => chip.parentElement === track;
    const skipSelected = (chip) => chip.querySelector('input')?.checked;
    for (const chip of [...chips].reverse()) {
      if (!overflowed()) break;
      if (visible(chip) && !skipSelected(chip)) pack(chip);
    }
    for (const chip of chips) {
      if (!overflowed()) break;
      if (visible(chip) && !skipSelected(chip)) pack(chip);
    }
    if (overflowed()) {
      for (const chip of chips) {
        if (visible(chip)) pack(chip);
      }
    }
    if (overflowed() && wrapBarFor(track)) {
      fitPresets(track);
      return;
    }
    if (!track.querySelector(':scope > .preset input:checked') && menu.querySelector('input:checked')) {
      // Even the chosen setup had to go into the menu: the row is too short
      // for a capsule at all. On its own line it may keep the name in view.
      if (wrapBarFor(track)) {
        fitPresets(track);
        return;
      }
      // Still nothing but a nub. Custom is the only thing left to move.
      if (wrapRowFor(track)) {
        fitPresets(track);
        return;
      }
      nameCurrentPreset(track, more, menu);
    }
    slideThumb(track, { animate: false });
  };
  const PICKER_PROVIDER_ORDER = ['claude-subscription', 'cursor', 'claude-api'];
  const sortProviders = (list) => {
    const rank = (id) => {
      const index = PICKER_PROVIDER_ORDER.indexOf(id);
      return index < 0 ? PICKER_PROVIDER_ORDER.length + 1 : index;
    };
    return [...(list ?? [])].sort((a, b) => rank(a.id) - rank(b.id) || String(a.id).localeCompare(String(b.id)));
  };
  const pickCursorPickerModels = (models) => {
    const grouped = models ?? [];
    const auto = grouped.find((item) => item.id === 'auto');
    const groks = grouped.filter((item) => /grok/i.test(item.id) || /grok/i.test(item.label ?? ''));
    const version = (id) => {
      const hit = String(id).match(/grok[^\d]*(\d+(?:\.\d+)?)/i);
      return hit ? Number(hit[1]) : 0;
    };
    const best = [...groks].sort((a, b) => version(b.id) - version(a.id))[0];
    return [auto, best].filter(Boolean);
  };
  const BRAND = {
    // Claude's own mark, not Anthropic's wordmark A: these name a model you
    // are about to talk to, not the company that made it.
    anthropic: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.6c.5 0 .9.4.9.9v6.06l4.29-4.28a.9.9 0 0 1 1.27 1.27l-4.28 4.29h6.06a.9.9 0 0 1 0 1.8h-6.06l4.28 4.29a.9.9 0 1 1-1.27 1.27l-4.29-4.28v6.06a.9.9 0 0 1-1.8 0v-6.06l-4.29 4.28a.9.9 0 0 1-1.27-1.27l4.28-4.29H3.76a.9.9 0 0 1 0-1.8h6.06L5.54 5.55a.9.9 0 0 1 1.27-1.27l4.29 4.28V2.5c0-.5.4-.9.9-.9z"/></svg>',
    cursor: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 2.4 20.6 12 11.4 13.7 9.5 21.6z"/></svg>',
  };
  const PRESETS = [
    // Weakest first, which is the menu and the scrubber: a slider is pushed
    // right to turn something up, so Fable sits at the right-hand end.
    // Opus Extra High is not a setup of its own any more: the scrubber tunes
    // effort on its own axis, so it is Opus with one press of ↑.
    // Grok 4.7 rests on High. High Fast is the same model with fast on, and
    // that stays a step on the effort slider rather than the saved setup.
    { id: 'sonnet-high', provider: 'claude-subscription', model: 'sonnet', effort: 'high', name: 'Sonnet High', brand: 'anthropic' },
    { id: 'grok-high', provider: 'cursor', model: 'grok-4.7', effort: 'high', name: 'Grok 4.7 High', brand: 'cursor' },
    { id: 'opus-high', provider: 'claude-subscription', model: 'opus', effort: 'high', name: 'Opus 5.5 High', brand: 'anthropic' },
    { id: 'fable-high', provider: 'claude-subscription', model: 'fable', effort: 'high', name: 'Fable 5.1 High', brand: 'anthropic' },
  ];
  const EFFORT_WORD = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };
  /** Every effort word stacked in one grid cell, only the current one lit.
   *  Two things fall out of that. The cell is always as wide as the longest
   *  word, so "Low" and "Extra High" take the same room and the model name
   *  beside them never shifts — which is what it did when this was one span
   *  being rewritten. And both words are on screen at the switch, so the old
   *  one can leave while the new one arrives instead of blinking. */
  const effortStack = (efforts, className = 'scrub-effort') => {
    const stack = h('span', className);
    for (const id of efforts ?? []) {
      const word = h('i', `e-${id}`, EFFORT_WORD[id] ?? id);
      word.dataset.effort = id;
      stack.append(word);
    }
    return stack;
  };
  /** Light a stack or a gauge at `effort`. A stack lights exactly one child;
   *  a gauge lights every bar up to it, so `steps` says which those are. */
  const lightEffort = (el, effort, steps = null) => {
    if (!el) return;
    el.dataset.at = effort ?? '';
    const upto = steps ? steps.indexOf(effort) : -1;
    [...el.children].forEach((child, index) => {
      child.classList.toggle('is-on', steps ? index <= upto : child.dataset.effort === effort);
    });
  };
  /** Five bars, lit to the effort. `--i` staggers them so the gauge fills
   *  along its length rather than all at once. */
  const effortGauge = (efforts) => {
    const gauge = h('span', 'scrub-gauge');
    (efforts ?? []).forEach((id, index) => {
      const bar = h('i', `e-${id}`);
      bar.dataset.effort = id;
      bar.style.setProperty('--i', String(index));
      bar.style.height = `${3 + index * 1.6}px`;
      gauge.append(bar);
    });
    return gauge;
  };
  /** A preset's name with its effort taken off the end, so a scrubber stop can
   *  set the model over the effort on two tight lines. "Opus Extra High" is
   *  "Opus" over "Extra High"; a name that does not end in its own effort is
   *  left whole. */
  const presetHead = (preset) => {
    const word = EFFORT_WORD[preset?.effort] ?? '';
    const name = String(preset?.name ?? '');
    return word && name.endsWith(` ${word}`) ? name.slice(0, -(word.length + 1)) : name;
  };
  /** The same trim done to a catalog label. Cursor spells effort into the
   *  model's own name ("Grok 4.7 High Fast"); effort is the other axis here
   *  and says itself, so the model keeps only what names the model. */
  const modelHead = (label) => String(label ?? '')
    .replace(/\s+(Extra High|High|Medium|Low)(\s+Fast)?$/i, '')
    .replace(/\s+Fast$/i, '')
    .trim();
  const nextMode = (modes, current) => {
    const ids = (modes ?? []).map((item) => item.id);
    if (!ids.length) return current ?? '';
    const index = ids.indexOf(current);
    return ids[(index < 0 ? 0 : index + 1) % ids.length];
  };
  const splitCursorModel = (id) => {
    if (!id) return { family: '', effort: '' };
    let rest = String(id);
    let fast = false;
    if (rest.endsWith('-fast')) {
      fast = true;
      rest = rest.slice(0, -5);
    }
    for (const key of ['xhigh', 'high', 'medium', 'low']) {
      const suffix = `-${key}`;
      if (rest.endsWith(suffix)) return { family: rest.slice(0, -suffix.length), effort: fast ? `${key}-fast` : key };
    }
    if (fast) return { family: rest, effort: 'fast' };
    return { family: rest, effort: '' };
  };

  const TAG_COUNT = 6;

  const hueIndex = (key) => {
    let hash = 2166136261;
    for (const ch of String(key ?? '')) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return Math.abs(hash) % TAG_COUNT;
  };

  const providerHue = (id) => {
    if (String(id).startsWith('claude')) return 1;
    if (id === 'cursor') return 0;
    return hueIndex(id);
  };

  const KNOWN_PROVIDERS = {
    'claude-subscription': 'Claude',
    'claude-api': 'Claude',
    'cursor': 'Cursor',
  };

  const KNOWN_MODELS = [
    ['sonnet', 'Sonnet 5'],
    ['opus', 'Opus 5.5'],
    ['haiku', 'Haiku 4.5'],
    ['fable', 'Fable 5.1'],
  ];

  const providerLabel = (summary, labels) => {
    const id = summary?.provider;
    if (!id) return '';
    const listed = labels instanceof Map ? labels.get(id)?.label : '';
    const name = listed || KNOWN_PROVIDERS[id] || id;
    // One Claude either way; a conversation paid for by an API key says so.
    return id === 'claude-api' ? `${name} · API` : name;
  };

  const modelLabel = (summary, labels) => {
    const id = summary?.model;
    if (!id) return '';
    const models = labels instanceof Map ? labels.get(summary.provider)?.models : null;
    const named = models?.find((item) => item.id === id)?.label;
    if (named) return modelHead(named) || named;
    const lower = String(id).toLowerCase();
    const grok = lower.match(/grok[^\d]*(\d+(?:\.\d+)?)/);
    if (grok) return `Grok ${grok[1]}`;
    for (const [key, name] of KNOWN_MODELS) {
      if (lower === key || lower.includes(key)) return name;
    }
    return String(id);
  };

  const conversationTags = (summary, labels, projects = null) => {
    const tags = [];
    // The drive is the default and goes unsaid; any other project is named.
    if (summary?.project && summary.project !== 'drive') {
      tags.push({ kind: 'project', label: projects?.get?.(summary.project)?.name ?? summary.project, hue: 200 });
    }
    const agent = providerLabel(summary, labels);
    if (agent) {
      tags.push({ kind: 'agent', label: agent, hue: providerHue(summary.provider) });
    }
    const model = modelLabel(summary, labels);
    const effort = summary?.effort ? String(summary.effort) : '';
    const bits = [model];
    if (effort && !String(model).toLowerCase().includes(effort.toLowerCase())) bits.push(effort);
    const catalog = bits.filter(Boolean).join(' • ');
    if (catalog) tags.push({ kind: 'model', label: catalog, hue: providerHue(summary.provider) });
    return tags;
  };

  /** A transcript event belongs to a conversation if it has no turn (meta /
   *  handoff on this stream) or its turn id is this conversation's. Turn ids
   *  are `${conversationId}-t${n}`. The hyphen is required so a neighbouring
   *  id cannot prefix-match. */
  function eventBelongsToConversation(event, conversationId) {
    if (!conversationId) return false;
    if (!event?.turn) return true;
    const turn = String(event.turn);
    return turn === conversationId || turn.startsWith(`${conversationId}-`);
  }

  const TAG_CSS = `
    .tag, .chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11.5px; line-height: 1.35; font-weight: 500;
      padding: 2px 8px; border-radius: 999px; max-width: 100%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .tag[data-hue="0"], .chip[data-hue="0"] { background: #e4edf4; color: #3d5a70; }
    .tag[data-hue="1"], .chip[data-hue="1"] { background: #f0e6dc; color: #6b4f3a; }
    .tag[data-hue="2"], .chip[data-hue="2"] { background: #e4efe8; color: #3d5c4a; }
    .tag[data-hue="3"], .chip[data-hue="3"] { background: #f3ead8; color: #6d5630; }
    .tag[data-hue="4"], .chip[data-hue="4"] { background: #eee4ee; color: #5c4560; }
    .tag[data-hue="5"], .chip[data-hue="5"] { background: #e6e8ea; color: #454c52; }
    @media (prefers-color-scheme: dark) {
      .tag[data-hue="0"], .chip[data-hue="0"] { background: #243038; color: #9dc0dc; }
      .tag[data-hue="1"], .chip[data-hue="1"] { background: #322820; color: #e0c4a8; }
      .tag[data-hue="2"], .chip[data-hue="2"] { background: #1f2c26; color: #a8c9b6; }
      .tag[data-hue="3"], .chip[data-hue="3"] { background: #322c1e; color: #d9c08a; }
      .tag[data-hue="4"], .chip[data-hue="4"] { background: #2c2430; color: #c8b0c8; }
      .tag[data-hue="5"], .chip[data-hue="5"] { background: #26282a; color: #b4b8bc; }
    }
  `;

  /** Five words for what a conversation is doing, shared by every view. The
   *  dot is the only thing that reads them; its colours are the same tokens
   *  the status buckets already use. */
  const stateOf = (summary) => {
    if (summary?.asking) return 'waiting';
    if (summary?.running || summary?.queued || summary?.status === 'running') return 'working';
    if (summary?.needsReview) {
      return summary.lastOutcome === 'failed' || summary.lastOutcome === 'watchdog' ? 'failed' : 'unseen';
    }
    return 'idle';
  };

  const STATE_CSS = `
    .dot {
      flex: none; width: 8px; height: 8px; border-radius: 999px;
      background: var(--faint); box-sizing: border-box;
    }
    [data-state="idle"] .dot { background: transparent; border: 1.5px solid var(--faint); }
    [data-state="unseen"] .dot { background: var(--ink); }
    [data-state="failed"] .dot { background: var(--danger); }
    [data-state="working"] .dot { background: var(--accent-ink); animation: dot-breathe 1.6s ease-in-out infinite; }
    [data-state="waiting"] .dot { background: var(--caution); animation: dot-ring 1.8s ease-out infinite; }
    @keyframes dot-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @keyframes dot-ring {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--caution) 55%, transparent); }
      70%, 100% { box-shadow: 0 0 0 7px transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-state="working"] .dot, [data-state="waiting"] .dot { animation: none; }
    }
  `;

  const USAGE_CSS = `
    .usage {
      display: flex; align-items: center; gap: .7rem; min-width: 0;
      user-select: none;
    }
    .meter {
      display: flex; align-items: center; gap: .4rem; min-width: 0; cursor: pointer;
    }
    .meter-label {
      font-size: 12.5px; font-weight: 500; color: var(--muted); letter-spacing: -.01em;
    }
    .meter-bar {
      display: block; width: 5.5rem; height: 8px; flex: none;
      border-radius: 999px; background: var(--paper-3);
      box-shadow: inset 0 0 0 1px var(--line); overflow: hidden;
    }
    .meter-bar i {
      display: block; height: 100%; width: 0;
      background: var(--accent-ink); border-radius: inherit;
      transition: width 200ms var(--settle, ease), background 200ms var(--settle, ease);
    }
    .meter[data-tone="blue"] .meter-bar i { background: var(--accent-ink); }
    .meter[data-tone="yellow"] .meter-bar i { background: #c4a02a; }
    .meter[data-tone="orange"] .meter-bar i { background: #c46a28; }
    .meter[data-tone="red"] .meter-bar i { background: var(--danger); }
    .meter[data-tone="unavailable"] .meter-label,
    .meter[data-tone="unavailable"] .meter-pct { color: var(--faint); }
    .meter[data-tone="unavailable"] .meter-bar { background: var(--paper-2); }
    .meter[data-tone="unavailable"] .meter-bar i { width: 0 !important; background: var(--faint); }
    .meter-pct {
      font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums;
      color: var(--ink); min-width: 2.35em;
    }
    @media (prefers-color-scheme: dark) {
      .meter[data-tone="yellow"] .meter-bar i { background: #e0c056; }
      .meter[data-tone="orange"] .meter-bar i { background: #e08a4a; }
    }
    /* Held, not live: the number is real but nobody could refresh it. */
    .meter[data-stale] .meter-pct { opacity: .65; }
    .meter[data-stale] .meter-bar i { opacity: .55; }
    @media (prefers-reduced-motion: reduce) {
      .meter-bar i { transition: none; }
    }
  `;

  const usageAvailable = (meter) => {
    if (!meter || meter.available === false) return false;
    if (meter.used == null || meter.used === '') return false;
    return Number.isFinite(Number(meter.used));
  };

  const usageTone = (used) => {
    const n = Math.max(0, Math.min(100, Number(used) || 0));
    if (n >= 90) return 'red';
    if (n >= 75) return 'orange';
    if (n >= 50) return 'yellow';
    return 'blue';
  };

  const parseReset = (value) => {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return new Date(n > 1e11 ? n : n * 1000);
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatReset = (value, now = new Date()) => {
    const date = parseReset(value);
    if (!date) return '';
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const start = (item) => new Date(item.getFullYear(), item.getMonth(), item.getDate()).getTime();
    const diff = start(date) - start(now);
    const day = 86_400_000;
    if (diff === 0) return `Resets today, ${time}`;
    if (diff === day) return `Resets tomorrow, ${time}`;
    const when = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `Resets ${when}, ${time}`;
  };

  // A remembered reading is still a reading; it just needs a date on it. The
  // host serves the last good numbers when the usage API refuses to answer,
  // so the bar keeps its shape and the tooltip says how old it is.
  const formatAsOf = (value, now = new Date()) => {
    const date = parseReset(value);
    if (!date) return 'Last known';
    const mins = Math.round((now - date) / 60_000);
    if (mins < 2) return 'As of just now';
    if (mins < 60) return `As of ${mins} min ago`;
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return mins < 60 * 20 ? `As of ${time}` : `As of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  };

  const TIP_CSS = `
    #marble-usage-tip {
      position: fixed; z-index: 2147483646; padding: 6px 10px;
      font: 12.5px/1.35 "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink, #111); background: var(--card, #fff);
      border: 1px solid var(--line, #ddd9cf); border-radius: 8px;
      box-shadow: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12);
      pointer-events: none; max-width: 16rem; white-space: nowrap;
    }
    #marble-usage-tip[hidden] { display: none; }
  `;

  const ensureTip = () => {
    let tip = document.getElementById('marble-usage-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'marble-usage-tip';
      tip.setAttribute('data-marble-transient', '');
      tip.setAttribute('role', 'tooltip');
      tip.hidden = true;
      document.body.append(tip);
    }
    if (!document.getElementById('marble-usage-tip-css')) {
      const style = document.createElement('style');
      style.id = 'marble-usage-tip-css';
      style.setAttribute('data-marble-transient', '');
      style.textContent = TIP_CSS;
      document.head.append(style);
    }
    return tip;
  };

  const placeTip = (meter) => {
    const text = meter?.dataset?.resetText;
    const tip = ensureTip();
    if (!text) {
      tip.hidden = true;
      return;
    }
    tip.textContent = text;
    tip.hidden = false;
    const box = meter.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    let left = box.left + box.width / 2 - size.width / 2;
    left = Math.max(8, Math.min(left, innerWidth - size.width - 8));
    let top = box.top - size.height - 8;
    if (top < 8) top = box.bottom + 8;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };

  const hideTip = () => {
    const tip = document.getElementById('marble-usage-tip');
    if (tip) tip.hidden = true;
  };

  const tipped = new WeakSet();
  const bindMeterTips = (host) => {
    if (!host || tipped.has(host)) return;
    tipped.add(host);
    host.addEventListener('pointerover', (event) => {
      const meter = event.target.closest?.('.meter');
      if (meter && host.contains(meter)) placeTip(meter);
    });
    host.addEventListener('pointerleave', hideTip);
    // A meter is a summary; the Usage tab is where the rest of it lives.
    host.addEventListener('click', (event) => {
      if (event.target.closest?.('.meter')) window.marble?.agent?.openSettings?.('usage');
    });
  };

  // The strip is two sliders and always two: Claude's own window and Fable's
  // beside it. They are the pair you spend, so they are the pair that belongs
  // in the chrome — every other provider keeps its meters in Settings › Usage
  // and in the phone's Fleet sheet. Drawing both even when the host cannot
  // read one is the point: a slider that disappears takes the row's shape with
  // it, and "no Claude bar" reads as "no usage" rather than "not known".
  // Fable's id is 'fable', not 'claude-*': the composer finds the Claude meter
  // by that prefix. The popup reads the window off the Claude meter.
  const claudeMeterOf = (meters) => (meters ?? [])
    .find((meter) => meter?.id === 'claude-subscription' || String(meter?.id ?? '').startsWith('claude'));

  const compactMeters = (meters) => {
    const claude = claudeMeterOf(meters)
      ?? { id: 'claude-subscription', label: 'Claude', available: false, detail: 'Unavailable' };
    const fable = usageAvailable(claude) ? (claude.windows ?? []).find((item) => item.id === 'fable') : null;
    // Fable rides on the Claude reading, so it is exactly as stale as that one.
    return [claude, fable ? {
      id: 'fable', label: fable.label || 'Fable', available: true, used: fable.used, left: fable.left, window: 'week', resetsAt: fable.resetsAt,
      ...(claude.stale ? { stale: true, at: claude.at ?? null } : {}),
    } : { id: 'fable', label: 'Fable', available: false, detail: claude.detail || 'Unavailable' }];
  };

  const fillMeters = (host, meters) => {
    if (!host) return;
    host.replaceChildren();
    for (const meter of compactMeters(meters)) {
      const ready = usageAvailable(meter);
      const used = ready ? Math.max(0, Math.min(100, Number(meter.used) || 0)) : 0;
      const el = h('div', 'meter');
      el.dataset.id = meter.id;
      el.dataset.tone = ready ? usageTone(used) : 'unavailable';
      el.setAttribute('role', 'meter');
      el.setAttribute('aria-label', ready ? `${meter.label} ${used}% used` : `${meter.label} unavailable`);
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '100');
      if (ready) el.setAttribute('aria-valuenow', String(used));
      else el.setAttribute('aria-disabled', 'true');
      if (meter.stale) el.dataset.stale = '1';
      const reset = !ready
        ? (meter.detail || 'Unavailable')
        : (meter.stale
          ? [formatAsOf(meter.at), formatReset(meter.resetsAt)].filter(Boolean).join(' · ')
          : formatReset(meter.resetsAt));
      if (reset) el.dataset.resetText = reset;
      const bar = h('span', 'meter-bar');
      const fill = document.createElement('i');
      fill.style.width = ready ? `${used}%` : '0%';
      bar.append(fill);
      el.append(h('span', 'meter-label', meter.label), bar, h('span', 'meter-pct', ready ? `${used}%` : 'Unavailable'));
      host.append(el);
    }
    bindMeterTips(host);
  };

  const usageRow = (window) => {
    const used = Math.max(0, Math.min(100, Number(window.used) || 0));
    const el = h('div', 'meter');
    el.dataset.id = window.id;
    el.dataset.kind = window.kind === 'share' ? 'share' : 'quota';
    el.dataset.tone = window.kind === 'share' ? 'share' : usageTone(used);
    el.setAttribute('role', 'meter');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    el.setAttribute('aria-valuenow', String(used));
    el.setAttribute('aria-label', `${window.label} ${used}% used`);
    const bar = h('span', 'meter-bar');
    const fill = document.createElement('i');
    fill.style.width = `${used}%`;
    bar.append(fill);
    el.append(h('span', 'meter-label', window.label), bar, h('span', 'meter-pct', `${used}%`));
    if (window.kind !== 'share') {
      el.append(h('span', 'reset', formatReset(window.resetsAt) || 'Reset time unknown'));
    }
    return el;
  };

  const fillUsageDetail = (host, meters) => {
    if (!host) return;
    host.replaceChildren();
    if (!meters?.length) {
      host.append(h('p', 'empty', 'No usage to show. Sign in to Claude Code or Cursor on this Mac.'));
      return;
    }
    for (const meter of meters) {
      const group = h('section', 'usage-group');
      group.append(h('h3', '', meter.label));
      if (!usageAvailable(meter)) {
        group.append(h('p', 'empty', meter.detail || 'Unavailable'));
        host.append(group);
        continue;
      }
      const windows = meter.windows ?? [];
      const quotas = windows.filter((item) => item.kind !== 'share');
      const shares = windows.filter((item) => item.kind === 'share');
      const rows = quotas.length ? quotas : [{
        id: meter.id, label: meter.window || meter.label, used: meter.used, resetsAt: meter.resetsAt, kind: 'quota',
      }];
      for (const window of rows) group.append(usageRow(window));
      if (shares.length) {
        group.append(h('p', 'subhead', 'This week'));
        for (const window of shares) group.append(usageRow(window));
      }
      host.append(group);
    }
  };

  const watchUsage = (host) => {
    if (!host || host.dataset.usageBound) return () => {};
    host.dataset.usageBound = '1';
    let timer = 0;
    const load = async () => {
      const api = window.marble?.agent;
      if (!api?.usage) return;
      try {
        const { meters } = await api.usage();
        fillMeters(host, meters);
      } catch {
        fillMeters(host, []);
      }
    };
    load();
    // Only while someone is using the tab: a request is activity, and a meter
    // polling from a forgotten tab would keep its sprite awake.
    timer = setInterval(() => {
      if (document.visibilityState === 'hidden' || window.marbleTabRest?.resting) return;
      load();
    }, 120_000);
    const onSaved = () => load();
    addEventListener('marble:agent-settings-saved', onSaved);
    return () => {
      clearInterval(timer);
      removeEventListener('marble:agent-settings-saved', onSaved);
      delete host.dataset.usageBound;
    };
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const seconds = (ms) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
  const firstSentence = (text) => String(text ?? '').split(/(?<=[.!?—])\s/)[0].replace(/\s*—\s*$/, '');

  /** What to send back for an ask. `picks` is a Map question → Set of labels.
   *  For a permission, `note === null` is Allow; any string is Deny with that
   *  reason (or a stock one). */
  // A pick that stands for "the typed answer" until the response is built.
  const OTHER = Symbol('other');

  function askResponse(kind, input, picks = new Map(), note = '') {
    if (kind === 'question') {
      const answers = {};
      for (const q of input?.questions ?? []) {
        const chosen = [...(picks.get(q.question) ?? [])];
        if (chosen.length) answers[q.question] = q.multiSelect ? chosen.join(', ') : chosen[0];
      }
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }
    return note === null ? { behavior: 'allow' } : { behavior: 'deny', message: note || 'Denied from Marble' };
  }

  // Kept identical to TOOL_ALIASES in runtime/choice-question.js, which is
  // the node-tested copy; this file is a classic script and cannot import it.
  const SHORT_NAMES = new Map([
    ['shell', 'Shell'], ['bash', 'Shell'], ['read_document', 'Read'], ['read', 'Read'],
    ['apply_ops', 'Edit'], ['edit', 'Edit'], ['updatetodos', 'Todos'], ['todowrite', 'Todos'], ['task', 'Task'],
  ]);
  const toolShortName = (name) => {
    if (!name) return 'Tool';
    const alias = SHORT_NAMES.get(String(name).toLowerCase());
    if (alias) return alias;
    const segment = String(name).split(/[/:]/).pop() || '';
    return segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : 'Tool';
  };
  const tail = (p) => String(p ?? '').replace(/\/+$/, '').split('/').pop() || String(p ?? '');
  const trimTo = (s, n = 60) => {
    const one = String(s ?? '').replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n - 1)}…` : one;
  };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url ?? ''); } };
  const firstString = (input) => Object.values(input ?? {}).find((v) => typeof v === 'string' && v.trim()) ?? '';

  const ACT_GERUND = {
    press: 'Pressing', type: 'Typing in', set: 'Setting', move: 'Moving',
    size: 'Resizing', remove: 'Removing', pick: 'Picking',
  };

  /** One line per call: a verb, and the thing it touched. `source` is what a
   *  folded run lists; `short` is the kind it counts by. */
  function toolLabel(name, input = {}) {
    const where = input.path ? ` ${input.path}` : '';
    const short = toolShortName(name);
    const out = (label, source = '') => ({ label, short, source });
    switch (name) {
      case 'read_document':
        return out(`Read${where}${Array.isArray(input.ids) && input.ids.length ? ` · ${plural(input.ids.length, 'element')}` : ''}`, input.path ?? '');
      case 'apply_ops':
        return out(`Editing${where}${input.note ? ` — ${input.note}` : ''}`, input.path ?? '');
      // Operating, not authoring. The gesture vocabulary is closed, so the
      // verb is a lookup; the control is an id until the act has run, and the
      // app says its own name back in the result (see toolResult).
      case 'act': {
        const doing = ACT_GERUND[input.gesture] ?? 'Acting on';
        return out(`${doing} ${input.id ?? 'a control'}`, input.path ?? '');
      }
      case 'read_affordances':
        return out(`What${where} affords${Array.isArray(input.ids) && input.ids.length ? ` · ${plural(input.ids.length, 'element')}` : ''}`, input.path ?? '');
      case 'list_documents': return out('Listed documents');
      case 'create_document': return out(`Creating${where}`, input.path ?? '');
      case 'read_guide': return out(input.section ? `Read the guide · ${input.section}` : 'Read the guide', input.section ?? '');
      case 'check_document': return out(`Check${where}`, input.path ?? '');
      case 'browser_navigate': return out(input.url ? `Open ${input.url}` : 'Open page', hostOf(input.url));
      case 'browser_snapshot': return out('Snapshot page');
      case 'browser_click': return out(input.ref ? `Click ${input.ref}` : 'Click', input.ref ?? '');
      case 'browser_type': return out('Type in page');
      case 'browser_tabs': return out(input.action === 'new' ? 'New tab' : input.action === 'close' ? 'Close tab' : 'Tabs');
      case 'browser_take_screenshot': return out('Screenshot');
      case 'browser_close': return out('Close browser');
      case 'browser_navigate_back': return out('Back');
      case 'WebSearch':
      case 'web_search': {
        const q = input.search_term || input.query || '';
        return out(q ? `Search ${q}` : 'Web search', q);
      }
      case 'Bash':
      case 'Shell':
      case 'shell': {
        const what = trimTo(input.description || input.command || input.cmd || '');
        return out(what ? `Ran ${what}` : 'Ran a command', what);
      }
      case 'Read':
      case 'read_file': { const t = tail(input.file_path ?? input.path); return out(`Read ${t}`, t); }
      case 'Grep': {
        const p = trimTo(input.pattern, 40);
        return out(`Grep ${p}${input.path ? ` in ${tail(input.path)}` : ''}`, p);
      }
      case 'Glob': { const p = trimTo(input.pattern, 40); return out(`Glob ${p}`, p); }
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit': { const t = tail(input.file_path ?? input.notebook_path); return out(`Edited ${t}`, t); }
      case 'Write': { const t = tail(input.file_path); return out(`Wrote ${t}`, t); }
      case 'LS': { const t = tail(input.path); return out(`Listed ${t}`, t); }
      case 'WebFetch': { const hst = hostOf(input.url); return out(`Fetched ${hst}`, hst); }
      case 'Task':
      case 'Agent': { const d = trimTo(input.description || input.prompt || ''); return out(d ? `Agent · ${d}` : 'Agent', d); }
      case 'TodoWrite':
      case 'updateTodos': return out('Updated todos');
      case 'Skill': return out(`Skill /${input.skill ?? input.name ?? ''}`, input.skill ?? '');
      default: {
        const arg = trimTo(firstString(input));
        return out(arg ? `${short} ${arg}` : short, arg);
      }
    }
  }

  // ------------------------------------------------------------ prose questions

  // The parser lives in runtime/choice-question.js so node can test it; this
  // classic script loads it once, the first time a turn finishes.
  let choiceModule = null;
  const loadChoice = () => {
    choiceModule ??= import('/runtime/choice-question.js').then((mod) => {
      Object.assign(window.marbleAgentUI, { parseChoiceQuestion: mod.parseChoiceQuestion });
      return mod;
    }).catch(() => null);
    return choiceModule;
  };

  // ------------------------------------------------------------ visuals

  // The same arrangement for the card a ```marble-visual block becomes. The
  // shell is built the moment the text renders; runtime/chat-visual.js — the
  // sandboxed frame, the palette, the wire back to the composer — follows.
  let visualModule = null;
  const loadVisual = () => {
    visualModule ??= import('/runtime/chat-visual.js').then((mod) => {
      Object.assign(window.marbleAgentUI, {
        readVisualInfo: mod.readVisualInfo,
        maskStreamingVisuals: mod.maskStreamingVisuals,
        visualDocument: mod.visualDocument,
        VISUAL_CSS: mod.VISUAL_CSS,
      });
      return mod;
    }).catch(() => null);
    return visualModule;
  };

  // ------------------------------------------------------------ tool runs

  // A run of finished steps folds into "7 steps" because reads and greps are
  // the agent's own business. An act is not: it happened in the person's
  // document, by the person's app, and it keeps its line.
  const foldable = (node) => node?.classList?.contains('tool')
    && node.dataset.state === 'done'
    && node.dataset.kind !== 'act';

  /** `Shell ×2 · Read harness.js, agents.mrbl +1 · Grep packFocus`. */
  function groupLabel(rows) {
    const kinds = new Map();
    for (const row of rows) {
      const short = row.dataset.short || 'Tool';
      const entry = kinds.get(short) ?? { n: 0, sources: [] };
      entry.n += 1;
      // A command is too long to be a summary; a file or a pattern is one.
      const source = short === 'Shell' ? '' : row.dataset.source;
      if (source && !entry.sources.includes(source)) entry.sources.push(source);
      kinds.set(short, entry);
    }
    return [...kinds].map(([short, { n, sources }]) => {
      const named = sources.slice(0, 2).join(', ');
      const more = sources.length > 2 ? ` +${sources.length - 2}` : '';
      const count = n > 1 ? ` ×${n}` : '';
      return `${short}${count}${named ? ` ${named}${more}` : ''}`;
    }).join(' · ');
  }

  function makeGroup(rows) {
    const group = h('div', 'tool-group');
    group.dataset.open = 'false';
    const head = h('button', 'tool-group-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.append(h('span', 'tool-group-count'), h('span', 'tool-group-kinds'));
    const body = h('div', 'tool-group-body');
    body.hidden = true;
    head.addEventListener('click', () => {
      const open = group.dataset.open !== 'true';
      group.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
    group.append(head, body);
    rows[0].before(group);
    for (const row of rows) body.append(row);
    return group;
  }

  function paintGroup(group) {
    const rows = [...group.querySelectorAll(':scope > .tool-group-body > .tool')];
    group.querySelector('.tool-group-count').textContent = `${rows.length} steps`;
    const kinds = group.querySelector('.tool-group-kinds');
    kinds.textContent = groupLabel(rows);
    group.querySelector('.tool-group-head').title = kinds.textContent;
  }

  /** Fold every run of two or more finished rows in `nodes` (siblings, in
   *  order). A finished row right after a group joins it. Pending, failed and
   *  refused rows stand alone and end a run. */
  function collapseToolRows(nodes) {
    let run = [];
    let group = null;
    const flush = () => {
      if (group) {
        for (const row of run) group.querySelector('.tool-group-body').append(row);
        paintGroup(group);
      } else if (run.length >= 2) {
        paintGroup(makeGroup(run));
      }
      run = [];
      group = null;
    };
    for (const node of nodes) {
      if (node.classList?.contains('tool-group')) {
        flush();
        group = node;
        continue;
      }
      if (foldable(node)) {
        run.push(node);
        continue;
      }
      flush();
    }
    flush();
  }

  // ------------------------------------------------------------ the view

  // The ask card's rules stand alone so a page drawing the card outside a
  // conversation's shadow root (the Agents page's Deck) can carry them too.
  const ASK_CSS = `
    .ask { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); display: grid; gap: 10px; box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent); }
    .ask .ask-q { display: grid; gap: 6px; }
    .ask .ask-title { font-weight: 600; font-size: 13px; }
    .ask pre { margin: 0; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; background: var(--paper-2); padding: 6px 8px; border-radius: 8px; }
    .ask .ask-options { display: grid; gap: 3px; }
    .ask .ask-options button {
      display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: baseline; text-align: left;
      font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; background: none; color: inherit; cursor: pointer;
    }
    .ask .ask-options button:hover, .ask .ask-options button:focus-visible { background: var(--paper-2); outline: none; }
    .ask .ask-options button[aria-checked="true"] { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 10%, transparent); }
    /* Longhands, not the shorthand: inherit is a CSS-wide keyword and cannot
       stand in for the family component, so "font: 11px/1.4 inherit" is invalid
       and the whole declaration is dropped — these kbds were rendering at the
       UA's 14px monospace default, not 11px in the UI's own face. */
    .ask .ask-options kbd { font-family: inherit; font-size: 11px; line-height: 1.4; color: var(--faint); text-align: center; border: 1px solid var(--line); border-radius: 4px; }
    .ask .ask-options b { font-weight: 500; }
    .ask .ask-options small { grid-column: 2; color: var(--muted); font-size: 11.5px; }
    .ask .ask-other-text { font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; margin-left: 26px; }
    .ask .ask-other-text[hidden] { display: none; }
    .ask .ask-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ask .ask-actions button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: none; color: inherit; cursor: pointer; }
    .ask .ask-actions button.allow, .ask .ask-actions button.answer { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
    .ask .ask-actions button:disabled { opacity: .5; cursor: default; }
    .ask .deny-note { flex: 1; min-width: 8em; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; }
  `;

  const CONVERSATION_CSS = `
    /* --conv-surface is the page's handle on this conversation's paper: a
       pane sets it to tint the whole card — chrome, transcript and composer
       together — when focus lands on it. Unset, it is the page's own paper. */
    :host { display: flex; flex-direction: column; min-height: 0; background: var(--conv-surface, var(--paper)); overflow: visible; }
    /* In a pane, focus moving is a change of light, not a cut. Only there: a
       lone conversation takes the page's palette the instant it mounts. */
    :host([data-focused]) { transition: background-color 200ms var(--settle), opacity 200ms var(--settle); }
    .mast { flex: none; padding: 10px 18px 8px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; background: var(--conv-surface, var(--paper)); }
    .mast[hidden] { display: none; }
    :host([data-chrome="pane"]) .heading { display: none; }
    :host([data-chrome="pane"]) .mast:not(:has(.tag)) { display: none; }
    :host([data-chrome="pane"]) .mast { padding-top: 8px; }
    /* A tile is a pane sharing the screen with others. It keeps its mast and
       its bar — two panes side by side should both say what they are — and
       only gives up padding. */
    :host([data-chrome="tile"]) .composer { --edge: 8px; padding: 4px var(--edge) 8px; }
    :host([data-chrome="tile"]) .log { padding: 6px 12px calc(12px + var(--queued-space, 0px)); }
    :host([data-chrome="tile"]) .mast { padding: 6px 12px 6px; }
    /* A callout is the conversation drawn at the region it is about. The
       card around it carries the title, the status and the moves, so the
       mast keeps only its tags — the model and the target read once — and
       the log folds behind a one-line ticker. The card has no height of its
       own, so the log sizes to its content and stops at half the window. */
    :host([data-chrome="callout"]) .mast { padding: 2px 12px 0; border-bottom: 0; }
    :host([data-chrome="callout"]) .mast:not(:has(.tag)) { display: none; }
    :host([data-chrome="callout"]) .heading,
    :host([data-chrome="callout"]) .target-jump,
    :host([data-chrome="callout"]) .zone-row,
    :host([data-chrome="callout"]) .also { display: none; }
    :host([data-chrome="callout"]) .log { flex: 0 1 auto; padding: 6px 12px calc(10px + var(--queued-space, 0px)); max-height: min(50vh, 360px); overflow-y: auto; }
    :host([data-chrome="callout"][data-folded]) .log { display: none; }
    .ticker { display: none; }
    :host([data-chrome="callout"]) .ticker:not([hidden]) {
      display: block; flex: none; width: 100%; text-align: left; font: inherit; font-size: 12.5px; line-height: 1.4;
      color: var(--muted); background: none; border: 0; padding: 4px 12px; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    :host([data-chrome="callout"]) .ticker:hover { color: var(--ink); }
    :host([data-chrome="callout"]) .composer { --edge: 10px; padding: 4px var(--edge) 10px; }
    /* A phone shows one conversation, full screen. The mast folds to one line
       — the fold and the thumb-sized controls are at the foot of this sheet,
       after the rules they override — the transcript takes the width, and
       type is the size a thumb reads. */
    :host([data-chrome="phone"]) .log { padding: 8px 14px calc(12px + var(--queued-space, 0px)); font-size: 17px; line-height: 1.45; }
    :host([data-chrome="phone"]) .composer { --edge: 10px; padding: 6px var(--edge) calc(8px + env(safe-area-inset-bottom, 0px)); }
    :host([data-chrome="phone"]) .msg { max-width: none; }
    /* A pane that is not the focused one steps back: the page dims its
       surface, and the transcript loses a little colour with it. */
    :host([data-focused="false"]) .log { filter: saturate(.85); }
    :host([data-focused]) .log { transition: filter 200ms var(--settle); }
    :host([data-focused]) .mast, :host([data-focused]) .composer { transition: background-color 200ms var(--settle); }
    /* Longhands, not the font shorthand: "inherit" is a CSS-wide keyword and
       cannot stand in for one component of it, so "font: 500 15px/1.3 inherit"
       was dropped whole and this h2 rendered at the UA's 1.5em bold — 21px,
       which is what read as "the title is too big". */
    .heading { margin: 0; font-weight: 500; font-size: 13px; line-height: 1.3; letter-spacing: -.015em; outline: none; min-height: 1.3em; border-radius: 6px; padding: 2px 4px; margin-left: -4px; }
    .heading:hover { background: var(--paper-2); }
    .heading:focus { background: var(--card); box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft); }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tags:empty { display: none; }
    /* Tags and the document this chat is working in share one line: they are
       the same kind of fact about the conversation — what it is running as,
       and where it lands. The link wraps to its own line before it truncates
       away, so a deep path is still readable. */
    .mast-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
    /* A way out of this chat, so it wears a link's colour and the arrow that
       leaves its box. It is the document the agent is working in — the one
       name in the mast that is somewhere else. */
    .target-jump {
      display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%;
      font-size: 11.5px; line-height: 1.35; color: var(--accent-ink); text-decoration: none;
      padding: 1px 5px; margin: -1px -5px; border-radius: 6px;
      transition: background-color .13s var(--snap), color .13s var(--snap);
    }
    .target-jump[hidden] { display: none; }
    .target-jump .target-what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .target-jump .target-out { flex: none; display: inline-flex; opacity: .7; }
    .target-jump .target-out[hidden] { display: none; }
    .target-jump:hover, .target-jump:focus-visible { background: var(--paper-2); color: var(--ink); outline: none; }
    .target-jump:hover .target-out, .target-jump:focus-visible .target-out { opacity: 1; }
    /* A pane hides its mast when there is nothing on it; the target is something. */
    :host([data-chrome="pane"]) .mast:not([hidden]):has(.target-jump:not([hidden])) { display: flex; }
    ${TAG_CSS}
    /* --queued-space is how tall the floating queue is at this moment. The
       stack hovers over the foot of the log, so the log has to end that much
       higher: without the room, the last thing said sits under the stack and
       there is nothing left to scroll. */
    .log { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px calc(16px + var(--queued-space, 0px)); display: flex; flex-direction: column; gap: 0; overscroll-behavior: contain; }
    .msg { max-width: none; overflow-wrap: anywhere; }
    /* A prompt still waiting is the floating row and nothing else. Its bubble
       is made here, in log order, and held back until the turn starts. */
    .msg.me[data-waiting] { display: none; }
    .msg.me {
      align-self: stretch; background: var(--paper-2); color: var(--ink);
      padding: 10px 12px; border-radius: 10px; margin: 14px 0 8px; font-weight: 500;
      white-space: pre-wrap; border: 1px solid var(--line);
    }
    .msg.me:first-child { margin-top: 4px; }
    /* A bubble that another agent wrote, not the person: same paper, marked
       down its edge so the transcript reads as one column with a visible
       seam where someone else spoke. The mark is a clean bar, not a border:
       a border-left on a 10px bubble bent round both corners, and a corner
       belongs to the bubble, not to what is drawn on it. So it is a straight
       bar with square ends, lifted inside the edge and stopped a radius short
       of each end — the same rule a library row wears for its folder. The
       words' indent is derived from the bar, never typed. */
    .msg.me.from-agent {
      --rule-w: 3px; --rule-in: 6px; --rule-gap: 8px;
      padding-left: calc(var(--rule-in) + var(--rule-w) + var(--rule-gap));
      background-image: linear-gradient(var(--accent-ink), var(--accent-ink));
      background-repeat: no-repeat;
      background-size: var(--rule-w) calc(100% - 20px);
      background-position: var(--rule-in) center;
    }
    /* The whole row opens the sending conversation, not just the name in it. */
    .msg.me .from { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; cursor: pointer; }
    .msg.me .from button { all: unset; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line); }
    .msg.me .from button:hover { color: var(--ink); }
    .msg.agent { align-self: stretch; color: var(--ink); padding: 2px 2px 10px; }
    .msg.agent.live { color: var(--muted); white-space: pre-wrap; }
    .msg.agent p { margin: 0 0 .5em; } .msg.agent p:last-child { margin-bottom: 0; }
    .msg.agent ul, .msg.agent ol { margin: .25em 0 .5em; padding-left: 1.25em; }
    .msg.agent code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--paper-2); padding: 1px 4px; border-radius: 4px; }
    .msg.agent pre { background: var(--paper-2); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
    .msg.agent pre code { background: none; padding: 0; }
    .msg.agent li + li { margin-top: .15em; }
    .msg.agent .loose > li + li { margin-top: .5em; }
    .msg.agent li > ul, .msg.agent li > ol { margin: .15em 0 .25em; }
    .msg.agent li > p { margin: .35em 0 0; }
    .md-task { list-style: none; margin-left: -1.25em; }
    .md-task::before { content: '☐'; display: inline-block; width: 1.25em; color: var(--muted); }
    .md-task[data-done="true"]::before { content: '☑'; }
    /* A heading is a section of one reply: a step of weight and a little air
       above, never a title. */
    .msg .md-h { font-size: 1em; font-weight: 600; line-height: 1.35; margin: 1em 0 .35em; color: var(--ink); }
    .msg .md-h[data-level="1"] { font-size: 1.14em; }
    .msg .md-h[data-level="2"] { font-size: 1.07em; }
    .msg .md-h[data-level="4"] { color: var(--muted); }
    .msg .md-h:first-child { margin-top: 0; }
    .msg.agent hr { border: 0; border-top: 1px solid var(--line); margin: .9em 0; }
    .msg.agent blockquote { margin: .25em 0 .6em; padding: 0 0 0 12px; color: var(--muted); box-shadow: inset 3px 0 0 var(--line); }
    .msg.agent del { color: var(--muted); }
    .md-table { overflow-x: auto; margin: .35em 0 .7em; border: 1px solid var(--line); border-radius: 8px; }
    .md-table table { border-collapse: collapse; width: 100%; font-size: 13px; line-height: 1.45; }
    .md-table th, .md-table td { text-align: left; vertical-align: top; padding: 6px 10px; overflow-wrap: normal; min-width: 8ch; }
    .md-table th { font-weight: 600; background: var(--paper-2); border-bottom: 1px solid var(--line); }
    .md-table tr + tr td { border-top: 1px solid var(--line); }
    .md-table th + th, .md-table td + td { border-left: 1px solid var(--line); }
    .msg.agent a { color: var(--accent-ink); }
    .tool { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: var(--muted); padding: 1px 2px 1px 2px; }
    .tool::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--faint); transform: translateY(-1px); }
    .tool[data-state="pending"]::before { background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .tool[data-state="done"]::before { background: var(--accent-ink); }
    .tool[data-state="refused"] { color: var(--caution); } .tool[data-state="refused"]::before { background: var(--caution); }
    /* A line of text you can tap. It is a button because on a phone it opens
       the list of who else is in here — everywhere else it is just the line,
       so none of the UA's button chrome comes with it. */
    .also { appearance: none; -webkit-appearance: none; border: 0; background: none; padding: 0; margin: 0; font: inherit; text-align: left; cursor: default; }
    .mast .also { font-size: 11.5px; color: var(--faint); margin-top: 2px; }
    .mast .also[hidden] { display: none; }
    .also-short { display: none; }
    /* Where this conversation's hands are. It wears the agent's own violet —
       the same one the construction zone draws itself in on the document — so
       the row and the box on the page are visibly one thing, and neither is
       mistaken for a control of the app's. */
    .zone-jump {
      --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink)));
      align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
      max-width: 100%; margin-top: 1px; padding: 3px 9px 3px 8px;
      appearance: none; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--zone-mark) 30%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--zone-mark) 10%, transparent);
      color: color-mix(in srgb, var(--zone-mark) 64%, var(--ink));
      font: 500 11.5px/1.3 inherit; letter-spacing: -.01em; text-align: left;
      transition: background-color .13s var(--snap), color .13s var(--snap);
    }
    .zone-jump[hidden] { display: none; }
    /* Going once and going along are the same errand at two lengths, so they
       share a row: the arrow takes you there now, the eye keeps you with the
       agent as it moves — to the next element, and on to the next document. */
    .zone-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .zone-row[hidden] { display: none; }
    .zone-row .zone-jump { min-width: 0; }
    .zone-follow {
      --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink)));
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px 3px 6px;
      border: 1px solid color-mix(in srgb, var(--zone-mark) 30%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--zone-mark) 10%, transparent);
      color: color-mix(in srgb, var(--zone-mark) 64%, var(--ink));
      font: inherit;
      cursor: pointer;
    }
    .zone-follow svg { width: 13px; height: 13px; display: block; }
    .zone-follow:hover { background: color-mix(in srgb, var(--zone-mark) 18%, transparent); color: var(--zone-mark); }
    .zone-follow:focus-visible { outline: 2px solid var(--zone-mark); outline-offset: 2px; }
    /* On, it is not an offer any more: it is a state you are in. */
    .zone-follow[aria-pressed="true"] { background: var(--zone-mark); border-color: var(--zone-mark); color: var(--paper); }
    .zone-follow[aria-pressed="true"]:hover { color: var(--paper); opacity: .88; }
    .zone-jump:hover { background: color-mix(in srgb, var(--zone-mark) 18%, transparent); color: var(--zone-mark); }
    .zone-jump:focus-visible { outline: 2px solid var(--zone-mark); outline-offset: 2px; }
    .zone-jump .zone-live { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--zone-mark); animation: pulse 1.2s var(--snap) infinite; }
    .zone-jump .zone-what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zone-jump .zone-go { flex: none; opacity: .72; }
    /* A pane hides its mast when there is nothing on it; a live zone is something. */
    :host([data-chrome="pane"]) .mast:not([hidden]):has(.zone-row:not([hidden])) { display: flex; }
    @media (prefers-reduced-motion: reduce) { .zone-jump .zone-live { animation: none; } }
    ${ASK_CSS}
    .tool[data-state="failed"] { color: var(--danger); } .tool[data-state="failed"]::before { background: var(--danger); }
    .turn-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--faint); padding: 4px 2px 10px; }
    .turn-footer[data-status="failed"] .status { color: var(--danger); }
    .turn-footer .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .turn-footer button { font: inherit; color: var(--accent-ink); background: none; border: 0; padding: 2px 6px; margin: -2px -6px; border-radius: 6px; cursor: pointer; }
    .turn-footer button:hover { background: var(--accent-soft); }
    .turn-footer button:disabled { color: var(--faint); cursor: default; }
    .turn-footer .watch { color: var(--caution); }
    .system { align-self: center; font-size: 12px; color: var(--faint); text-align: center; max-width: 90%; padding: 8px 0; }
    .system.error { color: var(--danger); }
    /* Prompts waiting their turn hover over the composer rather than pushing
       it down the pane. The box you are typing in must not move because
       something you already sent is still queued, so the stack lifts off the
       top of the card, lined up with its sides and casting the same shadow. */
    .queued {
      position: absolute; left: var(--edge); right: var(--edge); bottom: 100%; z-index: 2;
      display: flex; flex-direction: column; gap: 4px;
      /* About five rows, then it scrolls: a long queue floating over a short
         pane would otherwise reach up past the mast and out of the card. */
      max-height: min(40vh, 190px); overflow-y: auto; overscroll-behavior: contain;
      /* Padding the scroller keeps it from cutting the rows' shadows off at
         its own edges; the negative margin puts the rows back on the card's. */
      padding: 6px; margin: 0 -6px;
    }
    .queued[hidden] { display: none; }
    .queued-bar { display: flex; align-items: center; align-self: flex-start; background: var(--paper-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px; box-shadow: var(--shadow-rest); }
    .queued-bar[hidden] { display: none; }
    .queued-bar button { font: inherit; font-size: 11px; font-weight: 500; border: 0; background: none; color: var(--muted); padding: 3px 9px; border-radius: 999px; cursor: pointer; }
    .queued-bar button[aria-pressed="true"] { color: var(--ink); background: var(--card); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent); }
    .queued-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 3px 4px 3px 6px; box-shadow: var(--shadow-rest); }
    .queued-dispatch { flex: none; font: inherit; font-size: 11px; font-weight: 500; color: var(--accent-ink); background: var(--paper-2); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; cursor: pointer; }
    .queued-item[data-dispatch="interrupt"] .queued-dispatch { color: var(--caution); }
    .queued-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; border-radius: 6px; padding: 2px 4px; outline: none; }
    .queued-text[contenteditable] { white-space: normal; background: var(--paper-2); box-shadow: 0 0 0 1px var(--accent); color: var(--ink); }
    .queued-item button.dequeue { font: inherit; border: 0; background: none; color: var(--muted); width: 22px; height: 22px; border-radius: 6px; cursor: pointer; flex: none; }
    .queued-item button.dequeue:hover { background: var(--line); }
    /* The rule across the top is gone. A pane already draws one under its
       mast, and a second one here fenced the composer off as a strip of chrome
       — what ends the transcript now is the card itself, over a short fade
       where the log runs under it. --edge is how far that card is held off the
       pane's sides, so the floating queue can line up with it. The space below
       stays: the drawer's launcher floats in the bottom-right corner of the
       page, and the send button is the last thing that should end up under it. */
    .composer { --edge: 10px; position: relative; flex: none; padding: 6px var(--edge) calc(var(--edge) + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 6px; background: var(--conv-surface, var(--paper)); }
    .composer::before { content: ''; position: absolute; left: 0; right: 0; bottom: 100%; height: 14px; pointer-events: none; background: linear-gradient(to top, var(--conv-surface, var(--paper)), transparent); }
    .picker { display: flex; flex-flow: row nowrap; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); overflow: visible; flex: 0 0 auto; width: fit-content; max-width: 100%; min-width: 0; }
    .picker[hidden] { display: none; }
    /* The setup takes what the buttons leave, so a crowded picker folds its
       trailing segments into dropdowns instead of wrapping the bar. It may
       wrap — on a phone-width pane the pickers genuinely want their own line —
       but the saved setups and the Custom toggle wrap as one thing. Left to
       themselves they came apart under a squeeze, and Custom alone on a second
       row was a line of bar spent on a word: what should give there is the
       track, which has a ••• to fold into and a fitter that knows when. */
    .setup { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1 1 0; min-width: 0; position: relative; z-index: 3; }
    .setup[hidden] { display: none; }
    .setup-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; }
    .setup-row[data-wrap] { flex-wrap: wrap; }
    .setup-row:not(:has(> :not([hidden]))) { display: none; }
    .presets {
      display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 0;
      flex: 0 1 auto; width: max-content; max-width: 100%; min-width: 0;
      position: relative; isolation: isolate;
      background: none; border: 0; border-radius: 0; padding: 0;
    }
    .presets[hidden] { display: none; }
    .preset { position: relative; display: inline-flex; align-items: center; cursor: pointer; margin: 0; z-index: 1; flex: none; }
    .preset input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 2; }
    .preset span {
      display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
      color: var(--muted); font-size: 11px; font-weight: 500; white-space: nowrap; position: relative; z-index: 1; pointer-events: none;
    }
    .preset input:checked + span { color: var(--ink); background: transparent; box-shadow: none; }
    .preset input:focus-visible + span { box-shadow: 0 0 0 3px var(--accent-soft); }
    .preset input:disabled + span { opacity: .45; cursor: default; }
    .preset .brand { width: 11px; height: 11px; flex: none; }
    .presets-more {
      appearance: none; border: 0; background: none; color: var(--ink);
      font: inherit; min-width: 28px; height: 22px; padding: 0 6px; border-radius: 7px;
      cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center;
      position: relative; z-index: 1;
    }
    .presets-more:not(.is-current) { width: 28px; }
    .presets-more:hover, .presets.is-open .presets-more { color: var(--ink); background: var(--paper-2); }
    .presets-more, .seg-current, .custom-toggle, .failover, .mode { transition: background-color .13s var(--snap), color .13s var(--snap); }
    .presets-more[hidden] { display: none; }
    .presets-more.is-current {
      width: auto; max-width: 100%; min-width: 0; height: auto;
      padding: 3px 6px; gap: 5px; color: var(--ink);
      background: none; box-shadow: none;
    }
    .presets-more.is-current::after {
      content: ''; width: 0; height: 0; flex: none;
      border-left: 3.5px solid transparent; border-right: 3.5px solid transparent;
      border-top: 4px solid var(--muted);
    }
    .presets-more span { display: inline-flex; align-items: center; gap: 5px; min-width: 0; font-size: 11px; font-weight: 500; white-space: nowrap; padding: 0; background: none; border-radius: 0; box-shadow: none; width: auto; }
    .presets-more.is-current span { overflow: hidden; }
    .presets-more .brand { width: 11px; height: 11px; flex: none; }
    /* margin and color reset the popover UA sheet, which centres [popover] in
       the viewport with an auto margin and paints it in system colours. */
    .presets-menu {
      display: none; position: absolute; bottom: calc(100% + 6px); top: auto; right: 0; left: auto; z-index: 12;
      margin: 0; color: inherit; width: auto; height: auto;
      min-width: max(100%, 11rem); max-height: min(16rem, 45vh); overflow: auto; flex-direction: column; gap: 1px; padding: 5px;
      background: color-mix(in srgb, var(--card) 92%, transparent); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow-lift); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      opacity: 0; transform: translateY(4px) scale(.96); transform-origin: 50% 100%;
      transition: opacity .12s var(--snap), transform .12s var(--snap), display .12s allow-discrete, overlay .12s allow-discrete;
    }
    .presets.is-open .presets-menu {
      display: flex; opacity: 1; transform: none;
      transition: opacity .15s var(--settle), transform .19s var(--settle), display .19s allow-discrete, overlay .19s allow-discrete;
    }
    @starting-style {
      .presets.is-open .presets-menu { opacity: 0; transform: translateY(4px) scale(.96); }
    }
    .presets-menu .preset { width: 100%; }
    .presets-menu .preset span {
      width: 100%; border-radius: 9px; padding: 7px 10px; justify-content: flex-start;
      transition: background-color .13s var(--snap), color .13s var(--snap);
    }
    .presets-menu input:checked + span { background: var(--paper-2); }
    /* The row under the pointer says so. The span is pointer-events: none so
       the radio underneath can take the click, which is why the hover is read
       off the label rather than the span. */
    .presets-menu .preset:hover input:not(:disabled) + span { background: var(--paper-2); color: var(--ink); }
    .presets-menu .preset:hover input:checked + span { background: var(--paper-3); }
    /* ⌃⌥ raises the same setups as a scrubber. A menu is for reading a list
       and picking out of it; this is for moving along one, which is what a
       held modifier and two arrows are. So it is a line with stops on it and
       the one you are on named above — the choice as a position, not as a
       row of options, and the same four names either way.
       Absolutely positioned pieces inside a flex track: the rail spans dot
       centre to dot centre, which is half a stop in from each end, and the
       knob and fill are moved in pixels off that same origin (paintScrub
       measures the track) so both animate on transform and width rather than
       on a calc nobody can interpolate. */
    .scrub {
      display: none; position: fixed; z-index: 13;
      margin: 0; color: inherit; width: auto; height: auto;
      flex-direction: column; gap: 7px; padding: 8px 12px 7px; overflow: visible;
      background: var(--card);
      border: 1px solid var(--line); border-radius: 11px;
      box-shadow: var(--shadow-rest);
      opacity: 0; transform: translateY(6px) scale(.94); transform-origin: 50% 100%;
      transition: opacity .12s var(--snap), transform .12s var(--snap), display .12s allow-discrete, overlay .12s allow-discrete;
    }
    .scrub.is-open {
      display: flex; opacity: 1; transform: none;
      transition: opacity .16s var(--settle), transform .22s var(--settle), display .22s allow-discrete, overlay .22s allow-discrete;
    }
    @starting-style {
      .scrub.is-open { opacity: 0; transform: translateY(6px) scale(.94); }
    }
    .scrub-now {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      font-size: 11px; white-space: nowrap; line-height: 1.3;
    }
    .scrub-model { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
    .scrub-model .brand { width: 11px; height: 11px; flex: none; }
    /* Effort has a colour, and the colour is the scale: grey at the bottom,
       through a true blue, into indigo, and out at a weighted purple. The
       word, the bars beside it and the word under each model name all read
       from the same five, so "how hard" is one thing you learn once. */
    .scrub {
      --e-low: #8a8a8a; --e-medium: #5b7fa6; --e-high: #2f6fd0;
      --e-xhigh: #4b3fbd; --e-max: #7b2fb8;
    }
    .scrub [data-at="low"] { --e: var(--e-low); --e-weight: 500; }
    .scrub [data-at="medium"] { --e: var(--e-medium); --e-weight: 500; }
    .scrub [data-at="high"] { --e: var(--e-high); --e-weight: 600; }
    .scrub [data-at="xhigh"] { --e: var(--e-xhigh); --e-weight: 600; }
    .scrub [data-at="max"] { --e: var(--e-max); --e-weight: 700; }
    /* Every word of the scale in one grid cell, so the cell is as wide as the
       longest of them whichever is showing and the model name beside it never
       moves — which is what it did when this was one span being rewritten.
       Both words are also on screen at the switch, so the one being replaced
       can sink out while the new one rises in. */
    .scrub-effort, .scrub-stop-effort { display: inline-grid; justify-items: center; align-items: center; }
    .scrub-effort[hidden], .scrub-stop-effort[hidden] { display: none; }
    .scrub-effort > i, .scrub-stop-effort > i {
      grid-area: 1 / 1; font-style: normal; white-space: nowrap;
      color: var(--e, var(--muted));
      /* The words that are not showing still size the cell, and they hold it
         at the heaviest weight on the scale. Bolder text is wider text, so
         without this the cell breathed by a pixel as the weight animated and
         the model name walked along with it. */
      font-weight: 700;
      opacity: 0; transform: translateY(3px);
      transition: opacity .16s var(--settle), transform .18s var(--settle),
        color .2s var(--snap), font-weight .2s var(--snap);
    }
    .scrub-effort > i.is-on, .scrub-stop-effort > i.is-on {
      opacity: 1; transform: none; font-weight: var(--e-weight, 500);
    }
    .scrub-stop-effort > i { font-size: 9px; }
    /* A stop you are not on still says what it is remembering, but quietly:
       at full strength a purple Max two stops away pulls harder than the
       choice you are actually making. */
    .scrub-stop-effort { opacity: .5; transition: opacity .16s var(--snap); }
    .scrub-stop.is-at .scrub-stop-effort { opacity: 1; }
    /* The second axis, said in the smallest thing that can say it: five bars,
       filled to where the effort is. Up and down are legible from a shape
       that already means more and less; a line of prose would be louder than
       the control. They light along their length rather than all at once. */
    .scrub-gauge { display: inline-flex; align-items: flex-end; gap: 1px; height: 11px; margin-left: 1px; }
    .scrub-gauge[hidden] { display: none; }
    .scrub-gauge > i {
      width: 2px; border-radius: 1px; background: var(--paper-3);
      transition: background-color .2s var(--snap) calc(var(--i, 0) * 22ms);
    }
    .scrub-gauge > i.is-on { background: var(--e, var(--accent-ink)); }
    .scrub-track { position: relative; display: flex; align-items: flex-start; min-width: 198px; }
    .scrub-rail, .scrub-fill { position: absolute; top: 2px; height: 2px; border-radius: 2px; left: calc(50% / var(--n)); }
    .scrub-rail { right: calc(50% / var(--n)); background: var(--paper-3); }
    .scrub-fill { width: 0; background: var(--accent); transition: width .24s var(--settle); }
    .scrub-knob {
      position: absolute; top: -1px; left: calc(50% / var(--n)); margin-left: -3px;
      width: 6px; height: 6px; border-radius: 999px; background: var(--ink);
      box-shadow: 0 0 0 2.5px var(--card);
      transition: transform .24s var(--settle);
    }
    .scrub-stop { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0 3px; }
    .scrub-dot { width: 4px; height: 4px; margin-top: 1px; border-radius: 999px; background: var(--paper-3); transition: background-color .16s var(--snap); }
    /* The knob is standing on it. */
    .scrub-stop.is-at .scrub-dot { background: transparent; }
    .scrub-name { font-size: 10px; font-weight: 500; color: var(--faint); white-space: nowrap; transition: color .16s var(--snap); }
    .scrub-stop.is-at .scrub-name { color: var(--ink); }
    .keytip {
      display: none; position: fixed; z-index: 14;
      margin: 0; width: auto; height: auto; overflow: visible;
      padding: 4px 8px; border: 1px solid var(--line); border-radius: 7px;
      background: var(--card); color: var(--muted); box-shadow: var(--shadow-rest);
      font-size: 10px; font-weight: 500; white-space: nowrap; pointer-events: none;
      text-align: left;
      opacity: 0; transform: translateY(3px); transform-origin: 50% 100%;
      transition: opacity .1s var(--snap), transform .1s var(--snap), display .1s allow-discrete, overlay .1s allow-discrete;
    }
    /* A tip that names a mode wants its second line, so newlines survive —
       and a tip is still never wide enough to wrap on its own. */
    .keytip.is-multi { white-space: pre-line; }
    .keytip.is-open {
      display: block; opacity: 1; transform: none;
      transition: opacity .14s var(--settle), transform .14s var(--settle), display .14s allow-discrete, overlay .14s allow-discrete;
    }
    @starting-style {
      .keytip.is-open { opacity: 0; transform: translateY(3px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .scrub, .scrub.is-open { transition: none; transform: none; }
      .scrub-fill, .scrub-knob { transition: none; }
      .keytip, .keytip.is-open { transition: none; transform: none; }
    }
    .custom-toggle {
      appearance: none; border: 0; background: none; color: var(--muted);
      font: inherit; font-size: 11px; font-weight: 500; padding: 3px 6px; border-radius: 7px; cursor: pointer; flex: none;
    }
    .custom-toggle:hover { color: var(--ink); background: var(--paper-2); }
    .custom-toggle[aria-expanded="true"] { color: var(--ink); background: var(--paper-2); }
    .custom-toggle[hidden] { display: none; }
    /* Nothing is a capsule any more, so there is no capsule to slide inside. */
    .seg-thumb { display: none; }
    /* The settings strip. Now that the send button is not standing in it, the
       bar owns its whole width honestly: setups from the left edge, mode at
       the right. The hairline that used to run above it is gone with the one
       over the composer — being outside the card is what says these configure
       the next turn rather than belonging to the message, and a rule under a
       floating card only puts it back on a shelf. */
    .bar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      min-height: 28px; min-width: 0;
      padding: 6px 0 0;
    }
    /* Nothing to configure — no provider, no modes — so there is no strip and
       no rule floating under the message. */
    .bar:not(:has(> :not([hidden]):not(.bar-space))) { display: none; }
    /* Everything after the spacer is the send end of the bar. On one row the
       setup already pushes it to the right edge; on the second row a wrapped
       setup leaves behind, the spacer is what holds it there. */
    .bar-space { flex: 0 0 0; min-width: 0; }
    .bar[data-wrap] .setup { flex-basis: 100%; }
    .bar[data-wrap] .bar-space { flex: 1 1 0; }
    /* Pinned to the setup's first row rather than centred against it: when
       Custom opens a second row of pickers, a centred label floats in the
       gutter beside them instead of sitting on a line with anything. The 2px
       is what centres it against a single row, so one rule serves both. */
    .mode { flex: none; align-self: flex-start; margin-top: 2px; font: inherit; font-size: 11px; font-weight: 500; color: var(--accent-ink); background: none; border: 0; padding: 3px 6px; border-radius: 999px; cursor: pointer; }
    /* Two modes, drawn rather than named. "Auto" read as the Auto permission
       mode standing in the wrong row, and a bordered capsule made the quietest
       setting in the strip the loudest thing in it. So it borrows the preset
       overflow's borderless 22px slot: a baton handed to the next CLI, or a
       pause. The glyph says which mode is on; the hover tip says its name. */
    .failover {
      appearance: none; border: 0; background: none; color: var(--muted);
      flex: none; align-self: center; margin: 0; font: inherit;
      min-width: 22px; height: 22px; padding: 0 4px; border-radius: 7px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    }
    .failover:hover { color: var(--ink); background: var(--paper-2); }
    .failover-mark { display: inline-flex; flex: none; }
    .failover svg { display: block; flex: none; }
    /* The word rides along only where nothing can be hovered to ask: the phone
       sheet has the room, and a bare glyph there names nothing. */
    .failover-word { display: none; font-size: 11px; font-weight: 500; }
    .usage-note {
      margin: 0 0 8px; padding: 12px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--paper); color: var(--ink); font-size: 12px; line-height: 1.4;
    }
    .usage-note[hidden] { display: none; }
    .usage-note p { margin: 0 0 10px; }
    .usage-note .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .usage-note button {
      height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--ink);
      background: var(--ink); color: var(--paper); font: inherit; font-size: 12px; cursor: pointer;
    }
    .usage-note button.quiet { background: transparent; color: var(--ink); }
    .mode:hover { color: var(--ink); background: var(--paper-2); }
    .mode[hidden] { display: none; }
    .dispatch[hidden] { display: none; }
    .seg { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex: none; align-items: center; position: relative; }
    .seg legend {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0;
    }
    /* The settings bar is a line of words, not a row of capsules. Marble's
       chrome had a fill, a border and a radius on every control in it, so five
       rarely-touched choices carried more weight than the prompt above them.
       What is left is the label, its state, and a chevron where there is more.
       The fills come back only where a control has to look pressable in place:
       the Custom toggle when it is open, and the send button when it is armed. */
    .seg-opts {
      display: flex; flex-wrap: nowrap; gap: 0; flex: none; position: relative; isolation: isolate;
      background: none; border: 0; border-radius: 0; padding: 0;
    }
    /* This element is two things: the segmented row you see when the picker
       has room, and the sheet it folds into when it does not. Only the sheet
       is ever raised, but the popover attribute is on it either way — so the
       row has to undo the [popover] UA sheet in full. Left alone it is a
       fixed, centred, bordered box in system colours, taken out of flow,
       which is what stopped fitPicker from ever seeing the picker overflow.
       The is-drop rules further down put the sheet's own box back. */
    .seg-menu {
      display: flex; flex-wrap: nowrap; gap: 0;
      position: static; inset: auto; margin: 0; padding: 0; border: 0;
      width: auto; height: auto; overflow: visible; background: none; color: inherit;
    }
    .seg-current {
      display: none; appearance: none; border: 0; background: none; color: var(--ink);
      padding: 3px 6px; border-radius: 7px; font: inherit; font-size: 11px; font-weight: 500;
      cursor: pointer; align-items: center; gap: 5px;
    }
    .seg-current:hover, .seg-opts.is-open .seg-current { background: var(--paper-2); }
    .seg-current::after {
      content: ''; width: 0; height: 0;
      border-left: 3.5px solid transparent; border-right: 3.5px solid transparent;
      border-top: 4px solid var(--muted);
    }
    .seg-opts.is-drop { overflow: visible; padding: 1px; }
    .seg-opts.is-drop .seg-current { display: inline-flex; }
    /* A sheet is a thing that arrives, not a thing that blinks on: it grows a
       little out of the control that opened it (floatMenu sets the origin)
       and shrinks back into it on the way out, a touch quicker than it came.
       Transitioning display itself is what lets a display: none menu animate
       at all, and @starting-style is the state it enters from; a browser with
       neither still shows and hides it, which is where this started. */
    .seg-opts.is-drop .seg-menu {
      display: none; position: absolute; bottom: calc(100% + 6px); top: auto; left: 0; right: auto; z-index: 12;
      margin: 0; color: inherit;
      min-width: max(100%, 10.5rem); max-height: min(16rem, 45vh); overflow: auto; flex-direction: column; gap: 1px; padding: 5px;
      background: color-mix(in srgb, var(--card) 92%, transparent); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow-lift); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      opacity: 0; transform: translateY(4px) scale(.96); transform-origin: 50% 100%;
      transition: opacity .12s var(--snap), transform .12s var(--snap), display .12s allow-discrete, overlay .12s allow-discrete;
    }
    .seg:last-child .seg-opts.is-drop .seg-menu { left: auto; right: 0; }
    .seg-opts.is-drop.is-open .seg-menu {
      display: flex; opacity: 1; transform: none;
      transition: opacity .15s var(--settle), transform .19s var(--settle), display .19s allow-discrete, overlay .19s allow-discrete;
    }
    @starting-style {
      .seg-opts.is-drop.is-open .seg-menu { opacity: 0; transform: translateY(4px) scale(.96); }
    }
    /* Nothing should crawl for someone who asked it not to: the sheet still
       opens and closes, it just does it on one frame. */
    @media (prefers-reduced-motion: reduce) {
      .seg-opts.is-drop .seg-menu, .seg-opts.is-drop.is-open .seg-menu,
      .presets-menu, .presets.is-open .presets-menu { transition: none; transform: none; }
    }
    .seg-opts.is-drop .seg-menu label { width: 100%; }
    .seg-opts.is-drop .seg-menu span {
      width: 100%; border-radius: 9px; padding: 7px 10px; justify-content: space-between;
      transition: background-color .13s var(--snap), color .13s var(--snap);
    }
    .seg-opts.is-drop input:checked + span::after {
      content: ''; width: 5px; height: 9px; margin-right: 2px;
      border-right: 1.6px solid var(--ink); border-bottom: 1.6px solid var(--ink);
      transform: rotate(45deg) translate(-1px, -1px);
    }
    .seg-opts label { position: relative; display: inline-flex; align-items: center; cursor: pointer; margin: 0; z-index: 1; }
    .seg-opts input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 2; }
    .seg-opts span {
      display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
      border: 0; background: transparent; color: var(--muted); font-size: 11px; font-weight: 500; white-space: nowrap;
      position: relative; z-index: 1; pointer-events: none;
    }
    /* With no sliding capsule behind it, the chosen segment says so in the
       type: full ink against its muted neighbours, and a shade heavier. */
    .seg-opts input:checked + span { color: var(--ink); background: transparent; box-shadow: none; font-weight: 600; }
    .seg-opts.is-drop .seg-thumb { display: none; }
    .seg-opts.is-drop input:checked + span { box-shadow: none; background: var(--paper-2); }
    .seg-opts.is-drop .seg-menu label:hover input:not(:disabled) + span { background: var(--paper-2); color: var(--ink); }
    .seg-opts.is-drop .seg-menu label:hover input:checked + span { background: var(--paper-3); }
    .seg-opts input:focus-visible + span { box-shadow: 0 0 0 3px var(--accent-soft); }
    .seg-opts input:disabled + span { opacity: .45; cursor: default; }
    .seg[hidden] { display: none; }
    .slash { max-height: 12rem; overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift); padding: 4px; }
    .slash[hidden] { display: none; }
    .slash button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; font: inherit; text-align: left; color: var(--ink); background: none; border: 0; border-radius: 8px; padding: 6px 8px; cursor: pointer; }
    .slash button[aria-selected="true"], .slash button:hover { background: var(--accent-soft); }
    .slash button small { color: var(--faint); font-size: 11px; }
    /* A chip in the text: a pasted thing, or the document the message is
       about. Non-editable, so the caret steps over it and Backspace takes it
       out whole. */
    /* Every chip is the same object whatever it carries. An inline-flex box
       takes its baseline from its first item, so a chip holding a thumbnail
       took it from the image and one holding words took it from the words —
       two chips on the same line of prose, five pixels apart in height and ten
       apart in position. A fixed height and vertical-align: middle make the
       box's alignment a property of the chip rather than of its contents. */
    .ichip {
      display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
      height: 20px; box-sizing: border-box; vertical-align: middle;
      margin: 0 1px; padding: 0 4px 0 6px; border-radius: 999px;
      font-size: 12px; font-weight: 500; line-height: 1; color: var(--muted);
      background: var(--paper-2); border: 1px solid var(--line); cursor: pointer; user-select: none;
      transition: border-color 160ms var(--settle), background 160ms var(--settle);
    }
    .ichip:hover { border-color: var(--accent); background: var(--card); }
    /* Inside the chip's height, not setting it. */
    .ichip-shot { width: 14px; height: 14px; border-radius: 4px; object-fit: cover; background: var(--paper-3); flex: none; margin-left: -2px; }
    /* What stands in for a thumbnail that has no source to load, or whose blob
       went away with the page that made it. An <img> with an empty src resolves
       to the document and paints the browser's broken-image glyph, which is
       how a restored draft came back showing a torn page. */
    .ichip-mark { width: 14px; height: 14px; border-radius: 4px; flex: none; margin-left: -2px; background: var(--paper-3); display: grid; place-items: center; color: var(--faint); }
    .ichip-mark svg { width: 9px; height: 9px; }
    .ichip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ichip-clear { font: inherit; font-size: 12px; border: 0; background: none; color: var(--faint); width: 15px; height: 15px; border-radius: 50%; cursor: pointer; line-height: 1; padding: 0; flex: none; display: grid; place-items: center; }
    .ichip-clear:hover { background: var(--line); color: var(--ink); }
    /* The one thing the document pill said that the pane's bar does not: that
       the next turn carries a selection, and that you can decide it should not. */
    .selection { display: inline-flex; align-items: center; gap: 1px; flex: none; height: 22px; padding: 0 2px 0 6px; border-radius: 7px; font-size: 11px; font-weight: 500; color: var(--accent-ink); background: none; }
    .selection:hover { background: var(--paper-2); }
    .selection[hidden] { display: none; }
    .selection-clear { font: inherit; font-size: 12px; border: 0; background: none; color: inherit; width: 15px; height: 15px; border-radius: 50%; cursor: pointer; line-height: 1; padding: 0; opacity: .7; display: grid; place-items: center; }
    .selection-clear:hover { opacity: 1; background: color-mix(in srgb, var(--accent) 35%, transparent); }
    /* Two registers, not three strips. The message — what you attached, the
       document it is about, the words, and the button that sends them — is one
       field. What the next turn is configured with is a strip under it. The
       scale below is what says so: 4px inside a group, and the card's own edge
       where the meaning changes. Everything used to be 4–6px, so nothing
       grouped and the box had to do the separating itself. */
    .row {
      --sp-1: 4px; --sp-2: 0px;
      display: flex; flex-direction: column; align-items: stretch;
      background: none; border: 0; border-radius: 0; padding: 0;
    }
    /* The send button holds the end of the last line rather than living in the
       toolbar. In the toolbar it made the strip impossible to balance: crushed
       against five setups in a narrow pane, stranded past a wide gap in a wide
       one. Here it is where the sentence ends. */
    /* The message is a card that floats on the pane: rounded, held off its
       sides, lifted just enough to throw a shadow. The settings stay on the
       floor under it — outside the card is what tells you they belong to the
       next turn and not to what you are writing.
       Two things used to make the box look top-heavy, both of them space that
       only existed above the text. The grid keeps its chips row even when
       there are no chips, so its row-gap was 6px of nothing over every line
       ever typed; the gap is the chips' margin now, and it goes when they do.
       And the editor was shorter than the send button beside it, so ending the
       row bottom-aligned pushed the text down off its own padding — a
       min-height the size of that button is what makes the two sides match. */
    .field {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: "chips chips" "editor commit";
      align-items: end; column-gap: var(--sp-1); row-gap: 0;
      padding: 8px 10px;
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-rest);
      transition: border-color 160ms var(--settle), box-shadow 160ms var(--settle);
    }
    /* Where the caret is, said quietly. */
    .field:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
    .chips { grid-area: chips; display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-bottom: 6px; }
    .chips[hidden] { display: none; }
    .commit { grid-area: commit; display: flex; align-items: center; gap: var(--sp-1); }
    .chip-remove { font: inherit; border: 0; background: none; color: inherit; opacity: .55; width: 16px; height: 16px; border-radius: 50%; cursor: pointer; line-height: 1; padding: 0; }
    .chip-remove:hover { opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }
    .editor {
      grid-area: editor; min-width: 0; font: inherit; color: var(--ink); outline: none;
      max-height: 160px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere;
      /* As tall as the send button, so one line of type sits on the middle of
         the card instead of at the bottom of a taller row. */
      box-sizing: border-box; min-height: 28px; padding: 3px 0;
      /* The parts nobody draws still belong to the design. */
      caret-color: var(--accent-ink);
    }
    .editor ::selection, .editor::selection { background: var(--accent-soft); color: var(--ink); }
    /* A placeholder is read, so it clears 4.5:1 rather than sitting at the
       faint tone the rest of the chrome uses for marks you only glance at. */
    .editor[data-empty]::after { content: attr(data-placeholder); color: var(--placeholder, var(--muted)); pointer-events: none; }
    .editor ul, .editor ol { margin: 2px 0; padding-left: 1.25em; }
    .editor li { margin: 0; }
    .send, .stop {
      flex: none; width: 28px; height: 28px; border-radius: 50%; border: 0; cursor: pointer;
      display: grid; place-items: center;
      transition: background-color 180ms var(--settle), color 180ms var(--settle),
        box-shadow 180ms var(--settle);
    }
    /* Nothing to send yet, so the button is only an outline. When there is, it
       fills — the state change is the affordance, and it means the muted disc
       that used to read as disabled while it was live is gone. Pressing shifts
       the fill and never the geometry: a control that pops under the finger
       moves something the person did not move. */
    .send { background: none; color: var(--faint); box-shadow: inset 0 0 0 1px var(--line); }
    .send:disabled { cursor: default; }
    .send:not(:disabled) { background: var(--ink); color: var(--paper); box-shadow: none; }
    .send:not(:disabled):hover { background: color-mix(in srgb, var(--ink) 82%, var(--paper)); }
    .send:not(:disabled):active { background: color-mix(in srgb, var(--ink) 68%, var(--paper)); }
    .stop { background: var(--paper-2); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
    .stop:hover { background: var(--paper-3); }
    .stop[hidden] { display: none; }

    /* The card a pasted thing opens into (the peek), and the fallback strip
       for an old message whose text has no token for its block. */
    .attach {
      display: block; width: 172px; padding: 0; overflow: hidden;
      font: inherit; text-align: left; color: var(--ink);
      background: var(--paper-2); border: 1px solid var(--line); border-radius: 10px;
      cursor: pointer;
      transition: border-color 160ms var(--settle), box-shadow 160ms var(--settle), background 160ms var(--settle);
    }
    .attach:hover, .attach:focus-visible { border-color: var(--accent); box-shadow: var(--shadow-lift); outline: none; }
    /* Pressed is a shade, never a scale: nothing in this composer pops. */
    .attach:active { background: var(--paper-3); }
    .attach[data-kind="image"] { width: 124px; }
    .attach-head { display: flex; align-items: baseline; gap: 5px; padding: 7px 9px 0; }
    .attach-name { font-size: 11.5px; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .attach-meta { flex: none; font-size: 10.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
    .attach-peek {
      display: block; height: 42px; overflow: hidden; padding: 4px 9px 8px;
      font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--muted); white-space: pre;
      -webkit-mask-image: linear-gradient(to bottom, #000 45%, transparent);
      mask-image: linear-gradient(to bottom, #000 45%, transparent);
    }
    .attach-shot { display: block; width: 100%; height: 76px; object-fit: cover; background: var(--paper-3); }
    /* Opening a card does not take you anywhere: the whole of it unfolds
       above the box you were typing in, and Escape puts it back. */
    .peek {
      display: flex; flex-direction: column; gap: 6px; max-height: 42vh;
      padding: 8px 10px; background: var(--card);
      border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift);
    }
    .peek[hidden] { display: none; }
    .peek-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--faint); }
    .peek-title { color: var(--ink); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .peek-close {
      margin-left: auto; flex: none; width: 22px; height: 22px; padding: 0; line-height: 1;
      font: inherit; color: var(--muted); background: none; border: 0; border-radius: 6px; cursor: pointer;
    }
    .peek-close:hover, .peek-close:focus-visible { background: var(--paper-2); color: var(--ink); outline: none; }
    .peek-body {
      margin: 0; overflow: auto; overscroll-behavior: contain;
      font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .peek-body img { display: block; max-width: 100%; border-radius: 8px; }

    /* Dragging an image over the composer says where it will land. */
    .composer.is-dropping .field { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .msg.me .attachments { margin-bottom: 6px; }
    .msg.me .attach { background: var(--card); }
    .msg-text { display: block; }
    .msg.me .msg-text { white-space: normal; }
    .msg.me .msg-text p { margin: 0 0 .4em; } .msg.me .msg-text p:last-child { margin-bottom: 0; }
    .msg.me .msg-text ul, .msg.me .msg-text ol { margin: .2em 0 .4em; padding-left: 1.25em; }
    .msg.me .attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }

    /* A run of finished calls folds to one line: how many, of what kind,
       touching what. The row still running stays out, under it. */
    .choice-ask { display: grid; gap: 3px; margin: -4px 0 10px; padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
    .choice-ask button { display: grid; grid-template-columns: 22px 1fr; column-gap: 8px; align-items: baseline; text-align: left; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid transparent; border-radius: 8px; background: none; color: inherit; cursor: pointer; }
    .choice-ask button:hover, .choice-ask button:focus-visible { background: var(--paper-2); outline: none; }
    .choice-ask button[aria-checked="true"] { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 10%, transparent); }
    .choice-ask kbd { font: 11px/1.4 inherit; color: var(--faint); text-align: center; border: 1px solid var(--line); border-radius: 4px; }
    .choice-ask b { font-weight: 500; }
    .choice-ask .choice-send { display: inline-flex; justify-self: start; grid-template-columns: none; margin-top: 4px; padding: 4px 10px; border-color: var(--line); }
    .tool-group { display: flex; flex-direction: column; margin: 1px 0; }
    .tool-group-head {
      display: flex; align-items: baseline; gap: 8px; min-width: 0; width: 100%;
      font: inherit; font-size: 12.5px; color: var(--muted); text-align: left;
      background: none; border: 0; padding: 1px 2px; border-radius: 6px; cursor: pointer;
    }
    .tool-group-head::before { content: ''; flex: none; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 5px solid var(--faint); transform: translateY(-1px); transition: transform 120ms var(--settle); }
    .tool-group[data-open="true"] .tool-group-head::before { transform: rotate(90deg) translateX(-1px); }
    .tool-group-head:hover { background: var(--paper-2); color: var(--ink); }
    .tool-group-count { flex: none; color: var(--ink); font-weight: 500; }
    .tool-group-kinds { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-group-body { display: flex; flex-direction: column; padding-left: 13px; }
    .tool-group-body[hidden] { display: none; }

    /* ----------------------------------------------------------- the phone
       Last in the sheet because every rule here overrides one above it. A
       phone is one conversation, full screen, under a topbar that is already
       the conversation's header: the title, the status and the ⋯ are up
       there. So the mast keeps only what the topbar has no room for — where
       the work lands, what it runs as, who else is in there — on one 36px
       line, and the composer's settings fold into a single chip. */
    :host([data-chrome="phone"]) .mast {
      flex-direction: row; align-items: center; gap: 8px;
      box-sizing: border-box; min-height: 36px; max-height: 36px; padding: 4px 14px;
    }
    /* The title is in the topbar. Two of them is one too many. */
    :host([data-chrome="phone"]) .heading { display: none; }
    :host([data-chrome="phone"]) .mast-meta { flex: 1 1 auto; flex-wrap: nowrap; gap: 8px; }
    :host([data-chrome="phone"]) .tags { flex-wrap: nowrap; overflow: hidden; }
    :host([data-chrome="phone"]) .zone-jump { align-self: center; flex: none; max-width: 40%; margin-top: 0; }
    /* 44pt of thumb on a line of 13px type: the padding is the target and the
       negative margin hands the height back to the row, so the mast is still
       one 36px line and the link is still something a finger can hit. */
    :host([data-chrome="phone"]) .target-jump {
      box-sizing: border-box; min-height: 44px; font-size: 13px;
      padding: 0 8px; margin: -8px -8px;
    }
    /* "Also working here: 3 — a, b, c" wraps to two lines and is most of the
       mast. The count is the fact; the names are a tap away, in the page's own
       sheet, because the page is what can open one of them. */
    :host([data-chrome="phone"]) .mast .also {
      flex: none; display: inline-flex; align-items: center; box-sizing: border-box;
      min-height: 44px; padding: 0 2px; margin: -8px 0; cursor: pointer;
    }
    :host([data-chrome="phone"]) .mast .also[hidden] { display: none; }
    :host([data-chrome="phone"]) .also-long { display: none; }
    :host([data-chrome="phone"]) .also-short {
      display: inline-flex; align-items: center; height: 22px; padding: 0 9px;
      border-radius: 999px; background: var(--paper-2); box-shadow: inset 0 0 0 1px var(--line);
      color: var(--muted); font-size: 11.5px; font-weight: 500; white-space: nowrap;
    }
    :host([data-chrome="phone"]) .also:active .also-short { background: var(--paper-3); transition: background-color 100ms ease-out; }
    /* The setup row is a line of 21px words; a thumb cannot hit any of them.
       It folds into one chip that says what this turn will run as, and comes
       back as a sheet when you tap it. */
    :host([data-chrome="phone"]) .bar > .setup, :host([data-chrome="phone"]) .bar > .mode { display: none; }
    /* A 40pt chip in a 44pt target: the weight the eye wants and the box a
       thumb needs are not the same rectangle. */
    :host([data-chrome="phone"]) .setup-chip {
      order: -1; display: inline-flex; align-items: center;
      flex: 0 1 auto; min-width: 0; max-width: 72%;
      box-sizing: border-box; height: 44px; padding: 0; margin: 0;
      appearance: none; border: 0; background: none; box-shadow: none; cursor: pointer;
      font: inherit; font-size: 14px; font-weight: 500; color: var(--muted);
    }
    :host([data-chrome="phone"]) .setup-chip-what {
      display: block; box-sizing: border-box; height: 40px; line-height: 40px; padding: 0 14px;
      border-radius: 999px; background: var(--paper-2); box-shadow: inset 0 0 0 1px var(--line);
    }
    :host([data-chrome="phone"]) .setup-chip:active .setup-chip-what { background: var(--paper-3); transition: background-color 100ms ease-out; }
    .setup-chip { display: none; }
    .setup-chip[hidden] { display: none; }
    .setup-chip-what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 44 × 44 of target around a 32px disc: the geometry a finger needs and
       the weight the eye wants are not the same box. */
    :host([data-chrome="phone"]) .send, :host([data-chrome="phone"]) .stop {
      position: relative; width: 44px; height: 44px; background: none; box-shadow: none;
    }
    :host([data-chrome="phone"]) .send::before, :host([data-chrome="phone"]) .stop::before {
      content: ''; position: absolute; left: 6px; top: 6px; width: 32px; height: 32px;
      border-radius: 50%; transition: background-color 180ms var(--settle), box-shadow 180ms var(--settle);
    }
    :host([data-chrome="phone"]) .send > *, :host([data-chrome="phone"]) .stop > * { position: relative; z-index: 1; }
    :host([data-chrome="phone"]) .send::before { box-shadow: inset 0 0 0 1px var(--line); }
    :host([data-chrome="phone"]) .send:not(:disabled) { background: none; }
    :host([data-chrome="phone"]) .send:not(:disabled)::before { background: var(--ink); box-shadow: none; }
    :host([data-chrome="phone"]) .send:not(:disabled):active::before { background: color-mix(in srgb, var(--ink) 68%, var(--paper)); }
    :host([data-chrome="phone"]) .stop { background: none; }
    :host([data-chrome="phone"]) .stop::before { background: var(--paper-2); box-shadow: inset 0 0 0 1px var(--line); }
    :host([data-chrome="phone"]) .stop:active::before { background: var(--paper-3); }
    :host([data-chrome="phone"]) .commit { gap: 2px; }
    :host([data-chrome="phone"]) .editor { min-height: 44px; font-size: 17px; padding: 10px 0; }
    :host([data-chrome="phone"]) .attach { min-height: 44px; }
    /* The sheet the chip opens. It is inside the shadow root because the
       controls in it are this conversation's own — moved, never rebuilt, so a
       pick made down here is the pick the composer already had. It reads --kb
       because a sheet that the keyboard covers is a sheet you cannot use. */
    .setup-scrim {
      position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, .28);
      opacity: calc(1 - var(--at, 1));
    }
    .setup-scrim[hidden] { display: none; }
    .setup-sheet {
      position: fixed; left: 0; right: 0; bottom: var(--kb, 0px); z-index: 41;
      display: flex; flex-direction: column; box-sizing: border-box;
      max-height: min(calc(var(--vv-h, 100vh) * .72), 520px); overflow-y: auto; overscroll-behavior: contain;
      touch-action: pan-y;
      padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px));
      background: var(--card); color: var(--ink);
      border-radius: 18px 18px 0 0;
      box-shadow: 0 -1px 0 var(--line), 0 -18px 44px rgba(0, 0, 0, .18);
      transform: translateY(calc(var(--at, 1) * 100%));
      will-change: transform;
    }
    .setup-sheet[hidden] { display: none; }
    .setup-handle { flex: none; display: grid; place-items: center; height: 28px; touch-action: none; cursor: grab; }
    .setup-grip { width: 36px; height: 5px; border-radius: 999px; background: var(--line); }
    .setup-sheet-head { flex: none; font-size: 17px; font-weight: 600; letter-spacing: -.01em; padding: 2px 0 10px; }
    .setup-sheet-body { display: flex; flex-direction: column; gap: 14px; }
    /* The mode is the bar's, not the setup row's, so it comes down here under
       a name of its own rather than as one more loose word. */
    .setup-sheet-mode { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding-top: 14px; }
    .setup-sheet-mode[hidden] { display: none; }
    .setup-sheet-legend { font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); }
    /* Everything in the sheet is a 44pt row. The scrubber is a desk gesture on
       a control too small to be one here, and the chip already says where it
       would have landed. */
    :host([data-chrome="phone"]) .setup-sheet .setup { display: flex; flex-direction: column; align-items: stretch; gap: 14px; }
    :host([data-chrome="phone"]) .setup-sheet .setup-row { flex-wrap: wrap; align-items: center; gap: 10px; }
    :host([data-chrome="phone"]) .setup-sheet .scrub { display: none; }
    :host([data-chrome="phone"]) .setup-sheet .picker { display: flex; flex-direction: column; align-items: stretch; gap: 14px; }
    :host([data-chrome="phone"]) .setup-sheet .seg { display: block; width: 100%; }
    :host([data-chrome="phone"]) .setup-sheet .seg legend {
      position: static; width: auto; height: auto; clip: auto; margin: 0 0 6px; padding: 0; overflow: visible;
      font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint);
    }
    :host([data-chrome="phone"]) .setup-sheet .seg-opts, :host([data-chrome="phone"]) .setup-sheet .presets { display: flex; flex-wrap: wrap; width: auto; gap: 8px; }
    :host([data-chrome="phone"]) .setup-sheet .seg-opts span,
    :host([data-chrome="phone"]) .setup-sheet .preset span,
    /* Only when it is standing in for a folded segment: a trigger that is not
       is-drop is a control this sheet has the room to show in full. */
    :host([data-chrome="phone"]) .setup-sheet .seg-opts.is-drop .seg-current,
    :host([data-chrome="phone"]) .setup-sheet .presets-more,
    :host([data-chrome="phone"]) .setup-sheet .custom-toggle,
    :host([data-chrome="phone"]) .setup-sheet .failover,
    :host([data-chrome="phone"]) .setup-sheet .mode {
      box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
      min-height: 44px; min-width: 44px; padding: 0 16px; border-radius: 12px;
      font-size: 15px; background: var(--paper-2); box-shadow: inset 0 0 0 1px var(--line);
    }
    :host([data-chrome="phone"]) .setup-sheet .seg-opts input:checked + span,
    :host([data-chrome="phone"]) .setup-sheet .preset input:checked + span {
      background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); color: var(--ink);
    }
    :host([data-chrome="phone"]) .setup-sheet .mode { color: var(--accent-ink); align-self: flex-start; margin-top: 0; }
    :host([data-chrome="phone"]) .setup-sheet .failover { color: var(--ink); gap: 8px; }
    :host([data-chrome="phone"]) .setup-sheet .failover-word { display: block; font-size: 15px; }
    /* Hidden still means hidden: these selectors are heavier than the [hidden]
       rules they sit under, so they have to say it themselves. */
    :host([data-chrome="phone"]) .setup-sheet .setup[hidden],
    :host([data-chrome="phone"]) .setup-sheet .picker[hidden],
    :host([data-chrome="phone"]) .setup-sheet .seg[hidden],
    :host([data-chrome="phone"]) .setup-sheet .presets[hidden],
    :host([data-chrome="phone"]) .setup-sheet .presets-more[hidden],
    :host([data-chrome="phone"]) .setup-sheet .custom-toggle[hidden],
    :host([data-chrome="phone"]) .setup-sheet .mode[hidden] { display: none; }
    @media (prefers-reduced-motion: reduce) {
      /* No slide and no scrim wipe: the sheet arrives by crossfade. */
      .setup-sheet { transform: none; opacity: calc(1 - var(--at, 1)); transition: opacity 150ms ease; }
      .setup-scrim { transition: opacity 150ms ease; }
    }

    @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { :host, .log, .mast, .composer { transition: none; } .tool::before, .turn-footer .pulse { animation: none; } .seg-thumb { transition: none; } }
  `;

  // ------------------------------------------------------- pasted attachments

  // Long enough that it would bury the box you are typing in.
  const PASTE_LINES = 12;
  const PASTE_CHARS = 900;
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const MAX_IMAGE = 8 * 1024 * 1024;

  const sizeOf = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const escAttr = (value) =>
    String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unescAttr = (value) =>
    String(value ?? '').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

  // An attachment travels inside the prompt, tagged, so the agent reads it as
  // a named block rather than as the person's own sentence — and so the sent
  // message can be shown back as the same cards the composer had.
  const PASTED = /<pasted-(text|image)\b([^>]*)>([\s\S]*?)<\/pasted-\1>\n?/g;
  // The token a chip leaves in the text, so the person can point at it and the
  // agent can match it to the block above.
  const TOKEN = /\[(image|pasted text) (\d+)\]/g;

  function splitPasted(text) {
    const blocks = [];
    const rest = String(text ?? '')
      .replace(PASTED, (_whole, kind, raw, inner) => {
        const attrs = Object.fromEntries(
          [...String(raw).matchAll(/([a-z-]+)="([^"]*)"/g)].map((match) => [match[1], unescAttr(match[2])]),
        );
        blocks.push({ ...attrs, kind, text: inner.replace(/^\n/, '').replace(/\n$/, '') });
        return '';
      })
      .trim();
    return { blocks, rest };
  }

  const asBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`${file.name || 'that image'} could not be read`));
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(file);
    });

  const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  /** What a chip shows where a thumbnail cannot be drawn: a picture, in the
   *  same stroke as the rest of the icons, rather than a browser glyph. */
  const imageMark = () => {
    const mark = h('span', 'ichip-mark');
    mark.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.4" y="2.6" width="13.2" height="10.8" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1.6 11.2 5.4 7.8l3.1 2.6 2.3-1.9 3.6 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return mark;
  };
  const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor"/></svg>';
  /** What happens when Claude's usage runs out, in two glyphs. The handoff is a
   *  baton: an arc leaving the runner it is with and coming down on the next
   *  one, which is what switching CLI mid-turn actually is. The pause is the
   *  pause every transport has ever drawn, because inventing one here would
   *  only make it harder to read. */
  const HANDOFF_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="2.9" cy="9.4" r="1.3" fill="currentColor"/><circle cx="11.1" cy="9.4" r="1.3" fill="currentColor"/><path d="M2.9 7C2.9 2.8 11.1 2.8 11.1 6.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M9.75 5.5 11.1 6.9 12.45 5.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const PAUSE_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="4.1" y="3.4" width="1.8" height="7.2" rx=".9" fill="currentColor"/><rect x="8.1" y="3.4" width="1.8" height="7.2" rx=".9" fill="currentColor"/></svg>';
  /** The arrow leaving its box: the one glyph that says a name is a way out of
   *  this chat and into another document. Drawn at the mast's type size so it
   *  sits on the same line as the tags beside it. */
  const EYE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const OUT_ICON = '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5H3.5v9h9v-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 3.5h3v3M12.5 3.5 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ------------------------------------------------------------ the editor

  // A contenteditable box whose value is the Markdown the agent will read:
  // lines, `- item` lists, and a token for each chip. The DOM is kept to text
  // nodes, <br>, <ul>/<ol>/<li> and .ichip spans; a browser or a paste may add
  // a <div>, which reads as a line.
  const LIST_LINE = /^(?:([-*])|(\d+)\.) (.*)$/;

  function serializeEditor(root) {
    let chips = 0;
    const out = [];
    const endsLine = () => !out.length || out.at(-1).endsWith('\n');
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          // An empty node (what a deletion leaves) is not a line.
          if (child.data) out.push(child.data.replace(/ /g, ' '));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName;
        if (tag === 'BR') { out.push('\n'); continue; }
        if (child.classList.contains('ichip')) {
          const kind = child.dataset.kind;
          if (kind === 'image') out.push(`[image ${(chips += 1)}]`);
          else if (kind === 'text') out.push(`[pasted text ${(chips += 1)}]`);
          continue;
        }
        if (tag === 'UL' || tag === 'OL') {
          if (!endsLine()) out.push('\n');
          let n = 0;
          for (const item of child.children) {
            if (item.tagName !== 'LI') continue;
            n += 1;
            const from = out.length;
            walk(item);
            const inner = out.splice(from).join('').replace(/\n+$/, '');
            // An empty bullet is a place to type, not a line to send.
            if (!inner.trim()) { n -= 1; continue; }
            out.push(`${tag === 'UL' ? '-' : `${n}.`} ${inner}\n`);
          }
          continue;
        }
        if (tag === 'DIV' || tag === 'P') {
          if (!endsLine()) out.push('\n');
          walk(child);
          if (!endsLine()) out.push('\n');
          continue;
        }
        walk(child);
      }
    };
    walk(root);
    return out.join('').replace(/\n$/, '');
  }

  function fillEditor(root, text) {
    root.replaceChildren();
    let list = null;
    for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
      const hit = LIST_LINE.exec(line);
      if (hit) {
        const tag = hit[1] ? 'UL' : 'OL';
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag);
          root.append(list);
        }
        const item = document.createElement('li');
        item.textContent = hit[3];
        list.append(item);
        continue;
      }
      list = null;
      const last = root.lastChild;
      if (last && last.tagName !== 'UL' && last.tagName !== 'OL') root.append(document.createElement('br'));
      // A trailing space would collapse; the agent gets a plain space back.
      if (line) root.append(document.createTextNode(line.replace(/ $/, ' ')));
    }
  }

  const selectionIn = (root) => {
    const sel = root.getRootNode().getSelection?.() ?? document.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return root.contains(range.startContainer) ? { sel, range } : null;
  };

  function placeCaret(node, offset = null) {
    const sel = node.getRootNode().getSelection?.() ?? document.getSelection();
    const range = document.createRange();
    if (offset === null) {
      range.selectNodeContents(node);
      range.collapse(false);
    } else {
      range.setStart(node, offset);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** The text of the current line up to the caret. */
  const closestItem = (root) => {
    const at = selectionIn(root);
    const node = at?.range.startContainer;
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const item = el?.closest('li');
    return item && root.contains(item) ? item : null;
  };

  /** The text of the current line up to the caret — inside an item, the
   *  item's own text, without the marker the list would print for it. */
  function caretLine(root) {
    const at = selectionIn(root);
    if (!at) return '';
    const item = closestItem(root);
    const range = document.createRange();
    range.setStart(item ?? root, 0);
    range.setEnd(at.range.startContainer, at.range.startOffset);
    const text = item ? range.cloneContents().textContent.replace(/ /g, ' ') : serializeEditor(range.cloneContents());
    return text.split('\n').pop();
  }

  const itemEmpty = (item) => !item.textContent.replace(/ /g, ' ').trim() && !item.querySelector('.ichip');

  /** `- ` or `1. ` typed at the start of a line becomes a list with one item.
   *  Typed inside an item that holds nothing else (the empty item a
   *  select-all-delete leaves behind), it makes that item the list asked for. */
  function startListAt(root, marker, item = null) {
    const at = selectionIn(root);
    if (!at) return false;
    const { sel } = at;
    for (let n = 0; n < marker.length; n += 1) sel.modify('extend', 'backward', 'character');
    sel.getRangeAt(0).deleteContents();
    const tag = marker === '1.' ? 'ol' : 'ul';
    if (item) {
      let list = item.parentElement;
      if (list.tagName.toLowerCase() !== tag && list.children.length === 1) {
        const next = document.createElement(tag);
        list.replaceWith(next);
        next.append(item);
        list = next;
      }
      if (!item.childNodes.length) item.append(document.createElement('br'));
      placeCaret(item, 0);
      return true;
    }
    const list = document.createElement(tag);
    const fresh = document.createElement('li');
    fresh.append(document.createElement('br'));
    list.append(fresh);
    const here = sel.getRangeAt(0);
    here.collapse(true);
    // A leading <br> is the line break before this line; the list stands in
    // for the line, so the break stays and the list follows it.
    here.insertNode(list);
    placeCaret(fresh, 0);
    return true;
  }

  /** Shift+Enter inside an item: split it, or leave the list from an empty one. */
  function continueList(root, item) {
    const list = item.parentElement;
    if (itemEmpty(item)) {
      const br = document.createElement('br');
      list.after(br);
      const after = document.createTextNode('');
      br.after(after);
      item.remove();
      if (!list.children.length) list.remove();
      placeCaret(after, 0);
      return;
    }
    const at = selectionIn(root);
    const next = document.createElement('li');
    if (at) {
      const rest = at.range;
      rest.setEnd(item, item.childNodes.length);
      next.append(rest.extractContents());
    }
    if (!next.childNodes.length) next.append(document.createElement('br'));
    item.after(next);
    placeCaret(next, 0);
  }

  /** Backspace on an empty item: drop the item, and the list when it is alone. */
  function leaveList(root, item) {
    const list = item.parentElement;
    const only = list.children.length === 1;
    const index = [...list.children].indexOf(item);
    item.remove();
    if (only) {
      const mark = document.createTextNode('');
      list.replaceWith(mark);
      placeCaret(mark, 0);
      return;
    }
    if (index === 0) placeCaret(list.firstElementChild, 0);
    else placeCaret(list.children[index - 1]);
  }

  // Rendered text on one line: blocks are spaced apart, inline runs are not.
  const INLINE_TEXT = new Set(['A', 'B', 'STRONG', 'EM', 'I', 'CODE', 'SPAN', 'SMALL', 'SUP', 'SUB', 'MARK', 'U', 'DEL', 'INS', 'ABBR', 'TIME']);
  const flatten = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    // A visual's caption and its two buttons are furniture, not what was said:
    // the callout's one line would otherwise end "… Two layouts Expand Code".
    if (node.classList?.contains('visual-head')) return '';
    const inner = [...node.childNodes].map(flatten).join('');
    return INLINE_TEXT.has(node.tagName) ? inner : ` ${inner} `;
  };

  class MarbleConversation extends HTMLElement {
    static get observedAttributes() {
      // The chrome is the page's word for how much room this conversation
      // has. It is watched because the phone's fold is not only CSS: the
      // setup sheet holds nodes that belong back in the bar at any other
      // density, and a pane that stops being a phone has to get them back.
      return ['conversation', 'data-chrome'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${CONVERSATION_CSS}</style>
        <header class="mast" hidden>
          <h2 class="heading" contenteditable="plaintext-only" spellcheck="false" aria-label="Conversation title"></h2>
          <div class="mast-meta">
            <div class="tags"></div>
            <a class="target-jump" hidden><span class="target-what"></span><span class="target-out" aria-hidden="true">${OUT_ICON}</span></a>
          </div>
          <div class="zone-row" hidden>
            <button type="button" class="zone-jump">
              <span class="zone-live" aria-hidden="true"></span>
              <span class="zone-what"></span>
              <span class="zone-go" aria-hidden="true">→</span>
            </button>
            <button type="button" class="zone-follow" aria-pressed="false">
              <span class="zone-eye" aria-hidden="true">${EYE_ICON}</span>
              <span class="zone-follow-what">Follow</span>
            </button>
          </div>
          <button type="button" class="also" hidden>
            <span class="also-long"></span>
            <span class="also-short"></span>
          </button>
        </header>
        <button type="button" class="ticker" hidden aria-label="Show or hide the conversation"></button>
        <div class="log" role="log" aria-live="polite" aria-label="Conversation"></div>
        <form class="composer">
          <div class="slash" hidden role="listbox" aria-label="Commands"></div>
          <div class="peek" hidden>
            <div class="peek-head">
              <span class="peek-title"></span>
              <button type="button" class="peek-close" aria-label="Close">×</button>
            </div>
            <div class="peek-body"></div>
          </div>
          <div class="usage-note" hidden>
            <p class="usage-note-text">Claude usage stopped. Switch to Cursor?</p>
            <div class="actions">
              <button type="button" class="usage-switch">Switch</button>
              <button type="button" class="usage-leave quiet">Leave it</button>
            </div>
          </div>
          <div class="queued" hidden data-combine="0">
            <div class="queued-bar" hidden role="group" aria-label="How queued prompts are sent">
              <button type="button" class="queued-individually" aria-pressed="true">Send individually</button>
              <button type="button" class="queued-together" aria-pressed="false">Send as one prompt</button>
            </div>
          </div>
          <div class="row">
            <div class="field">
              <div class="chips" hidden></div>
              <div class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-placeholder="Ask about this document…" data-empty></div>
              <div class="commit">
                <button type="button" class="stop" hidden aria-label="Stop">${STOP_ICON}</button>
                <button type="submit" class="send" aria-label="Send" disabled>${SEND_ICON}</button>
              </div>
            </div>
            <div class="bar">
              <button type="button" class="setup-chip" hidden aria-haspopup="dialog" aria-expanded="false"><span class="setup-chip-what"></span></button>
              <div class="setup" hidden>
                <div class="setup-row">
                  <div class="presets" role="radiogroup" aria-label="Saved setups" hidden></div>
                  <button type="button" class="custom-toggle" aria-expanded="false" hidden>Custom</button>
                  <button type="button" class="failover" data-failover="auto" aria-label="When Claude usage stops"><span class="failover-mark"></span><span class="failover-word"></span></button>
                  <div class="scrub" role="slider" aria-label="Model setup" aria-valuemin="0" tabindex="-1"></div>
                </div>
                <div class="picker">
                  <fieldset class="seg picker-agent"><legend>CLI</legend><div class="seg-opts" data-seg="agent"></div></fieldset>
                  <fieldset class="seg picker-project"><legend>Project</legend><div class="seg-opts" data-seg="project"></div></fieldset>
                  <fieldset class="seg picker-models"><legend>Model</legend><div class="seg-opts" data-seg="model"></div></fieldset>
                  <fieldset class="seg picker-effort"><legend>Effort</legend><div class="seg-opts" data-seg="effort"></div></fieldset>
                </div>
              </div>
              <div class="selection" hidden></div>
              <span class="bar-space"></span>
              <div class="dispatch" hidden role="radiogroup" aria-label="How to send while a turn runs"></div>
              <button type="button" class="mode" hidden aria-label="CLI mode — click or Shift+Tab to change"></button>
            </div>
          </div>
        </form>
        <div class="setup-scrim" hidden></div>
        <section class="setup-sheet" role="dialog" aria-modal="true" aria-label="Setup" hidden>
          <div class="setup-handle"><span class="setup-grip" aria-hidden="true"></span></div>
          <div class="setup-sheet-head">Setup</div>
          <div class="setup-sheet-body"></div>
          <div class="setup-sheet-mode" hidden><span class="setup-sheet-legend">Mode</span></div>
        </section>`;
      this.logEl = root.querySelector('.log');
      this.ticker = root.querySelector('.ticker');
      this.ticker.addEventListener('click', () => this.toggleAttribute('data-folded'));
      this.queuedEl = root.querySelector('.queued');
      this.queuedBar = root.querySelector('.queued-bar');
      this.queuedIndividually = root.querySelector('.queued-individually');
      this.queuedTogether = root.querySelector('.queued-together');
      this.form = root.querySelector('form');
      this.mast = root.querySelector('.mast');
      this.heading = root.querySelector('.heading');
      this.tagsEl = root.querySelector('.tags');
      this.targetJump = root.querySelector('.target-jump');
      this.targetWhat = root.querySelector('.target-what');
      this.targetOut = root.querySelector('.target-out');
      this.setup = root.querySelector('.setup');
      this.presetsEl = root.querySelector('.presets');
      this.selectionEl = root.querySelector('.selection');
      this.setupRow = root.querySelector('.setup-row');
      this.customToggle = root.querySelector('.custom-toggle');
      this.scrubEl = asPopover(root.querySelector('.scrub'));
      this.picker = root.querySelector('.picker');
      this.bar = root.querySelector('.bar');
      this.modeButton = root.querySelector('.mode');
      this.failoverButton = root.querySelector('.failover');
      this.failoverMark = root.querySelector('.failover-mark');
      this.failoverWord = root.querySelector('.failover-word');
      armHint(this.failoverButton, () => (this.failoverMode() === 'pause'
        ? 'Pause when Claude usage runs out\nClick to hand off instead'
        : 'Hand off to Cursor when Claude usage runs out\nClick to pause instead'));
      this.usageNote = root.querySelector('.usage-note');
      this.usageNoteText = root.querySelector('.usage-note-text');
      this.usageSwitch = root.querySelector('.usage-switch');
      this.usageLeave = root.querySelector('.usage-leave');
      this.usageLeft = new Set();
      this.pendingFailover = null;
      this.failoverButton.addEventListener('click', () => this.flipFailover());
      this.usageSwitch.addEventListener('click', () => this.switchFromUsage());
      this.usageLeave.addEventListener('click', () => this.leaveUsage());
      this.dispatchEl = root.querySelector('.dispatch');
      this.agentLabel = root.querySelector('.picker-agent');
      this.agentBox = root.querySelector('[data-seg="agent"]');
      this.projectBox = root.querySelector('[data-seg="project"]');
      this.projectLabel = root.querySelector('.picker-project');
      this.also = root.querySelector('.also');
      this.alsoLong = root.querySelector('.also-long');
      this.alsoShort = root.querySelector('.also-short');
      this.also.addEventListener('click', () => this.announceWorkingHere());
      this.setupChip = root.querySelector('.setup-chip');
      this.setupChipWhat = root.querySelector('.setup-chip-what');
      this.setupSheet = root.querySelector('.setup-sheet');
      this.setupScrim = root.querySelector('.setup-scrim');
      this.setupSheetBody = root.querySelector('.setup-sheet-body');
      this.setupSheetMode = root.querySelector('.setup-sheet-mode');
      this.setupHandle = root.querySelector('.setup-handle');
      this.sheetAt = 1;
      this.sheetWanted = false;
      this.armSetupSheet();
      this.zoneJump = root.querySelector('.zone-jump');
      this.zoneRow = root.querySelector('.zone-row');
      this.zoneFollow = root.querySelector('.zone-follow');
      this.zoneFollowWhat = root.querySelector('.zone-follow-what');
      this.zoneFollow.addEventListener('click', () => this.toggleFollow());
      this.zoneWhat = root.querySelector('.zone-what');
      this.zone = null;
      this.zoneJump.addEventListener('click', () => this.goToZone());
      this.modelLabel = root.querySelector('.picker-models');
      this.modelBox = root.querySelector('[data-seg="model"]');
      this.effortLabel = root.querySelector('.picker-effort');
      this.effortBox = root.querySelector('[data-seg="effort"]');
      this.slash = root.querySelector('.slash');
      this.chipsEl = root.querySelector('.chips');
      this.peek = root.querySelector('.peek');
      this.peekTitle = root.querySelector('.peek-title');
      this.peekBody = root.querySelector('.peek-body');
      this.peekClose = root.querySelector('.peek-close');
      this.input = root.querySelector('.editor');
      Object.defineProperty(this.input, 'value', {
        get: () => serializeEditor(this.input),
        set: (text) => this.setValue(text),
      });
      this.sendButton = root.querySelector('.send');
      this.stopButton = root.querySelector('.stop');

      this.seen = 0;
      this.turns = new Map();
      this.prompts = new Map();
      this.live = null;
      this.running = null;
      this.off = null;
      this.skipSelection = false;
      this.composing = false;
      this.sending = false;
      this.slashItems = [];
      this.slashIndex = 0;
      this.skills = [];
      this.composerChips = [];
      this.attachments = [];
      this.attachSeq = 0;
      this.savedTitle = '';
      this.mode = '';
      this.editedFiles = new Set();
      this.usageMeters = [];
      this.customOpen = false;

      this.picker.addEventListener('change', (event) => {
        const name = event.target?.name;
        const run = async () => {
          if (name === 'agent') {
            this.mode = this.currentProvider()?.modes?.[0]?.id ?? this.mode;
            await this.syncCatalog();
            this.persistCatalog();
            this.persistMode();
            this.paintStatus();
            this.paintTags();
          }
          if (name === 'model') { this.syncEfforts(); this.persistCatalog(); this.paintStatus(); this.paintTags(); }
          if (name === 'effort') { this.persistCatalog(); this.paintStatus(); this.paintTags(); }
          const track = event.target?.closest?.('.seg-opts');
          syncSegCurrent(track);
          slideThumb(track, { animate: true });
          closeSegMenus(this.shadowRoot);
          this.paintPresets();
          this.fitSetup();
        };
        run();
      });
      this.customToggle.addEventListener('click', () => {
        this.setCustomOpen(this.customToggle.getAttribute('aria-expanded') !== 'true');
      });
      this.presetsEl.addEventListener('change', (event) => {
        const id = event.target?.value;
        const preset = PRESETS.find((item) => item.id === id);
        closeSegMenus(this.shadowRoot);
        slideThumb(this.presetsEl, { animate: true });
        if (preset) this.applyPreset(preset);
      });
      // Dismissal is not this conversation's business: a click in the pane
      // next door has to close this menu too, and a listener on this shadow
      // root never hears one. armSegDismiss handles both from the document.
      this.modeButton.addEventListener('click', () => this.cycleMode());
      this.queuedIndividually.addEventListener('click', () => this.setQueueCombine(false));
      this.queuedTogether.addEventListener('click', () => this.setQueueCombine(true));
      // How the next send behaves while a turn runs; the same two modes a
      // queued row can be set to afterwards. Interrupt is not offered: killing
      // a turn mid-thought to say one more thing is what steer is for, and the
      // stop button is still there for actually stopping it.
      // Two words of segmented pill for a choice you make rarely, sitting
      // beside the prompt you are actually writing. One word and a menu.
      this.dispatchEl.classList.add('seg-opts');
      fillRadios(this.dispatchEl, 'dispatch', [
        { id: 'queue', label: 'Queue' }, { id: 'steer', label: 'Steer' },
      ], { empty: null, value: 'queue' });
      // After fillRadios, which clears the mode along with the children.
      this.dispatchEl.classList.add('is-drop');
      armSeg(this.dispatchEl);
      syncSegCurrent(this.dispatchEl);
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit();
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && event.shiftKey && this.slash.hidden) {
          event.preventDefault();
          this.cycleMode();
          return;
        }
        if (this.onSlashKey(event)) return;
        if (event.key === 'Backspace' && !this.input.value && this.composerChips.length) {
          event.preventDefault();
          this.composerChips.pop();
          this.renderChips();
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          // ⌘Enter is always a steer while a turn runs; Enter takes the bar's choice.
          const steer = event.metaKey || event.ctrlKey;
          this.submit(steer && this.running ? { dispatch: 'steer' } : {});
          return;
        }
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          const item = closestItem(this.input);
          if (item) continueList(this.input, item);
          else document.execCommand('insertLineBreak');
          this.onEdited();
          return;
        }
        if (event.key === ' ') {
          const line = caretLine(this.input);
          const item = closestItem(this.input);
          const marker = line === '-' || line === '*' || line === '1.';
          if (marker && (!item || item.textContent.replace(/ /g, ' ').trim() === line)) {
            event.preventDefault();
            startListAt(this.input, line, item);
            this.onEdited();
          }
          return;
        }
        if (event.key === 'Backspace') {
          const item = closestItem(this.input);
          if (item && itemEmpty(item)) {
            event.preventDefault();
            leaveList(this.input, item);
            this.onEdited();
          }
        }
      });
      this.heading.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.heading.blur();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          this.heading.textContent = this.savedTitle || 'New Chat';
          this.heading.blur();
        }
      });
      this.heading.addEventListener('paste', (event) => {
        event.preventDefault();
        const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
        document.execCommand('insertText', false, text);
      });
      this.heading.addEventListener('blur', () => this.commitTitle());
      this.input.addEventListener('input', () => {
        this.filterSlash();
        this.onEdited();
      });
      this.input.addEventListener('focus', () => this.settleCaret());
      this.input.addEventListener('beforeinput', () => this.settleCaret());
      // An IME holds the DOM it is composing into. Nothing tidies the box
      // while it does.
      this.input.addEventListener('compositionstart', () => { this.composing = true; });
      this.input.addEventListener('compositionend', () => { this.composing = false; this.onEdited(); });

      // A screenshot and a page of pasted log are the two things that arrive
      // through the clipboard and do not belong in a one-line box.
      this.input.addEventListener('paste', (event) => this.takePaste(event));
      this.form.addEventListener('dragover', (event) => {
        if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
        event.preventDefault();
        this.form.classList.add('is-dropping');
      });
      this.form.addEventListener('dragleave', (event) => {
        if (event.target === this.form || !this.form.contains(event.relatedTarget)) {
          this.form.classList.remove('is-dropping');
        }
      });
      this.form.addEventListener('drop', (event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
        this.form.classList.remove('is-dropping');
        if (!files.length) return;
        event.preventDefault();
        for (const file of files) this.attachImage(file);
      });
      this.peekClose.addEventListener('click', () => this.closePeek());
      this.shadowRoot.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !this.peek.hidden) {
          event.stopPropagation();
          this.closePeek();
        }
      });
      this.stopButton.addEventListener('click', () => {
        if (this.running) this.api.cancel(this.running.turn).catch((err) => this.system(err.message, true));
      });
      this.onContext = () => {
        // A new selection is a reason to offer it again; a selection merely
        // clearing (which dismissing it does) is not.
        const { selection = [] } = this.api?.context() ?? {};
        if (selection.length) this.skipSelection = false;
        this.updateContext();
      };
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      // In a callout the document is not "this document" but the region you
      // selected, and the placeholder says so.
      // A page that hosts a conversation for one purpose says what it is for
      // (the Console's workshop chat asks for a change to the code).
      if (this.dataset.prompt) this.input.dataset.placeholder = this.dataset.prompt;
      if (this.dataset.chrome === 'callout') {
        this.input.dataset.placeholder = 'Ask about this…';
        // The log is written down several paths — streamed text, a finished
        // message re-rendered, tool rows folding. The ticker follows the log
        // itself rather than the paths, so it cannot fall behind one of them.
        // Scheduled once per frame, never rescheduled: text streams in faster
        // than a frame, and a tick that keeps deferring itself never runs.
        this.tickWatch = new MutationObserver(() => {
          if (this.tickFrame) return;
          this.tickFrame = requestAnimationFrame(() => { this.tickFrame = 0; this.tick(); });
        });
        this.tickWatch.observe(this.logEl, { childList: true, subtree: true, characterData: true });
        this.tick();
      }
      armScrubKeys();
      this.unwatchTheme = watchPageTheme(this);
      addEventListener('marble:agent-context', this.onContext);
      this.updateContext();
      this.load();
      this.fitObserver = new ResizeObserver(() => this.fitSetup());
      this.fitObserver.observe(this);
      // A queued row can grow while you edit it, and the stack grows with
      // every prompt: the log's foot follows it rather than being set once.
      this.queueObserver = new ResizeObserver(() => this.measureQueue());
      this.queueObserver.observe(this.queuedEl);
    }

    disconnectedCallback() {
      this.tickWatch?.disconnect();
      this.tickWatch = null;
      cancelAnimationFrame(this.tickFrame ?? 0);
      this.closeScrub?.({ commit: false });
      this.restoreSetup?.();
      this.fitObserver?.disconnect();
      this.fitObserver = null;
      this.queueObserver?.disconnect();
      this.queueObserver = null;
      this.unwatchTheme?.();
      this.unwatchTheme = null;
      removeEventListener('marble:agent-context', this.onContext);
      this.off?.();
      this.offAll?.();
      this.offQueue?.();
      this.offAll = null;
      this.off = null;
      this.offQueue = null;
    }

    attributeChangedCallback(name, before, after) {
      if (name === 'data-chrome') {
        // The sheet is a phone's answer. At any other density the row belongs
        // in the bar, and leaving it in a hidden sheet would take the pickers
        // off the screen with it.
        if (after !== 'phone') this.restoreSetup?.();
        this.paintSetupChip?.();
        return;
      }
      if (this.isConnected && before !== after && after !== this.loadedId) this.load();
    }

    focusInput() {
      this.input.focus({ preventScroll: true });
    }

    /** A first sentence written by something other than the hand: the marks
     *  layer hands a sketch's reading over this way, as the start of a draft
     *  the person then edits. Never a replacement — anything already typed
     *  keeps its place and the new words go after it — because the one thing
     *  a composer may not do is lose what somebody wrote in it. */
    draft(text) {
      if (!text) return;
      if (!this.input.value.trim()) {
        this.setValue(text);
      } else {
        this.input.append(document.createTextNode(this.input.value.endsWith(' ') ? text : ` ${text}`));
        this.onEdited();
      }
      this.focusInput();
      placeCaret(this.input);
    }

    /** Say this, as soon as there is somebody to say it to. A card built a
     *  moment ago is still asking the host which agents exist, and `submit`
     *  refuses without one — so a brief handed over by another layer waits for
     *  the picker instead of failing in front of the person who wrote it. */
    async sendNow(text) {
      this.draft(text);
      await this.whenAgents();
      return this.submit();
    }

    whenAgents({ within = 8000 } = {}) {
      if (this.getAttribute('conversation') || radioValue(this.shadowRoot, 'agent')) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); watch.disconnect(); resolve(); };
        const watch = new MutationObserver(() => { if (radioValue(this.shadowRoot, 'agent')) done(); });
        watch.observe(this.agentBox ?? this.shadowRoot, { childList: true, subtree: true, attributes: true });
        // Nobody is coming: `submit` says so in the card, which is where "no
        // agent is ready on this machine" belongs.
        const timer = setTimeout(done, within);
      });
    }

    // ---------------------------------------------------------- loading

    async load() {
      this.off?.();
      this.off = null;
      this.offQueue?.();
      this.offQueue = null;
      this.logEl.replaceChildren();
      for (const item of this.queuedEl.querySelectorAll('.queued-item')) item.remove();
      this.queuedEl.hidden = true;
      this.queuedBar.hidden = true;
      this.measureQueue();
      this.applyQueueCombine(false);
      this.composerChips = this.composerChips.filter((chip) => chip.kind === 'model' || chip.kind === 'effort');
      this.renderChips();
      this.clearAttachments();
      this.skipSelection = false;
      this.updateContext();
      this.seen = 0;
      this.turns.clear();
      this.usageLeft = new Set();
      this.hideUsageNote();
      this.prompts.clear();
      this.live = null;
      this.editedFiles = new Set();
      this.setRunning(null);

      const id = this.getAttribute('conversation');
      this.loadedId = id;
      const token = Symbol('load');
      this.loading = token;
      this.skills = await this.api?.skills?.().catch(() => []) ?? [];

      if (!id) {
        this.meta = null;
        this.paintMast();
        this.paintFailover();
        await this.showPicker(token);
        return;
      }
      this.setup.hidden = false;
      this.agentLabel.hidden = false;
      // A started conversation keeps its project; the picker is for new ones.
      this.projectLabel.hidden = true;
      try {
        const [{ meta }, providers, projects] = await Promise.all([
          this.api.conversation(id),
          this.api.providers().catch(() => []),
          this.api.projects?.().catch(() => []) ?? [],
        ]);
        if (this.loading !== token) return;
        this.meta = meta;
        this.pendingFailover = null;
        this.paintFailover();
        this.applyQueueCombine(Boolean(meta.queueCombine));
        this.projectList = projects;
        this.providerList = sortProviders(providers);
        this.mode = meta.mode || '';
        this.fillAgents(meta.provider);
        await this.syncCatalog({ model: meta.model, effort: meta.effort });
        this.paintPresets({ initial: true });
        this.paintMast();
        this.dispatchEvent(new CustomEvent('meta', { detail: { meta }, bubbles: true, composed: true }));
      } catch (err) {
        if (this.loading === token) this.system(`This conversation could not be opened: ${err.message}`, true);
        return;
      }
      await this.refreshChrome();
      if (this.loading !== token) return;
      this.off?.();
      this.off = this.api.on(id, (event) => {
        if (this.loading !== token) return;
        this.receive(event);
      });
      this.offQueue = this.api.on(id, (event) => {
        if (this.loading !== token) return;
        this.receiveQueue(event);
      });
      this.offAll?.();
      this.others = new Map();
      this.offAll = this.api.on('*', (summary) => {
        if (this.loading !== token || !summary?.id) return;
        // A discarded chat sends its id and nothing else.
        if (summary.removed) this.others.delete(summary.id);
        else this.others.set(summary.id, summary);
        // This chat's own row: the host names a new chat once its first turn
        // is over, and the mast should say so without a reload. paintMast
        // leaves the heading alone while it has the caret, so a rename
        // arriving mid-edit cannot take the words out from under someone.
        if (summary.id === id && !summary.removed && summary.title && summary.title !== this.meta?.title) {
          this.meta = { ...(this.meta ?? {}), ...summary };
          this.paintMast();
          this.paintFailover();
          this.dispatchEvent(new CustomEvent('meta', { detail: { meta: this.meta }, bubbles: true, composed: true }));
        }
        if (summary.id === id && !summary.removed) {
          const previous = this.meta ?? {};
          const setupChanged = summary.provider !== previous.provider
            || summary.model !== previous.model
            || summary.effort !== previous.effort;
          const failoverChanged = summary.failover && summary.failover !== previous.failover;
          if ((setupChanged && summary.provider) || failoverChanged) {
            this.meta = {
              ...previous,
              provider: summary.provider ?? previous.provider,
              model: summary.model,
              effort: summary.effort,
              failover: summary.failover ?? previous.failover,
            };
            this.paintFailover();
            if (setupChanged && summary.provider) {
              this.fillAgents(summary.provider);
              this.syncCatalog({ model: summary.model, effort: summary.effort }).then(() => this.paintPresets());
            }
          }
        }
        this.paintAlso();
      });
      // The stream only carries changes; a turn already running and silent
      // would otherwise go uncounted until it spoke.
      this.api.conversations?.().then((list) => {
        if (this.loading !== token) return;
        for (const summary of list ?? []) if (!this.others.has(summary.id)) this.others.set(summary.id, summary);
        this.paintAlso();
      }).catch(() => {});
      this.updateSendable();
    }

    async showPicker(token) {
      let providers = [];
      try {
        providers = await this.api.providers();
        this.skills = await this.api.skills().catch(() => []);
      } catch (err) {
        if (this.loading === token) this.system(`Agents could not be listed: ${err.message}`, true);
      }
      if (this.loading !== token) return;
      this.providerList = sortProviders(providers);
      const usable = this.providerList.filter((p) => p.installed && p.signedIn);
      const fallback = usable.find((p) => p.default) ?? usable[0];
      this.fillAgents(fallback?.id ?? '');
      await this.fillProjects();
      if (this.loading !== token) return;
      if (!fallback) this.system('No agent is ready on this machine. `npm run agents -- providers` says why.');
      this.mode = this.currentProvider()?.modes?.[0]?.id ?? '';
      await this.syncCatalog();
      this.paintPresets({ initial: true });
      // Only now: an agent, a project, a model and an effort to choose between.
      // Revealing the row before this point showed empty pills and a blank
      // status line, and fitPicker measured a row that had nothing in it yet.
      this.setup.hidden = false;
      this.picker.hidden = false;
      this.agentLabel.hidden = false;
      this.fitSetup();
      await this.loadChrome();
      if (this.loading !== token) return;
      const current = radioValue(this.shadowRoot, 'agent');
      const preferred = this.preferredProvider(usable);
      if (preferred?.id && current === (fallback?.id ?? '') && preferred.id !== current) {
        this.fillAgents(preferred.id);
        this.mode = this.currentProvider()?.modes?.[0]?.id ?? '';
        await this.syncCatalog();
        this.paintPresets({ initial: true });
      } else {
        this.applyAgentDisabled();
        this.paintPresets();
        this.paintStatus();
      }
      this.paintMast();
      this.updateSendable();
    }

    unsignedAgentIds() {
      return new Set((this.providerList ?? []).filter((item) => !(item.installed && item.signedIn)).map((item) => item.id));
    }

    claudeMeter() {
      return (this.usageMeters ?? []).find((item) => item.id === 'claude-subscription' || String(item.id ?? '').startsWith('claude')) ?? null;
    }

    // Not knowing is not being out — of a meter that is missing, and equally
    // of one that is present but unreadable. The usage API rate-limits often,
    // and a 429 says nothing whatsoever about quota; locking every Claude
    // model over it would take the drive away from someone who is signed in
    // and has plenty left. Being genuinely out is `used >= 100`, which is
    // read off the meter separately and only when the meter could be read.
    claudeUnavailable() {
      const signedIn = (this.providerList ?? []).some((item) => String(item.id ?? '').startsWith('claude') && item.installed && item.signedIn);
      if (!signedIn) return false;
      const meter = this.claudeMeter();
      return meter ? usageAvailable(meter) && Number(meter.used) >= 100 : false;
    }

    disabledAgentIds() {
      const ids = this.unsignedAgentIds();
      if (this.claudeUnavailable()) {
        ids.add('claude-subscription');
        ids.add('claude-api');
      }
      return ids;
    }

    presetDisabled(preset) {
      if (!preset) return true;
      return this.claudeUnavailable() && this.presetProviderIds(preset).some((id) => String(id).startsWith('claude'));
    }

    /** The projects a new conversation can start in: the drive first, then
     *  whatever the settings panel registered. The `project` attribute (the
     *  drawer sets `drive`) or `settings.defaultProject` picks the default. */
    async fillProjects(value = null) {
      let projects = [];
      try {
        projects = await this.api.projects();
      } catch {
        projects = [{ id: 'drive', name: 'Drive' }];
      }
      this.projectList = projects;
      let wanted = value ?? this.getAttribute('project');
      if (!wanted) {
        try {
          wanted = (await this.api.settings()).defaultProject;
        } catch { /* the drive */ }
      }
      wanted = projects.some((p) => p.id === wanted) ? wanted : 'drive';
      fillRadios(this.projectBox, 'project', projects.map((p) => ({ id: p.id, label: p.name })), { empty: null, value: wanted });
      this.projectLabel.hidden = false;
      this.fitSetup();
    }

    /** Other conversations running in this conversation's project right now. */
    workingHere() {
      const id = this.getAttribute('conversation');
      const mine = this.meta?.project ?? 'drive';
      return [...(this.others?.values() ?? [])]
        .filter((s) => s.id !== id && !s.archived && (s.project ?? 'drive') === mine && (s.status === 'running' || s.running));
    }

    /** One fact, two readings. A desk has the room to name them; a phone mast
     *  is one line, so it carries the count and the names are a tap away.
     *  Both are drawn every time and the density picks which one shows, so
     *  the line never has to be rebuilt when a pane becomes a phone. */
    paintAlso() {
      if (!this.also) return;
      const rows = this.workingHere();
      const names = rows.map((s) => s.title || 'New Chat');
      this.also.hidden = !rows.length;
      this.alsoLong.textContent = rows.length ? `Also working here: ${rows.length} — ${names.join(', ')}` : '';
      this.alsoShort.textContent = rows.length ? `+${rows.length} here` : '';
      this.also.title = names.join(', ');
      this.also.setAttribute('aria-label', rows.length ? `Also working here: ${names.join(', ')}` : '');
    }

    /** The page owns the list, because the page is what can open one of them:
     *  a tap on the count says who they are and lets the page put them in its
     *  own actions sheet. */
    announceWorkingHere() {
      const rows = this.workingHere();
      if (!rows.length) return;
      this.dispatchEvent(new CustomEvent('marble:agent-working-here', {
        bubbles: true,
        composed: true,
        detail: { ids: rows.map((s) => s.id), names: rows.map((s) => s.title || 'New Chat') },
      }));
    }

    fillAgents(value) {
      fillRadios(this.agentBox, 'agent', (this.providerList ?? []).map((provider) => ({
        id: provider.id,
        label: provider.installed && provider.signedIn ? provider.label : `${provider.label} — ${provider.detail}`,
      })), { empty: null, value: value ?? '', disabled: this.disabledAgentIds() });
    }

    applyAgentDisabled() {
      const disabled = this.disabledAgentIds();
      for (const input of this.agentBox?.querySelectorAll('input[name="agent"]') ?? []) {
        input.disabled = disabled.has(input.value);
      }
    }

    preferredProvider(usable = []) {
      const cursor = usable.find((item) => item.id === 'cursor');
      if (cursor && (this.claudeUnavailable() || Number(this.claudeMeter()?.used) >= 100)) return cursor;
      return usable.find((item) => item.default) ?? usable[0] ?? null;
    }

    currentProvider() {
      const id = radioValue(this.shadowRoot, 'agent') || this.meta?.provider;
      return this.providerList?.find((p) => p.id === id) ?? null;
    }

    currentModel() {
      const provider = this.currentProvider();
      const id = radioValue(this.shadowRoot, 'model');
      return this.pickerModels(provider).find((item) => item.id === id)
        ?? (provider?.models ?? []).find((item) => item.id === id)
        ?? null;
    }

    pickerModels(provider) {
      const models = provider?.models ?? [];
      return provider?.id === 'cursor' ? pickCursorPickerModels(models) : models;
    }

    catalogPicks() {
      return {
        model: radioValue(this.shadowRoot, 'model') || null,
        effort: radioValue(this.shadowRoot, 'effort') || null,
        mode: this.mode || null,
      };
    }

    async syncCatalog({ model, effort } = {}) {
      const provider = this.currentProvider();
      if (provider?.id && this.api?.skills) {
        this.skills = await this.api.skills(provider.id).catch(() => this.skills ?? []);
      }
      let settings = {};
      try {
        settings = await this.api.settings();
      } catch { /* defaults from the provider list */ }
      const id = provider?.id;
      const models = this.pickerModels(provider);
      // A Claude family id (`opus`) is not a Cursor model. Leaving it checked
      // when the CLI switches makes the next turn ask Cursor for `opus-high`,
      // which Cursor rejects by printing its entire model list.
      const claudeFamily = new Set(['haiku', 'sonnet', 'opus', 'fable']);
      // A started conversation keeps the model it was started with. A composer
      // with no conversation yet opens on the last model this person chose —
      // which is what `settings.models` holds, and what the next conversation
      // the host starts will be given. (radioValue answers '' rather than
      // undefined when nothing is checked, so `??` would never reach here.)
      const fresh = !this.getAttribute('conversation');
      let modelValue = model ?? radioValue(this.shadowRoot, 'model') ?? '';
      if (!modelValue && fresh) modelValue = settings.models?.[id] ?? '';
      let effortValue = effort ?? radioValue(this.shadowRoot, 'effort') ?? '';
      if (!effortValue && fresh) effortValue = settings.efforts?.[id] ?? '';
      const split = splitCursorModel(modelValue);
      if (id === 'cursor' && claudeFamily.has(modelValue)) {
        const saved = settings.models?.[id] ?? '';
        const savedFamily = splitCursorModel(saved).family;
        const grok = models.find((item) => item.id !== 'auto' && /grok/i.test(`${item.id} ${item.label ?? ''}`));
        modelValue = models.some((item) => item.id === savedFamily) ? savedFamily : (grok?.id ?? '');
        if (!effortValue) effortValue = settings.efforts?.[id] || 'high';
      } else if (split.family && models.some((item) => item.id === split.family)) {
        if (!effortValue) effortValue = split.effort;
        modelValue = split.family;
      }
      const lockClaude = this.claudeUnavailable() && String(id ?? '').startsWith('claude');
      this.modelLabel.hidden = !models.length;
      fillRadios(this.modelBox, 'model', models, {
        empty: String(id ?? '').startsWith('claude') ? null : 'Default',
        value: modelValue,
        disabled: lockClaude ? new Set(models.map((item) => item.id)) : new Set(),
      });
      this.syncEfforts({ effort: effortValue });
      if (!this.mode) this.mode = provider?.modes?.[0]?.id ?? '';
      this.paintStatus();
      this.fitSetup();
    }

    syncEfforts({ effort } = {}) {
      const family = this.currentModel();
      const nested = family?.efforts ?? [];
      const efforts = nested.length
        ? nested
        : (this.currentProvider()?.efforts ?? []).map((level) => ({ id: level, label: level }));
      this.effortLabel.hidden = !efforts.length;
      const lockClaude = this.claudeUnavailable() && String(this.currentProvider()?.id ?? '').startsWith('claude');
      fillRadios(this.effortBox, 'effort', efforts, {
        empty: nested.length && !family?.hasBare ? null : 'Default',
        value: effort ?? radioValue(this.shadowRoot, 'effort') ?? nested[0]?.id ?? '',
        disabled: lockClaude ? new Set(efforts.map((item) => item.id)) : new Set(),
      });
      this.fitSetup();
    }

    persistCatalog() {
      const id = this.getAttribute('conversation');
      const { model, effort } = this.catalogPicks();
      const provider = radioValue(this.shadowRoot, 'agent') || this.meta?.provider || null;
      if (this.meta) this.meta = { ...this.meta, model, effort, ...(provider ? { provider } : {}) };
      this.paintTags();
      this.paintStatus();
      this.rememberPick(provider, model, effort);
      if (!id || !this.api?.update) return;
      this.api.update(id, { model, effort, ...(provider ? { provider } : {}) }).catch((err) => this.system(err.message, true));
    }

    /** The agent and model a person just chose are the ones they will want on
     *  the next conversation too, so a pick in any composer is also the host's
     *  default — the same setting the Settings panel writes, and the one
     *  `POST /agent/conversations` fills a new conversation from. Only a pick
     *  reaches here: loading a conversation syncs the picker without persisting
     *  it, so opening an old conversation never moves the default. */
    rememberPick(provider, model, effort) {
      if (!provider || !this.api?.saveSettings) return;
      this.api
        .saveSettings({
          defaultProvider: provider,
          models: { [provider]: model ?? '' },
          efforts: { [provider]: effort ?? '' },
        })
        .catch(() => { /* the conversation itself still has the pick */ });
    }

    persistMode() {
      const id = this.getAttribute('conversation');
      if (this.meta) this.meta = { ...this.meta, mode: this.mode || null };
      this.paintStatus();
      if (!id || !this.api?.update) return;
      this.api.update(id, { mode: this.mode || null }).catch((err) => this.system(err.message, true));
    }

    presetProviderIds(preset) {
      return preset.provider === 'claude-subscription' ? ['claude-subscription', 'claude-api'] : [preset.provider];
    }

    resolvePresetProvider(preset) {
      const ids = this.presetProviderIds(preset);
      const current = radioValue(this.shadowRoot, 'agent') || this.meta?.provider;
      if (ids.includes(current)) {
        const match = this.providerList?.find((item) => item.id === current);
        if (match?.installed && match?.signedIn) return match;
      }
      return ids
        .map((id) => this.providerList?.find((item) => item.id === id))
        .find((item) => item?.installed && item?.signedIn) ?? null;
    }

    availablePresets() {
      return PRESETS.filter((preset) => this.resolvePresetProvider(preset));
    }

    resolvePresetModel(preset, provider) {
      const models = this.pickerModels(provider);
      if (models.some((item) => item.id === preset.model)) return preset.model;
      if (preset.provider === 'cursor') return models.find((item) => /grok/i.test(item.id))?.id || preset.model;
      return preset.model;
    }

    /** The words a setup wears. Opus and Grok take the version from the
     *  catalog ("Opus 5.5", "Grok 4.7") so a newer model does not keep wearing
     *  last month's number. Effort is the other axis and is written after.
     *  Sonnet and Fable keep the name on the preset. */
    presetShownName(preset) {
      const word = EFFORT_WORD[preset?.effort] ?? '';
      const numbered = preset?.model === 'opus' || /grok/i.test(preset?.model ?? '') || preset?.provider === 'cursor';
      if (!numbered) return preset?.name ?? '';
      const provider = this.resolvePresetProvider(preset);
      const id = provider ? this.resolvePresetModel(preset, provider) : preset.model;
      const fromCatalog = modelHead((provider ? this.pickerModels(provider) : []).find((item) => item.id === id)?.label);
      const head = fromCatalog || presetHead(preset);
      if (!word || head.toLowerCase().endsWith(` ${word.toLowerCase()}`)) return head;
      return `${head} ${word}`;
    }

    /** The model half of a setup's name, for the scrubber, where effort has
     *  its own axis and must not be repeated under the stop. */
    presetModelName(preset) {
      const shown = this.presetShownName(preset);
      const word = EFFORT_WORD[preset?.effort] ?? '';
      return word && shown.endsWith(` ${word}`) ? shown.slice(0, -(word.length + 1)) : shown;
    }

    matchingPreset() {
      const providerId = radioValue(this.shadowRoot, 'agent');
      const model = radioValue(this.shadowRoot, 'model');
      const effort = radioValue(this.shadowRoot, 'effort');
      return this.availablePresets().find((preset) => {
        const provider = this.resolvePresetProvider(preset);
        return this.presetProviderIds(preset).includes(providerId)
          && this.resolvePresetModel(preset, provider) === model
          && preset.effort === effort;
      }) ?? null;
    }

    /** What this setup is called when no saved one matches it — Opus tuned up
     *  to Max, or Haiku picked in the custom row. The model names itself and
     *  wears its effort, in the same shape a setup's name has, so the word in
     *  the bar is a true answer to "what am I about to run as" rather than a
     *  guess. Empty only when there is no model to name; the callers say
     *  "Custom" for that. */
    customSetupName() {
      const model = this.currentModel()?.label ?? '';
      if (!model) return '';
      const word = EFFORT_WORD[radioValue(this.shadowRoot, 'effort')] ?? '';
      return word && !model.toLowerCase().endsWith(word.toLowerCase()) ? `${model} ${word}` : model;
    }

    /** The name and brand the packed setups control falls back to, written on
     *  the track for fitPresets to read. Refreshed immediately before every
     *  fit rather than at paint time: syncCatalog and the setup sheet fit the
     *  row too, and a stale word here is the whole bug this guards against. */
    markCustomSetup() {
      if (!this.presetsEl) return;
      const custom = this.matchingPreset() ? '' : (this.customSetupName() || 'Custom');
      const provider = String(this.currentProvider()?.id ?? '');
      this.presetsEl.dataset.custom = custom;
      this.presetsEl.dataset.customBrand = custom
        ? (provider.startsWith('claude') ? 'anthropic' : provider === 'cursor' ? 'cursor' : '')
        : '';
    }

    paintPresets({ initial = false } = {}) {
      const presets = this.availablePresets();
      this.presetsEl.hidden = !presets.length;
      this.customToggle.hidden = !presets.length;
      const match = this.matchingPreset();
      if (initial) this.customOpen = presets.length === 0;
      if (!presets.length) this.customOpen = true;
      const ids = presets.map((preset) => preset.id).join(',');
      if (this.presetsEl.dataset.ids !== ids) {
        this.presetsEl.dataset.ids = ids;
        this.presetsEl.replaceChildren();
        this.presetsEl._thumbAt = null;
        this.presetsEl._thumbVel = null;
        ensureThumb(this.presetsEl);
        for (const [index, preset] of presets.entries()) {
          const label = document.createElement('label');
          label.className = 'preset';
          label.dataset.index = String(index);
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'preset';
          input.value = preset.id;
          input.checked = match?.id === preset.id && !this.presetDisabled(preset);
          input.disabled = this.presetDisabled(preset);
          const span = document.createElement('span');
          span.innerHTML = `${BRAND[preset.brand] ?? ''}${this.presetShownName(preset)}`;
          label.append(input, span);
          this.presetsEl.append(label);
        }
        armSeg(this.presetsEl);
        requestAnimationFrame(() => slideThumb(this.presetsEl, { animate: false }));
      } else {
        for (const input of this.presetsEl.querySelectorAll('input[name="preset"]')) {
          const preset = presets.find((item) => item.id === input.value);
          input.checked = match?.id === input.value && !this.presetDisabled(preset);
          input.disabled = this.presetDisabled(preset);
          const span = input.nextElementSibling;
          if (span && preset) span.innerHTML = `${BRAND[preset.brand] ?? ''}${this.presetShownName(preset)}`;
        }
        slideThumb(this.presetsEl, { animate: !initial });
      }
      this.customToggle.setAttribute('aria-expanded', String(this.customOpen));
      this.picker.hidden = presets.length > 0 && !this.customOpen;
      this.paintSetupChip();
      this.fitSetup();
    }

    setCustomOpen(open) {
      this.customOpen = open;
      this.customToggle.setAttribute('aria-expanded', String(open));
      const hasPresets = this.availablePresets().length > 0;
      this.picker.hidden = hasPresets && !open;
      if (!this.picker.hidden) {
        this.fitSetup();
        requestAnimationFrame(() => {
          for (const box of this.picker.querySelectorAll('.seg-opts')) slideThumb(box, { animate: false });
        });
      }
    }

    /** `effort` overrides the setup's own, which is how the scrubber commits a
     *  model the person tuned up or down off its resting effort. */
    async applyPreset(preset, { effort = null } = {}) {
      if (this.presetDisabled(preset)) return;
      const provider = this.resolvePresetProvider(preset);
      if (!provider) return;
      const switched = (radioValue(this.shadowRoot, 'agent') || this.meta?.provider) !== provider.id;
      if (switched) {
        this.fillAgents(provider.id);
        this.mode = this.currentProvider()?.modes?.[0]?.id ?? this.mode;
      }
      await this.syncCatalog({ model: this.resolvePresetModel(preset, provider), effort: effort ?? preset.effort });
      this.persistCatalog();
      if (switched) this.persistMode();
      this.paintPresets();
    }

    /** The stops, weakest first — the same order as the menu. A slider is
     *  pushed right to turn something up, so the strongest setup belongs at
     *  the right end.
     *  A setup you cannot pick is not a stop: landing on one and letting go
     *  would be a no-op the scrubber had promised. */
    scrubStops() {
      return this.availablePresets().filter((preset) => !this.presetDisabled(preset));
    }

    /** The efforts the stop you are on can be tuned through, weakest first.
     *  Cursor bakes effort into the model id and reports none, so there is
     *  nothing to tune there and the gauge says so by not being there. */
    scrubEfforts(preset) {
      const provider = this.resolvePresetProvider(preset ?? this.scrubPresets?.[this.scrubAt ?? 0]);
      return provider?.efforts ?? [];
    }

    buildScrub() {
      const presets = this.scrubStops();
      this.scrubPresets = presets;
      const ids = presets.map((preset) => preset.id).join(',');
      if (this.scrubEl.dataset.ids === ids) return presets;
      this.scrubEl.dataset.ids = ids;
      this.scrubEl.style.setProperty('--n', String(presets.length));
      this.scrubEl.setAttribute('aria-valuemax', String(Math.max(0, presets.length - 1)));
      // Every word and every bar is built once and then only lit, never
      // rewritten: swapping textContent would resize the row under the model
      // name and cross-fading needs both words present at the same time.
      const efforts = this.scrubEfforts(presets[0]);
      const now = h('div', 'scrub-now');
      now.append(h('span', 'scrub-model'), effortStack(efforts), effortGauge(efforts));
      const track = h('div', 'scrub-track');
      track.append(h('div', 'scrub-rail'), h('div', 'scrub-fill'), h('div', 'scrub-knob'));
      for (const preset of presets) {
        const stop = h('div', 'scrub-stop');
        const name = h('span', 'scrub-name', this.presetModelName(preset));
        // Each model's own effort, under its own name: the second axis is
        // remembered per model, and this is where you can see that.
        stop.append(h('div', 'scrub-dot'), name, effortStack(this.scrubEfforts(preset), 'scrub-stop-effort'));
        track.append(stop);
      }
      this.scrubEl.replaceChildren(now, track);
      return presets;
    }

    scrubIsOpen() {
      return Boolean(this.scrubEl?.classList.contains('is-open'));
    }

    /** True when the scrubber is up and the arrows are its to take. */
    openScrub() {
      if (this.scrubIsOpen()) return true;
      if (this.setup?.hidden || !this.scrubEl) return false;
      const presets = this.buildScrub();
      // One stop is a line with nowhere to go.
      if (presets.length < 2) return false;
      closeOpenSeg();
      const match = this.matchingPreset();
      let at = presets.findIndex((preset) => preset.id === match?.id);
      if (at < 0) {
        // No setup matches exactly, which is what a tuned effort leaves
        // behind — Opus at Max is no chip. The model alone still says which
        // stop you are standing on, and the gauge says the rest.
        const model = radioValue(this.shadowRoot, 'model');
        at = presets.findIndex((preset) => this.resolvePresetModel(preset, this.resolvePresetProvider(preset)) === model);
      }
      this.scrubFrom = at < 0 ? 0 : at;
      this.scrubAt = this.scrubFrom;
      // Effort is remembered per model, not carried across: turning Opus up
      // is a thing you meant about Opus, and arriving at Sonnet with it still
      // raised is a setting nobody asked for. Every other stop starts at its
      // own resting effort; the one you are on starts at the effort actually
      // set, so ⌃⌥ on Opus at Extra High does not quietly turn it down.
      this.scrubTuned = new Map(presets.map((preset) => [preset.id, preset.effort]));
      const here = presets[this.scrubAt];
      const efforts = this.scrubEfforts(here);
      const current = radioValue(this.shadowRoot, 'effort');
      if (here) this.scrubTuned.set(here.id, efforts.includes(current) ? current : here.effort ?? efforts[0] ?? '');
      this.scrubFromEffort = this.scrubEffort();
      this.scrubEl.classList.add('is-open');
      raiseMenu(this.scrubEl);
      // Centred over the whole bar and keeping its own width: a scrubber hung
      // off the ••• would sit in the corner it came from, and this is about
      // the prompt, which is the middle.
      floatMenu(this.bar, this.scrubEl, { align: 'center', hug: false });
      this.paintScrub({ animate: false });
      scrubOpen = this;
      return true;
    }

    paintScrub({ animate = true } = {}) {
      const presets = this.scrubPresets ?? [];
      const at = Math.min(Math.max(0, this.scrubAt ?? 0), presets.length - 1);
      const preset = presets[at];
      if (!preset) return;
      const track = this.scrubEl.querySelector('.scrub-track');
      const fill = this.scrubEl.querySelector('.scrub-fill');
      const knob = this.scrubEl.querySelector('.scrub-knob');
      [...this.scrubEl.querySelectorAll('.scrub-stop')].forEach((stop, index) => {
        stop.classList.toggle('is-at', index === at);
        const name = stop.querySelector('.scrub-name');
        if (name && presets[index]) name.textContent = this.presetModelName(presets[index]);
      });
      // BRAND is this file's own constant, not anything an agent said.
      const model = this.scrubEl.querySelector('.scrub-model');
      model.innerHTML = BRAND[preset.brand] ?? '';
      model.append(document.createTextNode(this.presetModelName(preset)));
      // Light the word and the bars rather than rewriting them: the stack is
      // already as wide as its longest word, so nothing beside it moves, and
      // the word being replaced is still there to leave while the new one
      // arrives. `data-at` carries the level to the colour scale.
      const efforts = this.scrubEfforts(preset);
      const here = this.scrubEffort();
      const step = efforts.indexOf(here);
      const effortEl = this.scrubEl.querySelector('.scrub-effort');
      const gauge = this.scrubEl.querySelector('.scrub-gauge');
      effortEl.hidden = step < 0;
      gauge.hidden = step < 0;
      this.scrubEl.dataset.at = step < 0 ? '' : here;
      lightEffort(effortEl, here);
      lightEffort(gauge, here, efforts);
      // Each stop wears the effort it is remembering, so moving away and back
      // is visibly the same setting rather than a guess.
      [...this.scrubEl.querySelectorAll('.scrub-stop')].forEach((stop, index) => {
        lightEffort(stop.querySelector('.scrub-stop-effort'), this.scrubTuned?.get(presets[index]?.id));
      });
      // Dot centre to dot centre: the track less one stop's width.
      const span = Math.max(0, track.clientWidth * (1 - 1 / Math.max(1, presets.length)));
      const atPx = Math.round(span * (presets.length > 1 ? at / (presets.length - 1) : 0));
      if (!animate) {
        fill.style.transition = 'none';
        knob.style.transition = 'none';
      }
      fill.style.width = `${atPx}px`;
      knob.style.transform = `translateX(${atPx}px)`;
      if (!animate) {
        // Flush the jump, then hand the transitions back for the arrows.
        void this.scrubEl.offsetWidth;
        fill.style.transition = '';
        knob.style.transition = '';
      }
      this.scrubEl.setAttribute('aria-valuenow', String(at));
      this.scrubEl.setAttribute('aria-valuetext', [this.presetModelName(preset), EFFORT_WORD[here] ?? here].filter(Boolean).join(', '));
    }

    /** The effort remembered for the stop the scrubber is on. */
    scrubEffort(index = this.scrubAt) {
      const preset = (this.scrubPresets ?? [])[index ?? 0];
      return preset ? this.scrubTuned?.get(preset.id) ?? preset.effort ?? '' : '';
    }

    /** Stops at the ends rather than wrapping: a timeline has two of them,
     *  and holding an arrow down should come to rest, not cycle. */
    moveScrub(delta) {
      const presets = this.scrubPresets ?? [];
      if (!this.scrubIsOpen() || presets.length < 2) return;
      const next = Math.min(presets.length - 1, Math.max(0, (this.scrubAt ?? 0) + delta));
      if (next === this.scrubAt) return;
      this.scrubAt = next;
      // Nothing to carry over: the stop you arrive at wears whatever effort
      // it was left at, which is its own.
      this.paintScrub();
    }

    /** The other axis, and only for the model it is pointing at. Same shape
     *  as moveScrub, and the same ends. */
    tuneScrub(delta) {
      if (!this.scrubIsOpen()) return;
      const preset = (this.scrubPresets ?? [])[this.scrubAt ?? 0];
      const efforts = this.scrubEfforts(preset);
      if (!preset || efforts.length < 2) return;
      const step = efforts.indexOf(this.scrubEffort());
      const next = Math.min(efforts.length - 1, Math.max(0, (step < 0 ? 0 : step) + delta));
      if (efforts[next] === this.scrubEffort()) return;
      this.scrubTuned.set(preset.id, efforts[next]);
      this.paintScrub();
    }

    /** Letting go is the decision. Applying on every arrow would persist the
     *  setup — a write per step — for choices you were only scrubbing past. */
    closeScrub({ commit = true } = {}) {
      if (!this.scrubIsOpen()) return;
      this.scrubEl.classList.remove('is-open');
      if (scrubOpen === this) scrubOpen = null;
      const effort = this.scrubEffort();
      const moved = this.scrubAt !== this.scrubFrom || effort !== this.scrubFromEffort;
      const chosen = commit && moved ? (this.scrubPresets ?? [])[this.scrubAt] : null;
      clearTimeout(this.scrubEl._unfloat);
      const settle = () => {
        if (this.scrubIsOpen()) return;
        dropMenu(this.scrubEl);
        unfloatMenu(this.scrubEl);
      };
      if (reduceMotion()) settle();
      else this.scrubEl._unfloat = setTimeout(settle, MENU_MS + 60);
      if (chosen) this.applyPreset(chosen, { effort: effort || null });
    }

    fitSetup() {
      requestAnimationFrame(() => {
        // One row first; the fits below wrap the bar only if they must.
        delete this.bar.dataset.wrap;
        delete this.setupRow?.dataset.wrap;
        if (!this.picker?.hidden) fitPicker(this.picker);
        this.markCustomSetup();
        fitPresets(this.presetsEl);
      });
    }

    // ------------------------------------------------------ the setup sheet
    //
    // On a phone the whole setup row — two pickers, a scrubber and the mode —
    // is a line of 21px words, none of which a thumb can hit. It folds into
    // one chip that says what the next turn will run as, and comes back as a
    // sheet from the bottom when you tap it. The sheet holds the *same* nodes,
    // moved there and moved back: nothing is rebuilt, so a pick made down here
    // is a pick the composer already had, and the desk's row is untouched.

    /** What the row says, in the two words a thumb has room for. The mode
     *  rides along only when it is not the one the CLI would have chosen —
     *  the chip is for what is unusual about this turn. */
    setupChipLabel() {
      const provider = this.currentProvider();
      const modes = provider?.modes ?? [];
      const mode = modes.find((item) => item.id === this.mode);
      const preset = this.matchingPreset();
      const parts = [provider?.label || 'Agent', (preset ? this.presetShownName(preset) : '') || this.customSetupName() || 'Custom'];
      if (mode && modes[0] && mode.id !== modes[0].id) parts.push(mode.label);
      return parts.join(' · ');
    }

    paintSetupChip() {
      if (!this.setupChip) return;
      // The chip stands for the row, so it is there exactly when the row is:
      // nothing to configure, nothing to open.
      this.setupChip.hidden = Boolean(this.setup?.hidden) && !this.sheetWanted;
      if (this.setupSheetMode) this.setupSheetMode.hidden = Boolean(this.modeButton?.hidden);
      const label = this.setupChipLabel();
      this.setupChipWhat.textContent = label;
      this.setupChip.setAttribute('aria-label', `Setup: ${label}`);
    }

    armSetupSheet() {
      this.setupChip.addEventListener('click', () => this.toggleSetupSheet());
      this.setupScrim.addEventListener('click', () => this.closeSetupSheet());
      this.setupSheet.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        this.closeSetupSheet();
      });
      // A sheet a finger drives: 1:1 down the screen from wherever it was
      // grabbed, resisting past the top, and the decision on release is the
      // direction the finger was going, not where it happened to stop.
      const grab = { id: null, from: 0, y: 0, v: 0, t: 0 };
      this.setupHandle.addEventListener('pointerdown', (event) => {
        if (grab.id !== null) return;
        grab.id = event.pointerId;
        grab.from = this.sheetAt;
        grab.y = event.clientY;
        grab.v = 0;
        grab.t = event.timeStamp;
        this.stopSheetSpring?.();
        this.stopSheetSpring = null;
        this.setupHandle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      this.setupHandle.addEventListener('pointermove', (event) => {
        if (grab.id !== event.pointerId) return;
        const height = this.setupSheet.offsetHeight || 1;
        const over = grab.from + (event.clientY - grab.y) / height;
        this.setSheetAt(Math.min(1, over < 0 ? -rubberband(-over * height, height) / height : over));
        const dt = event.timeStamp - grab.t;
        if (dt > 0) grab.v = ((event.clientY - grab.y) / dt) * 1000;
        grab.y = event.clientY;
        grab.t = event.timeStamp;
      });
      const release = (event) => {
        if (grab.id !== event.pointerId) return;
        grab.id = null;
        if (this.setupHandle.hasPointerCapture?.(event.pointerId)) this.setupHandle.releasePointerCapture(event.pointerId);
        const drifting = Math.abs(grab.v) < 60;
        if (drifting ? this.sheetAt > 0.5 : grab.v > 0) this.closeSetupSheet({ velocity: grab.v });
        else this.openSetupSheet({ velocity: grab.v });
      };
      this.setupHandle.addEventListener('pointerup', release);
      this.setupHandle.addEventListener('pointercancel', release);
    }

    /** 0 is open, 1 is gone. One number, read by the transform and the scrim
     *  together, so a drag moves both in step. */
    setSheetAt(at) {
      this.sheetAt = at;
      this.setupSheet.style.setProperty('--at', String(at));
      this.setupScrim.style.setProperty('--at', String(at));
    }

    springSheet(to, velocity = 0, done) {
      this.stopSheetSpring?.();
      this.stopSheetSpring = null;
      if (reduceMotion()) {
        // No slide: the CSS crossfades, and the sheet is only really gone
        // once that fade is over.
        this.setSheetAt(to);
        if (done) setTimeout(done, 150);
        return;
      }
      const height = this.setupSheet.offsetHeight || 1;
      this.stopSheetSpring = spring({
        from: this.sheetAt,
        to,
        velocity: velocity / height,
        // A drawer, Apple's values: it carries the flick that threw it.
        damping: 0.8,
        response: 0.3,
        onFrame: (value) => this.setSheetAt(value),
        onDone: () => {
          this.stopSheetSpring = null;
          done?.();
        },
      });
    }

    toggleSetupSheet() {
      if (this.sheetWanted) this.closeSetupSheet();
      else this.openSetupSheet();
    }

    openSetupSheet({ velocity = 0 } = {}) {
      if (!this.setupSheet || this.setup?.hidden) return;
      const first = !this.sheetWanted;
      this.sheetWanted = true;
      if (this.setupSheet.hidden) {
        this.setupHome = document.createComment('setup');
        this.setup.replaceWith(this.setupHome);
        this.modeHome = document.createComment('mode');
        this.modeButton.replaceWith(this.modeHome);
        this.setupSheetBody.append(this.setup);
        this.setupSheetMode.append(this.modeButton);
        this.setupScrim.hidden = false;
        this.setupSheet.hidden = false;
        this.setSheetAt(1);
        // Measured where it will actually be shown: fitting the pickers while
        // they were display:none read every segment as overflowing nothing.
        this.fitSetup();
      }
      if (first) this.setupChip.setAttribute('aria-expanded', 'true');
      this.springSheet(0, velocity);
    }

    closeSetupSheet({ velocity = 0 } = {}) {
      if (!this.sheetWanted) return;
      this.sheetWanted = false;
      this.setupChip?.setAttribute('aria-expanded', 'false');
      this.springSheet(1, velocity, () => this.restoreSetup());
    }

    /** The row goes back where it came from. Called when the sheet has
     *  finished leaving, and outright when this stops being a phone or leaves
     *  the page, because the bar is where those nodes live. */
    restoreSetup() {
      if (!this.setupHome) return;
      this.sheetWanted = false;
      this.stopSheetSpring?.();
      this.stopSheetSpring = null;
      closeSegMenus(this.shadowRoot);
      this.setupSheet.hidden = true;
      this.setupScrim.hidden = true;
      this.setSheetAt(1);
      this.setupHome.replaceWith(this.setup);
      this.modeHome.replaceWith(this.modeButton);
      this.setupHome = null;
      this.modeHome = null;
      this.setupChip?.setAttribute('aria-expanded', 'false');
      this.fitSetup();
    }

    cycleMode() {
      const modes = this.currentProvider()?.modes ?? [];
      if (!modes.length) return;
      this.mode = nextMode(modes, this.mode);
      this.persistMode();
    }

    async loadChrome() {
      try {
        const usage = await this.api.usage?.().catch(() => ({ meters: [] }));
        this.usageMeters = usage?.meters ?? [];
      } catch {
        this.usageMeters = [];
      }
    }

    async refreshChrome() {
      await this.loadChrome();
      this.applyAgentDisabled();
      this.paintPresets();
      this.paintStatus();
    }

    /** The bar's only status: which mode the CLI runs in. Agent, model and
     *  project are the mast's tags; what changed is each turn's footer. */
    paintStatus() {
      const provider = this.currentProvider();
      const modes = provider?.modes ?? [];
      const mode = modes.find((item) => item.id === this.mode) ?? modes[0];
      this.modeButton.hidden = !mode;
      this.modeButton.textContent = mode?.label ?? '';
      this.paintSetupChip();
    }

    paintMast() {
      const id = this.getAttribute('conversation');
      this.mast.hidden = !id;
      if (!id) {
        this.heading.textContent = '';
        this.tagsEl.replaceChildren();
        this.paintTarget();
        return;
      }
      const title = this.meta?.title || 'New Chat';
      this.savedTitle = title;
      if (this.shadowRoot.activeElement !== this.heading) this.heading.textContent = title;
      this.paintTags();
      this.paintTarget();
    }

    /** The document this chat is working in, named in the mast beside the
     *  model it runs on. It used to ride in the pane's bar, which is the
     *  pane's own furniture — status, group, split, close. Where the work
     *  lands is a fact about the conversation, so it belongs on the line that
     *  already carries them, and it is drawn as the link it is. */
    paintTarget() {
      const target = this.meta?.target || '';
      this.targetJump.hidden = !target;
      this.targetWhat.textContent = target;
      const href = target ? window.marble?.href?.(target) : '';
      if (href) this.targetJump.href = href;
      else this.targetJump.removeAttribute('href');
      // No href, nowhere to go: the name still says where the work lands, but
      // the arrow would be promising a jump that would not happen.
      this.targetOut.hidden = !href;
      this.targetJump.title = target ? (href ? `Open ${target}` : target) : '';
    }

    /** The construction zone this conversation is drawing, or null. One row in
     *  the mast: a live dot, where the work is, and an arrow that goes there.
     *  It is the only thing in a chat that points back out at the document. */
    showZone(zone) {
      this.zone = zone && Array.isArray(zone.ids) && zone.ids.length ? zone : null;
      this.zoneRow.hidden = !this.zone;
      this.paintFollow();
      if (!this.zone) {
        this.dispatchEvent(new CustomEvent('zone', { detail: { zone: null }, bubbles: true, composed: true }));
        return;
      }
      const here = this.zone.path === window.marble?.app;
      this.zoneWhat.textContent = here ? 'Building here' : `Building in ${this.zone.path}`;
      this.zoneJump.title = here
        ? 'Scroll to what the agent is working on'
        : `Open ${this.zone.path} at what the agent is working on`;
      this.zoneJump.setAttribute('aria-label', this.zoneJump.title);
      this.dispatchEvent(new CustomEvent('zone', { detail: { zone: this.zone }, bubbles: true, composed: true }));
    }

    /** Is this page already tied to this conversation? The tether lives on the
     *  document — collab.js owns it, because it is the thing that moves your
     *  view — and answers by cancelling the question. */
    followingHere() {
      const id = this.getAttribute('conversation');
      if (!id) return false;
      return !dispatchEvent(new CustomEvent('marble:following?', { cancelable: true, detail: { id } }));
    }

    paintFollow(on = this.followingHere()) {
      this.zoneFollow.setAttribute('aria-pressed', String(on));
      this.zoneFollowWhat.textContent = on ? 'Following' : 'Follow';
      this.zoneFollow.title = on
        ? 'Stop following this agent'
        : 'Follow this agent: your view goes where its work goes, here and into other documents';
      this.zoneFollow.setAttribute('aria-label', this.zoneFollow.title);
    }

    /** Going once and going along. A jump is spent on arrival; a tether keeps
     *  taking you — to the next element, and on to the next document — until
     *  you stop it. Following includes the first jump, because a tether that
     *  leaves you where you were has not started. */
    toggleFollow() {
      const id = this.getAttribute('conversation');
      if (!id) return;
      if (this.followingHere()) {
        dispatchEvent(new CustomEvent('marble:follow', { detail: { id: null } }));
        this.paintFollow(false);
        return;
      }
      const zone = this.zone;
      if (zone && zone.path !== window.marble?.app) {
        // Another document: the tether rides the hash and is tied on arrival.
        const at = zone.ids.map(encodeURIComponent).join(',');
        location.href = `/a/${encodeURIComponent(zone.path)}#follow=${encodeURIComponent(id)}&at=${at}`;
        return;
      }
      dispatchEvent(new CustomEvent('marble:follow', { detail: { id } }));
      this.paintFollow(true);
      if (zone) this.goToZone();
    }

    /** Same document: scroll to it. Another document: the jump is a navigation,
     *  and the ids ride in the hash so collab.js can land you on them. */
    goToZone() {
      const zone = this.zone;
      if (!zone) return;
      const at = zone.ids.map(encodeURIComponent).join(',');
      if (zone.path !== window.marble?.app) {
        location.href = `/a/${encodeURIComponent(zone.path)}#at=${at}`;
        return;
      }
      // Already here: no navigation, and no hash to leave in the history.
      dispatchEvent(new CustomEvent('marble:jump-to', { detail: { ids: [...zone.ids] } }));
    }

    paintTags() {
      const labels = new Map((this.providerList ?? []).map((provider) => [provider.id, provider]));
      const summary = {
        ...(this.meta ?? {}),
        provider: this.meta?.provider ?? radioValue(this.shadowRoot, 'agent'),
        model: radioValue(this.shadowRoot, 'model') || this.meta?.model,
        effort: radioValue(this.shadowRoot, 'effort') || this.meta?.effort,
      };
      this.tagsEl.replaceChildren();
      const projects = new Map((this.projectList ?? []).map((p) => [p.id, p]));
      for (const tag of conversationTags(summary, labels, projects)) {
        const el = h('span', 'tag', tag.label);
        el.dataset.kind = tag.kind;
        el.dataset.hue = String(tag.hue);
        if (tag.title) el.title = tag.title;
        this.tagsEl.append(el);
      }
    }

    commitTitle() {
      const id = this.getAttribute('conversation');
      if (!id) return;
      const next = this.heading.textContent.replace(/\s+/g, ' ').trim();
      if (!next) {
        this.heading.textContent = this.savedTitle || 'New Chat';
        return;
      }
      if (next === this.savedTitle) return;
      this.savedTitle = next;
      this.meta = { ...(this.meta ?? {}), id, title: next };
      this.api.update(id, { title: next }).catch((err) => this.system(err.message, true));
      this.dispatchEvent(new CustomEvent('meta', { detail: { meta: this.meta }, bubbles: true, composed: true }));
    }

    // ---------------------------------------------------------- sending

    /** Words that go in front of whatever is typed, written by the page rather
     *  than the hand: Describe mode sets this to the reading of its marks, so
     *  the card it borrows sends "I marked up the page: …" ahead of the
     *  sentence without ever putting those words in the box. */
    get briefText() {
      try { return String(this.brief?.() ?? '').trim(); } catch { return ''; }
    }

    updateSendable() {
      const noAgent = !this.getAttribute('conversation') && !radioValue(this.shadowRoot, 'agent');
      const canSend = Boolean(this.input.value.trim())
        || Boolean(this.briefText)
        || this.attachments.length > 0
        || this.composerChips.some((chip) => chip.kind === 'skill' || chip.kind === 'compact');
      this.sendButton.disabled = this.sending || noAgent || !canSend;
    }

    /** Whether the person has started a message here: the same test the send
     *  button makes, asked from outside. A chat nobody has typed into is a
     *  chat nobody would miss — it is what lets closing a brand-new pane
     *  discard it instead of filing it. The document chip does not count;
     *  the page put that there, not the person. */
    get drafting() {
      if (this.sending) return true;
      return Boolean(this.input?.value.trim())
        || this.attachments.length > 0
        || this.composerChips.some((chip) => chip.kind === 'skill' || chip.kind === 'compact');
    }

    /** What follows any change to the box: the attachment list, the empty
     *  marker and the send button. */
    onEdited() {
      this.syncChips();
      // A bullet with nothing in it is still something on screen: no placeholder over it.
      const empty = !this.input.value.trim() && !this.attachments.length && !this.input.querySelector('li');
      // Emptying the box by hand does not empty it: the browser keeps a <br>
      // behind as somewhere to put the caret, and the placeholder is an
      // ::after, so it drew on the line under that — a box twice as tall as a
      // line with the prompt sitting at the bottom of it. An empty box holds
      // its placeholder and nothing else.
      if (empty && this.input.firstChild && !this.composing) {
        const focused = this.shadowRoot.activeElement === this.input;
        this.input.replaceChildren();
        if (focused) placeCaret(this.input, 0);
      }
      this.input.toggleAttribute('data-empty', empty);
      this.updateSendable();
    }

    /** Setting the text keeps the chips: a token in the new text becomes the
     *  chip it named, and the document chip stays at the front. */
    setValue(text) {
      const before = this.orderedAttachments();
      fillEditor(this.input, text);
      const walker = document.createTreeWalker(this.input, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        TOKEN.lastIndex = 0;
        if (TOKEN.test(node.data)) nodes.push(node);
      }
      for (const node of nodes) {
        const frag = document.createDocumentFragment();
        let last = 0;
        TOKEN.lastIndex = 0;
        for (let m = TOKEN.exec(node.data); m; m = TOKEN.exec(node.data)) {
          frag.append(node.data.slice(last, m.index));
          const item = before[Number(m[2]) - 1];
          frag.append(item ? this.attachChip(item) : m[0]);
          last = m.index + m[0].length;
        }
        frag.append(node.data.slice(last));
        node.replaceWith(frag);
      }
      if (this.shadowRoot.activeElement === this.input) placeCaret(this.input);
      this.onEdited();
    }

    /** Kept for the callers that grew up with a textarea; the box sizes itself. */
    autosize() {
      this.onEdited();
    }

    /** What this message carries besides the words. The document it is about
     *  travels either way — a turn cannot exist without one — and the pane's
     *  own bar already names it, so naming it a second time inside the prose
     *  was one fact written twice, and a pill the caret had to step over every
     *  time the box was empty. What is left worth saying is the selection,
     *  which is a real choice about the next turn: it shows in the settings
     *  bar with the rest of them, only when there is one. */
    updateContext() {
      if (!this.selectionEl) return;
      const { selection = [] } = this.api?.context() ?? {};
      const count = this.skipSelection ? 0 : selection.length;
      this.selectionEl.hidden = !count;
      if (!count) {
        this.fitSetup();
        return;
      }
      this.selectionEl.replaceChildren();
      const label = h('span', 'selection-text', `${count} selected`);
      const clear = h('button', 'selection-clear', '×');
      clear.type = 'button';
      clear.setAttribute('aria-label', 'Don’t send the selection');
      clear.addEventListener('click', () => {
        this.skipSelection = true;
        this.updateContext();
        this.focusInput();
      });
      this.selectionEl.append(label, clear);
      this.selectionEl.title = `Sending ${count} selected line${count === 1 ? '' : 's'} from the document`;
      this.fitSetup();
    }

    async submit({ dispatch = null } = {}) {
      if (this.sending) return;
      const mode = dispatch ?? (this.running ? radioValue(this.shadowRoot, 'dispatch') || 'queue' : 'queue');
      let typed = this.input.value.trim();
      const slash = this.matchSlash(typed);
      if (slash?.kind === 'clear') {
        this.hideSlash();
        this.input.value = '';
        this.composerChips = [];
        this.renderChips();
        this.api.remember(null);
        this.removeAttribute('conversation');
        this.dispatchEvent(new CustomEvent('conversation', { detail: { id: null }, bubbles: true, composed: true }));
        this.load();
        return;
      }
      if (slash?.kind === 'model' || slash?.kind === 'effort') {
        this.hideSlash();
        if (slash.kind === 'model') {
          setRadioValue(this.shadowRoot, 'model', slash.id);
          this.syncEfforts();
        } else setRadioValue(this.shadowRoot, 'effort', slash.id);
        this.persistCatalog();
        this.input.value = slash.rest;
        typed = slash.rest;
        this.autosize();
        if (!typed && !this.composerChips.some((chip) => chip.kind === 'skill' || chip.kind === 'compact')) return;
      }
      const skillChips = this.composerChips.filter((chip) => chip.kind === 'skill');
      const compactChip = this.composerChips.some((chip) => chip.kind === 'compact');
      const brief = this.briefText;
      if (!typed && !brief && !skillChips.length && !compactChip && !this.attachments.length) return;

      let prompt = brief && !['skill', 'compact'].includes(slash?.kind) && !skillChips.length && !compactChip ? `${brief} ${typed}`.trim() : typed;
      if (compactChip || slash?.kind === 'compact') prompt = '/compact';
      else if (slash?.kind === 'skill') prompt = `/${slash.id}${slash.rest ? ` ${slash.rest}` : ''}`;
      else if (skillChips.length) prompt = `${skillChips.map((chip) => `/${chip.id}`).join(' ')}${typed ? ` ${typed}` : ''}`.trim();
      if (!prompt && !this.attachments.length) return;

      this.sending = true;
      this.updateSendable();
      try {
        // Attachments lead, because a long quotation read before the question
        // about it is the way round that a model answers well.
        const packed = await this.packAttachments();
        if (packed) prompt = `${packed}\n\n${prompt}`.trimEnd();
        const context = this.api.context();
        if (this.skipSelection) context.selection = [];
        let id = this.getAttribute('conversation');
        if (!id) {
          const provider = radioValue(this.shadowRoot, 'agent');
          if (!provider) throw new Error('Choose an agent first.');
          const picks = this.catalogPicks();
          const project = radioValue(this.shadowRoot, 'project') || 'drive';
          id = await this.api.start({
            provider,
            model: picks.model,
            effort: picks.effort,
            mode: picks.mode,
            project,
            failover: this.pendingFailover === 'pause' ? 'pause' : 'auto',
          });
          this.setAttribute('conversation', id);
          this.agentLabel.hidden = false;
          this.projectLabel.hidden = true;
          this.fillAgents(provider);
          this.meta = {
            id,
            failover: this.pendingFailover === 'pause' ? 'pause' : 'auto',
            provider,
            model: picks.model,
            effort: picks.effort,
            mode: picks.mode,
            project,
            title: null,
          };
          this.paintMast();
          this.paintPresets();
          this.paintFailover();
          this.dispatchEvent(new CustomEvent('conversation', { detail: { id }, bubbles: true, composed: true }));
        }
        await this.api.send(id, { prompt, dispatch: mode, ...context });
        // Whoever lent this composer out learns the words left it: Describe
        // mode steps back as soon as its brief is on its way.
        this.dispatchEvent(new CustomEvent('sent', { detail: { id, prompt }, bubbles: true, composed: true }));
        // A reply in the person's own words answers the question too.
        for (const record of this.turns.values()) {
          record.choice?.remove();
          record.choice = null;
        }
        this.input.value = '';
        this.clearAttachments();
        this.composerChips = this.composerChips.filter((chip) => chip.kind === 'model' || chip.kind === 'effort');
        this.renderChips();
        this.hideSlash();
        this.skipSelection = false;
        this.updateContext();
      } catch (err) {
        this.system(err.message, true);
      } finally {
        this.sending = false;
        this.autosize();
      }
    }

    matchSlash(text) {
      const hit = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
      if (!hit) return null;
      const name = hit[1];
      const rest = (hit[2] ?? '').trim();
      if (name === 'clear') return { kind: 'clear' };
      if (name === 'compact') return { kind: 'compact' };
      const provider = this.currentProvider();
      const familyEfforts = (this.currentModel()?.efforts ?? []).map((item) => item.id);
      const effortIds = [...new Set([...(provider?.efforts ?? []), ...familyEfforts])];
      if (effortIds.includes(name) || (name === 'effort' && rest && effortIds.includes(rest))) {
        return { kind: 'effort', id: name === 'effort' ? rest : name, rest: name === 'effort' ? '' : rest };
      }
      const model = provider?.models?.find((item) => item.id === name || item.label.toLowerCase() === name.toLowerCase());
      if (model) return { kind: 'model', id: model.id, rest };
      const skill = this.skills.find((item) => item.id === name);
      if (skill) return { kind: 'skill', id: skill.id, rest };
      return null;
    }

    slashQuery() {
      const value = this.input.value;
      if (!value.startsWith('/')) return null;
      return value.slice(1).split(/\s/, 1)[0].toLowerCase();
    }

    filterSlash() {
      const query = this.slashQuery();
      if (query === null || /\s/.test(this.input.value)) {
        this.hideSlash();
        return;
      }
      const provider = this.currentProvider();
      const familyEfforts = this.currentModel()?.efforts ?? [];
      const effortItems = (provider?.efforts?.length ? provider.efforts.map((level) => ({ id: level, label: level })) : familyEfforts)
        .map((level) => ({ kind: 'effort', id: level.id ?? level, label: `Effort: ${level.label ?? level}` }));
      const items = [
        { kind: 'clear', id: 'clear', label: 'Clear conversation', detail: 'Start a new one' },
        { kind: 'compact', id: 'compact', label: 'Compact', detail: 'Shrink this conversation’s context' },
        ...effortItems,
        ...(provider?.models ?? []).map((model) => ({ kind: 'model', id: model.id, label: model.label, detail: 'Model' })),
        ...this.skills.map((skill) => ({ kind: 'skill', id: skill.id, label: skill.name || skill.id, detail: skill.description })),
      ].filter((item) => !query || item.id.toLowerCase().includes(query) || item.label.toLowerCase().includes(query));
      this.slashItems = items;
      this.slashIndex = 0;
      this.renderSlash();
    }

    renderSlash() {
      this.slash.replaceChildren();
      if (!this.slashItems.length) {
        this.slash.hidden = true;
        return;
      }
      this.slash.hidden = false;
      this.slashItems.forEach((item, index) => {
        const button = h('button');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', index === this.slashIndex ? 'true' : 'false');
        button.append(h('span', '', item.kind === 'skill' ? `/${item.id}` : item.label));
        if (item.detail) button.append(h('small', '', item.detail));
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
          this.pickSlash(index);
        });
        this.slash.append(button);
      });
    }

    pickSlash(index) {
      const item = this.slashItems[index];
      if (!item) return;
      if (item.kind === 'skill') this.input.value = `/${item.id} `;
      else if (item.kind === 'model' || item.kind === 'effort') this.input.value = `/${item.id}`;
      else this.input.value = `/${item.id}`;
      this.hideSlash();
      this.autosize();
      this.input.focus();
      if (item.kind !== 'skill') this.submit();
    }

    chipSlash(index) {
      const item = this.slashItems[index];
      if (!item) return;
      this.hideSlash();
      if (item.kind === 'clear') {
        this.input.value = '/clear';
        this.submit();
        return;
      }
      this.addChip(item);
      this.input.value = '';
      this.autosize();
      this.input.focus();
    }

    addChip(item) {
      if (item.kind === 'model' || item.kind === 'effort') {
        this.composerChips = this.composerChips.filter((chip) => chip.kind !== item.kind);
        if (item.kind === 'model') setRadioValue(this.shadowRoot, 'model', item.id);
        else setRadioValue(this.shadowRoot, 'effort', item.id);
        if (item.kind === 'model') this.syncEfforts();
        this.persistCatalog();
      }
      if (item.kind === 'compact') {
        this.composerChips = this.composerChips.filter((chip) => chip.kind !== 'compact');
      }
      if (item.kind === 'skill' && this.composerChips.some((chip) => chip.kind === 'skill' && chip.id === item.id)) {
        this.renderChips();
        return;
      }
      const label = item.kind === 'skill' ? `/${item.id}` : item.label;
      this.composerChips.push({ kind: item.kind, id: item.id, label, hue: hueIndex(item.id) });
      this.renderChips();
    }

    renderChips() {
      if (!this.chipsEl) return;
      this.chipsEl.replaceChildren();
      this.chipsEl.hidden = !this.composerChips.length;
      for (const chip of this.composerChips) {
        const el = h('span', 'chip', chip.label);
        el.dataset.kind = chip.kind;
        el.dataset.hue = String(chip.hue);
        const remove = h('button', 'chip-remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${chip.label}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          this.composerChips = this.composerChips.filter((other) => other !== chip);
          this.renderChips();
        });
        el.append(remove);
        this.chipsEl.append(el);
      }
      this.updateSendable();
    }

    // ------------------------------------------------------- attachments

    /** A paste is an attachment when it is an image, or when it is more text
     *  than the box can show at once. Anything shorter is just typing. */
    takePaste(event) {
      const data = event.clipboardData;
      if (!data) return;
      const images = [...(data.files ?? [])].filter((file) => file.type.startsWith('image/'));
      if (images.length) {
        event.preventDefault();
        for (const file of images) this.attachImage(file);
        return;
      }
      const text = data.getData('text/plain') ?? '';
      if (text.length <= PASTE_CHARS && text.split('\n').length <= PASTE_LINES) return;
      event.preventDefault();
      this.attachText(text);
    }

    attachText(text) {
      const lines = text.split('\n');
      const item = {
        key: `a${(this.attachSeq += 1)}`,
        kind: 'text',
        name: 'Pasted text',
        text,
        lines: lines.length,
        bytes: new Blob([text]).size,
        peek: lines.slice(0, 4).join('\n'),
      };
      this.attachments.push(item);
      this.insertChip(this.attachChip(item));
      this.focusInput();
    }

    attachImage(file) {
      if (!IMAGE_TYPES.has(file.type)) {
        this.system(`${file.name || 'That file'} is a ${file.type || 'kind of file'} this drive does not keep.`, true);
        return;
      }
      if (file.size > MAX_IMAGE) {
        this.system(`${file.name || 'That image'} is ${sizeOf(file.size)} — larger than the ${sizeOf(MAX_IMAGE)} an image can be.`, true);
        return;
      }
      const item = {
        key: `a${(this.attachSeq += 1)}`,
        kind: 'image',
        name: file.name || 'Pasted image',
        type: file.type,
        bytes: file.size,
        file,
        src: URL.createObjectURL(file),
      };
      this.attachments.push(item);
      this.insertChip(this.attachChip(item));
      this.focusInput();
    }

    dropAttachment(item) {
      this.input.querySelector(`.ichip[data-key="${CSS.escape(item.key)}"]`)?.remove();
      this.onEdited();
      this.focusInput();
    }

    clearAttachments() {
      for (const chip of this.input.querySelectorAll('.ichip[data-key]')) chip.remove();
      this.closePeek();
      this.onEdited();
    }

    /** The chip a pasted thing is shown as, in the box and in the sent bubble. */
    attachChip(item) {
      const chip = h('span', 'ichip');
      chip.contentEditable = 'false';
      chip.dataset.kind = item.kind;
      if (item.key) chip.dataset.key = item.key;
      chip.setAttribute('role', 'button');
      chip.tabIndex = -1;
      if (item.kind === 'image') {
        // Only when there is something to load. A chip rebuilt from a restored
        // draft has no blob left, and an <img> with an empty src paints the
        // browser's broken-image glyph — a torn page where a picture should be.
        const source = item.src ?? item.url ?? '';
        if (source) {
          const shot = h('img', 'ichip-shot');
          shot.src = source;
          shot.alt = '';
          // A blob URL outlives nothing; if it has gone, fall back rather than
          // leave the glyph standing.
          shot.addEventListener('error', () => shot.replaceWith(imageMark()), { once: true });
          chip.append(shot);
        } else {
          chip.append(imageMark());
        }
        chip.append(h('span', 'ichip-name', item.name));
        chip.setAttribute('aria-label', `${item.name}, ${sizeOf(item.bytes ?? 0)} — open`);
      } else {
        chip.append(h('span', 'ichip-name', `Pasted text · ${item.lines} lines`));
        chip.setAttribute('aria-label', `Pasted text, ${item.lines} lines — open`);
      }
      chip.addEventListener('click', () => this.openPeek(item));
      // The document chip can be taken off with its ×, so an attachment can
      // too. Backspacing over it worked and said so to nobody.
      if (item.key) {
        const clear = h('button', 'ichip-clear', '×');
        clear.type = 'button';
        clear.setAttribute('aria-label', `Remove ${item.name}`);
        clear.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.dropAttachment(item);
        });
        chip.append(clear);
      }
      return chip;
    }

    /** At the caret when the box has it, else at the end. A space follows so
     *  typing carries on after the chip. */
    insertChip(chip) {
      this.settleCaret();
      const at = selectionIn(this.input);
      const space = document.createTextNode(' ');
      if (at) {
        at.range.deleteContents();
        at.range.insertNode(space);
        at.range.insertNode(chip);
      } else {
        this.input.append(chip, space);
      }
      placeCaret(space, 1);
      this.onEdited();
    }

    /** The document chip is always first: a caret in front of it is moved
     *  behind it, so nothing typed or pasted lands ahead of it. */
    settleCaret() {
      const context = this.input.firstChild;
      if (!context?.classList?.contains('ichip') || context.dataset.kind !== 'context') return;
      const at = selectionIn(this.input);
      // A selection that starts in front of the chip is a selection over it
      // (select-all); deleting or replacing that takes the chip too, on purpose.
      if (!at || !at.range.collapsed) return;
      const { range } = at;
      const before = range.startContainer === this.input && range.startOffset === 0;
      if (before || context.contains(range.startContainer)) placeCaret(this.input, 1);
    }

    /** The list follows the box: a chip that is gone is an attachment that
     *  is gone, whichever key took it out. */
    syncChips() {
      const keys = new Set([...this.input.querySelectorAll('.ichip[data-key]')].map((chip) => chip.dataset.key));
      for (const item of this.attachments) {
        if (keys.has(item.key)) continue;
        if (item.src) URL.revokeObjectURL(item.src);
        if (this.peekItem === item) this.closePeek();
      }
      this.attachments = this.attachments.filter((item) => keys.has(item.key));
    }

    /** Attachments in the order their chips sit in the text, which is the
     *  order the blocks are numbered in. */
    orderedAttachments() {
      const byKey = new Map(this.attachments.map((item) => [item.key, item]));
      return [...this.input.querySelectorAll('.ichip[data-key]')].map((chip) => byKey.get(chip.dataset.key)).filter(Boolean);
    }

    /** The same card for a paste waiting to be sent and for one already sent:
     *  a name, how much of it there is, and a glance at what is inside. */
    attachCard(item) {
      const card = h('button', 'attach');
      card.type = 'button';
      card.dataset.kind = item.kind;
      if (item.kind === 'image') {
        const shot = h('img', 'attach-shot');
        shot.src = item.src ?? item.url ?? '';
        shot.alt = item.name;
        shot.loading = 'lazy';
        card.append(shot);
      }
      const head = h('div', 'attach-head');
      head.append(h('span', 'attach-name', item.name));
      head.append(h('span', 'attach-meta', item.kind === 'image' ? sizeOf(item.bytes ?? 0) : `${item.lines} lines`));
      card.append(head);
      if (item.kind === 'text') card.append(h('pre', 'attach-peek', item.peek ?? item.text.split('\n').slice(0, 4).join('\n')));
      card.setAttribute('aria-label', `${item.name}, ${item.kind === 'image' ? sizeOf(item.bytes ?? 0) : `${item.lines} lines`} — open`);
      card.addEventListener('click', () => this.openPeek(item));
      return card;
    }

    openPeek(item) {
      this.peekItem = item;
      this.peekTitle.textContent = item.kind === 'image'
        ? `${item.name} · ${sizeOf(item.bytes ?? 0)}`
        : `${item.name} · ${item.lines ?? item.text.split('\n').length} lines`;
      if (item.kind === 'image') {
        const full = h('img', '');
        full.src = item.src ?? item.url ?? '';
        full.alt = item.name;
        this.peekBody.replaceChildren(full);
      } else {
        this.peekBody.replaceChildren(document.createTextNode(item.text ?? ''));
      }
      this.peek.hidden = false;
      this.peekBody.scrollTop = 0;
      this.peekClose.focus({ preventScroll: true });
    }

    closePeek() {
      if (this.peek.hidden) return;
      this.peek.hidden = true;
      this.peekItem = null;
      this.peekBody.replaceChildren();
    }

    /** Images become files on the host first — every provider is a CLI reading
     *  the disk, so a path is the only thing all of them can open. */
    async packAttachments() {
      const blocks = [];
      for (const [index, item] of this.orderedAttachments().entries()) {
        const at = index + 1;
        if (item.kind === 'text') {
          blocks.push(`<pasted-text index="${at}" lines="${item.lines}" chars="${item.text.length}">\n${item.text}\n</pasted-text>`);
          continue;
        }
        if (!item.saved) {
          item.saved = await this.api.upload({
            name: item.name,
            type: item.type,
            data: await asBase64(item.file),
          });
        }
        const { path, url, name, bytes } = item.saved;
        blocks.push(
          `<pasted-image index="${at}" name="${escAttr(name || item.name)}" bytes="${bytes}" path="${escAttr(path)}" url="${escAttr(url)}"></pasted-image>`,
        );
      }
      return blocks.join('\n\n');
    }

    /** What a sent message looks like: its attachments as the cards they were,
     *  then whatever the person actually typed around them. */
    userMessage(text, from = null) {
      const { blocks, rest } = splitPasted(text);
      const node = h('div', 'msg me');
      if (from) {
        node.classList.add('from-agent');
        const who = h('span', 'from');
        const open = h('button', '', from.title || from.conversation);
        open.type = 'button';
        open.title = 'Open that conversation';
        // The button carries the name for a11y (focusable, reads as a label),
        // but the whole row is the click target: a block-level "From" line is
        // wider than its text, and a click past the name should still open it.
        who.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('marble-agent:open', { bubbles: true, composed: true, detail: { id: from.conversation } }));
        });
        who.append('From ', open);
        node.append(who);
      }
      const items = blocks.map((block) => ({
        kind: block.kind,
        name: block.name || (block.kind === 'image' ? 'Pasted image' : 'Pasted text'),
        url: block.url,
        text: block.text,
        lines: Number(block.lines) || (block.text ? block.text.split('\n').length : 0),
        bytes: Number(block.bytes ?? block.chars) || 0,
      }));
      const shown = new Set();
      const chip = (_kind, n) => {
        const item = items[n - 1];
        if (!item) return null;
        shown.add(item);
        return this.attachChip(item);
      };
      const body = h('div', 'msg-text');
      body.append(renderText(blocks.length ? rest : text, { chip }));
      node.append(body);
      // A block the text never names (a message from before chips were
      // inline) still shows, as a card under the words.
      const unnamed = items.filter((item) => !shown.has(item));
      if (unnamed.length) {
        const strip = h('div', 'attachments');
        for (const item of unnamed) strip.append(this.attachCard(item));
        node.append(strip);
      }
      return node;
    }

    hideSlash() {
      this.slash.hidden = true;
      this.slashItems = [];
    }

    onSlashKey(event) {
      if (this.slash.hidden) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideSlash();
        return true;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        this.slashIndex = (this.slashIndex + delta + this.slashItems.length) % this.slashItems.length;
        this.renderSlash();
        return true;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.pickSlash(this.slashIndex);
        return true;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        this.chipSlash(this.slashIndex);
        return true;
      }
      return false;
    }

    // ---------------------------------------------------------- receiving

    receive(event) {
      const id = this.getAttribute('conversation');
      if (!eventBelongsToConversation(event, id)) return;
      if (event.seq) {
        if (event.seq <= this.seen) return;
        this.seen = event.seq;
      }
      const stuck = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 48;
      const turn = event.turn;
      switch (event.type) {
        case 'user': {
          this.endLive();
          // What was typed, not what was attached: a title and a queue row are
          // both one line, and a pasted file would be all of it.
          const said = splitPasted(event.text).rest || String(event.text ?? '');
          this.prompts.set(turn, said);
          this.record(turn).target = event.context?.target ?? null;
          if (event.context?.target || event.text) {
            this.meta = {
              ...(this.meta ?? {}),
              target: event.context?.target ?? this.meta?.target,
              title: this.meta?.title || (event.from ? `From ${event.from.title || event.from.conversation}` : said.trim().slice(0, 60)),
            };
            this.paintMast();
          }
          this.append(turn, this.userMessage(event.text, event.from ?? null));
          break;
        }
        case 'turn.queued':
          this.queue(turn, true);
          break;
        case 'turn.removed':
          // Taken out of the queue before it ever ran: the bubble was never
          // in the transcript, and nothing happened for it to stay for.
          this.logEl.querySelector(`.msg.me[data-turn="${CSS.escape(turn)}"]`)?.remove();
          this.queue(turn, false);
          this.forget(turn);
          break;
        case 'turn.started':
          this.queue(turn, false);
          this.record(turn).started = event.t;
          this.footer(turn, 'running');
          this.setRunning(turn);
          break;
        case 'text.delta':
          this.delta(turn, event.text);
          break;
        case 'text':
          this.text(turn, event.text);
          break;
        case 'tool.call':
          this.endLive();
          this.toolCall(turn, event);
          break;
        case 'tool.result':
          this.toolResult(turn, event);
          break;
        case 'ops.applied':
          this.opsApplied(turn, event);
          break;
        // The construction zone this turn is drawing on its document, sent here
        // too because the chat may be read from another page entirely.
        case 'zone':
          this.showZone(event.ids?.length ? event : null);
          break;
        case 'document.changed':
          this.documentChanged(turn, event);
          break;
        case 'ops.refused':
          this.opsRefused(turn, event);
          break;
        case 'watchdog':
          this.record(turn).watchdog = event;
          break;
        case 'ask':
          this.endLive();
          // An ask needs an answer, so a folded callout unfolds itself.
          this.removeAttribute('data-folded');
          this.ask(turn, event);
          break;
        case 'ask.answered':
        case 'ask.void':
          this.askClosed(turn, event);
          break;
        case 'turn.completed':
        case 'turn.failed':
        case 'turn.cancelled':
        case 'turn.interrupted':
          this.endLive();
          this.finish(turn, event);
          if (event.type === 'turn.failed' && event.usageStopped && this.failoverMode() === 'pause') this.showUsageNote(event);
          break;
        case 'turn.undone':
          this.undone(turn, event);
          break;
        case 'handoff':
          this.system(event.from ? 'Continued from an earlier conversation.' : 'Continued in a new conversation.');
          break;
        case 'usage.continued':
          this.hideUsageNote();
          this.system(`Claude usage stopped. Continuing on ${event.label}.`);
          break;
        case 'usage.left':
          if (event.turn) this.usageLeft?.add(event.turn);
          if (this.usageAsk?.turn === event.turn) this.hideUsageNote();
          break;
        case 'message':
          this.endLive();
          this.append(turn, this.userMessage(event.text, { conversation: event.from, title: event.fromTitle }));
          break;
        case 'message.sent':
          this.system(`Sent to ${event.toTitle || event.to}${event.delivered === 'turn' ? ' — started their turn' : event.delivered === 'live' ? ' — they were waiting' : ' — they will read it when their turn ends'}`);
          break;
        default:
      }
      if (stuck) this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    record(turn) {
      if (!this.turns.has(turn)) this.turns.set(turn, { tools: new Map(), applies: [], applied: 0, footer: null, asks: new Map() });
      return this.turns.get(turn);
    }

    /** The process is waiting on the person: a permission prompt, or a
     *  question with options. A card under the turn's last message, answered
     *  once; the answer event (from any pane) removes it. */
    ask(turn, event) {
      let card = null;
      const submit = async (response) => {
        for (const b of card.querySelectorAll('button')) b.disabled = true;
        try {
          await this.api.answer(turn, event.requestId, response);
        } catch (err) {
          for (const b of card.querySelectorAll('button')) b.disabled = false;
          this.system(err.message, true);
        }
      };
      card = this.buildAskCard(event, submit);
      this.record(turn).asks.set(event.requestId, card);
      this.append(turn, card);
      card.querySelector('button')?.focus({ preventScroll: true });
    }

    /** The card an ask becomes: a permission prompt with Allow / Deny and a
     *  note, or a question's numbered options with Other…. `submit` gets the
     *  built response; whoever owns the card decides where it goes. Uses
     *  nothing of the instance, so the Agents page draws the same card. */
    buildAskCard(event, submit) {
      const card = h('div', 'ask');
      card.dataset.request = event.requestId;
      card.dataset.kind = event.kind;
      if (event.kind === 'question') {
        const picks = new Map();
        const questions = event.input?.questions ?? [];
        // One answer covers every question; each question's Other text is
        // folded into its picks just before the response is built.
        const resolveOther = [];
        let answer = () => {};
        for (const q of questions) {
          const block = h('div', 'ask-q');
          block.append(h('div', 'ask-title', q.question));
          const list = h('div', 'ask-options');
          list.setAttribute('role', q.multiSelect ? 'group' : 'radiogroup');
          list.setAttribute('aria-label', q.question);
          const set = new Set();
          picks.set(q.question, set);
          const other = document.createElement('input');
          other.className = 'ask-other-text';
          other.hidden = true;
          other.placeholder = 'Type an answer';
          other.setAttribute('aria-label', 'Your own answer');
          const options = [
            ...(q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })),
            { label: 'Other…', description: '', other: true },
          ];
          const buttons = options.map((o, i) => {
            const b = h('button', o.other ? 'ask-other' : '');
            b.type = 'button';
            b.setAttribute('role', q.multiSelect ? 'checkbox' : 'radio');
            b.setAttribute('aria-checked', 'false');
            b.tabIndex = i === 0 ? 0 : -1;
            b.append(h('kbd', '', String(i + 1)), h('b', '', o.label));
            if (o.description) b.append(h('small', '', o.description));
            return b;
          });
          const choose = (b, o) => {
            if (!q.multiSelect) {
              set.clear();
              for (const x of buttons) x.setAttribute('aria-checked', 'false');
            }
            const on = b.getAttribute('aria-checked') !== 'true';
            b.setAttribute('aria-checked', String(on));
            if (o.other) {
              other.hidden = !on;
              set.delete(OTHER);
              if (on) {
                set.add(OTHER);
                other.focus();
              }
              return;
            }
            if (on) set.add(o.label);
            else set.delete(o.label);
          };
          resolveOther.push(() => {
            if (!set.has(OTHER)) return;
            set.delete(OTHER);
            if (other.value.trim()) set.add(other.value.trim());
          });
          buttons.forEach((b, i) => {
            const o = options[i];
            b.addEventListener('click', () => choose(b, o));
            b.addEventListener('keydown', (e) => {
              const digit = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
                for (const x of buttons) x.tabIndex = -1;
                next.tabIndex = 0;
                next.focus();
              } else if (e.key === ' ') {
                e.preventDefault();
                choose(b, o);
              } else if (digit >= 0 && buttons[digit]) {
                e.preventDefault();
                choose(buttons[digit], options[digit]);
                buttons[digit].focus();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (!set.size) choose(b, o);
                if (o.other && !other.value.trim()) return;
                answer();
              }
            });
          });
          other.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              answer();
            }
          });
          list.append(...buttons, other);
          block.append(list);
          card.append(block);
        }
        answer = () => {
          for (const fold of resolveOther) fold();
          submit(askResponse('question', event.input, picks));
        };
        const actions = h('div', 'ask-actions');
        const answerButton = h('button', 'answer', 'Answer');
        answerButton.type = 'button';
        answerButton.addEventListener('click', () => answer());
        actions.append(answerButton);
        card.append(actions);
      } else {
        card.append(h('div', 'ask-title', `Allow ${event.displayName || event.tool}?`));
        const detail = event.input?.command ?? event.input?.file_path ?? event.input?.path ?? event.input?.url ?? '';
        if (detail) card.append(h('pre', '', String(detail)));
        else card.append(h('div', 'tool', toolLabel(event.tool, event.input ?? {}).label));
        const actions = h('div', 'ask-actions');
        const allow = h('button', 'allow', 'Allow');
        allow.type = 'button';
        allow.addEventListener('click', () => submit(askResponse('permission', event.input, new Map(), null)));
        const note = document.createElement('input');
        note.className = 'deny-note';
        note.placeholder = 'Why not? (optional)';
        note.setAttribute('aria-label', 'Reason for denying');
        const deny = h('button', 'deny', 'Deny');
        deny.type = 'button';
        deny.addEventListener('click', () => submit(askResponse('permission', event.input, new Map(), note.value.trim())));
        actions.append(allow, deny, note);
        card.append(actions);
      }
      return card;
    }

    askClosed(turn, event) {
      const record = this.record(turn);
      const card = record.asks.get(event.requestId);
      if (!card) return;
      card.remove();
      record.asks.delete(event.requestId);
      if (event.type === 'ask.void' && event.why !== 'cancelled') this.system('The agent stopped waiting for that answer.');
    }

    forget(turn) {
      this.turns.delete(turn);
    }

    /** Entries of a turn go above its footer, so the footer stays last. */
    append(turn, node) {
      if (turn && node.classList?.contains('msg')) node.dataset.turn = turn;
      const footer = turn ? this.turns.get(turn)?.footer : null;
      if (footer?.isConnected) this.logEl.insertBefore(node, footer);
      else this.logEl.append(node);
    }

    failoverMode() {
      if (this.meta?.failover === 'pause' || this.meta?.failover === 'auto') return this.meta.failover;
      return this.pendingFailover === 'pause' ? 'pause' : 'auto';
    }

    paintFailover() {
      if (!this.failoverButton) return;
      const pause = this.failoverMode() === 'pause';
      this.failoverButton.dataset.failover = pause ? 'pause' : 'auto';
      if (this.failoverMark) this.failoverMark.innerHTML = pause ? PAUSE_ICON : HANDOFF_ICON;
      if (this.failoverWord) this.failoverWord.textContent = pause ? 'Pause' : 'Hand off';
      this.failoverButton.setAttribute('aria-label', pause
        ? 'Pause when Claude usage stops. Click to hand off to Cursor instead.'
        : 'Hand off to Cursor when Claude usage stops. Click to pause instead.');
    }

    flipFailover() {
      const next = this.failoverMode() === 'pause' ? 'auto' : 'pause';
      this.pendingFailover = next;
      if (this.meta) this.meta = { ...this.meta, failover: next };
      this.paintFailover();
      const id = this.getAttribute('conversation');
      if (!id) return;
      this.api.update(id, { failover: next }).catch((err) => this.system(err.message, true));
    }

    showUsageNote(event) {
      if (!this.usageNote || this.usageLeft?.has(event.turn)) return;
      this.usageAsk = event;
      const can = event.canSwitch !== false;
      this.usageNoteText.textContent = can
        ? (event.next === 'grok'
          ? 'This model stopped. Switch to Grok?'
          : 'Claude usage stopped. Switch to Cursor?')
        : String(event.stay || 'Cursor is unavailable, so this chat stayed on Claude').replace(/^—\s*/, '');
      this.usageSwitch.hidden = !can;
      this.usageNote.hidden = false;
    }

    hideUsageNote() {
      if (this.usageNote) this.usageNote.hidden = true;
      this.usageAsk = null;
    }

    switchFromUsage() {
      const id = this.getAttribute('conversation');
      if (!id) return;
      this.api.failover(id).then(() => this.hideUsageNote()).catch((err) => this.system(err.message, true));
    }

    leaveUsage() {
      const id = this.getAttribute('conversation');
      const turn = this.usageAsk?.turn;
      if (turn) this.usageLeft?.add(turn);
      this.hideUsageNote();
      if (!id || !turn) return;
      this.api.leaveUsage(id, turn).catch((err) => this.system(err.message, true));
    }

    system(message, error = false) {
      this.logEl.append(h('div', error ? 'system error' : 'system', message));
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    /** The callout's one line: whatever the log said last, on one line. Any
     *  other chrome leaves the button hidden, so this costs nothing there. */
    tick() {
      if (this.dataset.chrome !== 'callout' || !this.ticker) return;
      const last = [...this.logEl.children].reverse().find((el) => !el.classList.contains('turn-footer'));
      // Not textContent: a paragraph followed by a list would run together
      // into onesentence. Blocks are spaced, inline runs are not, so bold
      // text keeps its punctuation.
      const text = (last ? flatten(last) : '').replace(/\s+/g, ' ').trim();
      this.ticker.textContent = text.slice(0, 240);
      this.ticker.hidden = !text;
    }

    delta(turn, text) {
      if (!this.live || this.live.turn !== turn) {
        this.endLive();
        const node = h('div', 'msg agent live');
        this.live = { turn, node, raw: '' };
        this.append(turn, node);
      }
      this.live.raw += text;
      // The cheap path is the only one until a visual opens. After that the
      // live message is rebuilt from the whole delta each time, because half a
      // visual is markup and markup is not what the log shows.
      if (!this.live.visual && !VISUAL_OPEN.test(this.live.raw)) {
        this.live.node.append(text);
        return;
      }
      this.live.visual = true;
      const mod = window.marbleAgentUI?.maskStreamingVisuals;
      if (!mod) {
        // Nothing is shown until the module that knows what to hide is here.
        // If it never comes, this falls back to the plain streaming it
        // replaced rather than waiting on a promise that has already settled.
        if (this.visualGone) {
          this.live.node.append(text);
          return;
        }
        loadVisual().then((loaded) => {
          this.visualGone = !loaded;
          if (this.live?.turn === turn) this.delta(turn, '');
        });
        return;
      }
      const { text: shown, visuals } = mod(this.live.raw);
      this.live.node.replaceChildren(shown);
      this.styleVisuals(window.marbleAgentUI?.VISUAL_CSS);
      for (let i = 0; i < visuals; i += 1) this.live.node.append(h('div', 'visual-pending'));
    }

    /** The hook renderText calls for a ```marble-visual block: a shell now, and
     *  the frame that fills it as soon as the module lands. */
    visualHook() {
      return (info, body) => {
        const card = h('figure', 'visual');
        card.setAttribute('role', 'group');
        card.append(h('div', 'visual-pending'));
        loadVisual().then((loaded) => {
          if (loaded) {
            this.styleVisuals(loaded.VISUAL_CSS);
            loaded.mountVisual(card, { info, body, view: this });
            return;
          }
          // A host that cannot serve the module — an older one, or a reload
          // that lost the network — shows the markup as what it is. A
          // placeholder that shimmers for ever is the one thing worse.
          const pre = h('pre');
          pre.append(h('code', '', body));
          card.replaceChildren(pre);
        });
        return card;
      };
    }

    /** The card's own sheet, added to this root the first time one appears. */
    styleVisuals(css) {
      if (this.visualStyled || !css) return;
      this.visualStyled = true;
      const style = document.createElement('style');
      style.textContent = css;
      this.shadowRoot.append(style);
    }

    /** The palette again, for frames that were mounted before it changed. */
    repaintVisuals() {
      if (!this.visualStyled) return;
      visualModule?.then?.((mod) => mod?.paintVisuals(this));
    }

    text(turn, text) {
      const visual = this.visualHook();
      if (this.live && this.live.turn === turn) {
        this.live.node.classList.remove('live');
        this.live.node.replaceChildren(renderText(text, { visual }));
        this.record(turn).lastText = { text, node: this.live.node };
        this.live = null;
        return;
      }
      const node = h('div', 'msg agent');
      node.append(renderText(text, { visual }));
      this.append(turn, node);
      this.record(turn).lastText = { text, node };
    }

    /** A finished turn whose last words were a question with lettered or
     *  numbered options gets a picker under them. */
    async offerChoices(turn) {
      const record = this.turns.get(turn);
      if (!record?.lastText?.node?.isConnected || record.choice) return;
      const mod = await loadChoice();
      const parsed = mod?.parseChoiceQuestion(record.lastText.text);
      if (!parsed || !record.lastText.node.isConnected || record.choice) return;
      record.choice = this.choicePicker(parsed, () => {
        record.choice?.remove();
        record.choice = null;
      });
      record.lastText.node.after(record.choice);
    }

    choicePicker({ question, options, multiHint }, done) {
      const group = h('div', 'choice-ask');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', question);
      const chosen = new Set();
      const buttons = options.map((o, i) => {
        const b = h('button');
        b.type = 'button';
        b.setAttribute('role', multiHint ? 'checkbox' : 'radio');
        b.setAttribute('aria-checked', 'false');
        b.tabIndex = i === 0 ? 0 : -1;
        b.append(h('kbd', '', o.key), h('b', '', o.label));
        return b;
      });
      const toggle = (i) => {
        const b = buttons[i];
        if (!multiHint) {
          chosen.clear();
          for (const x of buttons) x.setAttribute('aria-checked', 'false');
        }
        const on = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', String(on));
        if (on) chosen.add(i);
        else chosen.delete(i);
      };
      const send = async (fallback) => {
        if (!chosen.size && fallback != null) toggle(fallback);
        const picked = [...chosen].sort((a, b) => a - b).map((i) => options[i]);
        if (!picked.length) return;
        this.input.value = `${picked.map((o) => o.key).join(', ')} — ${picked.map((o) => o.label).join('; ')}`;
        await this.submit();
        if (!this.input.value) done();
      };
      buttons.forEach((b, i) => {
        b.addEventListener('click', () => toggle(i));
        b.addEventListener('dblclick', () => send(i));
        b.addEventListener('keydown', (e) => {
          const key = options.findIndex((o) => o.key.toLowerCase() === e.key.toLowerCase());
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
            for (const x of buttons) x.tabIndex = -1;
            next.tabIndex = 0;
            next.focus();
          } else if (e.key === ' ') {
            e.preventDefault();
            toggle(i);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            send(i);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            chosen.clear();
            for (const x of buttons) x.setAttribute('aria-checked', 'false');
          } else if (e.key.length === 1 && key >= 0) {
            e.preventDefault();
            toggle(key);
            buttons[key].focus();
          }
        });
      });
      const sendButton = h('button', 'choice-send', 'Send');
      sendButton.type = 'button';
      sendButton.addEventListener('click', () => send(null));
      group.append(...buttons, sendButton);
      return group;
    }

    endLive() {
      if (!this.live) return;
      this.live.node.classList.remove('live');
      this.live = null;
    }

    toolCall(turn, event) {
      const { label, short, source } = toolLabel(event.name, event.input);
      const row = h('div', 'tool', label);
      row.dataset.state = 'pending';
      row.dataset.name = event.name;
      row.dataset.short = short;
      // Kept so a refusal or a failure can say which step it was, instead of
      // replacing the label with the bare tool name.
      row.dataset.was = label;
      if (event.name === 'act') row.dataset.kind = 'act';
      if (source) row.dataset.source = source;
      const record = this.record(turn);
      record.tools.set(event.callId, row);
      if (event.name === 'apply_ops') record.applies.push({ row, path: event.input?.path });
      this.append(turn, row);
    }

    /** The nodes that belong to a turn: everything between the previous
     *  turn's footer (or the top) and this turn's footer. */
    turnNodes(turn) {
      const record = this.turns.get(turn);
      if (!record?.footer?.isConnected) return [];
      const nodes = [];
      let at = record.footer.previousSibling;
      while (at && !at.classList?.contains('turn-footer')) {
        nodes.unshift(at);
        at = at.previousSibling;
      }
      return nodes;
    }

    regroup(turn) {
      collapseToolRows(this.turnNodes(turn));
    }

    toolResult(turn, event) {
      const row = this.record(turn).tools.get(event.callId);
      if (!row || row.dataset.state === 'refused') return;
      // The one row its result is allowed to rewrite. "Pressing sort-btn" is
      // the call; "Pressed Sort · 12 changes" is what happened, and only the
      // host — which read the control's own words and counted the ops — can
      // say it. Its result leads with that line.
      if (row.dataset.kind === 'act' && event.ok) {
        const said = String(event.summary ?? '').trim().split('\n')[0];
        if (said && said.length <= 80) {
          row.textContent = said;
          row.dataset.was = said;
        }
      }
      if (row.dataset.state === 'pending' && event.ok && row.dataset.name !== 'apply_ops') {
        row.dataset.state = 'done';
        this.regroup(turn);
        return;
      }
      if (!event.ok) {
        // "Blocked" is a claim about a decision someone made, so only a
        // refusal gets to make it. A command that exited 1 — a typo, a
        // missing module, a test that failed — is the agent's own business
        // and says "Failed". Calling both "Blocked" read as a drive with no
        // access when most of it was the agent tripping over its own shell.
        const denied = Boolean(event.denied);
        row.dataset.state = denied ? 'refused' : 'failed';
        row.title = event.summary ?? '';
        if (!['list_documents', 'read_document', 'apply_ops', 'create_document', 'read_guide', 'check_document'].includes(row.dataset.name)) {
          // The label already says what the step was ("Ran the runner tests");
          // keep it, because what was refused is the useful half.
          row.textContent = `${denied ? 'Blocked' : 'Failed'}: ${row.dataset.was ?? row.dataset.name}`;
        }
      } else if (row.dataset.state === 'pending') {
        row.dataset.state = 'done';
      }
      this.regroup(turn);
    }

    pendingApply(turn, path) {
      return this.record(turn).applies.find((a) => a.row.dataset.state === 'pending' && (!a.path || !path || a.path === path));
    }

    opsApplied(turn, event) {
      if (event.path) {
        this.editedFiles.add(event.path);
        this.paintStatus();
      }
      const record = this.record(turn);
      record.applied += event.count;
      const apply = this.pendingApply(turn, event.path);
      if (!apply) return;
      apply.row.dataset.state = 'done';
      apply.row.textContent = `Edited ${plural(event.count, 'element')} in ${event.path}`;
      this.regroup(turn);
    }

    documentChanged(turn, event) {
      if (event.path) {
        this.editedFiles.add(event.path);
        this.paintStatus();
      }
      const record = this.record(turn);
      record.changed = (record.changed ?? 0) + 1;
      const row = h('div', 'tool');
      row.dataset.state = 'done';
      row.dataset.name = 'document.changed';
      row.append(renderText(`Changed document ${event.path}`));
      this.append(turn, row);
      this.regroup(turn);
    }

    opsRefused(turn, event) {
      const apply = this.pendingApply(turn, event.path);
      if (!apply) return;
      apply.row.dataset.state = 'refused';
      apply.row.textContent = `Refused — ${firstSentence(event.reason)}`;
      apply.row.title = event.reason ?? '';
      this.regroup(turn);
    }

    /** The queue's own events, beside the transcript's: a row's mode, an
     *  edited prompt, a row folded into a batch. */
    receiveQueue(event) {
      const id = this.getAttribute('conversation');
      if (!eventBelongsToConversation(event, id)) return;
      const turn = event.turn;
      switch (event.type) {
        case 'turn.queued':
          this.record(turn).dispatch = event.dispatch ?? 'queue';
          // The transcript's handler makes the row; paint its mode once it has.
          queueMicrotask(() => {
            const row = this.queuedRow(turn);
            if (row) this.paintQueuedDispatch(row, this.record(turn).dispatch);
          });
          break;
        case 'turn.dispatch': {
          this.record(turn).dispatch = event.dispatch;
          const row = this.queuedRow(turn);
          if (row) this.paintQueuedDispatch(row, event.dispatch);
          break;
        }
        case 'user.edited': {
          this.prompts.set(turn, event.text);
          const text = this.queuedRow(turn)?.querySelector('.queued-text');
          if (text && !text.isContentEditable) text.textContent = event.text;
          const bubble = this.logEl.querySelector(`.msg.me[data-turn="${CSS.escape(turn)}"]`);
          if (bubble) {
            const next = this.userMessage(event.text);
            next.dataset.turn = turn;
            bubble.replaceWith(next);
          }
          break;
        }
        case 'turn.combined':
          this.queue(turn, false);
          break;
        default:
      }
    }

    queuedRow(turn) {
      return this.queuedEl.querySelector(`.queued-item[data-turn="${CSS.escape(turn)}"]`);
    }

    queue(turn, present) {
      const existing = this.queuedRow(turn);
      if (!present) {
        existing?.remove();
      } else if (!existing) {
        const item = h('div', 'queued-item');
        item.dataset.turn = turn;
        const dispatch = h('button', 'queued-dispatch');
        dispatch.type = 'button';
        dispatch.addEventListener('click', () => this.cycleQueuedDispatch(item, turn));
        const text = h('span', 'queued-text', this.prompts.get(turn) ?? '');
        text.addEventListener('click', () => this.editQueuedPrompt(item, turn));
        const remove = h('button', 'dequeue', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove from the queue');
        remove.addEventListener('mousedown', () => { item.dataset.skipSave = '1'; });
        remove.addEventListener('click', () => this.api.dequeue(turn).catch((err) => this.system(err.message, true)));
        item.append(dispatch, text, remove);
        this.paintQueuedDispatch(item, this.record(turn).dispatch ?? 'queue');
        this.queuedEl.append(item);
      }
      const n = this.queuedEl.querySelectorAll('.queued-item').length;
      this.queuedEl.hidden = n === 0;
      this.queuedBar.hidden = n < 2;
      // One prompt, said once: while it waits, the floating row is the whole
      // of it, and the transcript's copy is held back rather than never made
      // — the bubble is already in log order, and joins the transcript when
      // the turn starts (or is folded into the batch that runs it).
      this.waiting(turn, present);
      this.measureQueue();
    }

    /** The log's own copy of a prompt, hidden while its row floats. */
    waiting(turn, held) {
      const bubble = this.logEl.querySelector(`.msg.me[data-turn="${CSS.escape(turn)}"]`);
      if (!bubble) return;
      if (held) bubble.dataset.waiting = '';
      else delete bubble.dataset.waiting;
    }

    /** Hold the foot of the log open by however tall the floating stack is,
     *  and stay at the bottom if that is where the reader already was. */
    measureQueue() {
      const space = this.queuedEl.hidden ? 0 : Math.round(this.queuedEl.getBoundingClientRect().height);
      if (space === this.queuedSpace) return;
      const stuck = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 48;
      this.queuedSpace = space;
      this.logEl.style.setProperty('--queued-space', `${space}px`);
      if (stuck) this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    applyQueueCombine(on) {
      this.queuedEl.dataset.combine = on ? '1' : '0';
      this.queuedIndividually.setAttribute('aria-pressed', on ? 'false' : 'true');
      this.queuedTogether.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    setQueueCombine(on) {
      const id = this.getAttribute('conversation');
      const was = this.queuedEl.dataset.combine === '1';
      this.applyQueueCombine(on);
      if (!id || !this.api?.update) return;
      this.api.update(id, { queueCombine: on }).catch((err) => {
        this.applyQueueCombine(was);
        this.system(err.message, true);
      });
    }

    paintQueuedDispatch(item, mode) {
      const next = mode === 'steer' || mode === 'interrupt' ? mode : 'queue';
      item.dataset.dispatch = next;
      const button = item.querySelector('.queued-dispatch');
      const label = { queue: 'Queue', steer: 'Steer', interrupt: 'Interrupt' }[next];
      button.textContent = label;
      button.setAttribute('aria-label', `${label} — click to change how this prompt is sent`);
    }

    /** Queue and steer, the two the composer offers. A row left on interrupt
     *  by an older build still says so, and leaves for queue on a click. */
    cycleQueuedDispatch(item, turn) {
      const prev = item.dataset.dispatch || 'queue';
      const next = prev === 'queue' ? 'steer' : 'queue';
      this.paintQueuedDispatch(item, next);
      this.api.patchTurn(turn, { dispatch: next }).catch((err) => {
        this.paintQueuedDispatch(item, prev);
        this.system(err.message, true);
      });
    }

    /** Click the text to change it in place: Enter or leaving saves, Escape
     *  and the × put it back. */
    editQueuedPrompt(item, turn) {
      const text = item.querySelector('.queued-text');
      if (!text || text.isContentEditable) return;
      const before = this.prompts.get(turn) ?? text.textContent;
      text.contentEditable = 'plaintext-only';
      text.textContent = before;
      text.focus();
      placeCaret(text);
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        text.removeAttribute('contenteditable');
        const next = text.textContent.replace(/\s+/g, ' ').trim();
        if (!save || item.dataset.skipSave || !next || next === before) {
          delete item.dataset.skipSave;
          text.textContent = before;
          return;
        }
        this.prompts.set(turn, next);
        this.api.patchTurn(turn, { prompt: next }).catch((err) => {
          this.prompts.set(turn, before);
          text.textContent = before;
          this.system(err.message, true);
        });
      };
      text.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      text.addEventListener('blur', () => finish(true), { once: true });
    }

    footer(turn, status) {
      const record = this.record(turn);
      if (!record.footer) {
        record.footer = h('div', 'turn-footer');
        this.logEl.append(record.footer);
      }
      record.footer.dataset.status = status;
      record.footer.replaceChildren();
      if (status === 'running') {
        record.footer.append(h('span', 'pulse'), h('span', 'status', 'Working…'));
      }
      return record.footer;
    }

    finish(turn, event) {
      this.regroup(turn);
      const record = this.record(turn);
      const status = event.type.slice('turn.'.length);
      const footer = this.footer(turn, status);
      const applied = event.applied ?? record.applied;
      const docs = record.changed ?? 0;
      const took = record.started ? ` · ${seconds(event.t - record.started)}` : '';
      const words = {
        completed: applied ? `Changed ${plural(applied, 'element')}` : docs ? `Changed ${plural(docs, 'document')}` : 'Done',
        failed: event.error ? `Failed — ${event.error}` : 'Failed',
        cancelled: applied ? `Stopped · changed ${plural(applied, 'element')}` : docs ? `Stopped · changed ${plural(docs, 'document')}` : 'Stopped',
        interrupted: 'Interrupted when the host stopped',
      }[status];
      footer.append(h('span', 'status', `${words}${took}`));

      if ((applied || docs) && !record.undone) {
        const undo = h('button', 'undo', 'Undo turn');
        undo.type = 'button';
        undo.addEventListener('click', async () => {
          undo.disabled = true;
          try {
            await this.api.undo(turn);
          } catch (err) {
            undo.disabled = false;
            footer.append(h('span', 'status', err.message));
          }
        });
        footer.append(undo);
      }
      if (record.watchdog) {
        const { path, sha } = record.watchdog;
        footer.append(h('span', 'watch', `${path} changed outside Marble`));
        const restore = h('button', 'restore', 'Restore');
        restore.type = 'button';
        restore.addEventListener('click', async () => {
          restore.disabled = true;
          try {
            await this.api.restore(path, sha);
            restore.textContent = 'Restored';
          } catch (err) {
            restore.disabled = false;
            footer.append(h('span', 'status', err.message));
          }
        });
        footer.append(restore);
      }
      if (this.running?.turn === turn) this.setRunning(null);
      this.offerChoices(turn);
    }

    undone(turn, event) {
      const record = this.record(turn);
      record.undone = true;
      const footer = record.footer ?? this.footer(turn, 'completed');
      footer.querySelector('button.undo')?.remove();
      footer.append(h('span', 'undone', `Undid ${event.reverted}${event.kept ? ` · kept ${event.kept} you edited` : ''}`));
    }

    setRunning(turn) {
      // Nothing is running, so nothing is being worked on: the zone on the
      // document is already gone and the row that points at it goes with it.
      if (!turn) this.showZone(null);
      this.running = turn ? { turn, target: this.turns.get(turn)?.target ?? null } : null;
      this.stopButton.hidden = !turn;
      this.dispatchEl.hidden = !turn;
      if (!turn) setRadioValue(this.shadowRoot, 'dispatch', 'queue');
      else requestAnimationFrame(() => slideThumb(this.dispatchEl, { animate: false }));
      // The chooser takes room from the setup; refit it, or wrap the bar.
      this.fitSetup();
      this.dispatchEvent(new CustomEvent('running', { detail: this.running ?? { turn: null }, bubbles: true, composed: true }));
    }
  }

  customElements.define('marble-conversation', MarbleConversation);

  // ------------------------------------------------------------ settings

  const SETTINGS_CSS = `
    :host { position: fixed; inset: 0; z-index: 2147483600; display: none; }
    :host([data-open="true"]) { display: block; }
    .backdrop { position: absolute; inset: 0; background: color-mix(in srgb, var(--ink) 28%, transparent); }
    .sheet { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(460px, calc(100vw - 24px)); max-height: min(80vh, 640px); overflow: auto;
      background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lift); padding: 18px 18px 16px; display: flex; flex-direction: column; gap: 14px; }
    .sheet[data-tab="usage"] { width: min(880px, calc(100vw - 24px)); max-height: min(90vh, 900px); }
    .usage-history { margin-top: 4px; padding-top: 16px; border-top: 1px solid var(--line); }
    h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.02em; }
    .tabs { display: inline-flex; align-self: start; border: 1px solid var(--line); border-radius: 999px; padding: 2px; background: var(--paper-3); }
    .tabs button { appearance: none; border: 0; background: none; color: var(--muted); padding: .28rem .75rem; cursor: pointer; font: inherit; font-size: .85rem; border-radius: 999px; }
    .tabs button[aria-selected="true"] { color: var(--accent-ink); background: var(--card); box-shadow: 0 1px 3px rgba(74,66,52,.12); }
    .tabs button:hover, .tabs button:focus-visible { color: var(--ink); outline: none; }
    fieldset { border: 1px solid var(--line); border-radius: 12px; margin: 0; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
    legend { padding: 0 6px; color: var(--muted); font-size: 12px; }
    .agent { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; }
    .agent label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .agent .detail { grid-column: 2; color: var(--faint); font-size: 11.5px; }
    .agent select { grid-column: 2; }
    input[type="text"], input[type="password"], select { font: inherit; color: var(--ink); background: var(--paper-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; width: 100%; box-sizing: border-box; }
    .key { display: flex; gap: 6px; align-items: center; }
    /* Claude's one switch: which sign-in pays for it. A segmented pair, and
       the API key field right under it only while "API key" is on. */
    .claude-auth { grid-column: 2; display: inline-flex; justify-self: start; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    .claude-auth label { position: relative; padding: 4px 10px; font-size: 12px; color: var(--muted); cursor: pointer; }
    .claude-auth label + label { border-left: 1px solid var(--line); }
    .claude-auth input { position: absolute; opacity: 0; pointer-events: none; }
    .claude-auth label:has(input:checked) { background: var(--paper-2); color: var(--ink); }
    .claude-auth label:has(input:focus-visible) { outline: 2px solid var(--accent-ink); outline-offset: -2px; }
    .claude-key { grid-column: 2; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
    .claude-key[hidden] { display: none; }
    .hint { margin: 0 0 6px; font-size: 12px; color: var(--muted); }
    .project { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .project code { font-size: 11.5px; color: var(--faint); overflow-wrap: anywhere; }
    .project-add { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .project-add input { flex: 1; min-width: 8em; }
    .key input { flex: 1; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    button { font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 12px; border: 1px solid var(--line); background: var(--paper-2); color: var(--ink); }
    button.save { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    button.link { border: 0; background: none; color: var(--muted); padding: 4px 6px; }
    button.link[hidden] { display: none; }
    .status { font-size: 12px; color: var(--faint); min-height: 1.2em; }
    .status.error { color: var(--danger); }
    .pane-usage { display: flex; flex-direction: column; gap: 16px; }
    .pane-usage[hidden], .body[hidden] { display: none; }
    .pane-usage .empty { margin: 0; color: var(--faint); font-size: 13px; }
    .usage-group h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
    .usage-group .subhead { margin: 10px 0 6px; font-size: 11.5px; color: var(--muted); }
    .usage-group .empty { margin: 0; color: var(--faint); font-size: 13px; }
    .usage-group .meter {
      display: grid; grid-template-columns: 7.4rem minmax(0, 1fr) 2.5rem;
      column-gap: .5rem; row-gap: 2px; align-items: center; margin: 0 0 8px;
    }
    .usage-group .meter-label { font-size: 12.5px; font-weight: 500; color: var(--muted); }
    .usage-group .meter-bar {
      display: block; width: auto; height: 8px; border-radius: 999px;
      background: var(--paper-3); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden;
    }
    .usage-group .meter-bar i { display: block; height: 100%; width: 0; background: var(--accent-ink); border-radius: inherit; }
    .usage-group .meter[data-tone="blue"] .meter-bar i { background: var(--accent-ink); }
    .usage-group .meter[data-tone="yellow"] .meter-bar i { background: #c4a02a; }
    .usage-group .meter[data-tone="orange"] .meter-bar i { background: #c46a28; }
    .usage-group .meter[data-tone="red"] .meter-bar i { background: var(--danger); }
    .usage-group .meter[data-tone="unavailable"] .meter-label,
    .usage-group .meter[data-tone="unavailable"] .meter-pct { color: var(--faint); }
    .usage-group .meter[data-tone="unavailable"] .meter-bar { background: var(--paper-2); }
    .usage-group .meter[data-tone="unavailable"] .meter-bar i { width: 0 !important; background: var(--faint); }
    .usage-group .meter[data-kind="share"] .meter-bar { height: 6px; }
    .usage-group .meter[data-kind="share"] .meter-bar i { background: var(--muted); }
    .usage-group .meter-pct { font-size: 12.5px; font-variant-numeric: tabular-nums; font-weight: 500; text-align: right; }
    .usage-group .reset { grid-column: 2 / 4; font-size: 11.5px; color: var(--faint); }
  `;

  class MarbleAgentSettings extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${SETTINGS_CSS}</style>
        <div class="backdrop" part="backdrop"></div>
        <div class="sheet" role="dialog" aria-labelledby="agent-settings-title" aria-modal="true">
          <h2 id="agent-settings-title">Agent settings</h2>
          <div class="tabs" role="tablist" aria-label="Settings sections">
            <button type="button" role="tab" data-tab="settings" aria-selected="true">Settings</button>
            <button type="button" role="tab" data-tab="usage" aria-selected="false">Usage</button>
          </div>
          <div class="body" data-pane="settings"></div>
          <div class="pane-usage" data-pane="usage" hidden></div>
          <p class="status"></p>
          <div class="actions">
            <button type="button" class="close">Cancel</button>
            <button type="button" class="save">Save</button>
          </div>
        </div>`;
      this.body = root.querySelector('.body');
      this.usagePane = root.querySelector('.pane-usage');
      this.status = root.querySelector('.status');
      this.saveButton = root.querySelector('.save');
      this.closeButton = root.querySelector('.close');
      this.tab = 'settings';
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      this.unwatchTheme = watchPageTheme(this);
      this.setAttribute('data-open', this.getAttribute('data-open') || 'false');
      this.onOpen = (event) => this.open(event?.detail?.tab);
      addEventListener('marble:agent-settings', this.onOpen);
      this.shadowRoot.querySelector('.backdrop').addEventListener('click', () => this.close());
      this.closeButton.addEventListener('click', () => this.close());
      this.saveButton.addEventListener('click', () => this.save());
      this.shadowRoot.querySelector('.tabs').addEventListener('click', (event) => {
        const tab = event.target.closest?.('[data-tab]');
        if (tab) this.setTab(tab.dataset.tab);
      });
      this.onKey = (event) => {
        if (event.key === 'Escape' && this.getAttribute('data-open') === 'true') {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      };
      addEventListener('keydown', this.onKey, true);
    }

    disconnectedCallback() {
      this.unwatchTheme?.();
      this.unwatchTheme = null;
      removeEventListener('marble:agent-settings', this.onOpen);
      removeEventListener('keydown', this.onKey, true);
    }

    open(tab) {
      if (tab) this.tab = tab === 'usage' ? 'usage' : 'settings';
      this.setAttribute('data-open', 'true');
      this.fill();
    }

    close() {
      this.setAttribute('data-open', 'false');
      hideTip();
    }

    setTab(tab) {
      this.tab = tab === 'usage' ? 'usage' : 'settings';
      for (const button of this.shadowRoot.querySelectorAll('[role="tab"]')) {
        button.setAttribute('aria-selected', String(button.dataset.tab === this.tab));
      }
      this.body.hidden = this.tab !== 'settings';
      this.usagePane.hidden = this.tab !== 'usage';
      this.shadowRoot.querySelector('.sheet').dataset.tab = this.tab;
      this.saveButton.hidden = this.tab === 'usage';
      this.closeButton.textContent = this.tab === 'usage' ? 'Close' : 'Cancel';
    }

    async fill() {
      this.status.textContent = '';
      this.status.classList.remove('error');
      this.body.replaceChildren(h('p', 'status', 'Loading…'));
      this.usagePane.replaceChildren(h('p', 'empty', 'Loading…'));
      this.setTab(this.tab);
      let providers = [];
      let settings = { defaultProvider: '', models: {}, keys: { anthropic: false, cursor: false } };
      let usage = { meters: [] };
      try {
        [providers, settings, usage] = await Promise.all([
          this.api.providers(),
          this.api.settings(),
          this.api.usage().catch(() => ({ meters: [] })),
        ]);
      } catch (err) {
        this.body.replaceChildren();
        this.usagePane.replaceChildren();
        this.status.textContent = err.message;
        this.status.classList.add('error');
        return;
      }
      const agents = document.createElement('fieldset');
      agents.append(h('legend', '', 'Default agent and model'));
      for (const provider of sortProviders(providers)) {
        const row = document.createElement('div');
        row.className = 'agent';
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'default';
        radio.value = provider.id;
        radio.checked = provider.default || provider.id === settings.defaultProvider;
        radio.disabled = !(provider.installed && provider.signedIn);
        label.append(radio, document.createTextNode(provider.label));
        const detail = h('span', 'detail', provider.detail || (provider.installed ? '' : 'not installed'));
        const model = document.createElement('select');
        model.name = `model-${provider.id}`;
        model.dataset.model = provider.id;
        model.setAttribute('aria-label', `Model for ${provider.label}`);
        fillSelect(model, provider.models ?? [], { value: settings.models?.[provider.id] ?? '' });
        row.append(label, detail, model);
        if (provider.efforts?.length) {
          const effort = document.createElement('select');
          effort.name = `effort-${provider.id}`;
          effort.dataset.effort = provider.id;
          effort.setAttribute('aria-label', `Effort for ${provider.label}`);
          fillSelect(effort, provider.efforts.map((level) => ({ id: level, label: level })), {
            value: settings.efforts?.[provider.id] ?? '',
          });
          row.append(effort);
        }
        if (provider.modes?.length) {
          const mode = document.createElement('select');
          mode.name = `mode-${provider.id}`;
          mode.dataset.mode = provider.id;
          mode.setAttribute('aria-label', `Permission mode for ${provider.label}`);
          fillSelect(mode, provider.modes, { value: settings.modes?.[provider.id] ?? '' });
          row.append(mode);
        }
        if (provider.id.startsWith('claude')) row.append(...this.claudeSwitch(settings));
        agents.append(row);
      }
      const keys = document.createElement('fieldset');
      keys.append(h('legend', '', 'API keys'));
      keys.append(this.keyRow('cursor', 'Cursor API key', settings.keys?.cursor));
      const projects = document.createElement('fieldset');
      projects.append(h('legend', '', 'Projects'));
      projects.append(h('p', 'hint', 'A full agent runs with your own Claude Code (or Cursor) configuration — your plugins, skills, hooks, MCP servers and permission rules — in the project you choose. It is exactly as capable, and as powerful, as the terminal. What it may run is decided there, not here: in Auto, Claude Code\u2019s classifier refuses some commands outright, and the cure is a permission rule in your own settings.'));
      let list = [];
      try {
        list = await this.api.projects();
      } catch { /* listed as none */ }
      for (const p of list) {
        const row = h('div', 'project');
        row.append(h('span', 'name', p.name), h('code', 'path', p.path));
        if (!p.builtIn) {
          const remove = h('button', 'link', 'Remove');
          remove.type = 'button';
          remove.addEventListener('click', async () => {
            try {
              await this.api.removeProject(p.id);
              await this.fill();
            } catch (err) {
              this.status.textContent = err.message;
              this.status.classList.add('error');
            }
          });
          row.append(remove);
        }
        projects.append(row);
      }
      const add = h('div', 'project-add');
      const name = document.createElement('input');
      name.placeholder = 'Name';
      name.name = 'project-name';
      name.setAttribute('aria-label', 'Project name');
      const dir = document.createElement('input');
      dir.placeholder = '/absolute/path/to/repo';
      dir.name = 'project-path';
      dir.setAttribute('aria-label', 'Project path');
      const button = h('button', 'link', 'Add project');
      button.type = 'button';
      button.addEventListener('click', async () => {
        try {
          await this.api.addProject({ name: name.value.trim(), path: dir.value.trim() });
          await this.fill();
        } catch (err) {
          this.status.textContent = err.message;
          this.status.classList.add('error');
        }
      });
      add.append(name, dir, button);
      projects.append(add);
      this.body.replaceChildren(agents, keys, projects);
      fillUsageDetail(this.usagePane, usage.meters ?? []);
      this.loadHistory();
    }

    // The daily picture under the live limits. It is its own request so a slow
    // or failed scan never holds up the limit bars above it.
    async loadHistory() {
      const charts = window.marbleUsageCharts;
      if (!charts || !this.api?.usageHistory) return;
      if (!this.shadowRoot.querySelector('style.uh-css')) {
        const style = document.createElement('style');
        style.className = 'uh-css';
        style.textContent = charts.CSS;
        this.shadowRoot.append(style);
      }
      const token = (this.historyToken = (this.historyToken ?? 0) + 1);
      const host = h('section', 'usage-history');
      this.usagePane.append(host);
      charts.renderLoading(host);
      try {
        const history = await this.api.usageHistory(26);
        if (token === this.historyToken) charts.render(host, history);
      } catch {
        if (token === this.historyToken) charts.renderMessage(host, "Couldn't read usage history.");
      }
    }

    /** Claude signs in with the Claude login or an API key: one agent, one
     *  switch. The key field shows only while "API key" is on. */
    claudeSwitch(settings) {
      const auth = settings.claudeAuth === 'api' ? 'api' : 'login';
      const group = document.createElement('div');
      group.className = 'claude-auth';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', 'Claude signs in with');
      const key = document.createElement('div');
      key.className = 'claude-key';
      key.append(this.keyRow('anthropic', 'Claude API key', settings.keys?.anthropic));
      key.hidden = auth !== 'api';
      for (const [value, text] of [['login', 'Claude login'], ['api', 'API key']]) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'claude-auth';
        radio.value = value;
        radio.checked = value === auth;
        radio.addEventListener('change', () => {
          key.hidden = value !== 'api';
        });
        label.append(radio, document.createTextNode(text));
        group.append(label);
      }
      return [group, key];
    }

    keyRow(name, label, set) {
      const wrap = document.createElement('label');
      wrap.append(document.createTextNode(label));
      const row = document.createElement('div');
      row.className = 'key';
      const input = document.createElement('input');
      input.type = 'password';
      input.name = `key-${name}`;
      input.autocomplete = 'off';
      input.placeholder = set ? 'Set — paste to replace' : 'Not set';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'link';
      clear.textContent = 'Clear';
      clear.hidden = !set;
      clear.addEventListener('click', async () => {
        try {
          await this.api.saveSettings({ keys: { [name]: '' } });
          dispatchEvent(new CustomEvent('marble:agent-settings-saved'));
          await this.fill();
        } catch (err) {
          this.status.textContent = err.message;
          this.status.classList.add('error');
        }
      });
      row.append(input, clear);
      wrap.append(row);
      return wrap;
    }

    async save() {
      this.status.classList.remove('error');
      const defaultProvider = this.shadowRoot.querySelector('input[name="default"]:checked')?.value;
      const models = {};
      for (const input of this.shadowRoot.querySelectorAll('[data-model]')) {
        models[input.dataset.model] = input.value.trim();
      }
      const efforts = {};
      for (const input of this.shadowRoot.querySelectorAll('[data-effort]')) {
        efforts[input.dataset.effort] = input.value.trim();
      }
      const modes = {};
      for (const input of this.shadowRoot.querySelectorAll('[data-mode]')) {
        modes[input.dataset.mode] = input.value.trim();
      }
      const patch = { models, efforts, modes };
      if (defaultProvider) patch.defaultProvider = defaultProvider;
      const claudeAuth = this.shadowRoot.querySelector('input[name="claude-auth"]:checked')?.value;
      if (claudeAuth) patch.claudeAuth = claudeAuth;
      const keys = {};
      const anthropic = this.shadowRoot.querySelector('input[name="key-anthropic"]')?.value.trim();
      const cursor = this.shadowRoot.querySelector('input[name="key-cursor"]')?.value.trim();
      if (anthropic) keys.anthropic = anthropic;
      if (cursor) keys.cursor = cursor;
      if (Object.keys(keys).length) patch.keys = keys;
      try {
        await this.api.saveSettings(patch);
        dispatchEvent(new CustomEvent('marble:agent-settings-saved'));
        this.close();
      } catch (err) {
        this.status.textContent = err.message;
        this.status.classList.add('error');
      }
    }
  }

  customElements.define('marble-agent-settings', MarbleAgentSettings);

  // ------------------------------------------------------------ the drawer

  const WIDTH = 420;
  const WIDTH_MIN = 280;
  const PHONE = '(max-width: 719px)';
  const OPEN_KEY = 'marble-agent:open';
  const PIN_KEY = 'marble-agent:pinned';
  const WIDTH_OVERLAY_KEY = 'marble-agent:width';
  const WIDTH_PINNED_KEY = 'marble-agent:width-pinned';
  const TOOLS = new Set(['button', 'select', 'textarea', 'input', 'a']);

  const DRAWER_CSS = `
    /* The host is an anchor for two fixed children, not a surface: left
       clickable it swallows whatever sits in the bottom-right corner of the
       page behind it — which is where a composer's send and stop buttons are. */
    :host { position: fixed; inset: auto 0 0 auto; z-index: 2147483000; pointer-events: none; }
    /* The tray. At rest it is exactly what it has always been — one round
       button in the corner — and the column above it is empty air the page
       can still be clicked through. The tools rise on hover, and only the
       ones with something to do are in the column at all, so an agent
       affordance never stands over a document saying nothing.

       --tray-inset is how far the pinned panel has pushed the page across.
       Keeping it here is the whole reason the tray can stay up beside a
       pinned panel: it sits at the page's corner, never the panel's. */
    .tray { pointer-events: none; position: fixed;
      right: calc(20px + env(safe-area-inset-right, 0px) + var(--tray-inset, 0px));
      bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      display: flex; flex-direction: column-reverse; align-items: center; gap: 10px;
      transition: opacity 200ms var(--settle), right 220ms var(--settle); }
    /* An overlay panel covers the page the tools act on; a pinned one does not. */
    .tray[data-away="true"] { opacity: 0; }
    .tray[data-away="true"] * { pointer-events: none !important; }

    .launcher { pointer-events: auto; position: relative;
      width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--ink);
      box-shadow: var(--shadow-lift); cursor: pointer; display: grid; place-items: center; padding: 0;
      transition: opacity 200ms var(--settle); }
    .launcher svg { width: 20px; height: 20px; }
    .launcher-dot { position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent-ink); box-shadow: 0 0 0 2px var(--card); }
    .launcher-dot[hidden] { display: none; }
    .launcher.running::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: spin 1s linear infinite; }

    /* column-reverse twice over: the first tool in the DOM is the one nearest
       the thumb, so Tab walks the column bottom-up the way the eye does. */
    .tools { display: flex; flex-direction: column-reverse; align-items: center; gap: 8px; }
    .tools:empty { display: none; }
    .tool { pointer-events: none; position: relative; flex: none; width: 34px; height: 34px; padding: 0;
      display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--line);
      background: var(--card); color: var(--muted); cursor: pointer; box-shadow: var(--shadow-rest);
      opacity: 0; transform: translateY(10px) scale(.86); transform-origin: 50% 100%;
      transition: opacity 180ms var(--settle), transform 180ms var(--settle),
        color 140ms var(--settle), background 140ms var(--settle); }
    .tool[hidden] { display: none; }
    .tool svg { width: 17px; height: 17px; }
    .tray[data-open="true"] .tool { pointer-events: auto; opacity: 1; transform: none;
      transition-delay: calc(var(--i, 0) * 26ms); }
    .tool:hover, .tool:focus-visible { color: var(--ink); background: var(--paper-2); outline: none; }
    .tool:focus-visible { border-color: var(--accent-ink); }
    .tool:active { transform: scale(.94); }
    /* Some tools are modes — Select and Sketch put the page in one. While a
       mode is on its tool wears the accent, so the column says which one of
       them has the pointer without a second piece of chrome saying it. */
    .tool[data-active="true"] { color: var(--accent-ink); background: var(--accent-soft); border-color: var(--accent-ink); }
    /* The name is a pill beside the icon, not inside it: a button the width of
       its label would make the column ragged and the hit target a moving edge. */
    .tool-label { position: absolute; right: calc(100% + 8px); white-space: nowrap; pointer-events: none;
      font: 500 12px/1 inherit; color: var(--ink); background: var(--card);
      border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; box-shadow: var(--shadow-rest);
      opacity: 0; transform: translateX(5px);
      transition: opacity 120ms var(--settle), transform 120ms var(--settle); }
    .tool:hover .tool-label, .tool:focus-visible .tool-label { opacity: 1; transform: none; }
    /* No hover to reveal with, so the contextual tools simply stand there —
       there are seldom more than one. The two that are always available do
       not, because on a phone they would be permanent furniture, and the
       drawer's own bar already carries both. */
    @media (hover: none) {
      .tool { pointer-events: auto; opacity: 1; transform: none; transition-delay: 0s !important; }
      .tool[data-always="true"] { display: none; }
      .tool-label { display: none; }
    }

    .panel { pointer-events: auto; position: fixed; top: 0; right: 0; bottom: 0; width: ${WIDTH}px; max-width: 100vw; display: flex; flex-direction: column;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--paper) 86%, transparent); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
      border-left: 1px solid var(--line); box-shadow: -18px 0 40px color-mix(in srgb, var(--ink) 12%, transparent);
      transform: translateX(100%); will-change: transform; visibility: hidden; }
    .panel[data-pinned="true"] { box-shadow: none; background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; }
    .panel[data-resizing="true"] { cursor: ew-resize; user-select: none; }
    @media (prefers-reduced-transparency: reduce) { .panel { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }

    .resize { position: absolute; inset: 0 auto 0 0; width: 10px; margin-left: -5px; padding: 0; border: 0; background: none;
      cursor: ew-resize; z-index: 4; touch-action: none; }
    .resize::before { content: ''; position: absolute; inset: 0 auto 0 4px; width: 2px; border-radius: 1px; background: transparent;
      transition: background 120ms var(--settle); }
    .resize:hover::before, .resize:focus-visible::before, .panel[data-resizing="true"] .resize::before { background: var(--accent-ink); }
    .resize:focus-visible { outline: none; }

    .bar { flex: none; display: flex; align-items: center; gap: 4px; padding: calc(10px + env(safe-area-inset-top, 0px)) 10px 8px 14px; touch-action: none; cursor: grab; user-select: none; }
    .bar:active { cursor: grabbing; }
    .grip { display: none; }
    .title { min-width: 0; display: flex; align-items: center; gap: 4px; font: 600 14px/1.3 inherit; font-family: inherit; color: var(--ink); background: none; border: 0; padding: 6px 8px; margin-left: -8px; border-radius: 8px; cursor: pointer; }
    .title:hover { background: var(--paper-2); }
    .title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title svg { flex: none; color: var(--faint); }
    .provider { flex: none; font-size: 11px; color: var(--muted); background: var(--paper-2); border-radius: 999px; padding: 1px 8px; }
    .provider:empty { display: none; }
    .spacer { flex: 1; }
    .icon { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; transition: background 200ms var(--settle); }
    .icon:hover { background: var(--paper-2); color: var(--ink); }
    .icon[aria-pressed="true"] { color: var(--accent-ink); background: var(--accent-soft); }
    .where { flex: none; margin: 0 14px 6px; font-size: 12px; color: var(--muted); background: var(--accent-soft); border-radius: 8px; padding: 5px 10px; }
    .where[hidden] { display: none; }
    ${USAGE_CSS}
    .panel > .usage { flex: none; padding: 0 14px 8px; }
    .panel > .usage:empty { display: none; }

    .menu { position: absolute; top: calc(52px + env(safe-area-inset-top, 0px)); left: 10px; right: 10px; z-index: 2; max-height: 60vh; overflow-y: auto;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift); padding: 6px; }
    .menu.actions { left: auto; width: 240px; }
    .menu[hidden] { display: none; }
    .menu [role="menuitem"] { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0; border-radius: 8px; padding: 7px 10px; cursor: pointer; }
    .menu [role="menuitem"]:hover, .menu [role="menuitem"]:focus-visible { background: var(--paper-2); outline: none; }
    .menu [role="menuitem"] small { font-size: 11.5px; color: var(--faint); }
    .menu .empty { font-size: 12px; color: var(--faint); padding: 8px 10px; }

    marble-conversation { flex: 1; min-height: 0; }

    @media ${PHONE} {
      .panel { top: 0; left: 0; width: 100vw; border-left: 0; transform: translateY(100%); }
      .grip { display: block; position: absolute; top: calc(6px + env(safe-area-inset-top, 0px)); left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--line); }
      .resize { display: none; }
      .bar { padding-top: calc(18px + env(safe-area-inset-top, 0px)); }
      .pin { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition: opacity 150ms linear; }
      .launcher.running::after { animation: none; }
      .tray, .tool-label { transition: none; }
      .tool { transition: none; transform: none; transition-delay: 0s !important; }
      .tray[data-open="true"] .tool { transform: none; }
      .tool:active { transform: none; }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  const ICONS = {
    launcher: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 10.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.5 8h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    chevron: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg>',
    pin: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 3v10" stroke="currentColor" stroke-width="1.5"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    // Tray tools. Ask here borrows the callout's own mark — the beaked bubble
    // that hangs at a selection — because it summons exactly that, and a
    // second glyph for one affordance would be a second affordance. The
    // overlapping rounds are two conversations at once, which is the Agents
    // page. Both are drawn on the 24-box the callout's mark was drawn on.
    ask: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(2.6 -.6) scale(.8)"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z" stroke-width="2.2"/></g><path d="M4.5 21.4h15" stroke-width="2.2"/></svg>',
    agents: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="11" y="11" width="10" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  };

  class MarbleAgentDrawer extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${DRAWER_CSS}</style>
        <div class="tray" data-open="false" data-away="false">
          <button type="button" class="launcher" aria-label="Agent (⌘J)" aria-expanded="false">${ICONS.launcher}<span class="launcher-dot" hidden></span></button>
          <div class="tools" role="group" aria-label="Agent tools"></div>
        </div>
        <aside class="panel" role="dialog" aria-label="Agent" data-open="false" data-pinned="false" inert>
          <span class="grip" aria-hidden="true"></span>
          <button type="button" class="resize" aria-label="Resize sidebar"></button>
          <header class="bar">
            <button type="button" class="title" aria-haspopup="menu" aria-expanded="false"><span class="title-text">New conversation</span>${ICONS.chevron}</button>
            <span class="provider"></span>
            <span class="spacer"></span>
            <button type="button" class="icon new" aria-label="New conversation">${ICONS.plus}</button>
            <button type="button" class="icon more" aria-label="More" aria-haspopup="menu" aria-expanded="false">${ICONS.more}</button>
            <button type="button" class="icon pin" aria-label="Pin beside the page" aria-pressed="false">${ICONS.pin}</button>
            <button type="button" class="icon close" aria-label="Close">${ICONS.close}</button>
          </header>
          <div class="usage" role="group" aria-label="Usage remaining"></div>
          <div class="where" hidden></div>
          <div class="menu recent" role="menu" aria-label="Recent conversations" hidden></div>
          <div class="menu actions" role="menu" aria-label="Conversation actions" hidden></div>
          <marble-conversation project="drive"></marble-conversation>
        </aside>`;
      this.launcher = root.querySelector('.launcher');
      this.dot = root.querySelector('.launcher-dot');
      this.tray = root.querySelector('.tray');
      this.tools = root.querySelector('.tools');
      this.panel = root.querySelector('.panel');
      this.bar = root.querySelector('.bar');
      this.usageEl = root.querySelector('.usage');
      this.titleButton = root.querySelector('.title');
      this.titleText = root.querySelector('.title-text');
      this.providerEl = root.querySelector('.provider');
      this.where = root.querySelector('.where');
      this.recent = root.querySelector('.menu.recent');
      this.actions = root.querySelector('.menu.actions');
      this.pinButton = root.querySelector('.pin');
      this.resizeEl = root.querySelector('.resize');
      this.view = root.querySelector('marble-conversation');

      this.progress = 0;
      this.width = WIDTH;
      this.cancelMotion = null;
      this.isOpen = false;
      this.pinned = false;
      this.phone = matchMedia(PHONE);
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
      this.summaries = new Map();
      this.labels = new Map();
      this.toolSpecs = new Map();
      this.toolEls = new Map();
      this.trayOpen = false;
      this.trayTimer = null;
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      this.unwatchTheme = watchPageTheme(this);
      const api = this.api;
      this.pinned = api.storage.get(PIN_KEY) === '1';
      this.width = this.clampWidth(this.readStoredWidth());
      const current = api.current();
      // A conversation handed over by something else: the Drive, once it has made
      // a document from a template and briefed an agent at it; a link somebody
      // sent. It sits beside collab's `#at=<ids>`, which lands you on elements
      // rather than on a chat — and it outranks what was last remembered here,
      // because being handed one is a decision somebody just made.
      const handed = /(?:^|[#&])chat=([\w-]+)/.exec(location.hash)?.[1] ?? null;
      if (handed) api.remember(handed);
      const showing = handed ?? current;
      if (showing) this.view.setAttribute('conversation', showing);

      // Pinned, the launcher does not go away, so it has to be able to say
      // "enough" as well as "come here".
      this.launcher.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
      this.root('.close').addEventListener('click', () => this.close());
      this.root('.new').addEventListener('click', () => this.startNew());
      this.pinButton.addEventListener('click', () => this.setPinned(!this.pinned));
      this.titleButton.addEventListener('click', () => this.toggleMenu(this.recent, this.titleButton, () => this.fillRecent()));
      this.root('.more').addEventListener('click', (event) => this.toggleMenu(this.actions, event.currentTarget, () => this.fillActions()));

      this.view.addEventListener('conversation', (event) => {
        api.remember(event.detail.id);
      });
      this.view.addEventListener('meta', (event) => this.showMeta(event.detail.meta));
      this.view.addEventListener('running', (event) => {
        this.lastRunning = event.detail;
        this.showWhere(event.detail);
      });
      // The mast's zone row says where the work is and takes you there. This
      // header's line says only where it is; while the better one is up, it
      // stands down rather than saying the same thing worse.
      this.view.addEventListener('zone', (event) => {
        this.zoneUp = Boolean(event.detail?.zone);
        this.showWhere(this.lastRunning);
      });

      this.onKey = (event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          // One key for "agent", and the selection decides where the agent
          // appears: the callout layer takes it when it can draw a card at
          // what you are holding.
          const selected = window.marble?.agent?.context?.().selection?.length;
          if (selected && !dispatchEvent(new CustomEvent('marble-callout:summon', { cancelable: true }))) return;
          if (this.isOpen) this.close();
          else this.open();
        } else if (event.key === 'Escape' && this.isOpen && this.shadowRoot.activeElement !== null) {
          if (!this.recent.hidden || !this.actions.hidden) this.hideMenus();
          else this.close();
        } else if (event.key === 'Escape' && this.trayOpen) {
          this.setTray(false);
          this.launcher.focus({ preventScroll: true });
        }
      };
      addEventListener('keydown', this.onKey, true);
      this.onOpenRequest = (event) => {
        if (event.detail?.id) this.switchTo(event.detail.id);
        this.open();
      };
      this.onCloseRequest = () => this.close();
      addEventListener('marble:agent-open', this.onOpenRequest);
      addEventListener('marble:agent-close', this.onCloseRequest);
      this.onSettingsSaved = async () => {
        try {
          this.labels.clear();
          for (const provider of await api.providers()) this.labels.set(provider.id, provider);
          this.showMeta(this.meta);
        } catch { /* labels stay as they were */ }
      };
      addEventListener('marble:agent-settings-saved', this.onSettingsSaved);
      this.onViewport = () => this.render();
      this.phone.addEventListener('change', this.onViewport);
      this.onOutside = (event) => {
        if (!event.composedPath().some((node) => node === this.recent || node === this.actions || node === this.titleButton || node?.classList?.contains?.('more'))) this.hideMenus();
      };
      this.shadowRoot.addEventListener('pointerdown', this.onOutside);

      this.bindDrag();
      this.bindResize();
      this.bindTray();
      this.onWindowResize = () => {
        this.applyWidth(this.readStoredWidth(), { persist: false });
        this.render();
      };
      addEventListener('resize', this.onWindowResize);

      api.conversations().then((list) => {
        for (const summary of list) this.summaries.set(summary.id, summary);
        this.showLauncherState();
      }).catch(() => {});
      this.offSummaries = api.on('*', (summary) => {
        if (summary?.removed) {
          this.summaries.delete(summary.id);
          this.showLauncherState();
          return;
        }
        this.summaries.set(summary.id, summary);
        this.showLauncherState();
        if (summary.id === this.view.getAttribute('conversation')) this.showMeta(summary);
      });
      api.providers().then((providers) => {
        for (const provider of providers) this.labels.set(provider.id, provider);
        this.showMeta(this.meta);
      }).catch(() => {});

      // Handed a conversation, the drawer opens whether or not it was left open:
      // arriving at a document to watch something being built in it and finding
      // the panel shut is arriving at nothing.
      if (handed || api.storage.get(api.here(OPEN_KEY)) === '1') this.open({ animate: false });
      else this.render();
      this.unwatchUsage = watchUsage(this.usageEl);
      this.fillTray();
      // Scripts load in order and collab.js comes after this one, so its
      // registration lands on a tray that already exists. This is for the
      // other case — a drawer mounted late, or remounted — where whoever
      // asked first was told there was no tray.
      dispatchEvent(new CustomEvent('marble-tray:ready'));
    }

    disconnectedCallback() {
      this.unwatchTheme?.();
      this.unwatchTheme = null;
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('marble:agent-open', this.onOpenRequest);
      removeEventListener('marble:agent-close', this.onCloseRequest);
      removeEventListener('marble:agent-settings-saved', this.onSettingsSaved);
      removeEventListener('marble-tray:register', this.onTrayRegister);
      removeEventListener('marble-tray:update', this.onTrayUpdate);
      removeEventListener('marble-tray:unregister', this.onTrayRemove);
      removeEventListener('marble:agent-context', this.onContext);
      clearTimeout(this.trayTimer);
      this.phone.removeEventListener('change', this.onViewport);
      removeEventListener('resize', this.onWindowResize);
      this.offSummaries?.();
      this.unwatchUsage?.();
      this.cancelMotion?.();
      this.dock(false);
    }

    root(selector) {
      return this.shadowRoot.querySelector(selector);
    }

    // ---------------------------------------------------------- open, close

    open({ animate = true } = {}) {
      this.isOpen = true;
      this.api.storage.set(this.api.here(OPEN_KEY), '1');
      this.animateTo(1, { animate });
      this.view.focusInput();
      const id = this.view.getAttribute('conversation');
      if (id && this.summaries.get(id)?.needsReview) this.api.markReviewed(id).catch(() => {});
    }

    close() {
      this.isOpen = false;
      this.api.storage.set(this.api.here(OPEN_KEY), '0');
      this.hideMenus();
      this.animateTo(0);
      this.launcher.focus({ preventScroll: true });
    }

    animateTo(target, { animate = true, velocity = 0 } = {}) {
      this.cancelMotion?.();
      this.cancelMotion = null;
      if (!animate || this.reduced.matches) {
        this.progress = target;
        this.render();
        return;
      }
      this.cancelMotion = spring({
        from: this.progress,
        to: target,
        velocity,
        onFrame: (value) => {
          this.progress = value;
          this.render();
        },
        onDone: () => {
          this.cancelMotion = null;
        },
      });
      this.render();
    }

    render() {
      const phone = this.phone.matches;
      const p = Math.max(0, Math.min(1, this.progress));
      const visible = this.isOpen || p > 0.001;
      this.panel.dataset.open = String(this.isOpen);
      this.panel.dataset.pinned = String(this.pinned && !phone);
      this.panel.inert = !this.isOpen;
      this.panel.style.visibility = visible ? 'visible' : 'hidden';
      this.launcher.setAttribute('aria-expanded', String(this.isOpen));
      this.toggleAttribute('data-open-state', false);
      if (this.isOpen) this.setAttribute('data-open-state', 'open');
      if (this.reduced.matches) {
        this.panel.style.transform = 'none';
        this.panel.style.opacity = this.isOpen ? '1' : '0';
      } else {
        this.panel.style.opacity = '';
        this.panel.style.transform = phone ? `translateY(${(1 - p) * 100}%)` : `translateX(${(1 - p) * 100}%)`;
      }
      this.pinButton.setAttribute('aria-pressed', String(this.pinned));
      this.panel.style.width = phone ? '' : `${this.width}px`;
      const docked = this.isOpen && this.pinned && !phone;
      this.dock(docked);
      // Pinned, the page is still there to act on and the tray goes with it.
      // Overlaying, the panel is the whole of what you are looking at.
      this.tray.dataset.away = String(this.isOpen && !docked);
      this.tray.style.setProperty('--tray-inset', docked ? `${this.width}px` : '0px');
      if (this.isOpen) this.setTray(false);
    }

    setPinned(pinned) {
      this.pinned = pinned;
      this.api.storage.set(PIN_KEY, pinned ? '1' : '0');
      this.applyWidth(this.readStoredWidth(), { persist: false });
      this.render();
    }

    widthKey() {
      return this.pinned ? WIDTH_PINNED_KEY : WIDTH_OVERLAY_KEY;
    }

    widthMax() {
      return Math.max(WIDTH_MIN, Math.min(Math.round(innerWidth * 0.72), innerWidth - 200));
    }

    clampWidth(px) {
      const n = Number(px);
      if (!Number.isFinite(n)) return WIDTH;
      return Math.round(Math.min(this.widthMax(), Math.max(WIDTH_MIN, n)));
    }

    readStoredWidth() {
      const raw = Number(this.api.storage.get(this.widthKey()));
      if (!Number.isFinite(raw) || raw <= 0) return WIDTH;
      return raw;
    }

    applyWidth(px, { persist = false } = {}) {
      this.width = this.clampWidth(px);
      this.resizeEl.setAttribute('aria-valuenow', String(this.width));
      this.resizeEl.setAttribute('aria-valuemin', String(WIDTH_MIN));
      this.resizeEl.setAttribute('aria-valuemax', String(this.widthMax()));
      if (persist) this.api.storage.set(this.widthKey(), String(this.width));
    }

    /** Docking moves the page, which is the whole point of pinning — and is
     *  done with a transient stylesheet, so nothing about the document changes. */
    dock(on) {
      const existing = document.getElementById('marble-agent-dock');
      if (on) {
        const css = `html { margin-inline-end: ${this.width}px !important; }`;
        if (existing) {
          existing.textContent = css;
          return;
        }
        const style = document.createElement('style');
        style.id = 'marble-agent-dock';
        style.setAttribute('data-marble-transient', '');
        style.textContent = css;
        document.head.append(style);
      } else if (existing) {
        existing.remove();
      }
    }

    // ---------------------------------------------------------------- tray

    /** A tool is a small named action that only appears when it applies. The
     *  drawer owns the tray; anything else that wants a slot in it — today
     *  that is collab.js's work toggle — asks by dispatching a *cancelable*
     *  `marble-tray:register`, and the tray answers by preventing it. An
     *  unanswered ask means there is no tray on this page (a page with
     *  `<meta name="marble-agent" content="custom">` mounts no drawer), and
     *  the asker is expected to draw its own affordance instead. */
    bindTray() {
      this.onTrayRegister = (event) => {
        if (!event.detail?.id) return;
        event.preventDefault();
        this.addTool(event.detail);
      };
      this.onTrayUpdate = (event) => {
        if (event.detail?.id) this.addTool(event.detail, { merge: true });
      };
      this.onTrayRemove = (event) => {
        const id = event.detail?.id;
        if (!id) return;
        this.toolSpecs.delete(id);
        this.fillTray();
      };
      addEventListener('marble-tray:register', this.onTrayRegister);
      addEventListener('marble-tray:update', this.onTrayUpdate);
      addEventListener('marble-tray:unregister', this.onTrayRemove);

      // Ask here summons the callout at the selection — the same door ⌘J
      // opens. It is in the tray only while there is a selection to hang it
      // on, which is also the only time ⌘J means this rather than "drawer".
      this.addTool({
        id: 'ask',
        order: 5,
        label: 'Ask here',
        icon: ICONS.ask,
        hidden: true,
        onSelect: () => {
          if (!dispatchEvent(new CustomEvent('marble-callout:summon', { cancelable: true }))) return;
          this.open();
        },
      });
      this.addTool({ id: 'new', order: 20, label: 'New chat', icon: ICONS.plus, always: true, onSelect: () => this.startNew() });
      this.addTool({
        id: 'agents',
        order: 30,
        label: 'All agents',
        icon: ICONS.agents,
        always: true,
        onSelect: () => { location.href = window.marble?.href?.('Agents') ?? '/a/Agents'; },
      });

      this.onContext = () => {
        const selected = this.api?.context?.().selection?.length ?? 0;
        this.addTool({ id: 'ask', hidden: !selected }, { merge: true });
      };
      addEventListener('marble:agent-context', this.onContext);
      this.onContext();

      const leave = () => {
        clearTimeout(this.trayTimer);
        this.trayTimer = setTimeout(() => this.setTray(false), 180);
      };
      // The gaps between the buttons do not take a pointer — the page under
      // them is still the page — so crossing one leaves the tray for a frame.
      // The delay is what makes the column one surface to the hand.
      this.tray.addEventListener('pointerenter', () => this.setTray(true));
      this.tray.addEventListener('pointerleave', leave);
      this.tray.addEventListener('focusin', () => this.setTray(true));
      this.tray.addEventListener('focusout', (event) => {
        if (!this.tray.contains(event.relatedTarget)) leave();
      });
    }

    addTool(spec, { merge = false } = {}) {
      const existing = this.toolSpecs.get(spec.id);
      const next = merge && existing ? { ...existing, ...spec } : { ...spec };
      // A selection change asks about Ask here on every keystroke. Answering
      // "same as before" by rebuilding the column would move DOM under a
      // hovering pointer for nothing.
      if (existing && Object.keys(next).every((key) => next[key] === existing[key])
        && Object.keys(existing).length === Object.keys(next).length) return;
      this.toolSpecs.set(spec.id, next);
      this.fillTray();
    }

    fillTray() {
      const wanted = [...this.toolSpecs.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
      for (const [id, el] of this.toolEls) {
        if (!this.toolSpecs.has(id)) { el.remove(); this.toolEls.delete(id); }
      }
      let shown = 0;
      for (const spec of wanted) {
        let el = this.toolEls.get(spec.id);
        if (!el) {
          el = h('button', 'tool');
          el.type = 'button';
          el.dataset.tool = spec.id;
          el.append(h('span', 'tool-icon'), h('span', 'tool-label'));
          el.addEventListener('click', () => {
            this.setTray(false);
            this.toolSpecs.get(spec.id)?.onSelect?.();
          });
          this.toolEls.set(spec.id, el);
        }
        const icon = el.querySelector('.tool-icon');
        if (icon.dataset.icon !== spec.icon) {
          icon.dataset.icon = spec.icon ?? '';
          icon.innerHTML = spec.icon ?? '';
        }
        el.querySelector('.tool-label').textContent = spec.label ?? '';
        el.setAttribute('aria-label', spec.label ?? '');
        el.dataset.always = String(Boolean(spec.always));
        // Only a tool that says whether it is active is a toggle; the rest are
        // actions, and pressing an action is not a state to announce.
        if ('active' in spec) {
          el.dataset.active = String(Boolean(spec.active));
          el.setAttribute('aria-pressed', String(Boolean(spec.active)));
        }
        el.hidden = Boolean(spec.hidden);
        // The stagger counts visible tools, so a hidden one does not leave a
        // beat of silence in the middle of the column.
        if (!el.hidden) el.style.setProperty('--i', String(shown++));
        if (el.parentNode !== this.tools) this.tools.append(el);
      }
      const order = wanted.map((spec) => this.toolEls.get(spec.id));
      if (order.some((el, i) => this.tools.children[i] !== el)) this.tools.replaceChildren(...order);
      for (const el of this.toolEls.values()) el.tabIndex = this.trayOpen ? 0 : -1;
    }

    setTray(open) {
      clearTimeout(this.trayTimer);
      if (this.trayOpen === open) return;
      this.trayOpen = open;
      this.tray.dataset.open = String(open);
      for (const el of this.toolEls.values()) el.tabIndex = open ? 0 : -1;
    }

    // ---------------------------------------------------------- dragging

    bindDrag() {
      let drag = null;
      // A title click opens the recent menu; only the bar's empty space starts a drag.
      this.titleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
      this.bar.addEventListener('pointerdown', (event) => {
        if (!this.isOpen || event.button !== 0) return;
        if (event.composedPath().some((node) => TOOLS.has(node?.localName) && node !== this.titleButton)) return;
        drag = { id: event.pointerId, start: this.phone.matches ? event.clientY : event.clientX, moved: false, history: [] };
        this.bar.setPointerCapture(event.pointerId);
      });
      this.bar.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const position = this.phone.matches ? event.clientY : event.clientX;
        const distance = position - drag.start;
        if (!drag.moved && Math.abs(distance) < 10) return;
        if (!drag.moved) {
          drag.moved = true;
          this.cancelMotion?.();
          this.cancelMotion = null;
        }
        const size = this.phone.matches ? innerHeight : this.width;
        // Past the open edge the sheet resists rather than stops.
        const offset = distance >= 0 ? distance : (distance * size * 0.55) / (size + 0.55 * Math.abs(distance)) ;
        this.progress = 1 - offset / size;
        drag.history.push({ position, t: event.timeStamp });
        if (drag.history.length > 5) drag.history.shift();
        this.render();
      });
      const release = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const current = drag;
        drag = null;
        if (!current.moved) return;
        // The click that ends a drag on the title is not a request for the menu.
        this.suppressClick = true;
        setTimeout(() => {
          this.suppressClick = false;
        }, 0);
        const size = this.phone.matches ? innerHeight : this.width;
        const [first, last] = [current.history[0], current.history.at(-1)];
        const velocity = first && last && last.t > first.t ? ((last.position - first.position) / (last.t - first.t)) * 1000 : 0;
        const offset = (1 - this.progress) * size;
        const resting = offset + project(velocity);
        if (resting > size / 2) {
          this.isOpen = false;
          this.api.storage.set(this.api.here(OPEN_KEY), '0');
          this.animateTo(0, { velocity: -velocity / size });
        } else {
          this.animateTo(1, { velocity: -velocity / size });
        }
      };
      this.bar.addEventListener('pointerup', release);
      this.bar.addEventListener('pointercancel', release);
      // A drag that ends on the title must not also open the recent menu.
      this.titleButton.addEventListener('click', (event) => {
        if (this.suppressClick) {
          event.stopImmediatePropagation();
          this.suppressClick = false;
        }
      }, true);
    }

    bindResize() {
      const handle = this.resizeEl;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      this.applyWidth(this.width, { persist: false });
      let drag = null;
      handle.addEventListener('pointerdown', (event) => {
        if (!this.isOpen || this.phone.matches || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = { id: event.pointerId, startX: event.clientX, startWidth: this.width };
        this.panel.dataset.resizing = 'true';
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        this.applyWidth(drag.startWidth - (event.clientX - drag.startX), { persist: false });
        this.render();
      });
      const stop = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        drag = null;
        this.panel.dataset.resizing = 'false';
        this.applyWidth(this.width, { persist: true });
        this.render();
      };
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
      handle.addEventListener('dblclick', (event) => {
        if (this.phone.matches) return;
        event.preventDefault();
        this.applyWidth(WIDTH, { persist: true });
        this.render();
      });
      handle.addEventListener('keydown', (event) => {
        if (this.phone.matches || !this.isOpen) return;
        const step = event.shiftKey ? 48 : 16;
        let next = null;
        if (event.key === 'ArrowLeft') next = this.width + step;
        else if (event.key === 'ArrowRight') next = this.width - step;
        else if (event.key === 'Home') next = WIDTH_MIN;
        else if (event.key === 'End') next = this.widthMax();
        else return;
        event.preventDefault();
        this.applyWidth(next, { persist: true });
        this.render();
      });
    }

    // ---------------------------------------------------------- content

    startNew() {
      this.hideMenus();
      this.api.remember(null);
      this.view.removeAttribute('conversation');
      this.meta = null;
      this.showMeta(null);
      if (!this.isOpen) this.open();
      else this.view.focusInput();
    }

    switchTo(id) {
      this.hideMenus();
      if (this.view.getAttribute('conversation') === id) return;
      this.api.remember(id);
      this.view.setAttribute('conversation', id);
      if (this.summaries.get(id)?.needsReview && this.isOpen) this.api.markReviewed(id).catch(() => {});
    }

    showMeta(meta) {
      if (meta !== undefined) this.meta = meta;
      const current = this.meta && this.meta.id === this.view.getAttribute('conversation') ? this.meta : null;
      this.titleText.textContent = current?.title || (this.view.getAttribute('conversation') ? 'Conversation' : 'New conversation');
      this.providerEl.textContent = current ? this.labels.get(current.provider)?.label ?? current.provider : '';
    }

    showWhere(running) {
      const target = running?.turn ? running.target : null;
      const here = window.marble?.app;
      if (this.zoneUp) {
        this.where.hidden = true;
      } else if (target && target !== here) {
        this.where.textContent = `Viewing ${here} · editing ${target}`;
        this.where.hidden = false;
      } else {
        this.where.hidden = true;
      }
    }

    showLauncherState() {
      const list = [...this.summaries.values()].filter((s) => !s.archived);
      this.launcher.classList.toggle('running', list.some((s) => s.status === 'running'));
      const openId = this.isOpen ? this.view.getAttribute('conversation') : null;
      this.dot.hidden = !list.some((s) => s.needsReview && s.id !== openId);
    }

    // ---------------------------------------------------------- menus

    toggleMenu(menu, button, fill) {
      const opening = menu.hidden;
      this.hideMenus();
      if (!opening) return;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      fill();
    }

    hideMenus() {
      for (const [menu, button] of [[this.recent, this.titleButton], [this.actions, this.root('.more')]]) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    }

    item(menu, label, detail, onChoose) {
      const button = h('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.append(h('span', '', label));
      if (detail) button.append(h('small', '', detail));
      button.addEventListener('click', () => {
        this.hideMenus();
        onChoose();
      });
      menu.append(button);
      return button;
    }

    async fillRecent() {
      this.recent.replaceChildren(h('div', 'empty', 'Loading…'));
      let list = [];
      try {
        list = await this.api.conversations();
      } catch (err) {
        this.recent.replaceChildren(h('div', 'empty', err.message));
        return;
      }
      this.recent.replaceChildren();
      if (!list.length) this.recent.append(h('div', 'empty', 'No conversations yet.'));
      for (const summary of list.slice(0, 20)) {
        this.summaries.set(summary.id, summary);
        const provider = this.labels.get(summary.provider)?.label ?? summary.provider;
        const state = summary.asking ? 'Needs you' : summary.status === 'running' ? 'Running' : summary.needsReview ? 'Needs review' : summary.activity || summary.status;
        this.item(this.recent, summary.title || 'New Chat', `${provider} · ${state}`, () => this.switchTo(summary.id));
      }
      this.recent.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    }

    async fillActions() {
      this.actions.replaceChildren();
      this.item(this.actions, 'Settings', 'Default agent, model, and API keys', () => {
        this.hideMenus();
        this.api.openSettings();
      });
      const id = this.view.getAttribute('conversation');
      const summary = id ? this.summaries.get(id) ?? this.meta : null;
      if (id) {
        for (const provider of this.labels.values()) {
          if (!provider.installed || !provider.signedIn || provider.id === summary?.provider) continue;
          this.item(this.actions, `Continue in ${provider.label}`, 'A new conversation that knows what happened here', async () => {
            try {
              const next = await this.api.handoff(id, provider.id);
              this.switchTo(next);
            } catch (err) {
              this.view.system(err.message, true);
            }
          });
        }
        this.item(this.actions, 'Archive conversation', 'Hidden from the list; nothing is deleted', async () => {
          try {
            await this.api.archive(id, true);
            const remaining = (await this.api.conversations()).filter((item) => item.id !== id);
            if (remaining[0]) this.switchTo(remaining[0].id);
            else this.startNew();
          } catch (err) {
            this.view.system(err.message, true);
          }
        });
      }
      try {
        const docs = await window.marble.docs();
        if (docs.some((doc) => (doc.path ?? doc.name) === 'Agents')) {
          this.item(this.actions, 'Open Agents', 'Every conversation, as a list or a board', () => {
            location.href = window.marble.href('Agents');
          });
        }
      } catch {
        // No listing, no link.
      }
    }
  }

  customElements.define('marble-agent-drawer', MarbleAgentDrawer);

  // ------------------------------------------------------------ mounting

  const mountSettings = () => {
    if (document.querySelector('marble-agent-settings')) return;
    const el = document.createElement('marble-agent-settings');
    el.setAttribute('data-marble-transient', '');
    el.setAttribute('data-open', 'false');
    document.body.append(el);
  };

  // ⌘⇧O is New chat, the chord the CLI and the desktop app use. The Agents
  // page answers it in its own script, where the Focus stage and the folders
  // are in scope; this is the fallback for a page whose script predates that,
  // and it presses the page's own New button so both routes do exactly the
  // same thing. A page that has the chord says so in `marbleAgentNewChatKey`,
  // and then nothing here fires.
  let newChatKeyBound = false;
  const bindNewChatKey = () => {
    if (newChatKeyBound) return;
    newChatKeyBound = true;
    addEventListener('keydown', (event) => {
      if (window.marbleAgentNewChatKey) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.repeat) return;
      if (event.code !== 'KeyO' && String(event.key).toLowerCase() !== 'o') return;
      const button = document.querySelector('header.topbar .new');
      if (!button) return;
      event.preventDefault();
      button.click();
    });
  };

  const mount = () => {
    mountSettings();
    const pageUsage = document.querySelector('header.topbar > .usage');
    if (pageUsage) watchUsage(pageUsage);
    bindNewChatKey();
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('marble-agent-drawer')) return;
    const drawer = document.createElement('marble-agent-drawer');
    drawer.setAttribute('data-marble-transient', '');
    document.body.append(drawer);
  };

  const buildAskCard = (event, submit) => MarbleConversation.prototype.buildAskCard(event, submit);
  window.marbleAgentUI = { stateOf, STATE_CSS, renderText, spring, project, TOKENS, buildAskCard, ASK_CSS, conversationTags, eventBelongsToConversation, askResponse, TAG_CSS, fillMeters, usageAvailable, usageTone, formatReset, formatAsOf, USAGE_CSS, pageTheme, applyPageTheme, fillRadios, fitPicker, fitPresets, sortProviders };
  Object.assign(window.marbleAgentUI, { collapseToolRows, toolShortName, toolLabel });

  if (window.marble?.agent) mount();
  else addEventListener('marble:agent', mount, { once: true });
})();
