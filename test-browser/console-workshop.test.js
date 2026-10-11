// The workshop's marble card, walked through a release the way it went wrong
// once: loose edits, then a change npm does not have, with this machine signed
// out of npm; signing in from the card; a publish npm refuses after the
// version is made; finishing it without making another; and GitHub moving on.
// At every stop the card says where things stand in a sentence and offers the
// one button that moves it on.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'bdhmin', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'bdhmin', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

// A stand-in npm on PATH, for the workshop's reads and the jobs alike: what it
// has published, who it is signed in as, and how a publish goes, from a file.
const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-npm-'));
const npmState = path.join(bin, 'npm.json');
const setNpm = async (over) => {
  const now = JSON.parse(await fsp.readFile(npmState, 'utf8').catch(() => '{}'));
  await fsp.writeFile(npmState, JSON.stringify({ ...now, ...over }));
};
await setNpm({ published: '0.2.1', user: null, publish: 'ok' });
await fsp.writeFile(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('fs');
const file = ${JSON.stringify(npmState)};
const st = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(st));
const a = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (a[0] === 'whoami') { if (st.user) console.log(st.user); else { console.error('npm error code E401'); process.exit(1); } }
  if (a[0] === 'view') console.log(st.published);
  if (a[0] === 'login') { console.log('Login at:\\nhttps://www.npmjs.com/login?next=/login/cli/abc'); await wait(900); st.user = 'bdhmin'; save(); }
  if (a[0] === 'version') {
    const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const v = p.version.split('.').map(Number); v[2] += 1; p.version = v.join('.');
    fs.writeFileSync('package.json', JSON.stringify(p) + '\\n');
    console.log('v' + p.version);
  }
  if (a[0] === 'publish') {
    await wait(700);
    if (st.publish !== 'ok') { console.error('npm error code E500\\nnpm error 500 Internal Server Error - PUT https://registry.npmjs.org/@bdhmin%2fmarble'); process.exit(1); }
    st.published = JSON.parse(fs.readFileSync('package.json', 'utf8')).version; save();
    console.log('+ @bdhmin/marble@' + st.published);
  }
  if (a[0] === 'test') console.log('ok');
})();
`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;

const world = await consoleWorld();
test.after(() => world.host.close());
const marble = path.join(world.src, 'marble');
const card = '.cx-view[data-view="workshop"] .card.repo[data-repo="marble"]';
const shot = async (page, name) => {
  if (!process.env.SHOTS) return;
  await page.waitForTimeout(500); // the card's arrival settles
  const box = await page.locator(card).boundingBox();
  await page.screenshot({ path: `${process.env.SHOTS}/workshop-${name}.png`, clip: box });
};
/** The page as it opens now, with npm asked afresh. */
async function look({ fetch = false } = {}) {
  world.host.drive.console.workshop.forgetNpm();
  if (fetch) await world.host.drive.console.workshop.fetch({ force: true });
  const { page, errors } = await world.open({ view: 'workshop', width: 1280, height: 1100 });
  await page.waitForSelector(card);
  return { page, errors };
}
const where = (page) => page.textContent(`${card} .where`);
const go = (page) => page.textContent(`${card} .where-block .go .btn`);

test('loose edits come first: the card says so and offers nothing that would publish them', async () => {
  const { page, errors } = await look();
  assert.equal(await page.getAttribute(card, 'data-state'), 'edited');
  assert.match(await where(page), /1 edit that is not committed/);
  assert.equal(await page.$(`${card} .where-block .go`), null);
  assert.match(await page.textContent(`${card} .facts`), /npm sign-in\s*Not signed in/);
  assert.match(await page.textContent(`${card} .files`), /new\s*README\.md/);
  await shot(page, '1-edited');
  if (process.env.SHOTS) {
    const box = await page.locator('.cx-view[data-view="workshop"] .card.repo[data-repo="marble-drive"]').boundingBox();
    await page.screenshot({ path: `${process.env.SHOTS}/workshop-0-marble-drive.png`, clip: box });
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('a change npm lacks, signed out: sign in first, from the card, with npm’s link on a button', async () => {
  git(marble, 'tag', '-a', 'v0.2.1', '-m', 'marble 0.2.1');
  git(marble, 'add', '.');
  git(marble, 'commit', '-q', '-m', 'The doctor says when affordances go nowhere');
  git(marble, 'push', '-q', '--follow-tags');
  const { page, errors } = await look();
  assert.equal(await page.getAttribute(card, 'data-state'), 'unreleased');
  assert.match(await where(page), /1 change since 0\.2\.1 is not on npm yet/);
  assert.match(await page.textContent(`${card} .changes`), /The doctor says when affordances go nowhere/);
  assert.equal(await go(page), 'Sign in to npm');
  await shot(page, '2-signed-out');
  if (process.env.SHOTS) {
    const phone = await world.open({ view: 'workshop', width: 390, height: 1400, colorScheme: 'dark', hasTouch: true, isMobile: true });
    await phone.page.waitForSelector(card);
    await phone.page.waitForTimeout(500);
    const box = await phone.page.locator(card).boundingBox();
    await phone.page.screenshot({ path: `${process.env.SHOTS}/workshop-2-phone-dark.png`, clip: box });
    assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing runs off the side');
    await phone.page.close();
  }

  await page.click(`${card} .where-block .go .btn`);
  await page.waitForSelector(`${card} .job-now a.btn[href*="npmjs.com/login"]`);
  assert.match(await page.textContent(`${card} .job-now a.btn`), /Sign in on npmjs\.com/);
  await shot(page, '3-signing-in');
  await page.waitForSelector(`${card}[data-state="unreleased"] .job-now[data-state="done"]`);
  assert.match(await page.textContent(`${card} .job-said`), /Signed in to npm as bdhmin/);
  await page.waitForFunction((sel) => document.querySelector(sel)?.textContent === 'Publish 0.2.2…', `${card} .where-block .go .btn`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('an upload npm refuses leaves a made version, and the card offers to finish it, not to make another', async () => {
  await setNpm({ publish: 'fail' });
  const { page, errors } = await look();
  await page.click(`${card} .where-block .go .btn`);
  await page.waitForSelector('.pop h4:text-is("Publish marble 0.2.2")');
  assert.match(await page.textContent('.pop'), /nothing is changed/);
  await page.click('.pop .foot .btn.primary');
  await page.waitForSelector(`${card} .job-now[data-state="failed"]`);
  const steps = await page.$$eval(`${card} .progress li`, (lis) => lis.map((li) => [li.lastChild.textContent.trim(), li.dataset.state]));
  assert.deepEqual(steps.at(-1), ['Test and upload 0.2.2 to npm', 'failed']);
  assert.ok(steps.slice(0, -1).every(([, s]) => s === 'done'));
  assert.match(await page.textContent(`${card} .job-said`), /0\.2\.2 is committed and pushed, so Finish publishing uploads it/);
  await page.waitForSelector(`${card}[data-state="prepared"]`);
  assert.match(await where(page), /0\.2\.2 has been made, but it never reached npm/);
  assert.match(await page.textContent(`${card} .job-said`), /500 Internal Server Error/, 'npm’s reason, not its code line');
  assert.equal(await go(page), 'Finish publishing 0.2.2');
  assert.equal(await page.$(`${card} .job-now .go`), null, 'one Finish button, not two');
  await shot(page, '4-refused');

  await setNpm({ publish: 'ok' });
  await page.click(`${card} .where-block .go .btn`);
  await page.waitForSelector(`${card}[data-state="current"] .job-now[data-state="done"]`);
  assert.match(await page.textContent(`${card} .job-said`), /0\.2\.2 is on npm/);
  assert.match(await where(page), /npm has everything here: 0\.2\.2 is the latest/);
  assert.equal(git(marble, 'log', '-1', '--format=%s'), 'marble 0.2.2', 'finished, not 0.2.3');
  await shot(page, '5-published');
  assert.deepEqual(errors, []);
  await page.close();
});

test('GitHub moving on is said as changes this copy lacks, with getting them as the one thing to do', async () => {
  const other = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-other-'));
  git(other, 'clone', '-q', git(marble, 'config', '--get', 'remote.origin.url'), 'm');
  const m = path.join(other, 'm');
  await fsp.writeFile(path.join(m, 'NEW'), 'x');
  git(m, 'add', '.');
  git(m, 'commit', '-q', '-m', 'Somebody else’s change');
  git(m, 'push', '-q');
  const { page, errors } = await look({ fetch: true });
  assert.equal(await page.getAttribute(card, 'data-state'), 'behind');
  assert.match(await where(page), /GitHub has 1 change this copy does not have yet/);
  assert.equal(await go(page), 'Get the latest from GitHub');
  await shot(page, '6-behind');
  await page.click(`${card} .where-block .go .btn`);
  await page.waitForSelector(`${card}[data-state="unreleased"] .job-now[data-state="done"]`);
  assert.deepEqual(errors, []);
  await page.close();
});
