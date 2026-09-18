// Drive's collaboration chrome. Transient, injected like the agent drawer.
//
// The package decides what landed: ops, a fork, a presence set. This file is
// the look — outlines on the component that is being written, a flash on a
// disjoint apply, and the three verbs on a <marble-alt>. Another host using
// @bdhmin/marble draws something else against the same events.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const ID = 'data-marble-id';
  const ALT = 'data-marble-alt';
  const ACTIVE = 'data-marble-active';
  const BY = 'data-marble-by';

  const attach = (marble) => {
    if (document.documentElement.classList.contains('marble-collab-host')) return;
    document.documentElement.classList.add('marble-collab-host');
    marble.pageOnly('data-marble-choice');

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = `
      html.marble-collab-host .marble-alts { display: none; }
      html.marble-collab-host marble-alt > [data-marble-alt] { display: none; }
      html.marble-collab-host marble-alt > .marble-alt-shown { display: block; }
      .marble-presence {
        outline: 2px solid var(--accent, #9bb6cf);
        outline-offset: 3px;
      }
      .marble-flash {
        animation: marble-flash .9s var(--settle, ease) 1;
      }
      @keyframes marble-flash {
        from { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #9bb6cf) 55%, transparent); }
        to { box-shadow: 0 0 0 0 transparent; }
      }
      @media (prefers-reduced-motion: reduce) {
        .marble-flash { animation: none; }
      }
      .marble-fork {
        display: flex; flex-wrap: wrap; gap: .35rem; align-items: center;
        margin-top: .55rem;
        font: 500 12px/1 var(--ui-font, system-ui, sans-serif);
      }
      .marble-fork button {
        appearance: none; border: 1px solid var(--line, #ddd9cf);
        background: var(--paper, #fafaf7); color: var(--ink, #111);
        padding: .32rem .7rem; border-radius: 999px; cursor: pointer;
        font: inherit;
      }
      .marble-fork button:hover { background: var(--paper-2, #f3f1ea); }
      .marble-fork button:focus-visible {
        outline: 2px solid var(--accent, #9bb6cf); outline-offset: 2px;
      }
      .marble-fork button[aria-pressed="true"] {
        background: var(--ink, #111); color: var(--paper, #fafaf7); border-color: var(--ink, #111);
      }
      .marble-fork button.marble-fork-reject { color: var(--danger, #b4533e); }
    `;
    document.head.append(style);

    const byId = (id) => marble.byId(id);
    const persistentChildren = (el) => [...el.children].filter((c) => !c.hasAttribute(TRANSIENT));
    const nextPersistent = (el) => {
      let sibling = el.nextElementSibling;
      while (sibling && sibling.hasAttribute(TRANSIENT)) sibling = sibling.nextElementSibling;
      return sibling;
    };

    const labelOf = (version) => {
      const by = version.getAttribute(BY) ?? '';
      if (by === 'person') return 'You';
      const name = version.getAttribute(ALT) ?? '';
      if (name === 'you') return 'You';
      if (by.startsWith('agent') || name.startsWith('agent') || name === 'claude') return 'Agent';
      return name || 'Version';
    };

    function deriveAlts(root = document) {
      const alts = [
        ...(root.matches?.('marble-alt') ? [root] : []),
        ...root.querySelectorAll?.('marble-alt') ?? [],
      ];
      for (const alt of alts) {
        const versions = persistentChildren(alt);
        const active = alt.getAttribute(ACTIVE);
        const current = versions.find((el) => el.getAttribute(ALT) === active) ?? versions[0];
        for (const version of versions) {
          version.classList.toggle('marble-alt-shown', version === current);
        }
      }
    }

    const flashes = new WeakMap();
    function flash(id) {
      const el = byId(id);
      if (!el) return;
      el.classList.add('marble-flash');
      clearTimeout(flashes.get(el));
      flashes.set(el, setTimeout(() => el.classList.remove('marble-flash'), 900));
    }

    const presence = new Map();
    function paintPresence() {
      for (const el of document.querySelectorAll('.marble-presence')) el.classList.remove('marble-presence');
      for (const { ids } of presence.values()) {
        for (const id of ids) byId(id)?.classList.add('marble-presence');
      }
    }

    document.addEventListener('marble:presence', ({ detail }) => {
      if (!detail?.client) return;
      if (!detail.ids?.length) presence.delete(detail.client);
      else presence.set(detail.client, detail);
      paintPresence();
    });

    document.addEventListener('marble:ops', ({ detail }) => {
      const ops = detail?.ops ?? [];
      const forked = new Set();
      for (const op of ops) {
        if (op.type === 'insert' && /<marble-alt[\s>]/.test(op.html ?? '')) {
          const id = op.html.match(/data-marble-id="([^"]+)"/)?.[1];
          if (id) forked.add(id);
        }
        if (op.id) flash(op.id);
      }
      deriveAlts();
      for (const id of forked) wireFork(byId(id));
      paintPresence();
    });

    function play(ops) {
      const inverses = [];
      for (const op of ops) {
        const inverse = marble.invert(op);
        if (inverse) inverses.unshift(inverse);
        marble.apply(op);
        marble.op(op);
      }
      if (inverses.length) marble.record({ redo: ops, undo: inverses });
      return marble.flush();
    }

    function unwrapAlt(alt) {
      const keep = persistentChildren(alt)[0];
      if (!keep) return;
      const parent = alt.parentElement;
      if (!parent || !marble.id(parent)) return;
      const altId = marble.id(alt);
      const before = nextPersistent(alt);
      const clone = marble.clone(keep);
      clone.removeAttribute(ALT);
      clone.removeAttribute(BY);
      clone.setAttribute(ID, altId);
      // Remove the wrapper first so the guard sees `ha` as destroyed with it,
      // then insert the kept child under the original id. Renaming via setAttr
      // would drop `ha` without a remove.
      play([
        { type: 'remove', id: altId },
        {
          type: 'insert',
          html: marble.source.outer(clone),
          parentId: marble.id(parent),
          beforeId: before ? marble.id(before) : null,
        },
      ]);
    }

    function resolve(alt, keepName) {
      const versions = persistentChildren(alt);
      const keep = versions.find((el) => el.getAttribute(ALT) === keepName) ?? versions[0];
      if (!keep) return;
      const doomed = versions.filter((el) => el !== keep);
      const id = marble.id(alt);
      const ops = [];
      if (alt.getAttribute(ACTIVE) !== keepName) {
        ops.push({ type: 'setAttr', id, name: ACTIVE, value: keepName });
      }
      for (const node of doomed) ops.push({ type: 'remove', id: marble.id(node) });
      play(ops).then(() => {
        if (persistentChildren(alt).length <= 1) unwrapAlt(alt);
        else deriveAlts(alt);
      });
    }

    function askMerge(alt) {
      const versions = persistentChildren(alt);
      const ids = versions.map((el) => marble.id(el)).filter(Boolean);
      const prompt =
        'Merge these two versions of the selected component into a third alternative. ' +
        'Keep both authors’ intent. Add a new data-marble-alt child — do not overwrite either existing version.';
      if (!marble.agent) return;
      marble.agent.select(ids);
      marble.agent.aim(marble.app);
      const current = marble.agent.current?.();
      if (current) {
        marble.agent.send(current, { prompt, target: marble.app, selection: ids });
      } else {
        marble.agent.open();
      }
    }

    function wireFork(alt) {
      if (!alt || alt.tagName !== 'MARBLE-ALT' || alt.querySelector(':scope > .marble-fork')) return;
      const versions = persistentChildren(alt);
      if (versions.length < 2) return;

      const bar = document.createElement('div');
      bar.className = 'marble-fork';
      bar.setAttribute(TRANSIENT, '');
      bar.setAttribute('contenteditable', 'false');

      const render = () => {
        const kids = persistentChildren(alt);
        const active = alt.getAttribute(ACTIVE);
        bar.replaceChildren();
        for (const version of kids) {
          const name = version.getAttribute(ALT);
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = labelOf(version);
          button.setAttribute('aria-pressed', String(name === active));
          button.addEventListener('click', () => {
            if (!name || alt.getAttribute(ACTIVE) === name) return;
            const undo = { type: 'setAttr', id: marble.id(alt), name: ACTIVE, value: alt.getAttribute(ACTIVE) };
            const redo = { type: 'setAttr', id: marble.id(alt), name: ACTIVE, value: name };
            alt.setAttribute(ACTIVE, name);
            marble.apply(redo);
            marble.record({ redo: [redo], undo: [undo] });
            marble.op(redo, { immediate: true });
            deriveAlts(alt);
            render();
          });
          bar.append(button);
        }
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.textContent = 'Approve';
        approve.addEventListener('click', () => {
          const agent = kids.find((el) => labelOf(el) === 'Agent') ?? kids[1];
          resolve(alt, agent?.getAttribute(ALT));
        });
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'marble-fork-reject';
        reject.textContent = 'Reject';
        reject.addEventListener('click', () => {
          const yours = kids.find((el) => labelOf(el) === 'You') ?? kids[0];
          resolve(alt, yours?.getAttribute(ALT));
        });
        const merge = document.createElement('button');
        merge.type = 'button';
        merge.textContent = 'Ask another agent to merge';
        merge.addEventListener('click', () => askMerge(alt));
        bar.append(approve, reject, merge);
      };

      alt.append(bar);
      render();
      new MutationObserver(render).observe(alt, { attributes: true, attributeFilter: [ACTIVE], childList: true });
    }

    marble.register((root) => {
      deriveAlts(root);
      const alts = [
        ...(root.matches?.('marble-alt') ? [root] : []),
        ...root.querySelectorAll?.('marble-alt') ?? [],
      ];
      for (const alt of alts) wireFork(alt);
    });
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
