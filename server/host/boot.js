// What marble-host does when it starts, after the PC itself has: no drive's
// service is ever enabled, so this is what brings them back. Every drive the
// registry says is running and whose service is not is started; one already
// up (marble-host restarted on its own) is left as it is. A drive whose
// making was cut off by marble-host stopping is marked failed, so the owner
// can try it again (`restart`) or remove it; it is never half-made and
// running.
//
// A running drive whose settings file has gone (install.sh --uninstall takes
// /etc/marble-guests with it) is given a new one from the registry, with a
// new passphrase nobody is shown, before it is started. A settings file
// written before each drive had a loopback address of its own names none,
// and run-guest refuses it: it is given its address, which the drive takes
// up the next time it starts.

import { guestAddress } from './addresses.js';
import { guestEntries, newSecret as makeSecret } from './guest-env.js';

const UP = new Set(['active', 'activating', 'reloading']);

export async function bootDrives({ registry, units, envs, settings, notify = async () => {}, log = console, newSecret = makeSecret }) {
  const result = { started: [], already: [], failed: [], interrupted: [] };
  for (const d of registry.drives()) {
    if (d.state !== 'removed' && d.state !== 'making') {
      try {
        const env = await envs.read(d.name);
        if (env && env.HOST !== guestAddress(d.port)) {
          await envs.update(d.name, { HOST: guestAddress(d.port) });
          log.log?.(`[host] ${d.name}'s settings file had no address of its own; it is ${guestAddress(d.port)} from its next start`);
        }
      } catch (err) {
        log.error?.(`[host] could not give ${d.name} its address: ${err.message}`);
      }
    }
    if (d.state === 'making') {
      await registry.update((r) => {
        Object.assign(r.drives[d.name], { state: 'failed', failed: { step: 'machine', why: 'marble-host stopped while it was being made' } });
      });
      await registry.event(d.name, 'failed', { step: 'machine', why: 'marble-host stopped while it was being made' });
      result.interrupted.push(d.name);
      continue;
    }
    if (d.state !== 'running') continue;
    try {
      const s = await units.show(d.name).catch(() => null);
      if (UP.has(s?.active)) {
        result.already.push(d.name);
        continue;
      }
      if (!(await envs.read(d.name))) {
        await envs.write(d.name, guestEntries({ name: d.name, release: d.release, port: d.port, secret: newSecret(), doorKeys: settings.guestDoorKeys ?? settings.doorKeys, owner: d.owner, publicSuffix: settings.publicSuffix, ownerName: settings.ownerName, cohort: d.cohort, direct: settings.direct }));
        log.log?.(`[host] ${d.name} had no settings file; wrote it again`);
      }
      await units.start(d.name);
      await registry.event(d.name, 'started', { by: 'boot' });
      result.started.push(d.name);
    } catch (err) {
      result.failed.push(d.name);
      log.error?.(`[host] could not start ${d.name}: ${err.message}`);
      await notify(d.name, 'boot', `${d.name} could not be started when marble-host started: ${err.message}`);
    }
  }
  const said = [
    result.started.length ? `started ${result.started.join(', ')}` : null,
    result.already.length ? `${result.already.join(', ')} already running` : null,
    result.failed.length ? `could not start ${result.failed.join(', ')}` : null,
    result.interrupted.length ? `${result.interrupted.join(', ')} interrupted while being made` : null,
  ].filter(Boolean);
  log.log?.(`[host] boot: ${said.length ? said.join('; ') : 'no drives to start'}`);
  return result;
}
