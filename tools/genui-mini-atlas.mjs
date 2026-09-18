#!/usr/bin/env node
// Cut the entries the genui fixtures use out of the real Atlas, so the tests
// run on the codebook's own keys and glosses. Re-run after an Atlas rebuild:
//   node tools/genui-mini-atlas.mjs [path/to/atlas.json]
import fsp from 'node:fs/promises';
import path from 'node:path';

const IDS = ['overview-detail', 'card', 'inbox', 'dashboard', 'stat-tile', 'chart', 'wizard', 'form', 'stepper'];
const from = process.argv[2] ?? path.join(process.cwd(), 'drive', 'Research', 'Design Pattern Generation', 'atlas.json');
const to = path.join(process.cwd(), 'test', 'fixtures', 'genui', 'atlas.mini.json');

const atlas = JSON.parse(await fsp.readFile(from, 'utf8'));
const entries = IDS.map((id) => {
  const e = atlas.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no entry "${id}" in ${from}`);
  return {
    id: e.id,
    name: e.name,
    level: e.level,
    archetype: e.archetype ?? null,
    def: e.def,
    relations: { uses: e.relations?.uses ?? [], specializes: e.relations?.specializes ?? [], neighbors: [] },
    dims: (e.dims ?? []).map((d) => ({
      name: d.name,
      q: d.q,
      subs: (d.subs ?? []).map((s) => ({
        name: s.name,
        key: s.key,
        sel: s.sel,
        vars: (s.vars ?? []).map((v) => [v[0], v[1] ?? '', '']),
      })),
    })),
  };
});
await fsp.mkdir(path.dirname(to), { recursive: true });
await fsp.writeFile(
  to,
  `${JSON.stringify({ about: `Mini atlas for genui tests, cut from atlas.json (${atlas.generatedAt ?? 'unknown build'}). Regenerate with tools/genui-mini-atlas.mjs.`, entries }, null, 1)}\n`,
);
console.log(`${entries.length} entries → ${path.relative(process.cwd(), to)}`);
