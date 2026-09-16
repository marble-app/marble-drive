// From your own devices.
//
// The host listens on loopback and Tailscale Serve is the way in: it holds an
// HTTPS certificate for this machine's tailnet name and forwards to the port.
// Only devices signed in to the tailnet can reach that name, so the gate is the
// second lock on the door rather than the only one — which matters more once an
// agent runs on this machine at the request of whoever got through it.
//
// Funnel, the public version of the same thing, is deliberately not here.
//
// Serve's config lives in tailscaled, not in this process: it survives a
// restart of the host and a reboot of the machine, and it names a port. That is
// why `serveOn` refuses a host that has not said which port it is on.

import { spawn } from 'node:child_process';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Every reason this host should not be put on the tailnet yet. Empty means go. */
export function preflight(config) {
  const problems = [];
  if (!config.secret) {
    problems.push('MARBLE_DRIVE_SECRET is unset — an open host on the tailnet is every device in it editing everything.');
  }
  if (!config.portIsExplicit) {
    problems.push(
      `PORT is not set — without it the host steps to the next free port, and Serve would keep pointing at ${config.port} after something else took it.`,
    );
  }
  if (!LOOPBACK.has(config.host)) {
    problems.push(`HOST is ${config.host} — listen on 127.0.0.1 so Serve is the only way in, not a second one beside the LAN.`);
  }
  return problems;
}

/** Runs `tailscale <args>` and hands back what it said.
 *
 *  `tailscale serve --bg` on a tailnet where Serve is not enabled prints the
 *  page that enables it and then waits for somebody to visit it. Waiting is
 *  right at a terminal and wrong here, so the moment that page is printed the
 *  process is stopped and the page is the answer. */
export function runTailscale(args, { timeout = 20_000, bin = 'tailscale' } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output });
    };
    const hear = (chunk) => {
      output += chunk;
      if (enablePage(output)) {
        child.kill();
        finish(1);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(124);
    }, timeout);
    child.stdout.on('data', hear);
    child.stderr.on('data', hear);
    child.on('error', (err) => {
      output += err.code === 'ENOENT' ? `no "${bin}" on PATH — install Tailscale` : err.message;
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

const enablePage = (output) =>
  /Serve is not enabled/.test(output) ? output.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0] ?? null : null;

/** Put this host on the tailnet, or say why not. */
export async function serveOn({ config, run = runTailscale }) {
  const problems = preflight(config);
  if (problems.length) return { ok: false, problems };

  const served = await run(['serve', '--bg', `http://127.0.0.1:${config.port}`]);
  const enable = enablePage(served.output);
  if (enable) return { ok: false, enable };
  if (served.code !== 0) return { ok: false, error: served.output.trim() || `tailscale exited ${served.code}` };

  return { ok: true, url: await tailnetUrl(run) };
}

// This address only. `serve reset` would also take down anything else this
// machine serves, which is not this host's to decide.
export const serveOff = ({ run = runTailscale } = {}) => run(['serve', '--https=443', 'off']);

export const serveStatus = ({ run = runTailscale } = {}) => run(['serve', 'status']);

/** This machine's HTTPS address on the tailnet. */
export async function tailnetUrl(run = runTailscale) {
  const status = await run(['status', '--json']);
  const name = JSON.parse(status.output).Self.DNSName.replace(/\.$/, '');
  return `https://${name}/`;
}

/** What a device on the tailnet sees, asked from here. Each check is one thing
 *  a person would otherwise find out by trying it on the laptop. */
export async function check({ url, secret, timeout = 5_000 }) {
  const at = (route) => new URL(route, url).href;
  const bearer = { Authorization: `Bearer ${secret}` };
  // Each check returns true or throws what it saw instead.
  const attempt = async (name, fn) => {
    try {
      await fn();
      return { name, ok: true, detail: '' };
    } catch (err) {
      return { name, ok: false, detail: err.cause?.code ?? err.message };
    }
  };
  const fail = (detail) => {
    throw new Error(detail);
  };
  const within = () => AbortSignal.timeout(timeout);

  const checks = [
    await attempt('health', async () => {
      const res = await fetch(at('health'), { signal: within() });
      return res.ok || fail(`status ${res.status}`);
    }),
    await attempt('closed without the secret', async () => {
      const res = await fetch(at('/'), { headers: { Accept: 'text/html' }, redirect: 'manual', signal: within() });
      return (res.status === 302 && res.headers.get('location')?.startsWith('/gate')) ||
        fail(`status ${res.status} — the drive answered without the secret`);
    }),
    await attempt('open with the secret', async () => {
      const res = await fetch(at('docs'), { headers: bearer, signal: within() });
      return res.ok || fail(`status ${res.status}`);
    }),
    // The one a proxy can break silently: a stream it buffers is a page that
    // never hears an edit, and nothing anywhere says so.
    await attempt('live stream arrives', async () => {
      const res = await fetch(at('events?drive=1&client=remote-check'), {
        headers: { ...bearer, Accept: 'text/event-stream' },
        signal: within(),
      });
      if (!res.ok) fail(`status ${res.status}`);
      const reader = res.body.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      return new TextDecoder().decode(value).includes(': connected') || fail('no first frame — is the proxy buffering?');
    }),
  ];

  // Only meaningful over https, where it is the proof that the proxy says
  // X-Forwarded-Proto and the gate believes it. Without it the laptop signs in
  // with a cookie that would also travel over plain http.
  if (new URL(url).protocol === 'https:') {
    checks.push(
      await attempt('cookie is Secure', async () => {
        const res = await fetch(at('gate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret }),
          signal: within(),
        });
        if (!res.ok) fail(`status ${res.status}`);
        return /;\s*Secure/i.test(res.headers.get('set-cookie') ?? '') || fail('no Secure flag — is X-Forwarded-Proto reaching the host?');
      }),
    );
  }
  return checks;
}
