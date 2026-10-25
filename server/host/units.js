// How marble-host starts and stops a drive's service: the one place it talks
// to systemd.
//
// `system` (the PC, after linux/pc-host/install.sh): marble-guest@<name>.service
// is the installed system template, and the owner's user may start, stop and
// restart its instances through the polkit rule beside it
// (linux/pc-host/50-marble-host.rules), never with sudo.
//
// `user` (a machine without that sudo step, and the trial): the same service
// as a transient unit of the owner's own systemd --user, with every wall a
// user manager can put up. It cannot be its own Linux user (DynamicUser needs
// the system manager), and a user manager silently ignores the IP rules, so it
// runs as the owner with the owner's home hidden, and the network walls exist
// only in `system` mode. Its folder is <guestStateDir>/<name>, made here
// because StateDirectory= would put it in the owner's home.
//
// Anything else (a test) passes its own object with the same five calls.

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { NAME } from './settings.js';

export const unitOf = (name) => {
  if (!NAME.test(name ?? '')) throw new Error(`"${name}" is not a drive's name`);
  return `marble-guest@${name}.service`;
};

/** Runs a command and resolves with its exit code and output; never throws. */
export function commandRunner({ timeoutMs = 90_000 } = {}) {
  return (command, args, { env = process.env } = {}) =>
    new Promise((resolve) => {
      execFile(command, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 127) : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });
}

const SHOW = ['ActiveState', 'SubState', 'MainPID', 'MemoryCurrent', 'MemoryMax', 'NRestarts', 'InvocationID'];

