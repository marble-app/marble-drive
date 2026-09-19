// A day, read as a story.
//
// Tap through the day one screen at a time, swipe up to reach the live
// component, tap back to re-read. This file drives the runtime in
// `.claude/skills/my-day/shell.mrbl` against issues built by the real
// `build.mjs`, at phone size, through the drive that actually serves them.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

const ROOT = new URL('../', import.meta.url).pathname;
const BUILD = path.join(ROOT, '.claude/skills/my-day/lib/build.mjs');
const PHONE = { width: 393, height: 852 };
const DOC = "Bryan's Days/story";

// No `id` or `pdfUrl` on a paper: the build screenshots a first PDF page over
// the network when it has one, and a test must never leave the machine.
const DAY = {
  date: '2026-09-19',
  title: 'Story fixture',
  palette: 'Sax Blue & Sulphur',
  greeting: 'Good morning, Bryan.',
  summary: 'A fixture day, built to be read as screens.',
  layout: {
    rail: [{ type: 'weather', treatment: 'card' }],
    stream: [
      { type: 'focus', treatment: 'bare' },
      { type: 'todos', treatment: 'bare' },
      { type: 'papers', treatment: 'bare' },
    ],
    tail: [{ type: 'calendar', treatment: 'card' }],
  },
  focus: [{ key: 'f1', title: 'Send the email' }],
  todos: [
    { key: 't1', title: 'Book the flight' },
    { key: 't2', title: 'Plan the course' },
    { key: 't3', title: 'Write the grant' },
    { key: 'big', title: 'The long one', note: 'a line about the work\n'.repeat(40) },
  ],
  keyDates: [{ label: 'UIST', date: '2026-10-20' }, { label: 'Ai2', date: '2026-11-13' }],
  weather: { error: 'none today' },
  arxiv: {
    papers: [
      { key: 'core', title: 'A core paper', authors: ['A. One'], relevance: 3, absUrl: 'https://arxiv.org/abs/1' },
      { key: 'fieldy', title: 'A field paper', authors: ['B. Two'], relevance: 0, absUrl: 'https://arxiv.org/abs/2' },
    ],
  },
};

function issue(payload = DAY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-story-b-'));
  const pj = path.join(dir, 'p.json');
  const out = path.join(dir, 'issue.mrbl');
  fs.writeFileSync(pj, JSON.stringify(payload));
  execFileSync('node', [BUILD, 'assemble', '--payload', pj, '--out', out], { encoding: 'utf8' });
  return fs.readFileSync(out, 'utf8');
}

const SOURCE = issue();

