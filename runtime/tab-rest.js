// A tab nobody is using lets its sprite sleep.
//
// On a Fly Sprite an open connection is activity, and every page keeps live
// streams open (its document, the drive, agents). So a tab left open and
// forgotten would keep the sprite awake, and billing, for days. This script
// runs before any other on the page and stands in for EventSource: every
// stream the page opens goes through it, and underneath each one it holds a
// real EventSource, or none while the tab rests.
//
// The tab rests when it has been hidden for a minute, or visible with no input
// for ten (the host's limits, on this script's tag). Resting closes every
// stream underneath. The next input, or the tab being shown, wakes it: each
// stream reopens at the same address and catches up. An agent stream reopens
// after the last event it saw (the host replays the rest). Any other stream is
// told once that its document or folder changed, so it re-reads. A stream the
// page closes itself stays closed.
//
// While used, the tab says so (POST /tab/alive, at most once a minute) and
// tags its streams with its id; the host closes the streams of a tab that
// stopped saying so (server/streams.js).

(() => {
  if (window.marbleTabRest || typeof window.EventSource !== 'function') return;
  const Native = window.EventSource;
  const tag = document.currentScript?.dataset ?? {};
  const HIDDEN_MS = Number(tag.hiddenMs) || 60_000;
  const IDLE_MS = Number(tag.idleMs) || 10 * 60_000;
  const PING_MS = 60_000;
  const TAB = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const all = new Set();
  let resting = false;
  let lastInput = Date.now();
  let lastPing = 0;
  let hiddenTimer = null;
  let idleTimer = null;

  function ping() {
    lastPing = Date.now();
    return fetch('/tab/alive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab: TAB }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  }

  class RestingEventSource extends EventTarget {
    constructor(url, init = {}) {
      super();
      this.url = new URL(url, location.href).href;
      this.withCredentials = Boolean(init.withCredentials);
      this.lastEventId = '';
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._init = init;
      this._types = new Set(['open', 'message', 'error']);
      this._native = null;
      this._closed = false;
      this._catchUp = false;
      all.add(this);
      if (!resting) this._open(false);
    }

    get readyState() {
      if (this._closed) return 2;
      return this._native ? this._native.readyState : 0;
    }

    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, options);
      if (!this._types.has(type)) {
        this._types.add(type);
        this._native?.addEventListener(type, (event) => this._forward(event));
      }
    }

    close() {
      this._closed = true;
      all.delete(this);
      this._native?.close();
      this._native = null;
    }

    _address(wake) {
      const url = new URL(this.url);
      url.searchParams.set('tab', TAB);
      if (wake && /^\d+$/.test(this.lastEventId)) url.searchParams.set('after', this.lastEventId);
      return url.href;
    }

    _open(wake) {
      const native = new Native(this._address(wake), this._init);
      this._native = native;
      this._catchUp = wake && !/^\d+$/.test(this.lastEventId);
      for (const type of this._types) native.addEventListener(type, (event) => this._forward(event));
    }

    _rest() {
      this._native?.close();
      this._native = null;
    }

    _forward(event) {
      if (event.target !== this._native) return;
      if (event.lastEventId) this.lastEventId = event.lastEventId;
      const copy = event.type === 'error' || event.type === 'open'
        ? new Event(event.type)
        : new MessageEvent(event.type, { data: event.data, lastEventId: event.lastEventId, origin: event.origin });
      this._dispatch(copy);
      if (event.type === 'open' && this._catchUp) {
        this._catchUp = false;
        // Nothing to replay from: say the file or folder changed, the way the
        // host would have, so the page re-reads what it missed.
        if (this._types.has('changed')) this._dispatch(new MessageEvent('changed', { data: '{}' }));
        else this._dispatch(new MessageEvent('message', { data: 'changed' }));
      }
    }

    _dispatch(event) {
      this.dispatchEvent(event);
      const handler = this[`on${event.type}`];
      if (typeof handler === 'function') handler.call(this, event);
    }
  }
  RestingEventSource.CONNECTING = 0;
  RestingEventSource.OPEN = 1;
  RestingEventSource.CLOSED = 2;
  window.EventSource = RestingEventSource;

  function rest() {
    if (resting) return;
    resting = true;
    for (const source of all) source._rest();
  }

  async function wake({ fromIdle }) {
    if (!resting) return;
    resting = false;
    // Said first, so the host lets this tab's streams back in.
    await ping();
    if (resting) return;
    for (const source of all) if (!source._native && !source._closed) source._open(true);
    // A page that resyncs when it is shown again (the Agents page does) had
    // not been hidden, so it is told the same way.
    if (fromIdle) document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new CustomEvent('marble:tab-woke'));
  }

  // One timer, not one per input: when it fires it checks the last input and
  // sets itself again for the rest of the wait.
  const armIdle = () => {
    if (idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (resting) return;
      if (document.visibilityState !== 'hidden' && Date.now() - lastInput >= IDLE_MS) rest();
      else armIdle();
    }, Math.max(50, IDLE_MS - (Date.now() - lastInput)));
  };

  function used() {
    lastInput = Date.now();
    if (document.visibilityState === 'hidden') return;
    if (resting) wake({ fromIdle: true });
    else if (Date.now() - lastPing >= PING_MS) ping();
    armIdle();
  }

  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll', 'focus']) {
    addEventListener(type, used, { capture: true, passive: true });
  }
  // The wake below sends one of these itself, when the tab was already shown
  // and awake by then; it changes nothing here.
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.visibilityState === 'hidden') {
      hiddenTimer = setTimeout(rest, HIDDEN_MS);
      return;
    }
    lastInput = Date.now();
    armIdle();
    wake({ fromIdle: false });
  });

  window.marbleTabRest = {
    tab: TAB,
    get resting() {
      return resting;
    },
  };
  ping();
  armIdle();
  if (document.visibilityState === 'hidden') hiddenTimer = setTimeout(rest, HIDDEN_MS);
})();
