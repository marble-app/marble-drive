// Listening and playing, for talking to a chat (docs/AGENTS.md, "Voice").
// `globalThis.marbleVoice`: the composer (agent-ui.js) presses Talk, this
// records a clip until you stop, the host writes it down; when the turn ends,
// this plays the reply the host speaks.
//
// The microphone opens only on a press, and every track is stopped the moment
// listening ends, so the browser's recording light goes out. A hidden tab
// stops listening and throws the clip away. A clip lives in this tab until it
// is sent, and the last one is kept for one retry; it is never stored.
//
// Classic IIFE, so the host injects it as a script tag; Node tests import it
// for its pure parts (quietEnd, pickType).

(() => {
  const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'];
  const MIN_FLOOR = 0.02;
  const FLOOR_GAIN = 1.5;
  const SAMPLE_MS = 50;

  /** The first kind of clip this browser records: webm on Chrome and
   *  Firefox, mp4 on Safari. */
  const pickType = (supported) => TYPES.find((type) => supported(type)) ?? '';

  /** True once speech rose above a floor measured over the first `floorMs`
   *  and then stayed under it for `quietMs`. `levels` are 0..1, one every
   *  `frameMs`. */
  function quietEnd(levels, { floorMs = 300, quietMs = 1200, frameMs = 16 } = {}) {
    const floorFrames = Math.max(1, Math.round(floorMs / frameMs));
    if (levels.length <= floorFrames) return false;
    let noise = 0;
    for (let i = 0; i < floorFrames; i += 1) noise += levels[i];
    noise /= floorFrames;
    const floor = Math.max(MIN_FLOOR, noise * FLOOR_GAIN);
    const need = Math.round(quietMs / frameMs);
    let spoke = false;
    let quiet = 0;
    for (let i = floorFrames; i < levels.length; i += 1) {
      if (levels[i] > floor) {
        spoke = true;
        quiet = 0;
      } else if (spoke) {
        quiet += 1;
        if (quiet >= need) return true;
      }
    }
    return false;
  }

  // Everything below runs only in a browser.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    globalThis.marbleVoice = { quietEnd, pickType };
    return;
  }

  /** What the person is told when the microphone cannot open. */
  const WORDS = {
    blocked: "The microphone is blocked for this site. Allow it in the browser's site settings.",
    insecure: 'The microphone needs a secure address. Open the drive at its https name.',
    missing: "There's no microphone on this device. Connect one and try again.",
    busy: 'Another app is using the microphone. Close it and try again.',
    nothing: "Didn't catch anything. Try again a little closer.",
    down: "OpenAI didn't answer. Try again.",
  };

  let context = null;
  const audioContext = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!context || context.state === 'closed') context = new Ctx();
    return context;
  };

  // One <audio> per tab. iOS lets an element play later only if it was
  // played inside a press, so the press that starts listening plays it once,
  // silently (unlock), and every reply after uses the same element.
  let player = null;
  let playerSource = null;
  let playerAnalyser = null;
  let playing = null;
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  const element = () => {
    if (player) return player;
    player = document.createElement('audio');
    player.preload = 'auto';
    player.setAttribute('data-marble-transient', '');
    return player;
  };

  /** Inside a press: the player and the audio context are allowed to sound
   *  from now on. Safe to call on every press. */
  function unlock() {
    const ctx = audioContext();
    ctx?.resume?.().catch(() => {});
    const audio = element();
    if (audio.dataset.unlocked) return;
    audio.dataset.unlocked = '1';
    audio.muted = true;
    audio.src = SILENT;
    const done = () => { audio.muted = false; };
    audio.play().then(() => { audio.pause(); done(); }).catch(done);
  }

  /** 0..1 from an analyser's waveform: its loudness, scaled for drawing. */
  const levelOf = (analyser, buffer) => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
    return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
  };

  let listening = null;

  /** Listen until quiet follows speech, or `send()`. `done` resolves with the
   *  clip, or null when it was thrown away (cancel, a hidden tab). It rejects
   *  with a message for the person when the microphone cannot open. */
  function listen({ onLevel = () => {}, onState = () => {}, maxSeconds = 120 } = {}) {
    listening?.cancel();
    stop();
    unlock();
    let stream = null;
    let recorder = null;
    let analyser = null;
    let source = null;
    let frame = 0;
    let sampler = 0;
    let cap = 0;
    let ended = false;
    let keep = false;
    let started = 0;
    const levels = [];
    const chunks = [];
    let resolve;
    let reject;
    const done = new Promise((yes, no) => { resolve = yes; reject = no; });

    const release = () => {
      cancelAnimationFrame(frame);
      clearInterval(sampler);
      clearTimeout(cap);
      document.removeEventListener('visibilitychange', onHidden);
      try { source?.disconnect(); } catch { /* gone */ }
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (listening === handle) listening = null;
    };
    const finish = (save) => {
      if (ended) return;
      ended = true;
      keep = save;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.requestData?.(); } catch { /* not recording */ }
        recorder.stop();
      } else {
        release();
        resolve(null);
      }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') finish(false); };

    const handle = { done, send: () => finish(true), cancel: () => finish(false), get stream() { return stream; } };
    listening = handle;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) throw new Error(WORDS.insecure);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw new Error(WORDS.blocked);
        if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') throw new Error(WORDS.missing);
        if (err?.name === 'NotReadableError') throw new Error(WORDS.busy);
        throw new Error(WORDS.blocked);
      }
      if (ended) { release(); resolve(null); return; }
      const type = pickType((t) => window.MediaRecorder?.isTypeSupported?.(t));
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener('stop', () => {
        const seconds = (performance.now() - started) / 1000;
        const kind = recorder.mimeType || type || 'audio/webm';
        release();
        if (!keep || !chunks.length) return resolve(null);
        resolve({ blob: new Blob(chunks, { type: kind }), type: kind, seconds });
      });
      const ctx = audioContext();
      if (ctx) {
        ctx.resume?.().catch(() => {});
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        let last = 0;
        const draw = () => {
          last = levelOf(analyser, buffer);
          onLevel(last);
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        // Heard on a clock of its own, not the frame's: a frame can be slow
        // or skipped, and the quiet is measured in time.
        sampler = setInterval(() => {
          levels.push(levelOf(analyser, buffer));
          if (quietEnd(levels, { frameMs: SAMPLE_MS })) finish(true);
        }, SAMPLE_MS);
      }
      document.addEventListener('visibilitychange', onHidden);
      cap = setTimeout(() => finish(true), maxSeconds * 1000);
      started = performance.now();
      recorder.start(250);
      onState('listening');
    })().catch((err) => {
      ended = true;
      release();
      reject(err);
    });
    return handle;
  }

  /** Play a reply. One at a time: a second play stops the first. */
  function play(url, { onLevel = () => {}, onEnd = () => {} } = {}) {
    stop();
    const audio = element();
    const ctx = audioContext();
    // Drawn from the playback only where the context is already running; an
    // element routed through a suspended context would play silence.
    if (ctx && ctx.state === 'running' && !playerSource) {
      try {
        playerSource = ctx.createMediaElementSource(audio);
        playerAnalyser = ctx.createAnalyser();
        playerAnalyser.fftSize = 1024;
        playerSource.connect(playerAnalyser);
        playerAnalyser.connect(ctx.destination);
      } catch {
        playerSource = null;
        playerAnalyser = null;
      }
    }
    ctx?.resume?.().catch(() => {});
    let frame = 0;
    let over = false;
    const buffer = playerAnalyser ? new Float32Array(playerAnalyser.fftSize) : null;
    const draw = () => {
      if (playerAnalyser) onLevel(levelOf(playerAnalyser, buffer));
      frame = requestAnimationFrame(draw);
    };
    const end = (reason) => {
      if (over) return;
      over = true;
      cancelAnimationFrame(frame);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (playing === handle) playing = null;
      onEnd(reason);
    };
    const onEnded = () => end('ended');
    const onError = () => end('error');
    const handle = {
      stop() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        end('stopped');
      },
    };
    playing = handle;
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.muted = false;
    audio.src = url;
    audio.play().then(() => { if (!over) frame = requestAnimationFrame(draw); }).catch(() => end('blocked'));
    return handle;
  }

  /** The device's own voice, for Read aloud on a drive with no OpenAI key. */
  function say(text, { onEnd = () => {} } = {}) {
    stop();
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { onEnd('none'); return { stop() {} }; }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text ?? ''));
    let over = false;
    const end = (reason) => { if (over) return; over = true; if (playing === handle) playing = null; onEnd(reason); };
    utterance.onend = () => end('ended');
    utterance.onerror = () => end('error');
    const handle = { stop() { synth.cancel(); end('stopped'); } };
    playing = handle;
    synth.speak(utterance);
    return handle;
  }

  /** Stop whatever is speaking. */
  function stop() {
    playing?.stop();
    playing = null;
  }

  let lastClip = null;
  /** A clip to the host, and its words back. The clip is kept for one retry
   *  (`retry`), then let go. */
  async function transcribe(clip, { doc = '' } = {}) {
    lastClip = { clip, doc };
    const params = new URLSearchParams();
    if (doc) params.set('doc', doc);
    params.set('seconds', String(Math.round(clip.seconds ?? 0)));
    let response;
    try {
      response = await fetch(`/agent/voice/transcribe?${params}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': clip.type || clip.blob.type || 'audio/webm' },
        body: clip.blob,
      });
    } catch {
      throw Object.assign(new Error(WORDS.down), { retry: true });
    }
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(answer.error || WORDS.down), { status: response.status, retry: response.status >= 500 });
    lastClip = null;
    return String(answer.text ?? '');
  }

  /** The clip that failed last, once more. */
  function retry() {
    const held = lastClip;
    lastClip = null;
    if (!held) return Promise.reject(new Error(WORDS.nothing));
    return transcribe(held.clip, { doc: held.doc }).finally(() => { lastClip = null; });
  }

  globalThis.marbleVoice = {
    quietEnd,
    pickType,
    unlock,
    listen,
    play,
    say,
    stop,
    transcribe,
    retry,
    get listening() { return Boolean(listening); },
    get speaking() { return Boolean(playing); },
    canListen: () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
    WORDS,
  };
})();
