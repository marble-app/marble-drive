// The agent drawer and the conversation view it shows.
//
// Both are custom elements with open shadow roots: no document's stylesheet
// reaches in, and nothing in here reaches out, which is what lets the same
// drawer sit on top of a slide deck, a spreadsheet and the Drive itself. Both
// are transient — nothing they draw is ever the document — and the file on
// disk only changes when an agent edits it.
//
// Agent text is shown, never interpreted: renderText builds nodes from a small
// safe subset of Markdown with textContent, and only http(s) links become links.

(() => {
  if (customElements.get('marble-conversation')) return;

  // ------------------------------------------------------------------ tokens

  // The Drive's own tokens ("UIST warm" in the light, "Dusk" after dark), so a
  // drawer over any document looks like it belongs to the Drive, not to it.
  const TOKENS = `
    :host {
      --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #ddd9cf;
      --paper: #fafaf7; --paper-2: #f3f1ea; --card: #ffffff;
      --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
      --danger: #b4533e; --caution: #a07a2c;
      --shadow-lift: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12);
      --settle: cubic-bezier(.22, 1, .36, 1); --snap: cubic-bezier(.4, 0, .2, 1);
      --radius: 12px;
      font: 14px/1.5 "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #2f3438;
        --paper: #16181a; --paper-2: #1e2124; --card: #1c1f22;
        --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
        --danger: #e08a74; --caution: #d9b25e;
        --shadow-lift: 0 6px 16px rgba(0,0,0,.45), 0 18px 36px rgba(0,0,0,.35);
      }
    }
  `;

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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const seconds = (ms) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
  const firstSentence = (text) => String(text ?? '').split(/(?<=[.!?—])\s/)[0].replace(/\s*—\s*$/, '');

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
      default:
        return `Tried ${name}`;
    }
  }

  // ------------------------------------------------------------ the view

  const CONVERSATION_CSS = `
    :host { display: flex; flex-direction: column; min-height: 0; background: transparent; }
    .log { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 8px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
    .msg { max-width: 88%; overflow-wrap: anywhere; }
    .msg.me { align-self: flex-end; background: var(--ink); color: var(--paper); padding: 8px 12px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; }
    .msg.agent { align-self: flex-start; color: var(--ink); }
    .msg.agent.live { color: var(--muted); white-space: pre-wrap; }
    .msg.agent p { margin: 0 0 .5em; } .msg.agent p:last-child { margin-bottom: 0; }
    .msg.agent ul, .msg.agent ol { margin: .25em 0 .5em; padding-left: 1.25em; }
    .msg.agent code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--paper-2); padding: 1px 4px; border-radius: 4px; }
    .msg.agent pre { background: var(--paper-2); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
    .msg.agent pre code { background: none; padding: 0; }
    .msg.agent a { color: var(--accent-ink); }
    .tool { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: var(--muted); padding-left: 2px; }
    .tool::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--faint); transform: translateY(-1px); }
    .tool[data-state="pending"]::before { background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .tool[data-state="done"]::before { background: var(--accent-ink); }
    .tool[data-state="refused"] { color: var(--caution); } .tool[data-state="refused"]::before { background: var(--caution); }
    .tool[data-state="failed"] { color: var(--danger); } .tool[data-state="failed"]::before { background: var(--danger); }
    .turn-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--faint); padding: 2px 0 6px; border-bottom: 1px solid var(--line); }
    .turn-footer[data-status="running"] { border-bottom-color: transparent; }
    .turn-footer[data-status="failed"] .status { color: var(--danger); }
    .turn-footer .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s var(--snap) infinite; }
    .turn-footer button { font: inherit; color: var(--accent-ink); background: none; border: 0; padding: 2px 6px; margin: -2px -6px; border-radius: 6px; cursor: pointer; }
    .turn-footer button:hover { background: var(--accent-soft); }
    .turn-footer button:active { transform: scale(.96); }
    .turn-footer button:disabled { color: var(--faint); cursor: default; }
    .turn-footer .watch { color: var(--caution); }
    .system { align-self: center; font-size: 12px; color: var(--faint); text-align: center; max-width: 90%; }
    .system.error { color: var(--danger); }
    .queued { display: flex; flex-direction: column; gap: 4px; padding: 0 18px 6px; }
    .queued[hidden] { display: none; }
    .queued-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); background: var(--paper-2); border-radius: 8px; padding: 4px 4px 4px 10px; }
    .queued-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued-item button { font: inherit; border: 0; background: none; color: var(--muted); width: 22px; height: 22px; border-radius: 6px; cursor: pointer; }
    .queued-item button:hover { background: var(--line); }
    .composer { flex: none; padding: 8px 12px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
    .picker { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .picker[hidden] { display: none; }
    .picker-select { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; }
    .context { display: flex; align-items: center; gap: 4px; align-self: flex-start; max-width: 100%; font-size: 11.5px; color: var(--muted); background: var(--paper-2); border-radius: 999px; padding: 2px 4px 2px 10px; }
    .context-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-clear { font: inherit; border: 0; background: none; color: var(--faint); width: 18px; height: 18px; border-radius: 50%; cursor: pointer; line-height: 1; }
    .context-clear[hidden] { display: none; }
    .context-clear:hover { background: var(--line); color: var(--ink); }
    .row { display: flex; align-items: flex-end; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 6px 6px 6px 12px; transition: border-color 200ms var(--settle), box-shadow 200ms var(--settle); }
    .row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    textarea { flex: 1; font: inherit; color: var(--ink); background: none; border: 0; outline: none; resize: none; max-height: 160px; padding: 4px 0; }
    textarea::placeholder { color: var(--faint); }
    .send, .stop { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; transition: transform 110ms var(--snap), opacity 200ms var(--settle); }
    .send { background: var(--ink); color: var(--paper); }
    .send:disabled { opacity: .35; cursor: default; }
    .stop { background: var(--paper-2); color: var(--ink); }
    .stop[hidden] { display: none; }
    .send:active, .stop:active { transform: scale(.92); }
    @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .tool::before, .turn-footer .pulse { animation: none; } }
  `;

  const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor"/></svg>';

  class MarbleConversation extends HTMLElement {
    static get observedAttributes() {
      return ['conversation'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${CONVERSATION_CSS}</style>
        <div class="log" role="log" aria-live="polite" aria-label="Conversation"></div>
        <div class="queued" hidden></div>
        <form class="composer">
          <label class="picker" hidden>Agent <select class="picker-select"></select></label>
          <div class="context"><span class="context-text"></span><button type="button" class="context-clear" aria-label="Don’t send the selection">×</button></div>
          <div class="row">
            <textarea rows="1" placeholder="Ask about this document…" aria-label="Message"></textarea>
            <button type="button" class="stop" hidden aria-label="Stop">${STOP_ICON}</button>
            <button type="submit" class="send" aria-label="Send" disabled>${SEND_ICON}</button>
          </div>
        </form>`;
      this.logEl = root.querySelector('.log');
      this.queuedEl = root.querySelector('.queued');
      this.form = root.querySelector('form');
      this.picker = root.querySelector('.picker');
      this.pickerSelect = root.querySelector('.picker-select');
      this.contextText = root.querySelector('.context-text');
      this.contextClear = root.querySelector('.context-clear');
      this.input = root.querySelector('textarea');
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

      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit();
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.submit();
        }
      });
      this.input.addEventListener('input', () => this.autosize());
      this.stopButton.addEventListener('click', () => {
        if (this.running) this.api.cancel(this.running.turn).catch((err) => this.system(err.message, true));
      });
      this.contextClear.addEventListener('click', () => {
        this.skipSelection = true;
        this.updateContext();
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
      addEventListener('marble:agent-context', this.onContext);
      this.updateContext();
      this.load();
    }

    disconnectedCallback() {
      removeEventListener('marble:agent-context', this.onContext);
      this.off?.();
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
      this.seen = 0;
      this.turns.clear();
      this.prompts.clear();
      this.live = null;
      this.setRunning(null);

      const id = this.getAttribute('conversation');
      this.loadedId = id;
      const token = Symbol('load');
      this.loading = token;

      if (!id) {
        await this.showPicker(token);
        return;
      }
      this.picker.hidden = true;
      try {
        const { meta } = await this.api.conversation(id);
        if (this.loading !== token) return;
        this.meta = meta;
        this.dispatchEvent(new CustomEvent('meta', { detail: { meta }, bubbles: true, composed: true }));
      } catch (err) {
        if (this.loading === token) this.system(`This conversation could not be opened: ${err.message}`, true);
        return;
      }
      this.off = this.api.on(id, (event) => this.receive(event));
      this.updateSendable();
    }

    async showPicker(token) {
      this.picker.hidden = false;
      this.pickerSelect.replaceChildren();
      let providers = [];
      try {
        providers = await this.api.providers();
      } catch (err) {
        if (this.loading === token) this.system(`Agents could not be listed: ${err.message}`, true);
      }
      if (this.loading !== token) return;
      const usable = providers.filter((p) => p.installed && p.signedIn);
      for (const provider of providers) {
        const ready = provider.installed && provider.signedIn;
        const option = h('option', '', ready ? provider.label : `${provider.label} — ${provider.detail}`);
        option.value = provider.id;
        option.disabled = !ready;
        this.pickerSelect.append(option);
      }
      const preferred = usable.find((p) => p.default) ?? usable[0];
      if (preferred) this.pickerSelect.value = preferred.id;
      else this.system('No agent is ready on this machine. `npm run agents -- providers` says why.');
      this.updateSendable();
    }

    // ---------------------------------------------------------- sending

    updateSendable() {
      const noAgent = !this.getAttribute('conversation') && !this.pickerSelect.value;
      this.sendButton.disabled = this.sending || noAgent || !this.input.value.trim();
    }

    autosize() {
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`;
      this.updateSendable();
    }

    updateContext() {
      const { target, selection } = this.api?.context() ?? { target: '', selection: [] };
      const count = this.skipSelection ? 0 : selection.length;
      this.contextText.textContent = count ? `${target} · ${count} selected` : target;
      this.contextClear.hidden = !count;
    }

    async submit() {
      const prompt = this.input.value.trim();
      if (!prompt || this.sending) return;
      this.sending = true;
      this.updateSendable();
      try {
        const context = this.api.context();
        if (this.skipSelection) context.selection = [];
        let id = this.getAttribute('conversation');
        if (!id) {
          const provider = this.pickerSelect.value;
          if (!provider) throw new Error('Choose an agent first.');
          id = await this.api.start({ provider });
          this.setAttribute('conversation', id);
          this.dispatchEvent(new CustomEvent('conversation', { detail: { id }, bubbles: true, composed: true }));
        }
        await this.api.send(id, { prompt, ...context });
        this.input.value = '';
        this.skipSelection = false;
        this.updateContext();
      } catch (err) {
        this.system(err.message, true);
      } finally {
        this.sending = false;
        this.autosize();
      }
    }

    // ---------------------------------------------------------- receiving

    receive(event) {
      if (event.seq) {
        if (event.seq <= this.seen) return;
        this.seen = event.seq;
      }
      const stuck = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 48;
      const turn = event.turn;
      switch (event.type) {
        case 'user':
          this.endLive();
          this.prompts.set(turn, event.text);
          this.record(turn).target = event.context?.target ?? null;
          this.append(turn, h('div', 'msg me', event.text));
          break;
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
        case 'ops.refused':
          this.opsRefused(turn, event);
          break;
        case 'watchdog':
          this.record(turn).watchdog = event;
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
      if (!this.turns.has(turn)) this.turns.set(turn, { tools: new Map(), applies: [], applied: 0, footer: null });
      return this.turns.get(turn);
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
        if (!['list_documents', 'read_document', 'apply_ops', 'create_document', 'read_guide'].includes(row.dataset.name)) {
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
      const record = this.record(turn);
      record.applied += event.count;
      const apply = this.pendingApply(turn, event.path);
      if (!apply) return;
      apply.row.dataset.state = 'done';
      apply.row.textContent = `Edited ${plural(event.count, 'element')} in ${event.path}`;
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
      const took = record.started ? ` · ${seconds(event.t - record.started)}` : '';
      const words = {
        completed: applied ? `Changed ${plural(applied, 'element')}` : 'Done',
        failed: event.error ? `Failed — ${event.error}` : 'Failed',
        cancelled: applied ? `Stopped · changed ${plural(applied, 'element')}` : 'Stopped',
        interrupted: 'Interrupted when the host stopped',
      }[status];
      footer.append(h('span', 'status', `${words}${took}`));

      if (applied && !record.undone) {
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

  window.marbleAgentUI = { renderText, spring, project, TOKENS };
})();
