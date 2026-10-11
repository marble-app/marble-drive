import assert from 'node:assert/strict';
import test from 'node:test';

import { ALLOW, MARK, plan } from '../tools/agent-permissions.mjs';

// Stand-ins for `claude auto-mode defaults`, so no test reads the real config.
const DEFAULTS = {
  allow: ['Security Discussion: …', 'Transient Retry: …'],
  environment: ['### Org-wide', '**Organization**: None configured'],
};

test('a settings file with none of the rules gets all of them', () => {
  const { newPermissions, newAutoAllow, newEnv, empty } = plan({ settings: {}, defaults: DEFAULTS });
  assert.equal(empty, false);
  assert.deepEqual(newPermissions, ALLOW);
  assert.equal(newAutoAllow.length, 1);
  assert.equal(newEnv.length, 2);
});

test('the rules an agent was actually refused for are in the list', () => {
  for (const rule of ['Bash(grep:*)', 'Bash(sed:*)', 'Bash(awk:*)']) {
    assert.ok(ALLOW.includes(rule), `${rule} missing`);
  }
});

test('existing permission rules are kept, not replaced', () => {
  const settings = { permissions: { allow: ['Bash(lsof -i :9333)'] } };
  const { next } = plan({ settings, defaults: DEFAULTS });
  assert.ok(next.permissions.allow.includes('Bash(lsof -i :9333)'));
  assert.ok(next.permissions.allow.includes('Bash(grep:*)'));
  assert.equal(next.permissions.allow.length, 1 + ALLOW.length);
});

test('an unset autoMode.allow starts from the shipped rules, so none are dropped', () => {
  const { next } = plan({ settings: {}, defaults: DEFAULTS });
  for (const rule of DEFAULTS.allow) assert.ok(next.autoMode.allow.includes(rule), `${rule} dropped`);
  assert.equal(next.autoMode.allow.length, DEFAULTS.allow.length + 1);
});

test("a set autoMode.allow is the person's own list and is added to as it stands", () => {
  const settings = { autoMode: { allow: ['My own rule'] } };
  const { next } = plan({ settings, defaults: DEFAULTS });
  assert.deepEqual(next.autoMode.allow[0], 'My own rule');
  assert.equal(next.autoMode.allow.length, 2);
  assert.ok(!next.autoMode.allow.some((r) => DEFAULTS.allow.includes(r)));
});

test("the person's own environment is kept and added to", () => {
  const settings = { autoMode: { environment: ['**Trusted repo**: bdhmin/phd-portfolio'] } };
  const { next, newEnv } = plan({ settings, defaults: DEFAULTS });
  assert.equal(next.autoMode.environment[0], '**Trusted repo**: bdhmin/phd-portfolio');
  assert.equal(newEnv.length, 2);
  assert.ok(next.autoMode.environment.some((e) => e.includes('marble-drive')));
});

test('running it twice adds nothing the second time', () => {
  const { next: once } = plan({ settings: {}, defaults: DEFAULTS });
  const second = plan({ settings: once, defaults: DEFAULTS });
  assert.equal(second.empty, true);
  assert.deepEqual(second.next.permissions.allow, once.permissions.allow);
  assert.deepEqual(second.next.autoMode.allow, once.autoMode.allow);
  assert.deepEqual(second.next.autoMode.environment, once.autoMode.environment);
});

test('the false-positive rule names the repo and stays scoped to reading it', () => {
  const { newAutoAllow } = plan({ settings: {}, defaults: DEFAULTS, repo: '/somewhere/marble-drive' });
  const rule = newAutoAllow[0];
  assert.ok(rule.startsWith(MARK));
  assert.match(rule, /\/somewhere\/marble-drive/);
  // It must not hand over credential stores themselves.
  assert.match(rule, /still judged on its own terms/);
});

test('it refuses to write autoMode.allow when the shipped rules could not be read', () => {
  assert.throws(() => plan({ settings: {}, defaults: { allow: [] } }), /refusing to replace them/);
  assert.throws(() => plan({ settings: {}, defaults: {} }), /refusing to replace them/);
});
