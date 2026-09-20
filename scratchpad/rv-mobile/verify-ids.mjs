// Every data-marble-id in the original must still be in the edited file, exactly
// once. An id that moved is fine; an id that vanished is a dead link and a
// restore point that no longer lands.
import fs from 'node:fs';
const ids = f => {
  // The scripts mention ids in selector strings ('[data-marble-id="stage"]').
  // Those are references, not elements, so they must not count as duplicates.
  const src = fs.readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
  const out = [];
  for (const m of src.matchAll(/data-marble-id="([^"]+)"/g)) out.push(m[1]);
  return out;
};
const [, , a, b] = process.argv;
const A = ids(a), B = ids(b);
const setB = new Set(B);
const lost = [...new Set(A)].filter(id => !setB.has(id));
const dupA = A.filter((x, i) => A.indexOf(x) !== i);
const dupB = B.filter((x, i) => B.indexOf(x) !== i);
console.log(JSON.stringify({
  originalIds: A.length, editedIds: B.length,
  lost, added: [...new Set(B)].filter(id => !new Set(A).has(id)),
  duplicatesInOriginal: [...new Set(dupA)], duplicatesInEdited: [...new Set(dupB)],
  ok: lost.length === 0 && dupB.length === 0,
}, null, 2));
process.exit(lost.length === 0 && dupB.length === 0 ? 0 : 1);
