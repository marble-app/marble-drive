// worker/src/door/pages.js
// The pages at marbledrive.app: sign in, an invite, not invited, name your
// drive, making your drive, your account, and the page for anything that went
// wrong (docs/superpowers/specs/2026-10-10-accounts-and-sign-in-design.md,
// "The screens"; the drive page Notes and Sketches/Drive and Sharing/Accounts
// and sign-in has the sketches).
//
// One HTML file each, no webfont, nothing linked in. The tokens are the Design
// System's own (its "Starting an app" block), cut to what these pages use:
// paper behind, one card on a narrow column, the sans at 14/1.5, the dusty
// blue as the one accent, the filled ink pill spent at most once a page, and
// both schemes. The only colour that is not ours is in the provider buttons,
// which carry Google's and GitHub's own marks unaltered, as their rules ask.
//
// Every value that came from a person or a URL goes through esc(). The two
// small scripts read what they need from attributes, never from interpolated
// script.

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
:root {
  color-scheme: light dark;
  --ink: light-dark(#111111, #e8e6e1);
  --muted: light-dark(#5a5a5a, #a3a7ab);
  --faint: light-dark(#8a8a8a, #71767a);
  --placeholder: light-dark(#767676, #8d9296);
  --line: light-dark(#e6e2d8, #272c30);
  --paper: light-dark(#fafaf7, #16181a);
  --paper-2: light-dark(#f3f1ea, #1e2124);
  --paper-3: light-dark(#eceae1, #262a2e);
  --well: light-dark(#efece3, #101214);
  --card: light-dark(#ffffff, #1c1f22);
  --accent: light-dark(#9bb6cf, #7fa8c9);
  --accent-soft: light-dark(#f1f5f8, #1d2932);
  --accent-ink: light-dark(#738698, #9dc0dc);
  --danger: light-dark(#b4533e, #e08a74);
  --shadow: 0 1px 2px light-dark(rgba(74,66,52,.05), rgba(0,0,0,.28)), 0 2px 4px light-dark(rgba(74,66,52,.03), rgba(0,0,0,.18));
  --r: 12px;
  --r-sm: 8px;
  --pill: 999px;
  --ease: cubic-bezier(.22, .61, .36, 1);
  --t-fast: 110ms;
  --t: 200ms;
  --ui: "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
/* Width is asked of the root, not the window. */
html { container: doc / inline-size; background: var(--paper); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.5 var(--ui); -webkit-font-smoothing: antialiased; }
button, input { font: inherit; color: inherit; }
/* A link is ink with an accent underline: the accent's own ink is under
   4.5:1 on paper, and a link is text someone has to read. */
a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }

/* One column on the paper, the card aligned to its left edge. */
.col { max-width: 24rem; margin: 0 auto; padding: 14vh 1.25rem 3rem; }
.mark { display: flex; align-items: center; gap: .5rem; margin: 0 0 .9rem; font-weight: 500; font-size: 13px; color: var(--muted); }
.mark img { width: 20px; height: 20px; flex: none; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 1.4rem 1.25rem 1.3rem; box-shadow: var(--shadow); }
h1 { margin: 0 0 .35rem; font-size: 1.15rem; font-weight: 500; letter-spacing: -.015em; line-height: 1.3; text-wrap: balance; }
/* A title with no line under it stands a little clear of what follows. */
h1:not(:has(+ .lede)) { margin-bottom: 1rem; }
p { margin: 0 0 1rem; text-wrap: pretty; }
.lede { color: var(--muted); }
.small { margin: 1rem 0 0; font-size: 13px; color: var(--muted); }
.stack { display: flex; flex-direction: column; gap: .5rem; }
.foot { display: flex; gap: 1rem; margin: 1rem .1rem 0; font-size: 13px; color: var(--muted); }
.foot a { color: var(--muted); }
.addr { font-weight: 500; overflow-wrap: anywhere; }

/* Buttons. An outline for a choice between equals; the filled ink pill for a
   page's one action. A press answers on the way down, in colour; nothing
   scales and nothing lifts. */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: .55rem; min-height: 2.75rem; padding: .45rem .95rem;
  border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--card); color: var(--ink); font-weight: 500;
  text-decoration: none; cursor: pointer; transition: background-color var(--t) var(--ease); }
.btn:hover { background: var(--paper-3); }
.btn:active { background: var(--well); transition-duration: var(--t-fast); }
.btn svg { width: 18px; height: 18px; flex: none; }
.btn.one { border-color: var(--ink); background: var(--ink); color: var(--paper); border-radius: var(--pill); }
.btn.one:hover { background: color-mix(in srgb, var(--ink) 86%, var(--paper)); }
.btn.one:active { background: color-mix(in srgb, var(--ink) 76%, var(--paper)); }
.btn.one[aria-disabled="true"] { opacity: .45; cursor: default; pointer-events: none; }
.link { appearance: none; border: 0; background: none; padding: 0; color: var(--ink); text-decoration: underline;
  text-decoration-color: var(--accent); text-underline-offset: 2px; cursor: pointer; min-height: 1.5rem; }
.link.danger { color: var(--danger); text-decoration-color: currentColor; }
/* Keyboard focus: one 2px ring of the accent, everywhere a key can land. */
.btn:focus-visible, .link:focus-visible, a:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--accent-ink); border-radius: var(--r-sm); }
.btn.one:focus-visible { border-radius: var(--pill); }
form { margin: 0; }

/* A field: 1px of line, a ring at the caret, the address's end inside it. */
.label { display: block; margin: 0 0 .3rem; font-size: 13px; font-weight: 600; color: var(--muted); }
.field { display: flex; align-items: center; min-height: 2.75rem; padding: 0 .75rem; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--card); }
.field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft); }
.field input { flex: 1; min-width: 0; border: 0; padding: .45rem 0; background: none; outline: none; }
.field input::placeholder { color: var(--placeholder); }
.field .suffix { color: var(--muted); white-space: nowrap; }
.said { display: flex; align-items: center; gap: .45rem; min-height: 1.5rem; margin: .4rem 0 1rem; font-size: 13px; color: var(--muted); }
.said::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--line); }
.said[data-ok="yes"]::before { background: var(--accent-ink); }
.said[data-ok="no"] { color: var(--danger); }
.said[data-ok="no"]::before { background: var(--danger); }
.said:empty::before { display: none; }

/* The steps while a drive is made: done, now, waiting, each a row with a
   drawn state. Only the working row is in ink, and only it moves. */
.steps { margin: 0 0 1rem; padding: 0; list-style: none; }
.steps li { display: flex; align-items: center; gap: .65rem; padding: .5rem 0; border-top: 1px solid var(--line); color: var(--muted); }
.steps li:first-child { border-top: 0; padding-top: .1rem; }
.steps svg { flex: none; width: 16px; height: 16px; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.steps .i { display: none; }
.steps [data-state="done"] .i-done, .steps [data-state="now"] .i-now, .steps [data-state="wait"] .i-wait, .steps [data-state="failed"] .i-failed { display: block; }
.steps .i-done { stroke: var(--accent-ink); }
.steps [data-state="now"] { color: var(--ink); font-weight: 500; }
.steps .i-now { stroke: var(--ink); animation: turn 1.1s linear infinite; }
.steps .i-wait { stroke: var(--muted); }
.steps [data-state="failed"] { color: var(--danger); font-weight: 500; }
.steps .i-failed { stroke: var(--danger); }
@keyframes turn { to { transform: rotate(1turn); } }

/* The account page: a list of facts, the control beside each. */
.acct { margin: 0; padding: 0; list-style: none; }
.acct > li { padding: .65rem 0; border-top: 1px solid var(--line); }
.acct > li:first-child { border-top: 0; padding-top: 0; }
.acct .ak { display: block; margin-bottom: .15rem; font-size: 13px; font-weight: 600; color: var(--muted); }
.acct .row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .15rem .75rem; }
.acct .row > span { min-width: 0; overflow-wrap: anywhere; }
.acct .acts { display: flex; gap: 1rem; flex-wrap: wrap; }

.prose h2 { margin: 1.2rem 0 .3rem; font-size: .95rem; font-weight: 600; }
.prose ul { margin: 0 0 1rem; padding-left: 1.1rem; }

@container doc (width < 460px) {
  .col { padding: 2.25rem 1rem 2rem; }
  .card { padding: 1.2rem 1rem 1.1rem; }
}
/* A finger is not a mouse. */
@media (pointer: coarse) {
  .link { min-height: 2.75rem; }
}
@media (prefers-reduced-motion: reduce) {
  .btn { transition: none; }
  .steps .i-now { animation: none; }
}
`;

// Google's "G" and GitHub's mark, as each provider publishes them.
const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const GITHUB = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

// The Drive's own mark (server/favicon.js, flattened): the tab's icon, and
// the one beside the name at the top of each page.
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7.5' fill='%23738698'/%3E%3Ccircle cx='16' cy='16' r='9' fill='%23f4f6f8'/%3E%3Cpath d='M6 20C10 14 16 20 24 12' fill='none' stroke='%23738698' stroke-opacity='.5' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E";

export const APEX_HOST = 'marbledrive.app';

export function page({ title, body, script = '', status = 200, headers = {} }) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="icon" href="${ICON}">
<style>${STYLE}</style>
</head>
<body>
<main class="col">
<p class="mark"><img src="${ICON}" alt="" width="20" height="20"><span>Marble Drive</span></p>
${body}
</main>${script ? `\n<script>${script}</script>` : ''}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'self' https://*.marbledrive.app; frame-ancestors 'none'; base-uri 'none'",
      ...headers,
    },
  });
}

const foot = '<p class="foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></p>';

/** The two ways in, as links that start the round trip. */
function providerButtons(providers, { invite = null, to = null } = {}) {
  const q = new URLSearchParams();
  if (invite) q.set('invite', invite);
  if (to) q.set('to', to);
  const query = q.toString() ? `?${q}` : '';
  const buttons = [];
  if (providers.google) buttons.push(`<a class="btn" href="/auth/google/start${esc(query)}">${GOOGLE}<span>Continue with Google</span></a>`);
  if (providers.github) buttons.push(`<a class="btn" href="/auth/github/start${esc(query)}">${GITHUB}<span>Continue with GitHub</span></a>`);
  if (!buttons.length) return '<p class="lede">Signing in isn’t set up yet.</p>';
  return `<div class="stack">${buttons.join('')}</div>`;
}

export function signIn({ providers, to = null, drive = null }) {
  const lede = drive
    ? `Sign in to open <span class="addr">${esc(drive)}.${APEX_HOST}</span>.`
    : 'Documents that are apps, in a drive of your own.';
  return page({
    title: 'Sign in · Marble Drive',
    body: `<section class="card">
<h1>Sign in</h1>
<p class="lede">${lede}</p>
${providerButtons(providers, { to })}
<p class="small">New here? You need an invite link from Bryan.</p>
</section>
${foot}`,
  });
}

const DEAD = {
  spent: 'This invite has been used.',
  expired: 'This invite has expired.',
  unknown: 'This invite link doesn’t work. Check it was copied whole.',
};

export function join({ providers, invite, why = null, drive = null }) {
  if (why) {
    return page({
      title: 'Invite · Marble Drive',
      status: why === 'unknown' ? 404 : 410,
      body: `<section class="card">
<h1>${esc(DEAD[why] ?? DEAD.unknown)}</h1>
<p class="lede">Ask Bryan for a new link, or sign in and ask for access.</p>
${providerButtons(providers)}
</section>
${foot}`,
    });
  }
  const lede = drive
    ? `Sign in to take over <span class="addr">${esc(drive)}.${APEX_HOST}</span>. It stays as it is; from now on you open it by signing in.`
    : 'Sign in to make your drive. You’ll choose its name next.';
  return page({
    title: 'Bryan invited you · Marble Drive',
    body: `<section class="card">
<h1>Bryan invited you</h1>
<p class="lede">${lede}</p>
${providerButtons(providers, { invite })}
</section>
${foot}`,
  });
}

export function notInvited({ name = '', email = '', asked = false }) {
  if (asked) {
    return page({
      title: 'Asked · Marble Drive',
      body: `<section class="card">
<h1>Asked</h1>
<p class="lede">Bryan will tell you when there’s room.</p>
<p class="small"><a href="/">Sign in with another account</a></p>
</section>
${foot}`,
    });
  }
  const who = [name, email].filter(Boolean).map(esc).join(', ');
  return page({
    title: 'Open by invitation · Marble Drive',
    body: `<section class="card">
<h1>Marble Drive is open by invitation for now</h1>
<p class="lede">If Bryan sent you an invite link, open it. Otherwise ask for access; Bryan gets your name and email address${who ? ` (${who})` : ''}.</p>
<form method="post" action="/ask"><button class="btn one" type="submit">Ask for access</button></form>
<p class="small"><a href="/">Sign in with another account</a></p>
</section>
${foot}`,
  });
}

export function nameDrive({ value = '', said = '', ok = null, status = 200 }) {
  const state = ok === true ? 'yes' : ok === false ? 'no' : '';
  return page({
    title: 'Name your drive · Marble Drive',
    status,
    body: `<section class="card">
<h1>Name your drive</h1>
<form method="post" action="/name" class="name">
<label class="label" for="name">Address</label>
<div class="field"><input id="name" name="name" value="${esc(value)}" required minlength="3" maxlength="30" pattern="[a-z0-9-]{3,30}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="said" placeholder="yourname" autofocus><span class="suffix">.${APEX_HOST}</span></div>
<p class="said" id="said" role="status" aria-live="polite"${state ? ` data-ok="${state}"` : ''}>${esc(said)}</p>
<button class="btn one" type="submit">Make my drive</button>
</form>
<p class="small">Names are public. Bryan runs Marble Drive and can reach the machine your drive runs on. Nobody else can open it unless you share a page.</p>
</section>`,
    script: NAME_SCRIPT,
  });
}

// As it is typed: the rules here at once, then whether the name is free.
const NAME_SCRIPT = `(() => {
  const input = document.getElementById('name');
  const said = document.getElementById('said');
  let timer = null, asked = 0;
  const show = (text, ok) => { said.textContent = text; if (ok === null) said.removeAttribute('data-ok'); else said.dataset.ok = ok ? 'yes' : 'no'; };
  const local = (n) => {
    if (n.length < 3) return n ? 'A name is at least 3 characters.' : '';
    if (n.length > 30) return 'A name is at most 30 characters.';
    if (!/^[a-z0-9-]+$/.test(n)) return 'Use only lowercase letters, digits and hyphens.';
    if (n.startsWith('-') || n.endsWith('-')) return 'A name can\\u2019t start or end with a hyphen.';
    if (n.includes('--')) return 'A name can\\u2019t have two hyphens in a row.';
    return null;
  };
  input.addEventListener('input', () => {
    const n = input.value.trim();
    clearTimeout(timer);
    const why = local(n);
    if (why !== null) { show(why, why ? false : null); return; }
    show('Checking\\u2026', null);
    const mine = ++asked;
    timer = setTimeout(() => {
      fetch('/name/check?n=' + encodeURIComponent(n), { headers: { accept: 'application/json' } })
        .then((r) => r.json())
        .then((j) => { if (mine === asked) show(j.said, j.ok); })
        .catch(() => { if (mine === asked) show('', null); });
    }, 250);
  });
})();`;

const STEP_WORDS = { machine: 'Making its machine', install: 'Installing Marble Drive', check: 'Checking it answers' };
const ICONS =
  '<svg class="i i-done" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>' +
  '<svg class="i i-now" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5"/></svg>' +
  '<svg class="i i-wait" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2"/></svg>' +
  '<svg class="i i-failed" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

/** Each step's state for the page: done, now, wait or failed. Between two
 *  reports, the first step not yet done is the one working. */
export function stepStates(drive) {
  const order = Object.keys(STEP_WORDS);
  const out = {};
  for (const step of order) {
    const s = drive.state === 'ready' ? 'done' : drive.steps?.[step];
    out[step] = s === 'done' || s === 'failed' || s === 'now' ? s : 'wait';
  }
  if ((drive.state === 'queued' || drive.state === 'making') && !order.some((step) => out[step] === 'now')) {
    const next = order.find((step) => out[step] === 'wait');
    if (next) out[next] = 'now';
  }
  return out;
}

export function making({ drive }) {
  const states = stepStates(drive);
  const rows = Object.entries(STEP_WORDS)
    .map(([step, words]) => `<li data-step="${step}" data-state="${states[step]}">${ICONS}<span>${words}</span></li>`)
    .join('\n');
  const ready = drive.state === 'ready';
  const failed = drive.state === 'failed';
  const address = `${esc(drive.name)}.${APEX_HOST}`;
  const enter = `/enter?drive=${encodeURIComponent(drive.name)}&to=%2F`;
  const lede = failed
    ? `Making it stopped at “${esc(STEP_WORDS[drive.failed] ?? 'a step')}”. Bryan sees this in his list of drives and will finish it; you don’t need to do anything.`
    : ready
      ? `Your drive is at <span class="addr">${address}</span>.`
      : `This takes a few minutes. You can close this tab: your drive will be at <span class="addr">${address}</span>.`;
  return page({
    title: ready ? 'Your drive is ready · Marble Drive' : 'Making your drive · Marble Drive',
    body: `<section class="card making" data-src="/making/${esc(drive.name)}.json">
<h1>${ready ? 'Your drive is ready' : failed ? 'Your drive isn’t finished' : 'Making your drive'}</h1>
<ul class="steps">
${rows}
</ul>
<p class="lede" id="lede">${lede}</p>
${failed ? '' : `<a class="btn one" id="open" ${ready ? `href="${esc(enter)}"` : 'aria-disabled="true" role="link"'}>Open my drive</a>`}
</section>`,
    script: ready || failed ? '' : MAKING_SCRIPT,
  });
}

// Asks how far it has got every few seconds, and stops when it is done.
const MAKING_SCRIPT = `(() => {
  const card = document.querySelector('.making');
  const open = document.getElementById('open');
  const tick = () => fetch(card.dataset.src, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return setTimeout(tick, 5000);
      for (const li of card.querySelectorAll('[data-step]')) li.dataset.state = j.steps[li.dataset.step] || 'wait';
      if (j.state === 'ready' || j.state === 'failed') return location.reload();
      setTimeout(tick, 3000);
    })
    .catch(() => setTimeout(tick, 5000));
  setTimeout(tick, 3000);
  open.addEventListener('click', (e) => { if (open.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
})();`;

const PROVIDER_NAMES = { google: 'Google', github: 'GitHub' };

export function account({ account, drives = [] }) {
  const driveRows = drives.length
    ? drives
        .map((d) => {
          const address = `${esc(d.name)}.${APEX_HOST}`;
          const action =
            d.state === 'ready'
              ? `<a href="/enter?drive=${encodeURIComponent(d.name)}&amp;to=%2F">Open</a>`
              : d.state === 'held'
                ? '<span>On hold</span>'
                : `<a href="/making/${encodeURIComponent(d.name)}">${d.state === 'failed' ? 'Not finished' : 'Being made'}</a>`;
          return `<span class="row"><span class="addr">${address}</span>${action}</span>`;
        })
        .join('')
    : '<span class="row"><span>None yet</span><a href="/name">Name your drive</a></span>';
  const methods = (account.methods ?? []).map((m) => `${esc(PROVIDER_NAMES[m.provider] ?? m.provider)}, ${esc(m.email)}`).join('<br>');
  return page({
    title: 'Your account · Marble Drive',
    body: `<section class="card">
<h1>Your account</h1>
<ul class="acct">
<li><span class="ak">${drives.length > 1 ? 'Your drives' : 'Your drive'}</span>${driveRows}</li>
<li><span class="ak">Signed in with</span><span class="row"><span>${methods || esc(account.email)}</span></span></li>
<li><span class="ak">This browser</span><span class="row"><span class="acts"><form method="post" action="/signout"><button class="link" type="submit">Sign out</button></form><form method="post" action="/signout/everywhere"><button class="link" type="submit">Sign out everywhere</button></form></span></span></li>
</ul>
</section>
${foot}`,
  });
}

/** Anything that went wrong: what happened, and what to do next. */
export function problem({ title, text, status = 400, action = { href: '/', label: 'Back to sign in' }, headers = {} }) {
  return page({
    title: `${title} · Marble Drive`,
    status,
    headers,
    body: `<section class="card">
<h1>${esc(title)}</h1>
<p class="lede">${esc(text)}</p>
${action ? `<a class="btn" href="${esc(action.href)}">${esc(action.label)}</a>` : ''}
</section>`,
  });
}

/** A drive that isn't the signed-in person's: said without saying whose. */
export function notYours({ email }) {
  return page({
    title: 'That drive isn’t yours · Marble Drive',
    status: 403,
    body: `<section class="card">
<h1>That drive isn’t yours</h1>
<p class="lede">You’re signed in as ${esc(email)}. If it’s yours under another account, sign out and sign in with that one. If someone shared a page with you, open the link they sent.</p>
<form method="post" action="/signout"><button class="btn" type="submit">Sign out</button></form>
</section>`,
  });
}

export function privacy() {
  return page({
    title: 'Privacy · Marble Drive',
    body: `<section class="card prose">
<h1>Privacy</h1>
<p class="lede">Marble Drive is run by Bryan Min. This is what it keeps about you, and why.</p>
<h2>What is kept</h2>
<ul>
<li>Your name and email address, and the Google or GitHub account you sign in with, so you can sign in again.</li>
<li>When you sign in, from which address and browser, kept for 180 days, so you and Bryan can see what happened on your account.</li>
<li>Your drive’s name, which is public, like a username.</li>
</ul>
<h2>What isn’t</h2>
<p>Your password for Google or GitHub never reaches Marble Drive. Nothing is sold or shown to advertisers.</p>
<h2>Your drive</h2>
<p>Your drive runs on its own machine that Bryan pays for and can reach. Nobody else can open it unless you share a page.</p>
<h2>Leaving</h2>
<p>Ask Bryan to delete your account and your drive, and he will.</p>
</section>
${foot}`,
  });
}

export function terms() {
  return page({
    title: 'Terms · Marble Drive',
    body: `<section class="card prose">
<h1>Terms</h1>
<p class="lede">Marble Drive is a small service run by Bryan Min for people he invites.</p>
<ul>
<li>Your drive and what you make in it are yours.</li>
<li>Don’t use it to mine cryptocurrency, scrape sites at scale, send bulk mail, or harm anyone. Bryan may put a drive on hold if it does, and will tell you why.</li>
<li>Agents in your drive run on your own Anthropic or OpenAI account, under that company’s terms.</li>
<li>It comes with no warranty. Keep copies of anything you can’t lose.</li>
</ul>
</section>
${foot}`,
  });
}
