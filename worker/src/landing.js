// worker/src/landing.js
// marbledrive.app before the door is on: what Marble Drive is, for someone
// who has never seen it, and the one way in (an invite code at
// join.marbledrive.app, the PC host's sign-up page; docs/HOSTING.md, "Direct
// mode"). One page, no script, no webfont, the drive's own tokens (Design
// System, "Starting an app"), in the voice of a product page someone would
// actually write: plain, second person, concrete. The picture in the hero is
// drawn in HTML so it follows the scheme and never goes blurry.

export const JOIN_URL = 'https://join.marbledrive.app';

const DOC = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h5.5L12.25 4.5v9.75H4z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M9.25 1.75V4.75h3" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>';
const SEND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const dot = (on) => `<i class="${on ? 'on' : 'off'}"></i>`;
const row = (who, marks) => `<tr><td>${who}</td>${marks.map((m) => `<td>${dot(m)}</td>`).join('')}</tr>`;

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marble Drive: describe the tool you need, then use it</title>
<meta name="description" content="Marble Drive turns a plain-English request into a working tool that lives in your own drive. No code, no setup. Bring your own Claude or ChatGPT account.">
<style>
  /* The drive's tokens (Design System), as plain colours per scheme so any
     browser reads them. */
  :root {
    color-scheme: light dark;
    --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #e6e2d8;
    --paper: #fafaf7; --paper-2: #f3f1ea; --paper-3: #eceae1; --card: #ffffff;
    --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
    --shadow-rest: 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08);
    --shadow-lift: 0 2px 6px rgba(74,66,52,.07), 0 24px 48px rgba(74,66,52,.10);
    --r: 12px; --r-pane: 16px; --r-sm: 8px; --pill: 999px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #272c30;
      --paper: #16181a; --paper-2: #1e2124; --paper-3: #262a2e; --card: #1c1f22;
      --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
      --shadow-rest: 0 1px 2px rgba(0,0,0,.40), 0 6px 16px rgba(0,0,0,.28);
      --shadow-lift: 0 2px 6px rgba(0,0,0,.32), 0 24px 48px rgba(0,0,0,.36);
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  a { color: inherit; }
  .wrap { max-width: 68rem; margin: 0 auto; padding: 0 1.5rem; }
  h1, h2, h3 { margin: 0; font-weight: 600; }
  p { margin: 0; }

  /* Bar */
  header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--paper) 86%, transparent); backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); border-bottom: 1px solid transparent; }
  @media (prefers-reduced-transparency: reduce) { header { background: var(--paper); backdrop-filter: none; -webkit-backdrop-filter: none; } }
  header .wrap { display: flex; align-items: center; gap: 1.75rem; height: 3.75rem; }
  .brand { font-weight: 600; text-decoration: none; margin-right: auto; display: flex; align-items: center; gap: .55rem; }
  .brand i { width: 18px; height: 18px; border-radius: 50%; background: var(--ink); display: inline-block; box-shadow: inset -4px -3px 0 var(--accent-ink); }
  nav a { text-decoration: none; color: var(--muted); font-size: 15px; }
  nav a:hover { color: var(--ink); }
  nav { display: flex; gap: 1.5rem; }
  .btn { display: inline-block; text-decoration: none; font-weight: 500; border-radius: var(--pill); padding: .7rem 1.25rem; transition: opacity .12s; }
  .btn:active { opacity: .75; }
  .btn:focus-visible, nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .solid { background: var(--ink); color: var(--paper); }
  .solid:hover { opacity: .88; }
  .quiet { border: 1px solid var(--line); background: var(--card); color: var(--ink); }
  .quiet:hover { border-color: var(--faint); }
  .small { padding: .45rem .95rem; font-size: 15px; }

  /* Hero */
  .hero { padding: 5rem 0 3rem; text-align: center; }
  .hero h1 { font-size: clamp(2.2rem, 6vw, 3.6rem); line-height: 1.06; letter-spacing: -0.025em; max-width: 22ch; margin: 0 auto; text-wrap: balance; }
  .hero .sub { font-size: clamp(1.05rem, 2.2vw, 1.25rem); color: var(--muted); max-width: 38rem; margin: 1.4rem auto 0; }
  .ctas { display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap; margin-top: 2rem; }
  .note { font-size: 14px; color: var(--faint); margin-top: 1rem; }

  /* The picture: a drive with a tool open and a request in the bar. */
  .shot { margin: 3.5rem auto 0; max-width: 60rem; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-pane); box-shadow: var(--shadow-lift); overflow: hidden; text-align: left; }
  .chrome { display: flex; align-items: center; justify-content: center; height: 2.4rem; border-bottom: 1px solid var(--line); background: var(--paper-2); font-size: 13px; color: var(--muted); }
  .chrome span { background: var(--card); border: 1px solid var(--line); border-radius: var(--pill); padding: .1rem .9rem; }
  .app { display: grid; grid-template-columns: 13.5rem 1fr; min-height: 22rem; }
  .side { background: var(--paper); border-right: 1px solid var(--line); padding: 1rem .75rem; font-size: 14px; }
  .side b { display: block; font-size: 13px; font-weight: 600; color: var(--muted); padding: 0 .5rem .5rem; }
  .side div { display: flex; align-items: center; gap: .5rem; padding: .4rem .5rem; border-radius: var(--r-sm); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .side div.here { background: var(--accent-soft); color: var(--ink); font-weight: 500; }
  .side svg { width: 16px; height: 16px; flex: none; }
  .main { padding: 1.5rem 1.75rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  .main h3 { font-size: 18px; }
  .chips { display: flex; gap: .5rem; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .chips span { border: 1px solid var(--line); border-radius: var(--pill); padding: .15rem .65rem; }
  .chips em { font-style: normal; color: var(--ink); font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th { font-weight: 500; color: var(--muted); text-align: center; padding: .4rem; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child { text-align: left; }
  td { padding: .5rem .4rem; border-bottom: 1px solid var(--line); text-align: center; }
  tr:last-child td { border-bottom: 0; }
  i.on, i.off { display: inline-block; width: 12px; height: 12px; border-radius: 50%; vertical-align: middle; }
  i.on { background: var(--accent-ink); }
  i.off { border: 1px solid var(--faint); opacity: .55; }
  .ask { margin-top: auto; display: flex; align-items: center; gap: .75rem; background: var(--paper-2); border-radius: var(--r-pane); padding: .7rem .7rem .7rem 1.1rem; font-size: 15px; }
  .ask span { flex: 1; }
  .ask i { width: 30px; height: 30px; border-radius: 50%; background: var(--ink); color: var(--paper); display: grid; place-items: center; flex: none; }
  .ask svg { width: 15px; height: 15px; }

  /* Sections */
  section { padding: 5.5rem 0 0; }
  .head { max-width: 40rem; margin: 0 auto 2.75rem; text-align: center; }
  .head h2 { font-size: clamp(1.7rem, 4vw, 2.4rem); line-height: 1.12; letter-spacing: -0.02em; }
  .head p { color: var(--muted); font-size: 1.1rem; margin-top: .9rem; }

  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; counter-reset: step; }
  .steps div { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 1.5rem; }
  .steps div::before { counter-increment: step; content: counter(step); display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background: var(--paper-3); font-weight: 600; font-size: 15px; margin-bottom: 1rem; }
  .steps h3 { font-size: 18px; margin-bottom: .45rem; }
  .steps p { color: var(--muted); }
  .steps q { display: block; margin-top: .9rem; padding: .7rem .9rem; background: var(--paper-2); border-radius: var(--r-sm); color: var(--ink); font-size: 15px; quotes: "\\201C" "\\201D"; }

  .uses { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  .uses div { border-top: 1px solid var(--line); padding-top: 1.1rem; }
  .uses h3 { font-size: 17px; margin-bottom: .35rem; }
  .uses p { color: var(--muted); }

  .why { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2.5rem 3.5rem; max-width: 56rem; margin: 0 auto; }
  .why h3 { font-size: 18px; margin-bottom: .4rem; }
  .why p { color: var(--muted); }

  .faq { max-width: 44rem; margin: 0 auto; }
  details { border-bottom: 1px solid var(--line); }
  details:first-of-type { border-top: 1px solid var(--line); }
  summary { cursor: pointer; list-style: none; padding: 1.15rem 2rem 1.15rem 0; font-weight: 500; font-size: 17px; position: relative; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: ""; position: absolute; right: .35rem; top: 50%; width: 8px; height: 8px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: translateY(-70%) rotate(45deg); transition: transform .15s; }
  details[open] summary::after { transform: translateY(-30%) rotate(-135deg); }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  details p { color: var(--muted); padding: 0 0 1.2rem; max-width: 38rem; }

  .end { margin: 6rem auto 0; max-width: 56rem; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-pane); padding: 3.5rem 1.5rem; text-align: center; }
  .end h2 { font-size: clamp(1.6rem, 4vw, 2.2rem); letter-spacing: -0.02em; }
  .end p { color: var(--muted); margin-top: .75rem; font-size: 1.05rem; }
  .end .btn { margin-top: 1.75rem; }
  .end small { display: block; margin-top: 1.1rem; color: var(--faint); font-size: 14px; }

  footer { margin-top: 4rem; border-top: 1px solid var(--line); }
  footer .wrap { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding-top: 1.5rem; padding-bottom: 2.5rem; font-size: 14px; color: var(--muted); }

  @media (max-width: 760px) {
    nav { display: none; }
    .hero { padding-top: 3.25rem; }
    .app { grid-template-columns: 1fr; min-height: 0; }
    .side { display: none; }
    .main { padding: 1.1rem 1rem 1rem; }
    .steps, .uses, .why { grid-template-columns: 1fr; }
    .why { gap: 1.75rem; }
    section { padding-top: 4rem; }
  }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <a class="brand" href="/"><i></i>Marble Drive</a>
    <nav><a href="#how">How it works</a><a href="#uses">Examples</a><a href="#faq">FAQ</a></nav>
    <a class="btn quiet small" href="${JOIN_URL}">Sign up</a>
  </div>
</header>

<main>
  <div class="wrap hero">
    <h1>Describe the tool you need.<br> Use it a minute later.</h1>
    <p class="sub">Marble Drive turns a plain-English request into a working app that lives in your own drive. A tracker, a coding sheet, a lab checklist: if you can explain it, you can have it. No code, no setup, no waiting on a developer.</p>
    <div class="ctas">
      <a class="btn solid" href="${JOIN_URL}">Make your drive</a>
      <a class="btn quiet" href="#how">See how it works</a>
    </div>
    <p class="note">Invite only for now. You'll need an invite code and your own Claude or ChatGPT account.</p>

    <div class="shot" role="img" aria-label="Marble Drive open in a browser: a list of documents on the left, an Interview coding sheet open in the middle with themes marked for each transcript, and a request typed into the bar at the bottom asking for totals and a column for Habit.">
      <div class="chrome" aria-hidden="true"><span>ana.marbledrive.app</span></div>
      <div class="app" aria-hidden="true">
        <div class="side">
          <b>Your drive</b>
          <div class="here">${DOC}Interview coding</div>
          <div>${DOC}Reading list</div>
          <div>${DOC}Plate map, run 14</div>
          <div>${DOC}Lab notebook</div>
          <div>${DOC}Conference trip</div>
        </div>
        <div class="main">
          <h3>Interview coding</h3>
          <div class="chips"><span><em>9</em> of 12 coded</span><span>Trust <em>6</em></span><span>Cost <em>4</em></span><span>Time <em>7</em></span></div>
          <table>
            <thead><tr><th>Transcript</th><th>Trust</th><th>Cost</th><th>Time</th></tr></thead>
            <tbody>
              ${row('P01, nurse', [1, 0, 1])}
              ${row('P02, pharmacist', [0, 1, 1])}
              ${row('P03, nurse', [1, 1, 0])}
              ${row('P04, physician', [1, 0, 1])}
            </tbody>
          </table>
          <div class="ask"><span>Add a column for Habit, and show totals by role.</span><i>${SEND}</i></div>
        </div>
      </div>
    </div>
  </div>

  <section id="how">
    <div class="wrap">
      <div class="head">
        <h2>How it works</h2>
        <p>If you can explain what you want to a colleague, you can build it.</p>
      </div>
      <div class="steps">
        <div>
          <h3>Say what you need</h3>
          <p>Type it the way you'd say it out loud. You don't need to know what a database is.</p>
          <q>A sheet for coding my interviews, with a column for each theme.</q>
        </div>
        <div>
          <h3>It gets built in your drive</h3>
          <p>An AI agent makes it as a document, right there in your drive. Most things take about a minute.</p>
        </div>
        <div>
          <h3>Use it, and keep shaping it</h3>
          <p>Everything you type, tick or drag is saved. Want a chart, a filter or another column? Ask for it.</p>
          <q>Sort these by how many themes they hit.</q>
        </div>
      </div>
    </div>
  </section>

  <section id="uses">
    <div class="wrap">
      <div class="head">
        <h2>For the work that doesn't fit an app</h2>
        <p>Most of what people actually do ends up in a spreadsheet that almost works. Make the thing you really wanted instead.</p>
      </div>
      <div class="uses">
        <div><h3>Coding interviews</h3><p>Mark themes across transcripts and watch the counts add up as you go.</p></div>
        <div><h3>Running experiments</h3><p>Plate maps, sample logs and protocol checklists laid out the way your lab works.</p></div>
        <div><h3>Keeping up with papers</h3><p>A reading list sorted by project, with your notes sitting next to each paper.</p></div>
        <div><h3>Teaching</h3><p>A rubric that totals itself, an attendance sheet, a practice quiz for your section.</p></div>
        <div><h3>Planning</h3><p>Trips, budgets and schedules, without forcing them into rows and columns.</p></div>
        <div><h3>Anything else</h3><p>If you've ever thought "someone should make an app for this," now you can.</p></div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="head">
        <h2>Your tools, your drive</h2>
      </div>
      <div class="why">
        <div><h3>Every tool is a document</h3><p>Each one is a single file in your drive. Open it, rename it, share it with a link, or download it whenever you like.</p></div>
        <div><h3>Bring your own AI</h3><p>Connect the Claude or ChatGPT account you already have. You sign in on their site, and Marble Drive never sees your password.</p></div>
        <div><h3>Nothing gets lost</h3><p>What you enter is saved in the document itself, not somewhere you can't see. Close the tab and it's all there next time.</p></div>
        <div><h3>Change your mind</h3><p>Ask for a change, try it out, and undo it if it's not what you wanted.</p></div>
      </div>
    </div>
  </section>

  <section id="faq">
    <div class="wrap">
      <div class="head"><h2>Questions</h2></div>
      <div class="faq">
        <details><summary>Do I need to know how to code?</summary><p>No. You describe what you want in everyday language, and the agent does the building. If something isn't right, you tell it what to change.</p></details>
        <details><summary>Which AI does it use?</summary><p>Yours. Marble Drive works with Claude and ChatGPT. You connect your own account once, and the agent runs on your plan.</p></details>
        <details><summary>How much does it cost?</summary><p>Marble Drive itself is free while it's a research preview. The AI side runs on your own Claude or ChatGPT subscription, so a paid plan from one of them is the only cost.</p></details>
        <details><summary>Who can see my documents?</summary><p>Just you, unless you share a page with a link. If you joined as part of a research study, your consent form explains exactly what the research team can see.</p></details>
        <details><summary>Can I take my work with me?</summary><p>Yes. Every document is an ordinary file, and you can download your whole drive at any time.</p></details>
        <details><summary>How do I get in?</summary><p>Marble Drive is invite only for now. If someone gave you an invite code, you can make your drive in about a minute.</p></details>
      </div>
    </div>
  </section>

  <div class="wrap">
    <div class="end">
      <h2>Got an invite code?</h2>
      <p>Pick a name for your drive and you're in.</p>
      <a class="btn solid" href="${JOIN_URL}">Make your drive</a>
      <small>Already have one? Open the sign-in link you saved when you made it.</small>
    </div>
  </div>
</main>

<footer>
  <div class="wrap">
    <span>Marble Drive</span>
    <span>A research project at UC San Diego</span>
  </div>
</footer>
</body>
</html>
`;

export function landing() {
  return new Response(LANDING_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' },
  });
}
