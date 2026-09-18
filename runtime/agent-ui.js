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
  // the page it is sitting on — not a second, Drive-only sheet.
  const TOKENS = `
    :host {
      --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #ddd9cf;
      --paper: #fafaf7; --paper-2: #f3f1ea; --paper-3: #eceae1; --card: #ffffff;
      --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
      --danger: #b4533e; --caution: #a07a2c;
      --shadow-lift: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12);
      --settle: cubic-bezier(.22, 1, .36, 1); --snap: cubic-bezier(.4, 0, .2, 1);
      --radius: 12px;
      font: 14px/1.5 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #2f3438;
        --paper: #16181a; --paper-2: #1e2124; --paper-3: #262a2e; --card: #1c1f22;
        --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
        --danger: #e08a74; --caution: #d9b25e;
        --shadow-lift: 0 6px 16px rgba(0,0,0,.45), 0 18px 36px rgba(0,0,0,.35);
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
    const family = getComputedStyle(document.body).fontFamily;
    if (family) el.style.setProperty('--ui-font', family);
  }

  function watchPageTheme(el) {
    const paint = () => applyPageTheme(el);
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

  const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;

  function inline(parent, text) {
    let last = 0;
    INLINE.lastIndex = 0;
    for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
      if (match.index > last) parent.append(text.slice(last, match.index));
      const [whole] = match;
      let node;
      if (match[1]) {
        node = document.createElement('code');
        node.textContent = whole.slice(1, -1);
      } else if (match[2]) {
        node = document.createElement('strong');
        node.textContent = whole.slice(2, -2);
      } else if (match[3]) {
        node = document.createElement('em');
        node.textContent = whole.slice(1, -1);
      } else {
        node = document.createElement('a');
        node.textContent = /^\[([^\]]+)\]/.exec(whole)[1];
        node.href = match[5];
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
      parent.append(node);
      last = match.index + whole.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  const BULLET = /^\s*[-*]\s+(.*)$/;
  const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
  const FENCE = /^\s*```/;

  function renderText(text) {
    const out = document.createDocumentFragment();
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (FENCE.test(line)) {
        const body = [];
        for (i += 1; i < lines.length && !FENCE.test(lines[i]); i += 1) body.push(lines[i]);
        i += 1;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = body.join('\n');
        pre.append(code);
        out.append(pre);
        continue;
      }
      const kind = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
      if (kind) {
        const list = document.createElement(kind === BULLET ? 'ul' : 'ol');
        for (; i < lines.length && kind.test(lines[i]); i += 1) {
          const item = document.createElement('li');
          inline(item, kind.exec(lines[i])[1]);
          list.append(item);
        }
        out.append(list);
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      const paragraph = document.createElement('p');
      let first = true;
      for (; i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]); i += 1) {
        if (!first) paragraph.append(document.createElement('br'));
        inline(paragraph, lines[i]);
        first = false;
      }
      out.append(paragraph);
    }
    return out;
  }

  // ------------------------------------------------------------ motion

  /** A critically damped spring on one number. It starts from wherever the
   *  value is now and at whatever velocity it is moving, which is what makes an
   *  animation interruptible: a new target is a new spring from the present. */
  function spring({ from, to, velocity = 0, response = 0.34, onFrame, onDone }) {
    const omega = (2 * Math.PI) / response;
    let x = from;
    let v = velocity;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;
      v += (-omega * omega * (x - to) - 2 * omega * v) * dt;
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
  const closeSegMenus = (root) => {
    const host = root?.querySelectorAll ? root : root?.shadowRoot;
    if (!host) return;
    for (const box of host.querySelectorAll('.seg-opts.is-open, .presets.is-open')) {
      box.classList.remove('is-open');
      box.querySelector('.seg-current, .presets-more')?.setAttribute('aria-expanded', 'false');
    }
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
    const menu = document.createElement('div');
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
      const open = !box.classList.contains('is-open');
      closeSegMenus(box.getRootNode());
      box.classList.toggle('is-open', open);
      current.setAttribute('aria-expanded', String(open));
    });
    armSeg(box);
    syncSegCurrent(box);
    requestAnimationFrame(() => slideThumb(box, { animate: false }));
  };
  const fitPicker = (picker) => {
    if (!picker || picker.hidden) return;
    const segs = [...picker.querySelectorAll('.seg-opts')].filter((box) => !box.closest('.seg')?.hidden);
    for (const box of segs) box.classList.remove('is-drop', 'is-open');
    for (const box of [...segs].reverse()) {
      if (picker.scrollWidth <= picker.clientWidth + 1) break;
      box.classList.add('is-drop');
      syncSegCurrent(box);
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
        const open = !track.classList.contains('is-open');
        closeSegMenus(track.getRootNode());
        track.classList.toggle('is-open', open);
        more.setAttribute('aria-expanded', String(open));
      });
      track.append(more);
    }
    if (!menu) {
      menu = document.createElement('div');
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
  const fitPresets = (track) => {
    if (!track || track.hidden) return;
    const { more, menu } = ensurePresetOverflow(track);
    restorePresetOrder(track, more, menu);
    more.hidden = true;
    more.classList.remove('is-current');
    more.innerHTML = MORE_ICON;
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', 'More setups');
    track.classList.remove('is-packed', 'is-open');
    const overflowed = () => track.scrollWidth > track.clientWidth + 1;
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
    if (!track.querySelector(':scope > .preset input:checked') && menu.querySelector('input:checked')) {
      const span = menu.querySelector('input:checked + span');
      if (span) {
        more.replaceChildren(span.cloneNode(true));
        more.classList.add('is-current');
        more.setAttribute('aria-label', span.textContent.trim());
      }
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
    anthropic: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.304 3.541h-3.672L20.51 20.459H24L17.304 3.541zM6.696 3.541 0 20.459h3.543l1.39-3.386h7.044l1.39 3.386h3.543L10.352 3.541H6.696zm-.503 10.224 2.283-5.605 2.282 5.605H6.193z"/></svg>',
    cursor: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 2.4 20.6 12 11.4 13.7 9.5 21.6z"/></svg>',
  };
  const PRESETS = [
    { id: 'sonnet-high', provider: 'claude-subscription', model: 'sonnet', effort: 'high', name: 'Sonnet High', brand: 'anthropic' },
    { id: 'opus-xhigh', provider: 'claude-subscription', model: 'opus', effort: 'xhigh', name: 'Opus Extra High', brand: 'anthropic' },
    { id: 'grok-high', provider: 'cursor', model: 'cursor-grok-4.6', effort: 'high', name: 'Grok High', brand: 'cursor' },
    { id: 'grok-xhigh', provider: 'cursor', model: 'cursor-grok-4.6', effort: 'xhigh', name: 'Grok Extra High', brand: 'cursor' },
  ];
  const nextMode = (modes, current) => {
    const ids = (modes ?? []).map((item) => item.id);
    if (!ids.length) return current ?? '';
    const index = ids.indexOf(current);
    return ids[(index < 0 ? 0 : index + 1) % ids.length];
  };
  const filesEditedLabel = (n) => {
    const count = Number(n) || 0;
    return `${count} document${count === 1 ? '' : 's'} changed`;
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
    'claude-api': 'KIXLAB API',
    'cursor': 'Cursor',
  };

  const KNOWN_MODELS = [
    ['sonnet', 'Sonnet'],
    ['opus', 'Opus'],
    ['haiku', 'Haiku'],
    ['fable', 'Fable'],
  ];

  const providerLabel = (summary, labels) => {
    const id = summary?.provider;
    if (!id) return '';
    const listed = labels instanceof Map ? labels.get(id)?.label : '';
    return listed || KNOWN_PROVIDERS[id] || id;
  };

  const modelLabel = (summary, labels) => {
    const id = summary?.model;
    if (!id) return '';
    const models = labels instanceof Map ? labels.get(summary.provider)?.models : null;
    const named = models?.find((item) => item.id === id)?.label;
    if (named) return named;
    const lower = String(id).toLowerCase();
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
      font-size: 11px; line-height: 1.3; font-weight: 500;
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

  const USAGE_CSS = `
    .usage {
      display: flex; align-items: center; gap: .7rem; min-width: 0;
      user-select: none;
    }
    .meter {
      display: flex; align-items: center; gap: .4rem; min-width: 0;
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
  };

  const fillMeters = (host, meters) => {
    if (!host) return;
    host.replaceChildren();
    for (const meter of meters ?? []) {
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
      const reset = ready ? formatReset(meter.resetsAt) : (meter.detail || 'Unavailable');
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
    timer = setInterval(load, 120_000);
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

  function toolLabel(name, input = {}) {
    const where = input.path ? ` ${input.path}` : '';
    switch (name) {
      case 'read_document':
        return `Read${where}${Array.isArray(input.ids) && input.ids.length ? ` · ${plural(input.ids.length, 'element')}` : ''}`;
      case 'apply_ops':
        return `Editing${where}${input.note ? ` — ${input.note}` : ''}`;
      case 'list_documents':
        return 'Listed documents';
      case 'create_document':
        return `Creating${where}`;
      case 'read_guide':
        return input.section ? `Read the guide · ${input.section}` : 'Read the guide';
      case 'check_document':
        return `Check${where}`;
      case 'browser_navigate':
        return input.url ? `Open ${input.url}` : 'Open page';
      case 'browser_snapshot':
        return 'Snapshot page';
      case 'browser_click':
        return input.ref ? `Click ${input.ref}` : 'Click';
      case 'browser_type':
        return 'Type in page';
      case 'browser_tabs':
        return input.action === 'new' ? 'New tab' : input.action === 'close' ? 'Close tab' : 'Tabs';
      case 'browser_take_screenshot':
        return 'Screenshot';
      case 'browser_close':
        return 'Close browser';
      case 'browser_navigate_back':
        return 'Back';
      case 'WebSearch':
      case 'web_search':
        return input.search_term || input.query ? `Search ${input.search_term || input.query}` : 'Web search';
      default:
        return `Tried ${name}`;
    }
  }

  // ------------------------------------------------------------ the view

  const CONVERSATION_CSS = `
    :host { display: flex; flex-direction: column; min-height: 0; background: var(--paper); overflow: visible; }
    .mast { flex: none; padding: 10px 18px 8px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; background: var(--paper); }
    .mast[hidden] { display: none; }
    :host([data-chrome="pane"]) .heading { display: none; }
    :host([data-chrome="pane"]) .mast:not(:has(.tag)) { display: none; }
    :host([data-chrome="pane"]) .mast { padding-top: 8px; }
    /* A tile is a pane sharing the screen with others. The status line, the
       workdir path and the agent/model pickers are all the same on every pane
       in a folder, so four copies of them is four times the chrome and none of
       the information. The transcript and a place to type survive; clicking
       the tile promotes it, and the full chrome comes back with it. */
    :host([data-chrome="tile"]) .heading,
    :host([data-chrome="tile"]) .mast,
    :host([data-chrome="tile"]) .statusline,
    :host([data-chrome="tile"]) .setup { display: none; }
    :host([data-chrome="tile"]) .composer { padding: 6px 8px; gap: 4px; }
    .heading { margin: 0; font: 500 15px/1.3 inherit; letter-spacing: -.015em; outline: none; min-height: 1.3em; border-radius: 6px; padding: 2px 4px; margin-left: -4px; }
    .heading:hover { background: var(--paper-2); }
    .heading:focus { background: var(--card); box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft); }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tags:empty { display: none; }
    ${TAG_CSS}
    .log { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px 16px; display: flex; flex-direction: column; gap: 0; overscroll-behavior: contain; }
    .msg { max-width: none; overflow-wrap: anywhere; }
    .msg.me {
      align-self: stretch; background: var(--paper-2); color: var(--ink);
      padding: 10px 12px; border-radius: 10px; margin: 14px 0 8px; font-weight: 500;
      white-space: pre-wrap; border: 1px solid var(--line);
    }
    .msg.me:first-child { margin-top: 4px; }
    .msg.agent { align-self: stretch; color: var(--ink); padding: 2px 2px 10px; }
    .msg.agent.live { color: var(--muted); white-space: pre-wrap; }
    .msg.agent p { margin: 0 0 .5em; } .msg.agent p:last-child { margin-bottom: 0; }
    .msg.agent ul, .msg.agent ol { margin: .25em 0 .5em; padding-left: 1.25em; }
    .msg.agent code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--paper-2); padding: 1px 4px; border-radius: 4px; }
    .msg.agent pre { background: var(--paper-2); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
    .msg.agent pre code { background: none; padding: 0; }
    .msg.agent a { color: var(--accent-ink); }
    .tool { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: var(--muted); padding: 1px 2px 1px 2px; }
    .tool::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--faint); transform: translateY(-1px); }
    .tool[data-state="pending"]::before { background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .tool[data-state="done"]::before { background: var(--accent-ink); }
    .tool[data-state="refused"] { color: var(--caution); } .tool[data-state="refused"]::before { background: var(--caution); }
    .mast .also { font-size: 11.5px; color: var(--faint); margin-top: 2px; }
    .mast .also[hidden] { display: none; }
    .ask { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-2, var(--paper)); display: grid; gap: 8px; }
    .ask .ask-title { font-weight: 600; font-size: 13px; }
    .ask pre { margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
    .ask .ask-options { display: grid; gap: 4px; }
    .ask .ask-options button { text-align: left; font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; cursor: pointer; }
    .ask .ask-options button[aria-checked="true"] { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 10%, transparent); }
    .ask .ask-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ask .ask-actions button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: none; color: inherit; cursor: pointer; }
    .ask .ask-actions button.allow, .ask .ask-actions button.answer { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
    .ask .ask-actions button:disabled { opacity: .5; cursor: default; }
    .ask .deny-note { flex: 1; min-width: 8em; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; }
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
    .queued { display: flex; flex-direction: column; gap: 4px; padding: 0 18px 6px; }
    .queued[hidden] { display: none; }
    .queued-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); background: var(--paper-2); border-radius: 8px; padding: 4px 4px 4px 10px; }
    .queued-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued-item button { font: inherit; border: 0; background: none; color: var(--muted); width: 22px; height: 22px; border-radius: 6px; cursor: pointer; }
    .queued-item button:hover { background: var(--line); }
    .composer { flex: none; padding: 8px 12px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; background: var(--paper); }
    .picker { display: flex; flex-flow: row nowrap; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); overflow: visible; flex: 0 0 auto; width: fit-content; max-width: 100%; min-width: 0; }
    .picker[hidden] { display: none; }
    .setup { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 6px; width: 100%; min-width: 0; position: relative; z-index: 3; }
    .setup[hidden] { display: none; }
    .presets {
      display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 0;
      flex: 0 1 auto; width: max-content; max-width: 100%; min-width: 0;
      position: relative; isolation: isolate;
      background: var(--paper-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px;
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
      appearance: none; border: 0; background: transparent; color: var(--muted);
      font: inherit; min-width: 28px; height: 22px; padding: 0; border-radius: 999px;
      cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center;
      position: relative; z-index: 1;
    }
    .presets-more:not(.is-current) { width: 28px; }
    .presets-more:hover, .presets.is-open .presets-more { color: var(--ink); background: var(--card); }
    .presets-more[hidden] { display: none; }
    .presets-more.is-current {
      width: auto; max-width: 100%; min-width: 0; height: auto;
      padding: 3px 8px 3px 9px; gap: 6px; color: var(--ink);
      background: var(--card); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent);
    }
    .presets-more.is-current::after {
      content: ''; width: 0; height: 0; flex: none;
      border-left: 3.5px solid transparent; border-right: 3.5px solid transparent;
      border-top: 4px solid var(--muted);
    }
    .presets-more span { display: inline-flex; align-items: center; gap: 5px; min-width: 0; font-size: 11px; font-weight: 500; white-space: nowrap; }
    .presets-more.is-current span { overflow: hidden; }
    .presets-more .brand { width: 11px; height: 11px; flex: none; }
    .presets-menu {
      display: none; position: absolute; bottom: calc(100% + 6px); top: auto; right: 0; left: auto; z-index: 12;
      min-width: max(100%, 11rem); max-height: min(16rem, 45vh); overflow: auto; flex-direction: column; gap: 1px; padding: 5px;
      background: color-mix(in srgb, var(--card) 92%, transparent); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow-lift); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    }
    .presets.is-open .presets-menu { display: flex; }
    .presets-menu .preset { width: 100%; }
    .presets-menu .preset span { width: 100%; border-radius: 9px; padding: 7px 10px; justify-content: flex-start; }
    .presets-menu input:checked + span { background: var(--paper-2); }
    .custom-toggle {
      appearance: none; border: 1px solid var(--line); background: var(--paper-2); color: var(--muted);
      font: inherit; font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 999px; cursor: pointer; flex: none;
    }
    .custom-toggle[aria-expanded="true"] { color: var(--ink); background: var(--card); border-color: color-mix(in srgb, var(--ink) 18%, var(--line)); }
    .custom-toggle[hidden] { display: none; }
    .seg-thumb {
      position: absolute; left: 0; top: 0; z-index: 0; pointer-events: none;
      border-radius: 999px; background: var(--card);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent);
      opacity: 0;
    }
    .statusline { display: flex; flex-direction: column; gap: 1px; padding: 2px 2px 4px; }
    .statusline[hidden] { display: none; }
    .status-main { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .status-who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-weight: 500; font-size: 12.5px; letter-spacing: -.01em; }
    .status-mode { flex: none; font: inherit; font-size: 12.5px; font-weight: 500; color: var(--accent-ink); background: none; border: 0; padding: 0; cursor: pointer; }
    .status-mode:hover { color: var(--ink); }
    .status-mode[hidden] { display: none; }
    .status-where { font-size: 11.5px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .seg { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex: none; align-items: center; position: relative; }
    .seg legend {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0;
    }
    .seg-opts {
      display: flex; flex-wrap: nowrap; gap: 0; flex: none; position: relative; isolation: isolate;
      background: var(--paper-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px;
    }
    .seg-menu { display: flex; flex-wrap: nowrap; gap: 0; }
    .seg-current {
      display: none; appearance: none; border: 0; background: var(--card); color: var(--ink);
      padding: 2px 8px 2px 10px; border-radius: 999px; font: inherit; font-size: 11px; font-weight: 500;
      cursor: pointer; align-items: center; gap: 6px;
      box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent);
    }
    .seg-current::after {
      content: ''; width: 0; height: 0;
      border-left: 3.5px solid transparent; border-right: 3.5px solid transparent;
      border-top: 4px solid var(--muted);
    }
    .seg-opts.is-drop { overflow: visible; padding: 1px; }
    .seg-opts.is-drop .seg-current { display: inline-flex; }
    .seg-opts.is-drop .seg-menu {
      display: none; position: absolute; bottom: calc(100% + 6px); top: auto; left: 0; z-index: 12;
      min-width: max(100%, 10.5rem); max-height: min(16rem, 45vh); overflow: auto; flex-direction: column; gap: 1px; padding: 5px;
      background: color-mix(in srgb, var(--card) 92%, transparent); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow-lift); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    }
    .seg:last-child .seg-opts.is-drop .seg-menu { left: auto; right: 0; }
    .seg-opts.is-drop.is-open .seg-menu { display: flex; }
    .seg-opts.is-drop .seg-menu label { width: 100%; }
    .seg-opts.is-drop .seg-menu span { width: 100%; border-radius: 9px; padding: 7px 10px; justify-content: space-between; }
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
    .seg-opts input:checked + span { color: var(--ink); background: transparent; box-shadow: none; }
    .seg-opts.is-drop .seg-thumb { display: none; }
    .seg-opts.is-drop input:checked + span { box-shadow: none; background: var(--paper-2); }
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
    .ichip {
      display: inline-flex; align-items: center; gap: 5px; vertical-align: -3px; max-width: 100%;
      margin: 0 1px; padding: 1px 8px 1px 6px; border-radius: 999px;
      font-size: 11.5px; font-weight: 500; line-height: 1.5; color: var(--muted);
      background: var(--paper-2); border: 1px solid var(--line); cursor: pointer; user-select: none;
      transition: border-color 160ms var(--settle), background 160ms var(--settle);
    }
    .ichip:hover { border-color: var(--accent); background: var(--card); }
    .ichip[data-kind="context"] { padding-right: 3px; margin-right: 5px; cursor: default; }
    .ichip[data-kind="context"]:hover { border-color: var(--line); background: var(--paper-2); }
    .ichip-shot { width: 22px; height: 22px; border-radius: 6px; object-fit: cover; background: var(--paper-3); margin-left: -3px; }
    .ichip-name, .context-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-clear { font: inherit; border: 0; background: none; color: var(--faint); width: 16px; height: 16px; border-radius: 50%; cursor: pointer; line-height: 1; padding: 0; }
    .context-clear:hover { background: var(--line); color: var(--ink); }
    .row { display: flex; flex-direction: column; align-items: stretch; gap: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 8px 8px 8px 12px; transition: border-color 200ms var(--settle), box-shadow 200ms var(--settle); }
    .row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chips[hidden] { display: none; }
    .chip-remove { font: inherit; border: 0; background: none; color: inherit; opacity: .55; width: 16px; height: 16px; border-radius: 50%; cursor: pointer; line-height: 1; padding: 0; }
    .chip-remove:hover { opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }
    .row-input { display: flex; align-items: flex-end; gap: 8px; }
    .editor { flex: 1; min-width: 0; font: inherit; color: var(--ink); outline: none; max-height: 160px; overflow-y: auto; padding: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .editor[data-empty]::after { content: attr(data-placeholder); color: var(--faint); pointer-events: none; }
    .editor ul, .editor ol { margin: 2px 0; padding-left: 1.25em; }
    .editor li { margin: 0; }
    .send, .stop { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; transition: opacity 200ms var(--settle); }
    .send { background: var(--accent-ink); color: var(--paper); }
    .send:disabled { opacity: .35; cursor: default; }
    .stop { background: var(--paper-2); color: var(--ink); }
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
    .composer.is-dropping .row { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .msg.me .attachments { margin-bottom: 6px; }
    .msg.me .attach { background: var(--card); }
    .msg-text { display: block; }

    @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .tool::before, .turn-footer .pulse { animation: none; } .seg-thumb { transition: none; } }
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
  const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor"/></svg>';

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

  class MarbleConversation extends HTMLElement {
    static get observedAttributes() {
      return ['conversation'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${CONVERSATION_CSS}</style>
        <header class="mast" hidden>
          <h2 class="heading" contenteditable="plaintext-only" spellcheck="false" aria-label="Conversation title"></h2>
          <div class="tags"></div>
          <div class="also" hidden></div>
        </header>
        <div class="log" role="log" aria-live="polite" aria-label="Conversation"></div>
        <div class="queued" hidden></div>
        <form class="composer">
          <div class="statusline" hidden>
            <div class="status-main">
              <span class="status-who"></span>
              <button type="button" class="status-mode" hidden></button>
            </div>
            <div class="status-where"></div>
          </div>
          <div class="setup" hidden>
            <div class="presets" role="radiogroup" aria-label="Saved setups" hidden></div>
            <button type="button" class="custom-toggle" aria-expanded="false" hidden>Custom</button>
            <div class="picker">
            <fieldset class="seg picker-agent">
              <legend>CLI</legend>
              <div class="seg-opts" data-seg="agent"></div>
            </fieldset>
            <fieldset class="seg picker-project">
              <legend>Project</legend>
              <div class="seg-opts" data-seg="project"></div>
            </fieldset>
            <fieldset class="seg picker-models">
              <legend>Model</legend>
              <div class="seg-opts" data-seg="model"></div>
            </fieldset>
            <fieldset class="seg picker-effort">
              <legend>Effort</legend>
              <div class="seg-opts" data-seg="effort"></div>
            </fieldset>
            </div>
          </div>
          <div class="slash" hidden role="listbox" aria-label="Commands"></div>
          <div class="peek" hidden>
            <div class="peek-head">
              <span class="peek-title"></span>
              <button type="button" class="peek-close" aria-label="Close">×</button>
            </div>
            <div class="peek-body"></div>
          </div>
          <div class="row">
            <div class="chips" hidden></div>
            <div class="row-input">
              <div class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-placeholder="Ask about this document…" data-empty></div>
              <button type="button" class="stop" hidden aria-label="Stop">${STOP_ICON}</button>
              <button type="submit" class="send" aria-label="Send" disabled>${SEND_ICON}</button>
            </div>
          </div>
        </form>`;
      this.logEl = root.querySelector('.log');
      this.queuedEl = root.querySelector('.queued');
      this.form = root.querySelector('form');
      this.mast = root.querySelector('.mast');
      this.heading = root.querySelector('.heading');
      this.tagsEl = root.querySelector('.tags');
      this.setup = root.querySelector('.setup');
      this.presetsEl = root.querySelector('.presets');
      this.customToggle = root.querySelector('.custom-toggle');
      this.picker = root.querySelector('.picker');
      this.statusline = root.querySelector('.statusline');
      this.statusWho = root.querySelector('.status-who');
      this.statusMode = root.querySelector('.status-mode');
      this.statusWhere = root.querySelector('.status-where');
      this.agentLabel = root.querySelector('.picker-agent');
      this.agentBox = root.querySelector('[data-seg="agent"]');
      this.projectBox = root.querySelector('[data-seg="project"]');
      this.projectLabel = root.querySelector('.picker-project');
      this.also = root.querySelector('.also');
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
      this.usageLoaded = false;
      this.where = { path: '', branch: null };
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
      this.shadowRoot.addEventListener('pointerdown', (event) => {
        if (!event.target.closest?.('.seg-opts, .presets')) closeSegMenus(this.shadowRoot);
      });
      this.shadowRoot.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeSegMenus(this.shadowRoot);
      });
      this.statusMode.addEventListener('click', () => this.cycleMode());
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
          this.submit();
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
          this.heading.textContent = this.savedTitle || 'Untitled';
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
        this.skipSelection = false;
        this.updateContext();
      };
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      this.unwatchTheme = watchPageTheme(this);
      addEventListener('marble:agent-context', this.onContext);
      this.updateContext();
      this.load();
      this.fitObserver = new ResizeObserver(() => this.fitSetup());
      this.fitObserver.observe(this);
    }

    disconnectedCallback() {
      this.fitObserver?.disconnect();
      this.fitObserver = null;
      this.unwatchTheme?.();
      this.unwatchTheme = null;
      removeEventListener('marble:agent-context', this.onContext);
      this.off?.();
      this.offAll?.();
      this.offAll = null;
      this.off = null;
    }

    attributeChangedCallback(_name, before, after) {
      if (this.isConnected && before !== after && after !== this.loadedId) this.load();
    }

    focusInput() {
      this.input.focus({ preventScroll: true });
    }

    // ---------------------------------------------------------- loading

    async load() {
      this.off?.();
      this.off = null;
      this.logEl.replaceChildren();
      this.queuedEl.replaceChildren();
      this.queuedEl.hidden = true;
      this.composerChips = this.composerChips.filter((chip) => chip.kind === 'model' || chip.kind === 'effort');
      this.renderChips();
      this.clearAttachments();
      this.skipSelection = false;
      this.updateContext();
      this.seen = 0;
      this.turns.clear();
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
      this.offAll?.();
      this.others = new Map();
      this.offAll = this.api.on('*', (summary) => {
        if (this.loading !== token || !summary?.id) return;
        this.others.set(summary.id, summary);
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

    claudeUnavailable() {
      const signedIn = (this.providerList ?? []).some((item) => String(item.id ?? '').startsWith('claude') && item.installed && item.signedIn);
      if (!signedIn) return false;
      const meter = this.claudeMeter();
      if (meter) return !usageAvailable(meter);
      return Boolean(this.usageLoaded);
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
    paintAlso() {
      if (!this.also) return;
      const id = this.getAttribute('conversation');
      const mine = this.meta?.project ?? 'drive';
      const rows = [...(this.others?.values() ?? [])]
        .filter((s) => s.id !== id && !s.archived && (s.project ?? 'drive') === mine && (s.status === 'running' || s.running));
      this.also.hidden = !rows.length;
      this.also.textContent = rows.length
        ? `Also working here: ${rows.length} — ${rows.map((s) => s.title || 'Untitled').join(', ')}`
        : '';
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
      if (split.family && models.some((item) => item.id === split.family)) {
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
          span.innerHTML = `${BRAND[preset.brand] ?? ''}${preset.name}`;
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
        }
        slideThumb(this.presetsEl, { animate: !initial });
      }
      this.customToggle.setAttribute('aria-expanded', String(this.customOpen));
      this.picker.hidden = presets.length > 0 && !this.customOpen;
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

    async applyPreset(preset) {
      if (this.presetDisabled(preset)) return;
      const provider = this.resolvePresetProvider(preset);
      if (!provider) return;
      const switched = (radioValue(this.shadowRoot, 'agent') || this.meta?.provider) !== provider.id;
      if (switched) {
        this.fillAgents(provider.id);
        this.mode = this.currentProvider()?.modes?.[0]?.id ?? this.mode;
      }
      await this.syncCatalog({ model: this.resolvePresetModel(preset, provider), effort: preset.effort });
      this.persistCatalog();
      if (switched) this.persistMode();
      this.paintPresets();
    }

    fitSetup() {
      requestAnimationFrame(() => {
        if (!this.picker?.hidden) fitPicker(this.picker);
        fitPresets(this.presetsEl);
      });
    }

    cycleMode() {
      const modes = this.currentProvider()?.modes ?? [];
      if (!modes.length) return;
      this.mode = nextMode(modes, this.mode);
      this.persistMode();
    }

    async loadChrome() {
      try {
        const [usage, where] = await Promise.all([
          this.api.usage?.().catch(() => ({ meters: [] })),
          this.api.workspace?.().catch(() => ({ path: '', branch: null })),
        ]);
        this.usageMeters = usage?.meters ?? [];
        this.where = where ?? { path: '', branch: null };
      } catch {
        this.usageMeters = [];
      }
      this.usageLoaded = true;
    }

    async refreshChrome() {
      await this.loadChrome();
      this.applyAgentDisabled();
      this.paintPresets();
      this.paintStatus();
    }

    paintStatus() {
      const provider = this.currentProvider();
      const ready = Boolean(provider || this.meta?.provider);
      this.statusline.hidden = !ready;
      if (!ready) return;
      const family = this.currentModel();
      const effortId = radioValue(this.shadowRoot, 'effort');
      const nested = (family?.efforts ?? []).find((item) => item.id === effortId);
      const effortLabel = nested?.label || effortId || '';
      const who = [provider?.label || this.meta?.provider, family?.label, effortLabel].filter(Boolean).join(' ');
      const meter = this.usageMeters.find((item) => item.id === provider?.id);
      const bits = [who];
      if (usageAvailable(meter)) bits.push(`${meter.used}%`);
      else if (meter && !usageAvailable(meter) && String(provider?.id ?? '').startsWith('claude')) bits.push('unavailable');
      bits.push(filesEditedLabel(this.editedFiles.size));
      this.statusWho.textContent = bits.join(' · ');
      const modes = provider?.modes ?? [];
      const mode = modes.find((item) => item.id === this.mode) ?? modes[0];
      this.statusMode.hidden = !mode;
      this.statusMode.textContent = mode?.label ?? '';
      const where = [this.where?.path, this.where?.branch].filter(Boolean).join(' · ');
      this.statusWhere.textContent = where;
      this.statusWhere.hidden = !where;
    }

    paintMast() {
      const id = this.getAttribute('conversation');
      this.mast.hidden = !id;
      if (!id) {
        this.heading.textContent = '';
        this.tagsEl.replaceChildren();
        return;
      }
      const title = this.meta?.title || 'Untitled';
      this.savedTitle = title;
      if (this.shadowRoot.activeElement !== this.heading) this.heading.textContent = title;
      this.paintTags();
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
        this.heading.textContent = this.savedTitle || 'Untitled';
        return;
      }
      if (next === this.savedTitle) return;
      this.savedTitle = next;
      this.meta = { ...(this.meta ?? {}), id, title: next };
      this.api.update(id, { title: next }).catch((err) => this.system(err.message, true));
      this.dispatchEvent(new CustomEvent('meta', { detail: { meta: this.meta }, bubbles: true, composed: true }));
    }

    // ---------------------------------------------------------- sending

    updateSendable() {
      const noAgent = !this.getAttribute('conversation') && !radioValue(this.shadowRoot, 'agent');
      const canSend = Boolean(this.input.value.trim())
        || this.attachments.length > 0
        || this.composerChips.some((chip) => chip.kind === 'skill' || chip.kind === 'compact');
      this.sendButton.disabled = this.sending || noAgent || !canSend;
    }

    /** What follows any change to the box: the attachment list, the empty
     *  marker and the send button. */
    onEdited() {
      this.syncChips();
      // A bullet with nothing in it is still something on screen: no placeholder over it.
      const empty = !this.input.value.trim() && !this.attachments.length && !this.input.querySelector('li');
      this.input.toggleAttribute('data-empty', empty);
      this.updateSendable();
    }

    /** Setting the text keeps the chips: a token in the new text becomes the
     *  chip it named, and the document chip stays at the front. */
    setValue(text) {
      const before = this.orderedAttachments();
      const context = this.input.querySelector('.ichip[data-kind="context"]');
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
      if (context) this.input.prepend(context);
      if (this.shadowRoot.activeElement === this.input) placeCaret(this.input);
      this.onEdited();
    }

    /** Kept for the callers that grew up with a textarea; the box sizes itself. */
    autosize() {
      this.onEdited();
    }

    /** The document chip: what this message is about, at the front of the
     *  text. Taking it out sends without the selection; the document itself
     *  still travels, because a turn cannot exist without one. */
    updateContext() {
      const { target, selection, also = [] } = this.api?.context() ?? { target: '', selection: [], also: [] };
      let chip = this.input.querySelector('.ichip[data-kind="context"]');
      if (!chip && !this.skipSelection && target) {
        chip = this.contextChip();
        this.input.prepend(chip);
        this.settleCaret();
      }
      if (!chip) return;
      const count = this.skipSelection ? 0 : selection.length;
      const parts = [target];
      if (count) parts.push(`${count} selected`);
      if (also.length) parts.push(`+ ${also.length} more`);
      chip.querySelector('.context-text').textContent = parts.join(' · ');
      this.onEdited();
    }

    contextChip() {
      const chip = h('span', 'ichip');
      chip.contentEditable = 'false';
      chip.dataset.kind = 'context';
      chip.append(h('span', 'context-text'));
      const clear = h('button', 'context-clear', '×');
      clear.type = 'button';
      clear.setAttribute('aria-label', 'Don’t send the selection');
      clear.addEventListener('click', () => {
        chip.remove();
        this.skipSelection = true;
        this.onEdited();
        this.focusInput();
      });
      chip.append(clear);
      return chip;
    }

    async submit() {
      if (this.sending) return;
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
      if (!typed && !skillChips.length && !compactChip && !this.attachments.length) return;

      let prompt = typed;
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
          });
          this.setAttribute('conversation', id);
          this.agentLabel.hidden = false;
          this.projectLabel.hidden = true;
          this.fillAgents(provider);
          this.meta = {
            id,
            provider,
            model: picks.model,
            effort: picks.effort,
            mode: picks.mode,
            project,
            title: null,
          };
          this.paintMast();
          this.paintPresets();
          this.dispatchEvent(new CustomEvent('conversation', { detail: { id }, bubbles: true, composed: true }));
        }
        await this.api.send(id, { prompt, ...context });
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
        const shot = h('img', 'ichip-shot');
        shot.src = item.src ?? item.url ?? '';
        shot.alt = '';
        chip.append(shot, h('span', 'ichip-name', item.name));
        chip.setAttribute('aria-label', `${item.name}, ${sizeOf(item.bytes ?? 0)} — open`);
      } else {
        chip.append(h('span', 'ichip-name', `Pasted text · ${item.lines} lines`));
        chip.setAttribute('aria-label', `Pasted text, ${item.lines} lines — open`);
      }
      chip.addEventListener('click', () => this.openPeek(item));
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
      if (!this.input.querySelector('.ichip[data-kind="context"]')) this.skipSelection = true;
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
    userMessage(text) {
      const { blocks, rest } = splitPasted(text);
      const node = h('div', 'msg me');
      if (blocks.length) {
        const strip = h('div', 'attachments');
        for (const block of blocks) {
          strip.append(this.attachCard({
            kind: block.kind,
            name: block.name || (block.kind === 'image' ? 'Pasted image' : 'Pasted text'),
            url: block.url,
            text: block.text,
            lines: Number(block.lines) || (block.text ? block.text.split('\n').length : 0),
            bytes: Number(block.bytes ?? block.chars) || 0,
          }));
        }
        node.append(strip);
      }
      const body = blocks.length ? rest : text;
      if (body) node.append(h('span', 'msg-text', body));
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
              title: this.meta?.title || said.trim().slice(0, 60),
            };
            this.paintMast();
          }
          this.append(turn, this.userMessage(event.text));
          break;
        }
        case 'turn.queued':
          this.queue(turn, true);
          break;
        case 'turn.removed':
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
          break;
        case 'turn.undone':
          this.undone(turn, event);
          break;
        case 'handoff':
          this.system(event.from ? 'Continued from an earlier conversation.' : 'Continued in a new conversation.');
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
      const card = h('div', 'ask');
      card.dataset.request = event.requestId;
      card.dataset.kind = event.kind;
      const submit = async (response) => {
        for (const b of card.querySelectorAll('button')) b.disabled = true;
        try {
          await this.api.answer(turn, event.requestId, response);
        } catch (err) {
          for (const b of card.querySelectorAll('button')) b.disabled = false;
          this.system(err.message, true);
        }
      };
      if (event.kind === 'question') {
        const picks = new Map();
        for (const q of event.input?.questions ?? []) {
          card.append(h('div', 'ask-title', q.question));
          const list = h('div', 'ask-options');
          list.setAttribute('role', q.multiSelect ? 'group' : 'radiogroup');
          list.setAttribute('aria-label', q.question);
          const set = new Set();
          picks.set(q.question, set);
          const buttons = (q.options ?? []).map((o, i) => {
            const b = h('button', '', o.description ? `${o.label} — ${o.description}` : o.label);
            b.type = 'button';
            b.setAttribute('role', q.multiSelect ? 'checkbox' : 'radio');
            b.setAttribute('aria-checked', 'false');
            b.tabIndex = i === 0 ? 0 : -1;
            b.addEventListener('click', () => {
              if (!q.multiSelect) {
                set.clear();
                for (const x of buttons) x.setAttribute('aria-checked', 'false');
              }
              const on = b.getAttribute('aria-checked') !== 'true';
              if (on) set.add(o.label);
              else set.delete(o.label);
              b.setAttribute('aria-checked', String(on));
            });
            b.addEventListener('keydown', (e) => {
              const idx = buttons.indexOf(b);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = buttons[(idx + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
                for (const x of buttons) x.tabIndex = -1;
                next.tabIndex = 0;
                next.focus();
              } else if (e.key === ' ') {
                e.preventDefault();
                b.click();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (!set.size) b.click();
                submit(askResponse('question', event.input, picks));
              }
            });
            return b;
          });
          list.append(...buttons);
          card.append(list);
        }
        const actions = h('div', 'ask-actions');
        const answer = h('button', 'answer', 'Answer');
        answer.type = 'button';
        answer.addEventListener('click', () => submit(askResponse('question', event.input, picks)));
        actions.append(answer);
        card.append(actions);
      } else {
        card.append(h('div', 'ask-title', `Allow ${event.displayName || event.tool}?`));
        const detail = event.input?.command ?? event.input?.file_path ?? event.input?.path ?? event.input?.url ?? '';
        if (detail) card.append(h('pre', '', String(detail)));
        else card.append(h('div', 'tool', toolLabel(event.tool, event.input ?? {})));
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
      this.record(turn).asks.set(event.requestId, card);
      this.append(turn, card);
      card.querySelector('button')?.focus({ preventScroll: true });
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
      const footer = turn ? this.turns.get(turn)?.footer : null;
      if (footer?.isConnected) this.logEl.insertBefore(node, footer);
      else this.logEl.append(node);
    }

    system(message, error = false) {
      this.logEl.append(h('div', error ? 'system error' : 'system', message));
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    delta(turn, text) {
      if (!this.live || this.live.turn !== turn) {
        this.endLive();
        const node = h('div', 'msg agent live');
        this.live = { turn, node };
        this.append(turn, node);
      }
      this.live.node.append(text);
    }

    text(turn, text) {
      if (this.live && this.live.turn === turn) {
        this.live.node.classList.remove('live');
        this.live.node.replaceChildren(renderText(text));
        this.live = null;
        return;
      }
      const node = h('div', 'msg agent');
      node.append(renderText(text));
      this.append(turn, node);
    }

    endLive() {
      if (!this.live) return;
      this.live.node.classList.remove('live');
      this.live = null;
    }

    toolCall(turn, event) {
      const row = h('div', 'tool', toolLabel(event.name, event.input));
      row.dataset.state = 'pending';
      row.dataset.name = event.name;
      const record = this.record(turn);
      record.tools.set(event.callId, row);
      if (event.name === 'apply_ops') record.applies.push({ row, path: event.input?.path });
      this.append(turn, row);
    }

    toolResult(turn, event) {
      const row = this.record(turn).tools.get(event.callId);
      if (!row || row.dataset.state === 'refused') return;
      if (row.dataset.state === 'pending' && event.ok && row.dataset.name !== 'apply_ops') {
        row.dataset.state = 'done';
        return;
      }
      if (!event.ok) {
        row.dataset.state = 'failed';
        row.title = event.summary ?? '';
        if (!['list_documents', 'read_document', 'apply_ops', 'create_document', 'read_guide', 'check_document'].includes(row.dataset.name)) {
          row.textContent = `Blocked: ${row.dataset.name}`;
        }
      } else if (row.dataset.state === 'pending') {
        row.dataset.state = 'done';
      }
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
    }

    opsRefused(turn, event) {
      const apply = this.pendingApply(turn, event.path);
      if (!apply) return;
      apply.row.dataset.state = 'refused';
      apply.row.textContent = `Refused — ${firstSentence(event.reason)}`;
      apply.row.title = event.reason ?? '';
    }

    queue(turn, present) {
      const existing = this.queuedEl.querySelector(`[data-turn="${CSS.escape(turn)}"]`);
      if (!present) {
        existing?.remove();
      } else if (!existing) {
        const item = h('div', 'queued-item');
        item.dataset.turn = turn;
        item.append(h('span', '', `Queued: ${this.prompts.get(turn) ?? ''}`));
        const remove = h('button', 'dequeue', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove from the queue');
        remove.addEventListener('click', () => this.api.dequeue(turn).catch((err) => this.system(err.message, true)));
        item.append(remove);
        this.queuedEl.append(item);
      }
      this.queuedEl.hidden = !this.queuedEl.children.length;
      // A queued turn's message stays in the log; only the queue row goes.
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
    }

    undone(turn, event) {
      const record = this.record(turn);
      record.undone = true;
      const footer = record.footer ?? this.footer(turn, 'completed');
      footer.querySelector('button.undo')?.remove();
      footer.append(h('span', 'undone', `Undid ${event.reverted}${event.kept ? ` · kept ${event.kept} you edited` : ''}`));
    }

    setRunning(turn) {
      this.running = turn ? { turn, target: this.turns.get(turn)?.target ?? null } : null;
      this.stopButton.hidden = !turn;
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
      this.onOpen = () => this.open();
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

    open() {
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
        agents.append(row);
      }
      const keys = document.createElement('fieldset');
      keys.append(h('legend', '', 'API keys'));
      keys.append(this.keyRow('anthropic', 'Claude API key', settings.keys?.anthropic));
      keys.append(this.keyRow('cursor', 'Cursor API key', settings.keys?.cursor));
      const projects = document.createElement('fieldset');
      projects.append(h('legend', '', 'Projects'));
      projects.append(h('p', 'hint', 'A full agent runs with your own Claude Code (or Cursor) configuration — your plugins, skills, hooks, MCP servers and permission rules — in the project you choose. It is exactly as capable, and as powerful, as the terminal.'));
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
      const patch = { models, efforts };
      if (defaultProvider) patch.defaultProvider = defaultProvider;
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
    :host { position: fixed; inset: auto 0 0 auto; z-index: 2147483000; }
    .launcher { position: fixed; right: calc(20px + env(safe-area-inset-right, 0px)); bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--ink);
      box-shadow: var(--shadow-lift); cursor: pointer; display: grid; place-items: center;
      transition: opacity 200ms var(--settle); }
    .launcher svg { width: 20px; height: 20px; }
    .launcher-dot { position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent-ink); box-shadow: 0 0 0 2px var(--card); }
    .launcher-dot[hidden] { display: none; }
    .launcher.running::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: spin 1s linear infinite; }
    :host([data-open-state="open"]) .launcher { opacity: 0; pointer-events: none; }

    .panel { position: fixed; top: 0; right: 0; bottom: 0; width: ${WIDTH}px; max-width: 100vw; display: flex; flex-direction: column;
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
  };

  class MarbleAgentDrawer extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${DRAWER_CSS}</style>
        <button type="button" class="launcher" aria-label="Agent (⌘J)" aria-expanded="false">${ICONS.launcher}<span class="launcher-dot" hidden></span></button>
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
      if (current) this.view.setAttribute('conversation', current);

      this.launcher.addEventListener('click', () => this.open());
      this.root('.close').addEventListener('click', () => this.close());
      this.root('.new').addEventListener('click', () => this.startNew());
      this.pinButton.addEventListener('click', () => this.setPinned(!this.pinned));
      this.titleButton.addEventListener('click', () => this.toggleMenu(this.recent, this.titleButton, () => this.fillRecent()));
      this.root('.more').addEventListener('click', (event) => this.toggleMenu(this.actions, event.currentTarget, () => this.fillActions()));

      this.view.addEventListener('conversation', (event) => {
        api.remember(event.detail.id);
      });
      this.view.addEventListener('meta', (event) => this.showMeta(event.detail.meta));
      this.view.addEventListener('running', (event) => this.showWhere(event.detail));

      this.onKey = (event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          if (this.isOpen) this.close();
          else this.open();
        } else if (event.key === 'Escape' && this.isOpen && this.shadowRoot.activeElement !== null) {
          if (!this.recent.hidden || !this.actions.hidden) this.hideMenus();
          else this.close();
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
        this.summaries.set(summary.id, summary);
        this.showLauncherState();
        if (summary.id === this.view.getAttribute('conversation')) this.showMeta(summary);
      });
      api.providers().then((providers) => {
        for (const provider of providers) this.labels.set(provider.id, provider);
        this.showMeta(this.meta);
      }).catch(() => {});

      if (api.storage.get(OPEN_KEY) === '1') this.open({ animate: false });
      else this.render();
      this.unwatchUsage = watchUsage(this.usageEl);
    }

    disconnectedCallback() {
      this.unwatchTheme?.();
      this.unwatchTheme = null;
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('marble:agent-open', this.onOpenRequest);
      removeEventListener('marble:agent-close', this.onCloseRequest);
      removeEventListener('marble:agent-settings-saved', this.onSettingsSaved);
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
      this.api.storage.set(OPEN_KEY, '1');
      this.animateTo(1, { animate });
      this.view.focusInput();
      const id = this.view.getAttribute('conversation');
      if (id && this.summaries.get(id)?.needsReview) this.api.markReviewed(id).catch(() => {});
    }

    close() {
      this.isOpen = false;
      this.api.storage.set(OPEN_KEY, '0');
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
      this.dock(this.isOpen && this.pinned && !phone);
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
          this.api.storage.set(OPEN_KEY, '0');
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
      if (target && target !== here) {
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
        this.item(this.recent, summary.title || 'Untitled', `${provider} · ${state}`, () => this.switchTo(summary.id));
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

  const mount = () => {
    mountSettings();
    const pageUsage = document.querySelector('header.topbar > .usage');
    if (pageUsage) watchUsage(pageUsage);
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('marble-agent-drawer')) return;
    const drawer = document.createElement('marble-agent-drawer');
    drawer.setAttribute('data-marble-transient', '');
    document.body.append(drawer);
  };

  window.marbleAgentUI = { renderText, spring, project, TOKENS, conversationTags, eventBelongsToConversation, askResponse, TAG_CSS, fillMeters, usageAvailable, usageTone, formatReset, USAGE_CSS, pageTheme, applyPageTheme, fillRadios, fitPicker, fitPresets, sortProviders };

  if (window.marble?.agent) mount();
  else addEventListener('marble:agent', mount, { once: true });
})();