/** `systemctl show`'s KEY=value lines, as the state marble-host uses. */
export function parseShow(text) {
  const p = {};
  for (const line of String(text).split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) p[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  const bytes = (v) => (/^\d+$/.test(v ?? '') ? Number(v) : null);
  return {
    active: p.ActiveState || 'unknown',
    sub: p.SubState || null,
    pid: Number(p.MainPID) || null,
    memoryBytes: bytes(p.MemoryCurrent),
    memoryMax: bytes(p.MemoryMax),
    restarts: Number(p.NRestarts) || 0,
    invocation: p.InvocationID || null,
  };
}

/** The walls a user manager can put up, for a drive run as a transient unit
 *  (`user` mode). Each was tried under systemd 259 --user (docs/HOSTING.md,
 *  "Other people's drives on the PC"). */
export function userProperties({ name, opt, guestEnvDir, guestStateDir }) {
  const state = path.join(guestStateDir, name);
  const props = [
    `EnvironmentFile=${path.join(guestEnvDir, `${name}.env`)}`,
    'Restart=always',
    'RestartSec=5',
    'KillMode=mixed',
    'TimeoutStopSec=25',
    'UMask=0077',
    'LimitNOFILE=65536',
    'PrivateUsers=yes',
    'PrivatePIDs=yes',
    'PrivateTmp=yes',
    'PrivateDevices=yes',
    'ProtectSystem=strict',
    'ProtectHome=yes',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectControlGroups=yes',
    'ProtectHostname=yes',
    'NoNewPrivileges=yes',
    'RestrictSUIDSGID=yes',
    'LockPersonality=yes',
    'RestrictRealtime=yes',
    'SystemCallArchitectures=native',
    'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK',
    // Missing paths are fine: a folder under /tmp is already out of sight
    // behind PrivateTmp.
    `InaccessiblePaths=-/mnt -/run/WSL -/run/tailscale -/run/docker.sock -${guestEnvDir}`,
    // The drive's folder, wherever the trial keeps it, writable through the
    // walls (and visible behind PrivateTmp when it lives under /tmp).
    `BindPaths=${state}`,
    // Written as on the PC, and ignored by a user manager: the network walls
    // need `system` mode. 127.0.0.1 and ::1 are where this machine's own
    // services listen; the drive listens on an address of its own.
    'IPAddressDeny=127.0.0.1/32 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10',
    'IPAddressAllow=100.100.100.100 fd7a:115c:a1e0::53',
    'MemoryHigh=1G',
    'MemoryMax=1536M',
    'TasksMax=512',
  ];
  // The release and Chromium are where every guest expects them, /opt/marble,
  // even when they are really somewhere else: an empty /opt with them bound in.
  if (path.resolve(opt) !== '/opt/marble') props.push('TemporaryFileSystem=/opt', `BindReadOnlyPaths=${opt}:/opt/marble`);
  return props;
}

export function createUnits({ mode = 'system', run = commandRunner(), opt = '/opt/marble', guestEnvDir = '/etc/marble-guests', guestStateDir = '/var/lib/marble-guests', slice = 'marble-guests.slice', parentSlice = 'marble.slice', log = console } = {}) {
  const must = async (what, promise) => {
    const r = await promise;
    if (r.code !== 0) {
      const said = `${r.stderr}${r.stdout}`.trim().split('\n').slice(-2).join(' ').slice(0, 300);
      throw new Error(`${what} failed (exit ${r.code})${said ? `: ${said}` : ''}`);
    }
    return r;
  };

  if (mode === 'system') {
    // --no-ask-password: a refused call fails at once rather than waiting for
    // a password nobody is there to type.
    const sc = (...args) => run('systemctl', ['--no-ask-password', ...args]);
    return {
      mode,
      start: async (name) => void (await must(`systemctl start ${unitOf(name)}`, sc('start', unitOf(name)))),
      stop: async (name) => void (await must(`systemctl stop ${unitOf(name)}`, sc('stop', unitOf(name)))),
      restart: async (name) => void (await must(`systemctl restart ${unitOf(name)}`, sc('restart', unitOf(name)))),
      show: async (name) => parseShow((await sc('show', unitOf(name), `--property=${SHOW.join(',')}`)).stdout),
    };
  }

  if (mode === 'user') {
    const sc = (...args) => run('systemctl', ['--user', ...args]);
    let sliced = false;
    async function launch(name) {
      const state = path.join(guestStateDir, name);
      await fsp.mkdir(state, { recursive: true, mode: 0o700 });
      if (!sliced) {
        // All of them together, as marble-guests.slice is on the PC, and
        // their CPU weight on marble.slice, the level beside app.slice where
        // the owner's own drive runs (a weight counts only against siblings).
        const r = await sc('set-property', '--runtime', slice, 'MemoryHigh=5G', 'MemoryMax=6G', 'TasksMax=4096');
        if (r.code !== 0) log.error?.(`[host] could not cap ${slice}: ${r.stderr.trim()}`);
        const w = await sc('set-property', '--runtime', parentSlice, 'CPUWeight=50');
        if (w.code !== 0) log.error?.(`[host] could not weigh ${parentSlice}: ${w.stderr.trim()}`);
        sliced = true;
      }
      const props = userProperties({ name, opt, guestEnvDir, guestStateDir }).flatMap((p) => ['-p', p]);
      // systemd-run looks for the program outside the walls, where
      // /opt/marble may not exist, so bash is what it starts.
      await must(
        `systemd-run --user --unit=${unitOf(name)}`,
        run('systemd-run', ['--user', '--quiet', '--collect', `--unit=${unitOf(name)}`, `--slice=${slice}`, ...props, '-E', `STATE_DIRECTORY=${state}`, '/bin/bash', '/opt/marble/bin/run-guest', name]),
      );
    }
    const show = async (name) => parseShow((await sc('show', unitOf(name), `--property=${SHOW.join(',')}`)).stdout);
    return {
      mode,
      async start(name) {
        const s = await show(name);
        if (['active', 'activating', 'reloading'].includes(s.active)) return;
        await sc('reset-failed', unitOf(name));
        await launch(name);
      },
      // A transient unit is gone once it stops, so a restart is a new one,
      // with the settings file read again.
      async stop(name) {
        await sc('stop', unitOf(name));
        await sc('reset-failed', unitOf(name));
      },
      async restart(name) {
        await sc('stop', unitOf(name));
        await sc('reset-failed', unitOf(name));
        await launch(name);
      },
      show,
    };
  }

  throw new Error(`HOST_MODE is system or user, not "${mode}"`);
}
