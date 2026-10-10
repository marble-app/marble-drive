// Automations: an element in a document that carries its own brief.
//
// A document cannot fetch or run anything by itself, so "make this fill
// itself in" is built as a button with the brief on it:
//
//   <button data-marble-run="Look this paper up by its title and fill
//     Authors, Venue and Year. Leave cells someone typed in alone."
//     data-marble-scope="r2" data-marble-on="press">Fill</button>
//
// Pressing it starts an agent with that brief, aimed at this document and at
// the element named by data-marble-scope (or the button's own nearest
// addressed ancestor). The agent does the looking-up; its changes land like
// any other, with the zone while it works and Undo after. One run per scope
// at a time.
//
// A trigger whose data-marble-on is a schedule ("daily 07:00", "every 6h")
// is alive: the host runs it on that schedule with no page open
// (server/alive.js), and the page says how often in its own words beside it.
// Pressing it still runs it now. A button with data-marble-pause="<the
// trigger's id>" holds it and lets it go again: data-marble-paused on the
// trigger and aria-pressed on the button, each filed as an op, so a pause
// lasts and the host reads it from the file.
//
// Nothing else here edits the document.

(() => {
  const running = new Map(); // scope id -> conversation id

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    const app = marble.app;

    const scopeOf = (el) => {
      const named = el.getAttribute('data-marble-scope');
      if (named) return named;
      return el.parentElement?.closest('[data-marble-id]')?.getAttribute('data-marble-id')
        ?? el.getAttribute('data-marble-id');
    };

    async function run(el) {
      const brief = (el.getAttribute('data-marble-run') || '').trim();
      if (!brief) return;
      const scope = scopeOf(el);
      if (scope && running.has(scope)) {
        // Already at work here: pressing again follows it rather than
        // starting a second agent on the same element.
        agent.open(running.get(scope));
        return;
      }
      el.setAttribute('aria-busy', 'true');
      try {
        const settings = await agent.settings().catch(() => ({}));
        const id = await agent.start({ provider: settings.defaultProvider });
        if (scope) running.set(scope, id);
        await agent.send(id, {
          prompt: brief,
          target: app,
          viewing: app,
          selection: scope ? [scope] : [],
          also: [],
        });
        const off = agent.on(id, (event) => {
          if (!/^turn\.(completed|failed|cancelled|interrupted)$/.test(event.type)) return;
          off?.();
          if (scope) running.delete(scope);
          el.removeAttribute('aria-busy');
        });
      } catch {
        if (scope) running.delete(scope);
        el.removeAttribute('aria-busy');
        agent.open();
      }
    }

    /** Hold an alive trigger, or let it go again. */
    function pause(button) {
      const id = button.getAttribute('data-marble-pause');
      const trigger = id ? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`) : null;
      if (!trigger) return;
      const held = !trigger.hasAttribute('data-marble-paused');
      const ops = [{ type: 'setAttr', id, name: 'data-marble-paused', value: held ? '' : null }];
      const own = button.getAttribute('data-marble-id');
      if (own) ops.push({ type: 'setAttr', id: own, name: 'aria-pressed', value: String(held) });
      for (const op of ops) {
        marble.apply?.(op);
        marble.op?.(op);
      }
    }

    // One listener for the whole page: a trigger an agent adds later is live
    // the moment it lands. Describe mode's own tools are not a press. Every
    // trigger runs when pressed, a scheduled one too.
    document.addEventListener('click', (event) => {
      const el = event.target?.closest?.('[data-marble-run], [data-marble-pause]');
      if (!el || el.closest('[data-marble-transient]')) return;
      if (document.querySelector('.marble-marks-layer[data-describing]')) return;
      event.preventDefault();
      if (el.hasAttribute('data-marble-pause')) pause(el);
      else run(el);
    });

    window.marbleRun = { run, running: () => new Map(running) };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
