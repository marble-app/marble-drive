// Direct mode's sign-up page (docs/HOSTING.md, "Direct mode"): join.<suffix>,
// through the host's tunnel. Anyone holding the owner's invite code
// (HOST_INVITE_CODE) picks a name and gets a drive of their own: marble-host
// points <name>.<suffix> at the tunnel, makes the drive, signs its pass, and
// hands back the link that signs them in. Making takes about a minute, longer
// than the edge waits for one answer, so the page asks once and then looks
// for the result with a ticket only it holds.
//
// The code is the only lock. A wrong one counts against the address it came
// from and against everyone, the PC stops at HOST_MAX_DRIVES, and a new code
// (pc-host.mjs code --new) turns the old one off without a restart: the code
// is read from host.env on every try.

import crypto from 'node:crypto';

import { nameProblem } from '../../worker/src/door/names.js';
import { routeDns as defaultRouteDns } from './dns.js';
import { signInLink, signPass } from './passes.js';
import { NAME, RESERVED } from './settings.js';

const HOUR = 60 * 60 * 1000;
const WRONG_PER_ADDRESS = 10;
const WRONG_IN_ALL = 100;

const same = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.length > 0 && b.length > 0 &&
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a.trim().toUpperCase()).digest(), crypto.createHash('sha256').update(b.trim().toUpperCase()).digest());

/** A new invite code: 12 letters and digits a person can read out, in threes. */
export function newInviteCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => letters[b % letters.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

export function createJoin({ settings, readCode, registry, maker, routeDns = defaultRouteDns, log = console, now = () => Date.now() }) {
  const suffix = settings.publicSuffix;
  const origin = `https://join.${suffix}`;
  const jobs = new Map();
  const wrong = new Map();
  let wrongInAll = [];

  const recent = (list) => list.filter((t) => now() - t < HOUR);
  const tooMany = (who) => recent(wrong.get(who) ?? []).length >= WRONG_PER_ADDRESS || recent(wrongInAll).length >= WRONG_IN_ALL;
  const countWrong = (who) => {
    wrong.set(who, [...recent(wrong.get(who) ?? []), now()]);
    wrongInAll = [...recent(wrongInAll), now()];
  };
  const making = () => [...jobs.values()].filter((j) => j.state === 'making').length;
  const held = () => registry.drives().filter((d) => d.state !== 'removed').length;

  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function readBody(req, limit = 4096) {
    return new Promise((resolve, reject) => {
      let text = '';
      req.setEncoding('utf8');
      req.on('data', (c) => {
        text += c;
        if (text.length > limit) reject(new Error('too long'));
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(text || '{}'));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  async function make(job) {
    const host = `${job.name}.${suffix}`;
    try {
      const dns = await routeDns(host);
      if (!dns.ok) throw new Error(`dns: ${dns.said || 'cloudflared failed'}`);
      const r = await maker.make({ name: job.name, owner: `direct-${job.name}`, cohort: settings.inviteCohort ?? null });
      if (!r.ok) throw new Error(`${r.why}${r.step ? ` (at ${r.step})` : ''}`);
      const { pass } = signPass({ signingKey: settings.signingKey, name: job.name, account: r.drive.owner });
      Object.assign(job, { state: 'ready', link: signInLink({ name: job.name, suffix, pass }) });
      log.log?.(`[join] made ${job.name}`);
    } catch (err) {
      Object.assign(job, { state: 'failed' });
      log.error?.(`[join] ${job.name}: ${err.message}`);
    }
  }

  async function start(req, res) {
    if (req.headers.origin !== origin) return json(res, 403, { error: 'Open this page at its own address and try again.' });
    const who = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '');
    if (tooMany(who)) return json(res, 429, { error: 'Too many wrong codes. Try again in an hour.' });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: 'That didn’t come through. Try again.' });
    }
    const code = readCode();
    if (!code) return json(res, 403, { error: 'Sign-up is closed right now.' });
    if (!same(String(body.code ?? ''), code)) {
      countWrong(who);
      return json(res, 403, { error: 'That invite code isn’t right. Check it with the person who sent it.', field: 'code' });
    }
    const name = String(body.name ?? '').trim().toLowerCase();
    const problem = nameProblem(name) ?? (!NAME.test(name) || RESERVED.has(name) ? 'That name can’t be used.' : null);
    if (problem) return json(res, 400, { error: problem, field: 'name' });
    if (registry.drive(name) || [...jobs.values()].some((j) => j.name === name && j.state !== 'failed')) {
      return json(res, 409, { error: `${name} is taken. Pick another name.`, field: 'name' });
    }
    if (held() + making() >= settings.maxDrives) return json(res, 503, { error: 'This study is full right now. Tell the person who invited you.' });
    const ticket = crypto.randomBytes(24).toString('hex');
    const job = { name, state: 'making', at: now() };
    jobs.set(ticket, job);
    for (const [t, j] of jobs) if (now() - j.at > 2 * HOUR) jobs.delete(t);
    make(job);
    return json(res, 202, { ticket, name, address: `${name}.${suffix}` });
  }

  function look(res, ticket) {
    const job = jobs.get(ticket);
    if (!job) return json(res, 404, { error: 'That sign-up has run out. Start again.' });
    if (job.state === 'failed') return json(res, 200, { state: 'failed', error: 'Your drive couldn’t be made. Tell the person who invited you.' });
    return json(res, 200, job.state === 'ready' ? { state: 'ready', link: job.link } : { state: 'making' });
  }

  async function handle(req, res) {
    const route = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && route === '/') return page(res);
    if (req.method === 'POST' && route === '/join') return start(req, res);
    const ticket = /^\/join\/([0-9a-f]{48})$/.exec(route);
    if (req.method === 'GET' && ticket) return look(res, ticket[1]);
    req.resume();
    return json(res, 404, { error: 'not found' });
  }

  function page(res) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    res.end(PAGE(suffix));
  }

  return { handle, origin, host: `join.${suffix}` };
}

