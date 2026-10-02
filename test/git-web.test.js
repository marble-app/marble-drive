// A remote's page on GitHub, which is what the Publish popover links to.
import assert from 'node:assert/strict';
import test from 'node:test';

import { githubWeb } from '../server/git.js';

test('a GitHub remote, in each spelling, is its page on GitHub', () => {
  assert.equal(githubWeb('https://github.com/bdhmin/phd-portfolio.git'), 'https://github.com/bdhmin/phd-portfolio');
  assert.equal(githubWeb('https://github.com/bdhmin/phd-portfolio'), 'https://github.com/bdhmin/phd-portfolio');
  assert.equal(githubWeb('git@github.com:bdhmin/phd-portfolio.git'), 'https://github.com/bdhmin/phd-portfolio');
  assert.equal(githubWeb('ssh://git@github.com/bdhmin/phd-portfolio.git'), 'https://github.com/bdhmin/phd-portfolio');
});

test('credentials in a remote never come back, and other hosts are not GitHub', () => {
  assert.equal(githubWeb('https://user:ghp_secret@github.com/o/r.git'), 'https://github.com/o/r');
  assert.equal(githubWeb('https://gitlab.com/o/r.git'), null);
  assert.equal(githubWeb('/tmp/remote.git'), null);
  assert.equal(githubWeb(''), null);
  assert.equal(githubWeb(null), null);
});