async function phone(host, options = {}) {
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/${encodeURIComponent(DOC)}`);
  await page.waitForSelector('.story-read');
  return { page, errors };
}

async function openStory(page) {
  await page.click('[data-setread="story"]');
  await page.waitForSelector('.story-screen');
}

const at = (page) => page.$eval('.story-of', (el) => Number(el.textContent.split('/')[0].trim()));
const total = (page) => page.$eval('.story-of', (el) => Number(el.textContent.split('/')[1].trim()));
const still = (page) => page.waitForFunction(() => !document.querySelector('.story').dataset.moving);

// Walk forward until a predicate holds, so a test never hardcodes a screen
// number that adaptive packing is allowed to change.
const walkTo = (page, selector, limit = 60) => page.evaluate(async ([sel, max]) => {
  const zone = document.querySelector('.story-zone[data-dir="next"]');
  for (let i = 0; i < max; i += 1) {
    if (document.querySelector(sel)) return true;
    zone.click();
    await new Promise((r) => setTimeout(r, 40));
  }
  return !!document.querySelector(sel);
}, [selector, limit]);

test('a day reads as a story on a phone', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page, errors } = await phone(host);
  await openStory(page);

  assert.equal(await at(page), 1, 'it opens on the cover');
  const screens = await total(page);
  assert.ok(screens >= 6, `the fixture is more than a handful of screens, got ${screens}`);
  assert.equal(await page.$$eval('.story-bar > .story-seg', (els) => els.length), screens,
    'one progress segment per screen');

  await page.click('.story-zone[data-dir="next"]');
  await still(page);
  assert.equal(await at(page), 2, 'tapping the right advances one screen');
  await page.click('.story-zone[data-dir="prev"]');
  await still(page);
  assert.equal(await at(page), 1, 'tapping the left goes back');
  assert.deepEqual(errors, []);
});

test('every unit reaches a screen, and a screen holds one group', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);

  const seen = await page.evaluate(async () => {
    const zone = document.querySelector('.story-zone[data-dir="next"]');
    const keys = new Set();
    const groups = [];
    for (let i = 0; i < 80; i += 1) {
      const stack = document.querySelector('.story-screen[data-cur] .story-stack');
      if (stack) {
        const here = [...stack.querySelectorAll('[data-key]')].map((e) => e.getAttribute('data-key'));
        for (const k of here) keys.add(k);
        if (here.length) groups.push(here);
      }
      const of = document.querySelector('.story-of').textContent.split('/');
      if (Number(of[0]) >= Number(of[1])) break;
      zone.click();
      await new Promise((r) => setTimeout(r, 40));
    }
    return { keys: [...keys], groups };
  });

  for (const key of ['f1', 't1', 't2', 't3', 'big', 'core', 'fieldy']) {
    assert.ok(seen.keys.includes(key), `${key} appeared on a screen`);
  }
  // A to-do and a paper never share a screen.
  for (const g of seen.groups) {
    const kinds = new Set(g.map((k) => (['core', 'fieldy'].includes(k) ? 'paper' : 'row')));
    assert.equal(kinds.size, 1, `one kind per screen, saw ${g.join(', ')}`);
  }
});

test('a unit taller than the screen is clamped, never split', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  assert.equal(await walkTo(page, '.story-screen[data-cur][data-clamped]'), true,
    'the forty-line note gets a clamped screen of its own');
  const word = await page.$eval('.story-word', (el) => el.textContent);
  assert.match(word, /swipe up/i, 'and the hint says where the rest is');
});

test('a paper that stands alone shows its picture; packed rows do not', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  const shape = await page.evaluate(async () => {
    const zone = document.querySelector('.story-zone[data-dir="next"]');
    const out = {};
    for (let i = 0; i < 80; i += 1) {
      const stack = document.querySelector('.story-screen[data-cur] .story-stack');
      const keys = stack ? [...stack.querySelectorAll('[data-key]')].map((e) => e.getAttribute('data-key')) : [];
      if (keys.includes('core')) out.coreAlone = keys.length === 1;
      if (keys.includes('big')) out.bigAlone = keys.length === 1;
      if (keys.includes('t1')) out.packed = keys.length;
      const of = document.querySelector('.story-of').textContent.split('/');
      if (Number(of[0]) >= Number(of[1])) break;
      zone.click();
      await new Promise((r) => setTimeout(r, 40));
    }
    return out;
  });
  assert.equal(shape.coreAlone, true, 'a Core paper has the screen to itself');
  assert.equal(shape.bigAlone, true, 'so does the row with the list in it');
  assert.ok(shape.packed > 1, `short to-dos share a screen, got ${shape.packed}`);
});

test('glance is a picture of the document, not the document', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  await walkTo(page, '.story-screen[data-cur] .story-stack li.row');
  const clean = await page.evaluate(() => {
    const stack = document.querySelector('.story-screen[data-cur] .story-stack');
    return {
      ids: stack.querySelectorAll('[data-marble-id]').length,
      editable: stack.querySelectorAll('[contenteditable]').length,
      acts: stack.querySelectorAll('.acts, .chk, .add, [data-act]').length,
      links: stack.querySelectorAll('a[href]').length,
    };
  });
  assert.deepEqual(clean, { ids: 0, editable: 0, acts: 0, links: 0 },
    'nothing addressable, nothing editable, nothing to press, nothing to navigate');
});

test('no overlay on a desktop-width tab, and one behind #story', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await host.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${host.base}/a/${encodeURIComponent(DOC)}`);
  await page.waitForSelector('.comp[data-story-seq]');
  assert.equal(await page.$('.story-read'), null, 'no toggle at desktop width');
  assert.equal(await page.$('.story'), null, 'and no overlay');

  await page.goto(`${host.base}/a/${encodeURIComponent(DOC)}#story`);
  await page.waitForSelector('.story-screen');
  assert.ok(await page.$('.story'), 'the hash reaches the story for a screenshot pass');
});

