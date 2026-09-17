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
    .picker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .picker[hidden] { display: none; }
    .picker label { display: flex; align-items: center; gap: 6px; }
    .picker-select, .picker-model, .effort-select { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; max-width: 12rem; }
    .picker-agent[hidden], .picker-effort[hidden] { display: none; }
    .slash { max-height: 12rem; overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift); padding: 4px; }
    .slash[hidden] { display: none; }
    .slash button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; font: inherit; text-align: left; color: var(--ink); background: none; border: 0; border-radius: 8px; padding: 6px 8px; cursor: pointer; }
    .slash button[aria-selected="true"], .slash button:hover { background: var(--accent-soft); }
    .slash button small { color: var(--faint); font-size: 11px; }
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
          <div class="picker" hidden>
            <label class="picker-agent">Agent <select class="picker-select"></select></label>
            <label>Model <select class="picker-model" aria-label="Model"></select></label>
            <label class="picker-effort">Effort <select class="effort-select" aria-label="Effort"></select></label>
          </div>
          <div class="slash" hidden role="listbox" aria-label="Commands"></div>
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
      this.agentLabel = root.querySelector('.picker-agent');
      this.pickerSelect = root.querySelector('.picker-select');
      this.modelInput = root.querySelector('.picker-model');
      this.effortLabel = root.querySelector('.picker-effort');
      this.effortSelect = root.querySelector('.effort-select');
      this.slash = root.querySelector('.slash');
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
      this.slashItems = [];
      this.slashIndex = 0;
      this.skills = [];

      this.pickerSelect.addEventListener('change', () => this.syncCatalog());
      this.modelInput.addEventListener('change', () => this.persistCatalog());
      this.effortSelect.addEventListener('change', () => this.persistCatalog());
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit();
      });
      this.input.addEventListener('keydown', (event) => {
        if (this.onSlashKey(event)) return;
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.submit();
        }
      });
      this.input.addEventListener('input', () => {
        this.filterSlash();
        this.autosize();
      });
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
      this.skills = await this.api?.skills?.().catch(() => []) ?? [];

      if (!id) {
        await this.showPicker(token);
        return;
      }
      this.picker.hidden = false;
      this.agentLabel.hidden = true;
      try {
        const [{ meta }, providers] = await Promise.all([this.api.conversation(id), this.api.providers().catch(() => [])]);
        if (this.loading !== token) return;
        this.meta = meta;
        this.providerList = providers;
        this.pickerSelect.value = meta.provider;
        this.syncCatalog({ model: meta.model, effort: meta.effort });
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
      this.agentLabel.hidden = false;
      this.pickerSelect.replaceChildren();
      let providers = [];
      try {
        providers = await this.api.providers();
        this.skills = await this.api.skills().catch(() => []);
      } catch (err) {
        if (this.loading === token) this.system(`Agents could not be listed: ${err.message}`, true);
      }
      if (this.loading !== token) return;
      this.providerList = providers;
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
      await this.syncCatalog();
      this.updateSendable();
    }

    currentProvider() {
      const id = this.pickerSelect.value || this.meta?.provider;
      return this.providerList?.find((p) => p.id === id) ?? null;
    }

    async syncCatalog({ model, effort } = {}) {
      const provider = this.currentProvider();
      let settings = {};
      try {
        settings = await this.api.settings();
      } catch { /* defaults from the provider list */ }
      const id = provider?.id;
      fillSelect(this.modelInput, provider?.models ?? [], {
        value: model ?? this.modelInput.value ?? settings.models?.[id] ?? '',
      });
      const efforts = provider?.efforts ?? [];
      this.effortLabel.hidden = !efforts.length;
      fillSelect(this.effortSelect, efforts.map((level) => ({ id: level, label: level })), {
        value: effort ?? this.effortSelect.value ?? settings.efforts?.[id] ?? '',
      });
    }

    persistCatalog() {
      const id = this.getAttribute('conversation');
      if (!id || !this.api?.update) return;
      this.api.update(id, { model: this.modelInput.value, effort: this.effortSelect.value }).catch((err) => this.system(err.message, true));
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
      const { target, selection, also = [] } = this.api?.context() ?? { target: '', selection: [], also: [] };
      const count = this.skipSelection ? 0 : selection.length;
      const parts = [target];
      if (count) parts.push(`${count} selected`);
      if (also.length) parts.push(`+ ${also.length} more`);
      this.contextText.textContent = parts.join(' · ');
      this.contextClear.hidden = !count;
    }

    async submit() {
      const typed = this.input.value.trim();
      if (!typed || this.sending) return;
      const slash = this.matchSlash(typed);
      if (slash?.kind === 'clear') {
        this.hideSlash();
        this.input.value = '';
        this.api.remember(null);
        this.removeAttribute('conversation');
        this.dispatchEvent(new CustomEvent('conversation', { detail: { id: null }, bubbles: true, composed: true }));
        this.load();
        return;
      }
      if (slash?.kind === 'model' || slash?.kind === 'effort') {
        this.hideSlash();
        if (slash.kind === 'model') this.modelInput.value = slash.id;
        else this.effortSelect.value = slash.id;
        this.persistCatalog();
        this.input.value = slash.rest;
        this.autosize();
        if (!slash.rest) return;
      }
      let prompt = typed;
      if (slash?.kind === 'compact') prompt = '/compact';
      if (slash?.kind === 'skill') prompt = `/${slash.id}${slash.rest ? ` ${slash.rest}` : ''}`;
      this.sending = true;
      this.updateSendable();
      try {
        const context = this.api.context();
        if (this.skipSelection) context.selection = [];
        let id = this.getAttribute('conversation');
        if (!id) {
          const provider = this.pickerSelect.value;
          if (!provider) throw new Error('Choose an agent first.');
          id = await this.api.start({
            provider,
            model: this.modelInput.value.trim() || null,
            effort: this.effortSelect.value.trim() || null,
          });
          this.setAttribute('conversation', id);
          this.agentLabel.hidden = true;
          this.dispatchEvent(new CustomEvent('conversation', { detail: { id }, bubbles: true, composed: true }));
        }
        await this.api.send(id, { prompt, ...context });
        this.input.value = '';
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
      if (provider?.efforts?.includes(name) || (name === 'effort' && rest && provider?.efforts?.includes(rest))) {
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
      const items = [
        { kind: 'clear', id: 'clear', label: 'Clear conversation', detail: 'Start a new one' },
        { kind: 'compact', id: 'compact', label: 'Compact', detail: 'Shrink this conversation’s context' },
        ...(provider?.efforts ?? []).map((level) => ({ kind: 'effort', id: level, label: `Effort: ${level}` })),
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
      return false;
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

  // ------------------------------------------------------------ settings

  const SETTINGS_CSS = `
    :host { position: fixed; inset: 0; z-index: 2147483600; display: none; }
    :host([data-open="true"]) { display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(17, 17, 17, .28); }
    .sheet { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(440px, calc(100vw - 24px)); max-height: min(80vh, 640px); overflow: auto;
      background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lift); padding: 18px 18px 16px; display: flex; flex-direction: column; gap: 14px; }
    h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.02em; }
    fieldset { border: 1px solid var(--line); border-radius: 12px; margin: 0; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
    legend { padding: 0 6px; color: var(--muted); font-size: 12px; }
    .agent { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; }
    .agent label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .agent .detail { grid-column: 2; color: var(--faint); font-size: 11.5px; }
    .agent select { grid-column: 2; }
    input[type="text"], input[type="password"], select { font: inherit; color: var(--ink); background: var(--paper-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; width: 100%; box-sizing: border-box; }
    .key { display: flex; gap: 6px; align-items: center; }
    .key input { flex: 1; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    button { font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 12px; border: 1px solid var(--line); background: var(--paper-2); color: var(--ink); }
    button.save { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    button.link { border: 0; background: none; color: var(--muted); padding: 4px 6px; }
    button.link[hidden] { display: none; }
    .status { font-size: 12px; color: var(--faint); min-height: 1.2em; }
    .status.error { color: var(--danger); }
  `;

  class MarbleAgentSettings extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${TOKENS}${SETTINGS_CSS}</style>
        <div class="backdrop" part="backdrop"></div>
        <div class="sheet" role="dialog" aria-labelledby="agent-settings-title" aria-modal="true">
          <h2 id="agent-settings-title">Agent settings</h2>
          <div class="body"></div>
          <p class="status"></p>
          <div class="actions">
            <button type="button" class="close">Cancel</button>
            <button type="button" class="save">Save</button>
          </div>
        </div>`;
      this.body = root.querySelector('.body');
      this.status = root.querySelector('.status');
    }

    get api() {
      return window.marble?.agent;
    }

    connectedCallback() {
      this.setAttribute('data-open', this.getAttribute('data-open') || 'false');
      this.onOpen = () => this.open();
      addEventListener('marble:agent-settings', this.onOpen);
      this.shadowRoot.querySelector('.backdrop').addEventListener('click', () => this.close());
      this.shadowRoot.querySelector('.close').addEventListener('click', () => this.close());
      this.shadowRoot.querySelector('.save').addEventListener('click', () => this.save());
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
      removeEventListener('marble:agent-settings', this.onOpen);
      removeEventListener('keydown', this.onKey, true);
    }

    open() {
      this.setAttribute('data-open', 'true');
      this.fill();
    }

    close() {
      this.setAttribute('data-open', 'false');
    }

    async fill() {
      this.status.textContent = '';
      this.status.classList.remove('error');
      this.body.replaceChildren(h('p', 'status', 'Loading…'));
      let providers = [];
      let settings = { defaultProvider: '', models: {}, keys: { anthropic: false, cursor: false } };
      try {
        [providers, settings] = await Promise.all([this.api.providers(), this.api.settings()]);
      } catch (err) {
        this.body.replaceChildren();
        this.status.textContent = err.message;
        this.status.classList.add('error');
        return;
      }
      const agents = document.createElement('fieldset');
      agents.append(h('legend', '', 'Default agent and model'));
      for (const provider of providers) {
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
      this.body.replaceChildren(agents, keys);
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
  const PHONE = '(max-width: 719px)';
  const OPEN_KEY = 'marble-agent:open';
  const PIN_KEY = 'marble-agent:pinned';
  const TOOLS = new Set(['button', 'select', 'textarea', 'input', 'a']);

  const DRAWER_CSS = `
    :host { position: fixed; inset: auto 0 0 auto; z-index: 2147483000; }
    .launcher { position: fixed; right: calc(20px + env(safe-area-inset-right, 0px)); bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--ink);
      box-shadow: var(--shadow-lift); cursor: pointer; display: grid; place-items: center;
      transition: transform 110ms var(--snap), opacity 200ms var(--settle); }
    .launcher:hover { transform: translateY(-1px); }
    .launcher:active { transform: scale(.92); transition-duration: 60ms; }
    .launcher svg { width: 20px; height: 20px; }
    .launcher-dot { position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent-ink); box-shadow: 0 0 0 2px var(--card); }
    .launcher-dot[hidden] { display: none; }
    .launcher.running::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: spin 1s linear infinite; }
    :host([data-open-state="open"]) .launcher { opacity: 0; pointer-events: none; }

    .panel { position: fixed; top: 0; right: 0; bottom: 0; width: ${WIDTH}px; max-width: 100vw; display: flex; flex-direction: column;
      background: rgba(250, 250, 247, .86); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
      border-left: 1px solid var(--line); box-shadow: -18px 0 40px rgba(74,66,52,.12);
      transform: translateX(100%); will-change: transform; visibility: hidden; }
    .panel[data-pinned="true"] { box-shadow: none; background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; }
    @media (prefers-color-scheme: dark) { .panel { background: rgba(22, 24, 26, .86); box-shadow: -18px 0 40px rgba(0,0,0,.45); } .panel[data-pinned="true"] { background: var(--paper); } }
    @media (prefers-reduced-transparency: reduce) { .panel { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }

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
    .icon { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; transition: transform 110ms var(--snap), background 200ms var(--settle); }
    .icon:hover { background: var(--paper-2); color: var(--ink); }
    .icon:active { transform: scale(.92); }
    .icon[aria-pressed="true"] { color: var(--accent-ink); background: var(--accent-soft); }
    .where { flex: none; margin: 0 14px 6px; font-size: 12px; color: var(--muted); background: var(--accent-soft); border-radius: 8px; padding: 5px 10px; }
    .where[hidden] { display: none; }

    .menu { position: absolute; top: calc(52px + env(safe-area-inset-top, 0px)); left: 10px; right: 10px; z-index: 2; max-height: 60vh; overflow-y: auto;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift); padding: 6px; transform-origin: top left;
      animation: menu-in 160ms var(--settle); }
    .menu.actions { left: auto; width: 240px; transform-origin: top right; }
    .menu[hidden] { display: none; }
    .menu [role="menuitem"] { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0; border-radius: 8px; padding: 7px 10px; cursor: pointer; }
    .menu [role="menuitem"]:hover, .menu [role="menuitem"]:focus-visible { background: var(--paper-2); outline: none; }
    .menu [role="menuitem"] small { font-size: 11.5px; color: var(--faint); }
    .menu .empty { font-size: 12px; color: var(--faint); padding: 8px 10px; }

    marble-conversation { flex: 1; min-height: 0; }

    @media ${PHONE} {
      .panel { top: 0; left: 0; width: 100vw; border-left: 0; transform: translateY(100%); }
      .grip { display: block; position: absolute; top: calc(6px + env(safe-area-inset-top, 0px)); left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--line); }
      .bar { padding-top: calc(18px + env(safe-area-inset-top, 0px)); }
      .pin { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition: opacity 150ms linear; }
      .launcher.running::after, .menu { animation: none; }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes menu-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
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
          <header class="bar">
            <button type="button" class="title" aria-haspopup="menu" aria-expanded="false"><span class="title-text">New conversation</span>${ICONS.chevron}</button>
            <span class="provider"></span>
            <span class="spacer"></span>
            <button type="button" class="icon new" aria-label="New conversation">${ICONS.plus}</button>
            <button type="button" class="icon more" aria-label="More" aria-haspopup="menu" aria-expanded="false">${ICONS.more}</button>
            <button type="button" class="icon pin" aria-label="Pin beside the page" aria-pressed="false">${ICONS.pin}</button>
            <button type="button" class="icon close" aria-label="Close">${ICONS.close}</button>
          </header>
          <div class="where" hidden></div>
          <div class="menu recent" role="menu" aria-label="Recent conversations" hidden></div>
          <div class="menu actions" role="menu" aria-label="Conversation actions" hidden></div>
          <marble-conversation></marble-conversation>
        </aside>`;
      this.launcher = root.querySelector('.launcher');
      this.dot = root.querySelector('.launcher-dot');
      this.panel = root.querySelector('.panel');
      this.bar = root.querySelector('.bar');
      this.titleButton = root.querySelector('.title');
      this.titleText = root.querySelector('.title-text');
      this.providerEl = root.querySelector('.provider');
      this.where = root.querySelector('.where');
      this.recent = root.querySelector('.menu.recent');
      this.actions = root.querySelector('.menu.actions');
      this.pinButton = root.querySelector('.pin');
      this.view = root.querySelector('marble-conversation');

      this.progress = 0;
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
      const api = this.api;
      this.pinned = api.storage.get(PIN_KEY) === '1';
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
    }

    disconnectedCallback() {
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('marble:agent-open', this.onOpenRequest);
      removeEventListener('marble:agent-close', this.onCloseRequest);
      removeEventListener('marble:agent-settings-saved', this.onSettingsSaved);
      this.phone.removeEventListener('change', this.onViewport);
      this.offSummaries?.();
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
      this.dock(this.isOpen && this.pinned && !phone);
    }

    setPinned(pinned) {
      this.pinned = pinned;
      this.api.storage.set(PIN_KEY, pinned ? '1' : '0');
      this.render();
    }

    /** Docking moves the page, which is the whole point of pinning — and is
     *  done with a transient stylesheet, so nothing about the document changes. */
    dock(on) {
      const existing = document.getElementById('marble-agent-dock');
      if (on && !existing) {
        const style = document.createElement('style');
        style.id = 'marble-agent-dock';
        style.setAttribute('data-marble-transient', '');
        style.textContent = `html { margin-inline-end: ${WIDTH}px !important; }`;
        document.head.append(style);
      } else if (!on && existing) {
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
        const size = this.phone.matches ? innerHeight : WIDTH;
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
        const size = this.phone.matches ? innerHeight : WIDTH;
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
        const state = summary.status === 'running' ? 'Running' : summary.needsReview ? 'Needs review' : summary.activity || summary.status;
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
            this.startNew();
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
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('marble-agent-drawer')) return;
    const drawer = document.createElement('marble-agent-drawer');
    drawer.setAttribute('data-marble-transient', '');
    document.body.append(drawer);
  };

  window.marbleAgentUI = { renderText, spring, project, TOKENS };

  if (window.marble?.agent) mount();
  else addEventListener('marble:agent', mount, { once: true });
})();
