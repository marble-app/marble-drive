// Offers after edits: the one moment Marble speaks first.
//
// Right after you finish changing something by hand, and only when there is
// a concrete next step. The thing is already on your mind, your own action is
// done so nothing is interrupted, and the offer is about what you just did
// rather than a guess at what you might want (v2, Notes and Sketches/Ask at
// Anything). Three moments, found by heuristics with fixed wording and no
// model call:
//
//   - a row left unfinished among filled ones: "Fill Authors, Venue and Year"
//   - the third same change to siblings: "Do the other 9"
//   - a bare link pasted into a cell or a list item: "Look this up"
//
// The offer is a chip: one muted line with the bubble mark, at the end of the
// thing's first line. Pressing it opens the card with that step drafted,
// because a suggestion drafts and never sends. It goes after eight seconds or
// at your next action. One chip on the page at a time, at most three a
// document a day, never while typing, selecting, scrolling or dragging (the
// edit settles first: you leave the element, or 1.5 s pass), and a kind
// dismissed twice on a document stops there. The tray has one switch,
// Offers after edits.
//
// Hand edits are the ops this tab files itself, seen by wrapping marble.op:
// the carrier says nothing when the page files one.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const SETTLE = 1500;
  const SHOWN_FOR = 8000;
  const PER_DAY = 3;
  const DISMISSALS = 2;
  const EMPTY = new Set(['', '—', '–', '-', '?']);
  const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;

  const BUBBLE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z"/></svg>';
  const CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.7 4.7l6.6 6.6M11.3 4.7l-6.6 6.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const STYLE = `
    .marble-nudge { position: fixed; z-index: 2147482940; display: flex; align-items: center; gap: 2px; padding: 2px; pointer-events: auto;
      font: 500 12px/1 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      background: var(--card, #fff); color: var(--muted, #5a5a5a); border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--ink, #111) 10%, transparent); box-shadow: 0 3px 12px rgba(0,0,0,.07);
      opacity: 1; transform: none; transition: opacity 200ms ease, transform 200ms cubic-bezier(.22, 1, .36, 1), display 200ms allow-discrete; }
    @starting-style { .marble-nudge { opacity: 0; transform: translateY(3px) scale(.98); } }
    .marble-nudge.is-out { opacity: 0; pointer-events: none; }
    .marble-nudge button { font: inherit; border: 0; background: none; cursor: pointer; color: inherit; }
    .marble-nudge-go { display: flex; align-items: center; gap: 6px; padding: 5px 9px 5px 7px; border-radius: 999px; }
    .marble-nudge-go:hover, .marble-nudge-go:focus-visible { color: var(--accent-ink, #5f7488); background: var(--accent-soft, #eef3f7); outline: none; }
    .marble-nudge-go svg { width: 15px; height: 15px; flex: none; color: var(--accent-ink, #5f7488); }
    .marble-nudge-x { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: var(--faint, #8a8a8a); }
    .marble-nudge-x:hover, .marble-nudge-x:focus-visible { color: var(--ink, #111); background: var(--paper-2, rgba(0,0,0,.05)); outline: none; }
    .marble-nudge-x svg { width: 12px; height: 12px; }
    @media (prefers-reduced-motion: reduce) { .marble-nudge { transition: none; } }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app || typeof marble.op !== 'function') return;
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    const HOME = document.querySelector('script[data-home]')?.dataset.home ?? null;
    if (HOME && marble.app === HOME) return;
    if (marble.op.marbleNudged) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    const byId = (id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
    const idOf = (el) => el?.getAttribute?.('data-marble-id') ?? null;
    const clean = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const listed = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');

    // ------------------------------------------------------------ the budget

    const ON_KEY = 'marble-ask-offers';
    const offersOn = () => {
      try { return localStorage.getItem(ON_KEY) !== '0'; } catch { return true; }
    };
    const BUDGET_KEY = `marble-nudge:${app}`;
    const today = () => new Date().toISOString().slice(0, 10);
    const budget = () => {
      let b = null;
      try { b = JSON.parse(localStorage.getItem(BUDGET_KEY) || 'null'); } catch { b = null; }
      if (!b || typeof b !== 'object') b = { day: today(), shown: 0, dismissed: {} };
      if (b.day !== today()) { b.day = today(); b.shown = 0; }
      b.dismissed ??= {};
      return b;
    };
    const saveBudget = (b) => { try { localStorage.setItem(BUDGET_KEY, JSON.stringify(b)); } catch { /* private mode */ } };
    const allowed = (kind) => {
      if (!offersOn()) return false;
      const b = budget();
      return b.shown < PER_DAY && (b.dismissed[kind] ?? 0) < DISMISSALS;
    };

    // ------------------------------------------------------------ the moments

    /** A row whose first cell has words and whose other cells are gaps its
     *  filled siblings do not have: Fill <those columns>. */
    function unfinishedRow(el) {
      const tr = el?.closest?.('tr');
      const body = tr?.parentElement;
      if (!tr || !body || tr.closest('thead') || !tr.cells?.length || !clean(tr.cells[0])) return null;
      const gaps = [...tr.cells].slice(1).filter((td) => EMPTY.has(clean(td)));
      if (!gaps.length) return null;
      const siblings = [...body.children].filter((row) => row !== tr && row.tagName === 'TR' && row.cells?.length === tr.cells.length);
      if (siblings.length < 2) return null;
      const filled = (i) => siblings.filter((row) => !EMPTY.has(clean(row.cells[i]))).length >= Math.ceil(siblings.length * 0.6);
      const missing = gaps.filter((td) => filled(td.cellIndex));
      if (!missing.length) return null;
      const heads = [...(tr.closest('table')?.querySelectorAll('thead th') ?? [])].map((th) => clean(th));
      const cols = missing.map((td) => heads[td.cellIndex]).filter(Boolean);
      const what = cols.length ? listed(cols) : 'the rest';
      return { kind: 'row', target: tr, at: missing[0], label: `Fill ${what}`, action: 'automate' };
    }

    // The third same change to siblings: a status flipped, a date rewritten.
    const repeats = new Map(); // signature -> Set of ids
    const signatureOf = (op, el) => {
      const parent = el.parentElement;
      if (!parent) return null;
      const place = el.tagName === 'TD' || el.tagName === 'TH' ? `cell${el.cellIndex}` : el.tagName;
      const shape = `${parent.parentElement?.tagName ?? ''}>${parent.tagName}>${place}`;
      if (op.type === 'setAttr' && op.name && !op.name.startsWith('data-marble-')) return `${shape}|attr|${op.name}=${op.value}`;
      if (op.type === 'setText') return `${shape}|text|${String(op.text ?? '').trim()}`;
      return null;
    };
    // Where a sibling is: the same place in each of the parent's parent's
    // children (a cell in each row), or the parent's own children (an item).
    function siblingsLike(el) {
      if (el.tagName === 'TD' || el.tagName === 'TH') {
        const tr = el.parentElement;
        return [...(tr?.parentElement?.children ?? [])].filter((row) => row.tagName === 'TR').map((row) => row.cells?.[el.cellIndex]).filter(Boolean);
      }
      return [...(el.parentElement?.children ?? [])].filter((x) => x.tagName === el.tagName);
    }
    function repeated(op, el) {
      const sig = signatureOf(op, el);
      if (!sig) return null;
      const id = idOf(el);
      const seen = repeats.get(sig) ?? new Set();
      seen.add(id);
      repeats.set(sig, seen);
      if (seen.size < 3) return null;
      const all = siblingsLike(el);
      const value = op.type === 'setText' ? String(op.text ?? '').trim() : null;
      const others = all.filter((x) => !seen.has(idOf(x)) && (op.type === 'setText' ? clean(x) !== value : x.getAttribute(op.name) !== op.value));
      if (!others.length) return null;
      repeats.delete(sig);
      const container = el.tagName === 'TD' || el.tagName === 'TH' ? el.closest('table') ?? el.parentElement.parentElement : el.parentElement;
      const ids = idOf(container) ? [idOf(container)] : [...seen];
      const said = op.type === 'setText' ? `set it to “${value}”` : `set ${op.name} to “${op.value}”`;
      return {
        kind: 'repeat',
        target: el,
        ids,
        label: `Do the other ${others.length}`,
        draft: `Do the same to the other ${others.length}: ${said}, as I did for the last ${seen.size}`,
      };
    }

    function pasted(el) {
      if (!el || !URL_ONLY.test(el.textContent ?? '')) return null;
      if (!el.closest('td, th, li')) return null;
      const target = el.closest('tr') ?? el.closest('li') ?? el;
      return { kind: 'paste', target, at: el, label: 'Look this up', draft: `Look up ${clean(el)} and fill in what it is` };
    }

    // ------------------------------------------------------------ settling

    let chip = null; // { el, timer, kind }
    let settling = null; // { id, timer, op }
    let pasteAt = 0;
    let scrolling = 0;

    const busy = () => {
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return true;
      if (Date.now() - scrolling < 400) return true;
      return Boolean(document.querySelector('.marble-callout[data-offer]'))
        || Boolean(document.querySelector('.marble-marks-layer[data-describing]'));
    };

    function observe(op) {
      if (!op || typeof op !== 'object' || !op.id) return;
      if (!['setText', 'setInner', 'setAttr'].includes(op.type)) return;
      const el = byId(op.id);
      if (!el || el.closest(`[${TRANSIENT}]`)) return;
      hide();
      if (settling && settling.id !== op.id) settle();
      clearTimeout(settling?.timer);
      settling = { id: op.id, op, pasted: Date.now() - pasteAt < 800, timer: setTimeout(settle, SETTLE) };
    }

    function settle() {
      const s = settling;
      settling = null;
      if (!s) return;
      clearTimeout(s.timer);
      const el = byId(s.id);
      if (!el || !offersOn()) return;
      // Still in it, typing: the edit has not settled. Leaving it will.
      const active = document.activeElement;
      if (active?.isContentEditable && (active === el || active.contains(el) || el.contains(active)) && !s.left) {
        settling = { ...s, timer: setTimeout(settle, SETTLE) };
        return;
      }
      if (busy()) return;
      const found = (s.pasted && pasted(el)) || repeated(s.op, el) || unfinishedRow(el);
      if (found && allowed(found.kind)) show(found);
    }

    // Leaving the element is the edit settling.
    document.addEventListener('focusout', (event) => {
      if (!settling) return;
      const el = byId(settling.id);
      if (el && (event.target === el || el.contains(event.target) || event.target.contains?.(el))) {
        settling.left = true;
        clearTimeout(settling.timer);
        settling.timer = setTimeout(settle, 350);
      }
    }, true);
    document.addEventListener('paste', () => { pasteAt = Date.now(); }, true);
    addEventListener('scroll', () => { scrolling = Date.now(); place(); }, true);

    // ------------------------------------------------------------ the chip

    function show(found) {
      hide(true);
      const b = budget();
      b.shown += 1;
      saveBudget(b);
      const el = document.createElement('div');
      el.className = 'marble-nudge';
      el.setAttribute(TRANSIENT, '');
      el.setAttribute('role', 'status');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'marble-nudge-go';
      go.innerHTML = BUBBLE;
      go.append(found.label);
      go.addEventListener('click', () => {
        hide(true);
        const ids = found.ids ?? [idOf(found.target)];
        agent.select(ids);
        dispatchEvent(new CustomEvent('marble-callout:ask', { detail: { ids, draft: found.draft ?? null, action: found.action ?? null, from: 'nudge' } }));
      });
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'marble-nudge-x';
      x.innerHTML = CLOSE;
      x.setAttribute('aria-label', 'Not now');
      x.addEventListener('click', () => {
        const now = budget();
        now.dismissed[found.kind] = (now.dismissed[found.kind] ?? 0) + 1;
        saveBudget(now);
        hide();
      });
      el.append(go, x);
      document.documentElement.append(el);
      chip = { el, found, timer: setTimeout(() => hide(), SHOWN_FOR), shownAt: Date.now() };
      place();
    }

    // At the end of the thing's first line, or at its first gap for a row.
    function place() {
      if (!chip) return;
      const { el, found } = chip;
      const at = found.at ?? found.target;
      if (!at?.isConnected) { hide(true); return; }
      let x;
      let y;
      if (found.at) {
        const r = found.at.getBoundingClientRect();
        x = r.left + 4;
        y = r.top + r.height / 2;
      } else {
        const range = document.createRange();
        range.selectNodeContents(at);
        const first = range.getClientRects()[0] ?? at.getBoundingClientRect();
        x = first.right + 8;
        y = first.top + first.height / 2;
      }
      const w = el.offsetWidth;
      el.style.left = `${Math.round(Math.max(8, Math.min(x, innerWidth - w - 8)))}px`;
      el.style.top = `${Math.round(y - el.offsetHeight / 2)}px`;
    }

    function hide(quiet = false) {
      if (!chip) return;
      const { el, timer } = chip;
      chip = null;
      clearTimeout(timer);
      if (quiet || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }

    // The next action puts it away: a press anywhere else, or a key.
    addEventListener('pointerdown', (event) => {
      if (chip && !event.composedPath().includes(chip.el)) hide();
    }, true);
    addEventListener('keydown', (event) => {
      if (!chip || Date.now() - chip.shownAt < 200) return;
      if (event.key === 'Escape') { event.stopPropagation(); hide(); return; }
      if (!chip.el.contains(document.activeElement)) hide();
    }, true);
    addEventListener('resize', place);
    document.addEventListener('marble:ops', place);

    // ------------------------------------------------------------ watching

    const file = marble.op;
    const watched = (op, ...rest) => {
      try { for (const one of Array.isArray(op) ? op : [op]) observe(one); } catch { /* an offer is never worth a lost edit */ }
      return file.call(marble, op, ...rest);
    };
    watched.marbleNudged = true;
    marble.op = watched;

    // ------------------------------------------------------------ the tray

    const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z"/></svg>';
    let inTray = false;
    function offerTray() {
      const spec = {
        id: 'offers',
        order: 41,
        label: 'Offers after edits',
        icon: ICON,
        always: true,
        active: offersOn(),
        onSelect: () => {
          try { localStorage.setItem(ON_KEY, offersOn() ? '0' : '1'); } catch { /* private mode */ }
          if (!offersOn()) hide(true);
          offerTray();
        },
      };
      if (!inTray) {
        inTray = !dispatchEvent(new CustomEvent('marble-tray:register', { cancelable: true, detail: spec }));
        return;
      }
      dispatchEvent(new CustomEvent('marble-tray:update', { detail: spec }));
    }
    addEventListener('marble-tray:ready', () => { inTray = false; offerTray(); });
    addEventListener('storage', (event) => { if (event.key === ON_KEY) offerTray(); });
    offerTray();

    window.marbleNudge = { settle, show, hide, allowed, budget };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