const PAGE = (suffix) => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Make your Marble Drive</title>
<style>
:root{color-scheme:light dark;--paper:#fafaf7;--ink:#111111;--muted:#5a5a5a;--line:#ddd9cf;--accent:#738698;--bad:#a8453a}
@media (prefers-color-scheme: dark){:root{--paper:#161616;--ink:#ededed;--muted:#a3a3a3;--line:#3a3833;--accent:#8fa3b5;--bad:#e08a7e}}
*{box-sizing:border-box}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper);color:var(--ink)}
main{width:100%;max-width:24rem}
h1{font-size:1.35rem;font-weight:600;margin:0 0 .4rem}
p{color:var(--muted);margin:0 0 1rem}
label{display:block;font-weight:500;margin:1rem 0 .3rem}
input{width:100%;font:inherit;padding:.6rem .75rem;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
.hint{font-size:13px;margin:.35rem 0 0}
button,a.go{display:inline-block;margin-top:1.25rem;font:inherit;font-weight:500;padding:.6rem 1rem;border:0;border-radius:8px;background:var(--accent);color:#fafaf7;cursor:pointer;text-decoration:none}
button[disabled]{opacity:.6;cursor:default}
.err{color:var(--bad);margin:.75rem 0 0;min-height:1.5em}
.link{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;padding:.6rem .75rem;border:1px solid var(--line);border-radius:8px;margin:0 0 .5rem;user-select:all}
[hidden]{display:none}
</style>
<main>
<form id="f" novalidate>
<h1>Make your Marble Drive</h1>
<p>Enter the invite code you were given and pick a name. The name is your drive's address, so it's public.</p>
<label for="code">Invite code</label>
<input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
<label for="name">Drive name</label>
<input id="name" name="name" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="30">
<p class="hint">Lowercase letters, digits and hyphens. Your drive will be at <b id="addr">name</b>.${suffix}</p>
<button id="b">Make my drive</button>
<p class="err" id="e" role="alert"></p>
</form>
<section id="wait" hidden>
<h1>Making your drive</h1>
<p>This takes about a minute. Keep this page open.</p>
</section>
<section id="done" hidden>
<h1>Your drive is ready</h1>
<p>This link is how you get back in, on this or any other device, for 90 days. Save it somewhere only you can see, and don't share it.</p>
<div class="link" id="l"></div>
<a class="go" id="g" href="#">Open my drive</a>
</section>
</main>
<script>
const $=(id)=>document.getElementById(id);
const f=$('f'),b=$('b'),e=$('e');
$('name').addEventListener('input',()=>{const v=$('name').value.toLowerCase();$('name').value=v;$('addr').textContent=v||'name'});
const show=(id)=>{for(const s of ['f','wait','done'])$(s).hidden=s!==id};
const fail=(msg,field)=>{show('f');b.disabled=false;e.textContent=msg;if(field)$(field).focus()};
function poll(t){fetch('/join/'+t,{cache:'no-store'}).then((r)=>r.json()).then((j)=>{if(j.state==='ready'){$('l').textContent=j.link;$('g').href=j.link;show('done')}else if(j.state==='making')setTimeout(()=>poll(t),3000);else fail(j.error||'Something went wrong. Try again.')},()=>setTimeout(()=>poll(t),5000))}
f.addEventListener('submit',(ev)=>{ev.preventDefault();e.textContent='';b.disabled=true;fetch('/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:$('code').value,name:$('name').value})}).then((r)=>r.json().then((j)=>[r.status,j])).then(([s,j])=>{if(s===202){show('wait');poll(j.ticket)}else fail(j.error||'Something went wrong. Try again.',j.field)},()=>fail('The PC didn\\'t answer. Try again in a minute.'))});
</script>
</html>
`;
