// A Fly bill, pasted as text from the Cost Explorer page.
//
// Fly has no API for what a sprite cost, so the owner pastes the page. The
// shape seen on 2026-09-25: "From:" and "To:" each followed by MM/DD/YYYY,
// "Total Spend" followed by $6.75, and one line per product ("Sprites: RAM
// $6.05"); the per-app view adds one line per app. Anything with a dollar
// amount that is none of these is named back rather than guessed at.

const PRODUCTS = [
  [/^sprites?:?\s*ram\b/i, 'ram'],
  [/^sprites?:?\s*(memory)\b/i, 'ram'],
  [/^sprites?:?\s*cpu\b/i, 'cpu'],
  [/^sprites?:?\s*hot\s*storage\b/i, 'hot'],
  [/^sprites?:?\s*cold\s*storage\b/i, 'cold'],
];
const SKIP = /^(daily average|products|update range|maximum range|earliest start|product\s+total|app\s+total)/i;
const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const MONEY = /\$\s*([\d,]+(?:\.\d+)?)/;

const money = (s) => Number(MONEY.exec(s)[1].replace(/,/g, ''));
const dateOf = (s) => {
  const m = DATE.exec(s);
  return m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
};

export function parseBill(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let from = null;
  let to = null;
  let totalSpend = null;
  const products = {};
  const apps = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1] ?? '';
    if (/^from:?(\s|$)/i.test(line)) {
      from = dateOf(line) ?? dateOf(next);
      continue;
    }
    if (/^to:?(\s|$)/i.test(line)) {
      to = dateOf(line) ?? dateOf(next);
      continue;
    }
    if (/^total spend/i.test(line)) {
      if (MONEY.test(line)) totalSpend = money(line);
      else if (MONEY.test(next)) {
        totalSpend = money(next);
        i += 1;
      }
      continue;
    }
    if (/^daily average/i.test(line)) {
      if (!MONEY.test(line) && MONEY.test(next)) i += 1;
      continue;
    }
    if (!MONEY.test(line) || SKIP.test(line)) continue;
    const label = line.slice(0, line.search(MONEY)).trim();
    const product = PRODUCTS.find(([re]) => re.test(label));
    if (product) {
      products[product[1]] = (products[product[1]] ?? 0) + money(line);
      continue;
    }
    if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(label)) {
      apps[label.toLowerCase()] = money(line);
      continue;
    }
    return { ok: false, line, why: 'a dollar amount this does not know how to read' };
  }
  if (from === null || to === null) return { ok: false, line: null, why: 'no "From:" and "To:" dates' };
  if (totalSpend === null) return { ok: false, line: null, why: 'no "Total Spend"' };
  if (!Object.keys(products).length && !Object.keys(apps).length) return { ok: false, line: null, why: 'no product or app lines' };
  const productSum = Object.values(products).reduce((a, b) => a + b, 0);
  if (Object.keys(products).length && Math.abs(productSum - totalSpend) > 0.02 + 0.01 * Object.keys(products).length) {
    return { ok: false, line: null, why: `the products add to $${productSum.toFixed(2)} but the total says $${totalSpend.toFixed(2)}` };
  }
  return {
    ok: true,
    bill: {
      from,
      // The range is inclusive of its last day.
      to: to + 24 * 60 * 60 * 1000,
      total: totalSpend,
      products,
      ...(Object.keys(apps).length ? { apps } : {}),
    },
  };
}
