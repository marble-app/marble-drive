// A Fly bill pasted from the Cost Explorer page, read back or refused by line.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBill } from '../server/console/bill.js';

// Exactly what the owner pasted on 2026-09-25.
const PASTED = `Cost Explorer

View per-app breakdown
Back to Billing
From:

09/19/2026
To:

09/25/2026
Update Range
Maximum range: 35 days. Earliest start: 2026-06-01.
Total Spend
$6.75
Daily Average
$0.96
Products
3
Spend by Product
Product    Total
Sprites: RAM    $6.05
Sprites: CPU    $0.58
Sprites: Hot Storage    $0.11`;

test('the page pasted on 2026-09-25 reads as its range, total and products', () => {
  const r = parseBill(PASTED);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.bill.from, Date.UTC(2026, 8, 19));
  assert.equal(r.bill.to, Date.UTC(2026, 8, 26), 'inclusive of the last day');
  assert.equal(r.bill.total, 6.75);
  assert.deepEqual(r.bill.products, { ram: 6.05, cpu: 0.58, hot: 0.11 });
  assert.equal(r.bill.apps, undefined);
});

test('the per-app view adds a line per app', () => {
  const r = parseBill(`From: 09/19/2026\nTo: 09/25/2026\nTotal Spend $6.75\nApp\tTotal\nadmin-p1\t$4.10\nt-bryan\t$1.65\nt-sam\t$1.00`);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.bill.apps, { 'admin-p1': 4.1, 't-bryan': 1.65, 't-sam': 1 });
});

test('a line with a dollar amount it cannot read is named, and nothing is kept', () => {
  const r = parseBill(`${PASTED}\nSomething else entirely    $1.00`);
  assert.equal(r.ok, false);
  assert.equal(r.line, 'Something else entirely    $1.00');
});

test('missing pieces, and products that do not add up, are refused with a reason', () => {
  assert.match(parseBill('Total Spend $1\nSprites: RAM $1').why, /From/);
  assert.match(parseBill('From: 09/19/2026\nTo: 09/25/2026\nSprites: RAM $1').why, /Total Spend/);
  assert.match(parseBill('From: 09/19/2026\nTo: 09/25/2026\nTotal Spend $9.00\nSprites: RAM $1.00').why, /add to/);
  assert.equal(parseBill('').ok, false);
});
