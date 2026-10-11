# Four recipes

Copy one and change the content. Each renders as it stands — `node
tools/visual-shots.mjs` draws all four at drawer width and pane width, light
and dark, from this file. If you change a recipe here, run it.

The four cover the four reasons to draw instead of write: **choosing** between
things you built, **seeing** a structure, **saying** an amount, and **picking**
a scope.

## Options

Options to choose between. Each one is a real miniature of the thing, not a
description of it — the demo is the argument. One `data-answer` per option, so
the reply is a click.

```marble-visual Three ways to show the reading list
<div class="grid" role="group" aria-label="Three layouts">
  <button class="pick" aria-pressed="false" data-answer="Use the stacked list.">
    <span class="demo stacked">
      <span class="line"><i></i><em>Interaction cost</em><u>2d</u></span>
      <span class="line"><i></i><em>Elicitive interfaces</em><u>4d</u></span>
      <span class="line"><i></i><em>The instruction gap</em><u>6d</u></span>
    </span>
    <b>Stacked list</b>
    <span class="meta">Every paper the same weight. Fastest to scan.</span>
  </button>
  <button class="pick" aria-pressed="false" data-answer="Use the lead and the rest.">
    <span class="demo lead">
      <span class="big"><em>Interaction cost</em><span class="sub">Why people stop</span></span>
      <span class="line"><i></i><em>Elicitive interfaces</em><u>4d</u></span>
    </span>
    <b>One lead, then the rest</b>
    <span class="meta">The day has a headline. The others stay a list.</span>
  </button>
  <button class="pick" aria-pressed="false" data-answer="Use the two-column grid.">
    <span class="demo tiles">
      <span class="tile"><em>Interaction cost</em></span>
      <span class="tile"><em>Elicitive UIs</em></span>
      <span class="tile"><em>The gap</em></span>
      <span class="tile"><em>Marks</em></span>
    </span>
    <b>Tiles</b>
    <span class="meta">Four at a glance. Titles get two lines each.</span>
  </button>
</div>
<style>
  .demo { display: grid; gap: 4px; padding: 8px; background: var(--paper-2); border-radius: 8px; height: 84px; align-content: start; overflow: hidden; }
  .demo em, .demo u { font-style: normal; text-decoration: none; font-size: 9px; }
  .line { display: flex; align-items: center; gap: 5px; }
  .line i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: none; }
  .line em { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line u { color: var(--faint); }
  .big { display: grid; gap: 2px; padding: 6px 7px; background: var(--card); border-radius: 6px; }
  .big em { font-size: 11px; font-weight: 500; }
  .big .sub { font-size: 8.5px; color: var(--muted); }
  .tiles { grid-template-columns: 1fr 1fr; }
  .tile { padding: 6px; background: var(--card); border-radius: 6px; display: grid; align-content: center; }
</style>
```

## Diagram

A structure. The boxes are HTML so the labels stay 14px at any width; the
arrows are SVG so they are drawn rather than typed. At a narrow width the row
becomes a column and the arrows turn with it — one rule, not a second diagram.

```marble-visual How a turn reaches the page
<div class="flow">
  <div class="node"><b>You</b><span class="meta">A prompt, and what you had selected</span></div>
  <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h15m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <div class="node"><b>The turn</b><span class="meta">Reads, thinks, files ops</span></div>
  <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h15m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <div class="node here"><b>Your page</b><span class="meta">Patched element by element, undoable</span></div>
</div>
<style>
  .flow { display: grid; gap: 8px; justify-items: stretch; align-items: center; }
  .node { display: grid; gap: 3px; padding: 10px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  .node b { font-weight: 500; }
  .node.here { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent) 10%, var(--card)); }
  .arrow { width: 22px; height: 22px; color: var(--faint); justify-self: center; transform: rotate(90deg); }
  @media (min-width: 520px) {
    .flow { grid-auto-flow: column; grid-auto-columns: 1fr auto 1fr auto 1fr; }
    .arrow { transform: none; }
  }
</style>
```

## Amount

A question with a number in it. The widget says the answer in words as it
moves, drafts it into the composer, and sends it on one press.

```marble-visual How much room should it take
<div class="stack">
  <label class="row"><span class="label">Width</span>
    <input id="w" type="range" min="1" max="4" step="1" value="2" style="flex:1;max-width:280px">
  </label>
  <p>Take <b id="said">half the page</b>, and <span id="rest">keep the rail</span>.</p>
  <div class="row" id="rail">
    <button class="pill" aria-pressed="true" data-rail="keep the rail">Keep the rail</button>
    <button class="pill" aria-pressed="false" data-rail="drop the rail">Drop the rail</button>
  </div>
  <button class="send" id="go">Use this</button>
</div>
<script>
  const words = ['a third of the page', 'half the page', 'two thirds of the page', 'the whole page'];
  const w = document.getElementById('w');
  const said = document.getElementById('said');
  const rest = document.getElementById('rest');
  const sentence = () => 'Take ' + said.textContent + ', and ' + rest.textContent + '.';
  const update = () => { said.textContent = words[w.value - 1]; marble.draft(sentence()); };
  w.addEventListener('input', update);
  document.getElementById('rail').addEventListener('click', (event) => {
    const button = event.target.closest('[data-rail]');
    if (!button) return;
    for (const pill of document.querySelectorAll('#rail .pill')) pill.setAttribute('aria-pressed', String(pill === button));
    rest.textContent = button.dataset.rail;
    marble.draft(sentence());
  });
  document.getElementById('go').addEventListener('click', () => marble.answer(sentence()));
</script>
```

## Scope

What to include. Chips toggle, the sentence underneath is the answer, and
nothing is sent until you press it — so changing your mind costs nothing.

```marble-visual What should the first pass cover
<div class="stack">
  <div class="row" id="picks">
    <button class="pill" aria-pressed="true">the composer</button>
    <button class="pill" aria-pressed="true">the transcript</button>
    <button class="pill" aria-pressed="false">the settings panel</button>
    <button class="pill" aria-pressed="false">the phone chrome</button>
    <button class="pill" aria-pressed="false">the callout</button>
  </div>
  <p class="meta" id="say">Covering the composer and the transcript.</p>
  <button class="send" id="go">Send this</button>
</div>
<script>
  const picks = document.getElementById('picks');
  const say = document.getElementById('say');
  const chosen = () => [...picks.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent);
  const sentence = () => {
    const list = chosen();
    if (!list.length) return 'Nothing yet — tell me what to cover.';
    const last = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list.at(-1) : list[0];
    return 'Covering ' + last + '.';
  };
  picks.addEventListener('click', (event) => {
    const button = event.target.closest('.pill');
    if (!button) return;
    button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    say.textContent = sentence();
  });
  document.getElementById('go').addEventListener('click', () => marble.answer(sentence()));
</script>
```
