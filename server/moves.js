// Where a document went. A document's name is its address, so a move changes
// the address of everything that pointed at it: a link somebody kept, a tab
// left open, a pin. This remembers the old addresses so they still land.
//
// `.marble/moves.json` holds `{ from, to, kind }` in the order they happened.
// A folder's move covers everything under it. Resolving follows the chain to
// its end, so a document moved twice is found from its first address, and a
// name taken again by a new document is that document's again: the host only
// asks here when nothing lives at the address.

import fsp from 'node:fs/promises';
import path from 'node:path';

const HOPS = 16;

export function createMoves({ dir }) {
  const file = path.join(dir, 'moves.json');
  let list = null;

  async function load() {
    if (list) return list;
    try {
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
      list = Array.isArray(raw) ? raw.filter((m) => m && typeof m.from === 'string' && typeof m.to === 'string') : [];
    } catch {
      list = [];
    }
    return list;
  }

  async function save() {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
    await fsp.rename(tmp, file);
  }

  /** One step: where this address went, if anywhere. The latest move wins. */
  const step = (moves, at) => {
    for (let i = moves.length - 1; i >= 0; i -= 1) {
      const { from, to, kind } = moves[i];
      if (at === from) return to;
      if (kind === 'folder' && at.startsWith(`${from}/`)) return to + at.slice(from.length);
    }
    return null;
  };

  return {
    async note(from, to, kind = 'doc') {
      if (!from || !to || from === to) return;
      const moves = await load();
      // Moving back to an old address makes that address live again, so no
      // entry may send it on; and one move per old address is enough.
      list = moves.filter((m) => m.from !== to && m.from !== from);
      list.push({ from, to, kind, at: new Date().toISOString() });
      await save();
    },

    /** Where an address that holds nothing now points, or null. */
    async resolve(at) {
      const moves = await load();
      let here = at;
      for (let hop = 0; hop < HOPS; hop += 1) {
        const next = step(moves, here);
        if (!next || next === at) break;
        here = next;
      }
      return here === at ? null : here;
    },
  };
}