test('dragging sideways moves the story, and a flick carries it', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  await page.click('.story-zone[data-dir="next"]');
  await still(page);
  const from = await at(page);

  const box = await page.$eval('.story-track', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(box.x - i * 30, box.y);
  await page.mouse.up();
  await still(page);
  assert.equal(await at(page), from + 1, 'a leftward flick advances one screen');
});

test('the cover and the end card rubber-band rather than falling off', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  await page.click('.story-zone[data-dir="prev"]');
  await still(page);
  assert.equal(await at(page), 1, 'previous on the cover stays on the cover');

  const n = await total(page);
  await page.evaluate(async (count) => {
    const zone = document.querySelector('.story-zone[data-dir="next"]');
    for (let i = 0; i < count + 4; i += 1) {
      zone.click();
      await new Promise((r) => setTimeout(r, 30));
    }
  }, n);
  await still(page);
  assert.equal(await at(page), n, 'next on the end card stays on the end card');
  assert.ok(await page.$('.story-end'), 'and the end card is the way out');
});

test('the keyboard reaches every move', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  await page.keyboard.press('ArrowRight');
  await still(page);
  assert.equal(await at(page), 2);
  await page.keyboard.press('ArrowLeft');
  await still(page);
  assert.equal(await at(page), 1);
});

test('swiping up holds the live component, and the bar brings the story back', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await openStory(page);
  await walkTo(page, '.story-screen[data-cur] .story-stack li.row[data-key="t1"]');

  await page.click('.story-open');
  await page.waitForSelector('.story-return:not([hidden])');
  assert.match(await page.$eval('.story-back', (el) => el.textContent), /To-dos . back to the story/i,
    'the bar names the component it opened');
  await page.waitForFunction(() => document.querySelector('.story').hidden);  // the rise finishes, then it stands down

  const landed = await page.evaluate(() => {
    const sec = document.querySelector('.comp[data-comp="todos"]');
    return sec.getBoundingClientRect().top;
  });
  assert.ok(Math.abs(landed) < 140, `the document is scrolled to the component, top was ${landed}`);

  await page.click('.comp[data-comp="todos"] li.row[data-key="t1"] [data-act="done"]');
  await page.click('.story-back');
  await page.waitForSelector('.story:not([hidden]) .story-screen');
  const struck = await page.$$eval('.story-screen[data-cur] .story-stack li.row', (els) =>
    els.some((e) => e.getAttribute('data-key') === 't1' && e.hasAttribute('data-done')));
  assert.equal(struck, true, 'the glance is rebuilt from the document he just edited');
});

test('the story files the reading mode and nothing else', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host);
  await page.evaluate(() => {
    window.__ops = [];
    const real = window.marble.op.bind(window.marble);
    window.marble.op = (op, o) => { window.__ops.push(op); return real(op, o); };
  });
  await openStory(page);
  await page.click('.story-zone[data-dir="next"]');
  await still(page);
  await walkTo(page, '.story-screen[data-cur] .story-stack li.row');
  const ops = await page.evaluate(() => window.__ops);
  assert.deepEqual(ops.map((o) => `${o.type}:${o.name}`), ['setAttr:data-read']);
  assert.equal(ops[0].value, 'story');
});

test('under reduced motion nothing animates transform', async (t) => {
  const host = await startDrive({ documents: { [DOC]: SOURCE } });
  t.after(() => host.close());
  const { page } = await phone(host, { reducedMotion: 'reduce' });
  await openStory(page);
  await page.click('.story-zone[data-dir="next"]');
  const moving = await page.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === 'running' && String(a.effect?.getKeyframes?.()?.map((k) => k.transform))
      .includes('translate')).length);
  assert.equal(moving, 0, 'no transform animation runs');
  assert.equal(await at(page), 2, 'the move still happens');
});
