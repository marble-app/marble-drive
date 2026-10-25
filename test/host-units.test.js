// How marble-host talks to systemd (server/host/units.js), with systemctl and
// systemd-run stood in for: the system template through polkit in `system`
// mode, a transient unit of the owner's own systemd in `user` mode.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { createUnits, parseShow, unitOf, userProperties } from '../server/host/units.js';
import { tempDirs, quiet } from './fixtures/host.js';

const temp = tempDirs();
after(temp.cleanup);

/** A command runner that records each call and answers from `answers`. */
function fakeRun(answers = {}) {
  const calls = [];
  const run = async (command, args) => {
    const line = [command, ...args].join(' ');
    calls.push(line);
    for (const [match, answer] of Object.entries(answers)) {
      if (line.includes(match)) return { code: 0, stdout: '', stderr: '', ...(typeof answer === 'function' ? answer(line) : answer) };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const SHOW = 'ActiveState=active\nSubState=running\nMainPID=4242\nMemoryCurrent=134217728\nMemoryMax=1610612736\nNRestarts=2\nInvocationID=abc\n';

test('a unit is marble-guest@<name>.service, and only for a drive\'s name', () => {
  assert.equal(unitOf('ana'), 'marble-guest@ana.service');
  for (const bad of ['Ana', 'a', '../x', 'a b', 'ana;rm']) assert.throws(() => unitOf(bad), /not a drive's name/);
});

test('systemctl show, as the state marble-host uses', () => {
  assert.deepEqual(parseShow(SHOW), { active: 'active', sub: 'running', pid: 4242, memoryBytes: 134217728, memoryMax: 1610612736, restarts: 2, invocation: 'abc' });
  const none = parseShow('ActiveState=inactive\nMainPID=0\nMemoryCurrent=[not set]\nMemoryMax=infinity\n');
  assert.equal(none.active, 'inactive');
  assert.equal(none.pid, null);
  assert.equal(none.memoryBytes, null);
  assert.equal(none.memoryMax, null);
});

test('system mode: the installed template, started and stopped through polkit, never asking for a password', async () => {
  const f = fakeRun({ 'show marble-guest@ana.service': { stdout: SHOW } });
  const units = createUnits({ mode: 'system', run: f.run, log: quiet });
  await units.start('ana');
  await units.restart('ana');
  await units.stop('ana');
  assert.equal((await units.show('ana')).pid, 4242);
  assert.deepEqual(f.calls.slice(0, 3), [
    'systemctl --no-ask-password start marble-guest@ana.service',
    'systemctl --no-ask-password restart marble-guest@ana.service',
    'systemctl --no-ask-password stop marble-guest@ana.service',
  ]);
  assert.match(f.calls[3], /^systemctl --no-ask-password show marble-guest@ana\.service --property=ActiveState,/);
  assert.ok(!f.calls.some((c) => /enable/.test(c)), 'never enabled');
});

test('system mode: a refusal is an error naming the unit and what systemctl said', async () => {
  const f = fakeRun({ start: { code: 1, stderr: 'Failed to start marble-guest@ana.service: Access denied\n' } });
  const units = createUnits({ mode: 'system', run: f.run, log: quiet });
  await assert.rejects(units.start('ana'), /systemctl start marble-guest@ana\.service failed \(exit 1\): Failed to start .*Access denied/);
  await assert.rejects(units.start('../x'), /not a drive's name/);
});

test('user mode: a transient unit in marble-guests.slice, its walls, its settings file, and bash running run-guest', async () => {
  const root = await temp.make('units-');
  const opt = path.join(root, 'opt');
  const guestEnvDir = path.join(root, 'etc');
  const guestStateDir = path.join(root, 'guests');
  let state = 'inactive';
  const f = fakeRun({ show: () => ({ stdout: `ActiveState=${state}\n` }), 'systemd-run': () => { state = 'active'; return {}; } });
  const units = createUnits({ mode: 'user', run: f.run, opt, guestEnvDir, guestStateDir, log: quiet });
  await units.start('ana');
  const launch = f.calls.find((c) => c.startsWith('systemd-run'));
  assert.ok(launch, f.calls.join('\n'));
  assert.match(launch, /^systemd-run --user --quiet --collect --unit=marble-guest@ana\.service --slice=marble-guests\.slice /);
  assert.ok(launch.includes(`-p EnvironmentFile=${path.join(guestEnvDir, 'ana.env')}`));
  assert.ok(launch.includes(`-E STATE_DIRECTORY=${path.join(guestStateDir, 'ana')}`));
  assert.ok(launch.endsWith('/bin/bash /opt/marble/bin/run-guest ana'), 'systemd-run checks the program outside the walls, so bash is it');
  for (const wall of ['PrivateUsers=yes', 'PrivatePIDs=yes', 'PrivateTmp=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'NoNewPrivileges=yes', 'MemoryMax=1536M', 'TasksMax=512', 'KillMode=mixed']) {
    assert.ok(launch.includes(`-p ${wall}`), wall);
  }
  assert.ok(launch.includes(`-p InaccessiblePaths=-/mnt -/run/WSL -/run/tailscale -/run/docker.sock -${guestEnvDir}`));
  assert.ok(!/RestrictNamespaces/.test(launch), 'Chromium and Claude Code make namespaces of their own');
  assert.ok(f.calls.some((c) => c.startsWith('systemctl --user set-property --runtime marble-guests.slice MemoryHigh=5G MemoryMax=6G')));
  assert.ok(f.calls.includes('systemctl --user set-property --runtime marble.slice CPUWeight=50'), 'the weight on the level beside the owner\'s drive');
  assert.equal((await fsp.stat(path.join(guestStateDir, 'ana'))).mode & 0o777, 0o700, 'its folder is made, its own');

  // Already running: started again, nothing happens.
  f.calls.length = 0;
  await units.start('ana');
  assert.ok(!f.calls.some((c) => c.startsWith('systemd-run')));

  // A restart is a new transient unit, so the settings file is read again.
  f.calls.length = 0;
  await units.restart('ana');
  assert.deepEqual(f.calls.slice(0, 2), ['systemctl --user stop marble-guest@ana.service', 'systemctl --user reset-failed marble-guest@ana.service']);
  assert.ok(f.calls[2].startsWith('systemd-run --user'));
});

test('user mode: the release is at /opt/marble inside the walls, wherever it really is', () => {
  const moved = userProperties({ name: 'ana', opt: '/var/tmp/trial/opt', guestEnvDir: '/var/tmp/trial/etc', guestStateDir: '/var/tmp/trial/guests' });
  assert.ok(moved.includes('TemporaryFileSystem=/opt'));
  assert.ok(moved.includes('BindReadOnlyPaths=/var/tmp/trial/opt:/opt/marble'));
  assert.ok(moved.includes('BindPaths=/var/tmp/trial/guests/ana'));
  const real = userProperties({ name: 'ana', opt: '/opt/marble', guestEnvDir: '/etc/marble-guests', guestStateDir: '/var/lib/marble-guests' });
  assert.ok(!real.some((p) => p.startsWith('TemporaryFileSystem=')));
  assert.ok(real.includes('IPAddressAllow=100.100.100.100 fd7a:115c:a1e0::53'));
});

test('user mode: a failed systemd-run is an error', async () => {
  const root = await temp.make('units-');
  const f = fakeRun({ show: { stdout: 'ActiveState=inactive\n' }, 'systemd-run': { code: 1, stderr: 'Unit marble-guest@ana.service already exists.' } });
  const units = createUnits({ mode: 'user', run: f.run, opt: path.join(root, 'opt'), guestEnvDir: path.join(root, 'etc'), guestStateDir: path.join(root, 'guests'), log: quiet });
  await assert.rejects(units.start('ana'), /systemd-run --user --unit=marble-guest@ana\.service failed \(exit 1\): Unit marble-guest@ana\.service already exists/);
  assert.throws(() => createUnits({ mode: 'root' }), /HOST_MODE is system or user/);
});
