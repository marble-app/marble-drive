// worker/src/landing.js
// marbledrive.app before the door is on: what Marble Drive is, for someone
// who has never seen it, and the one way in (an invite code at
// join.marbledrive.app, the PC host's sign-up page; docs/HOSTING.md, "Direct
// mode"). One page, no script, no webfont, the drive's own tokens (Design
// System, "Starting an app"), written plainly enough for a scientist who has
// never used an AI agent.

export const JOIN_URL = 'https://join.marbledrive.app';

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marble Drive</title>
<meta name="description" content="Ask for the tool your work needs, and an AI agent builds it as a document in your drive.">
<style>
  /* The drive's tokens (Design System), as plain colours per scheme so any
     browser reads them. */
  :root {
    color-scheme: light dark;
    --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #e6e2d8;
    --paper: #fafaf7; --paper-2: #f3f1ea; --card: #ffffff;
    --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
    --shadow-rest: 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08);
    --r: 12px; --r-pane: 16px; --r-sm: 8px; --pill: 999px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #272c30;
      --paper: #16181a; --paper-2: #1e2124; --card: #1c1f22;
      --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
      --shadow-rest: 0 1px 2px rgba(0,0,0,.40), 0 6px 16px rgba(0,0,0,.28);
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
  .mark { font-weight: 600; margin: 0 0 3.5rem; }
  h1 { font-size: clamp(1.75rem, 5vw, 2.4rem); line-height: 1.15; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 0 0 .75rem; }
  p { margin: 0 0 1rem; }
  .lede { font-size: 1.1rem; color: var(--muted); max-width: 36rem; }
  section { margin-top: 3.5rem; }

  /* The figure: what you ask for, and what you get. */
  figure { margin: 2.5rem 0 0; }
  .ask {
    background: var(--paper-2); border-radius: var(--r-pane);
    padding: .85rem 1.1rem; color: var(--ink);
  }
  .ask small { display: block; color: var(--muted); font-size: 13px; font-weight: 500; margin-bottom: .2rem; }
  .then { display: block; margin: .6rem auto; color: var(--faint); }
  .tool {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--r);
    box-shadow: var(--shadow-rest); padding: 1rem 1.1rem 1.1rem; overflow-x: auto;
  }
  .tool h3 { font-size: 15px; font-weight: 600; margin: 0 0 .15rem; }
  .tool .count { font-size: 13px; color: var(--muted); margin: 0 0 .75rem; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th { font-weight: 500; color: var(--muted); text-align: center; padding: .35rem .4rem; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child { text-align: left; }
  td { padding: .45rem .4rem; border-bottom: 1px solid var(--line); text-align: center; }
  tr:last-child td { border-bottom: 0; }
  .on, .off { display: inline-block; width: 12px; height: 12px; border-radius: 50%; vertical-align: middle; }
  .on { background: var(--accent-ink); }
  .off { border: 1px solid var(--faint); opacity: .55; }
  figcaption { font-size: 14px; color: var(--muted); margin-top: .75rem; }

  ul.plain { list-style: none; padding: 0; margin: 0; }
  ul.plain li { padding: .6rem 0; border-top: 1px solid var(--line); }
  ul.plain li:last-child { border-bottom: 1px solid var(--line); }
  .facts { display: grid; gap: 1.25rem 2rem; grid-template-columns: 1fr; }
  @media (min-width: 40rem) { .facts { grid-template-columns: 1fr 1fr; } }
  .facts h3 { font-size: 16px; font-weight: 600; margin: 0 0 .25rem; }
  .facts p { color: var(--muted); margin: 0; }

  .in { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 1.5rem 1.25rem; }
  .go {
    display: inline-block; margin: .25rem 0 1rem; padding: .7rem 1.2rem; border-radius: var(--pill);
    background: var(--ink); color: var(--paper); font-weight: 500; text-decoration: none;
  }
  .go:hover { opacity: .88; }
  .go:active { opacity: .75; }
  .go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .in p:last-child { margin: 0; color: var(--muted); font-size: 15px; }
  footer { margin-top: 3rem; font-size: 14px; color: var(--muted); }
</style>
</head>
<body>
<main>
  <p class="mark">Marble Drive</p>

  <h1>Make the tools your work needs by asking for them.</h1>
  <p class="lede">Marble Drive keeps your documents, and any document can be an app. Say what you need in plain words. An AI agent builds it in your drive, and you can use it right away.</p>

  <figure>
    <div class="ask"><small>You ask</small>Make a sheet for coding my interview transcripts, with a column for each of my four themes.</div>
    <svg class="then" width="20" height="28" viewBox="0 0 20 28" aria-hidden="true"><path d="M10 2v22M4 18l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="tool" role="img" aria-label="A table titled Interview coding: four transcripts down the side, four themes across the top, and a dot where a theme came up.">
      <h3>Interview coding</h3>
      <p class="count">3 of 12 transcripts coded</p>
      <table aria-hidden="true">
        <thead><tr><th>Transcript</th><th>Trust</th><th>Cost</th><th>Time</th><th>Habit</th></tr></thead>
        <tbody>
          <tr><td>P01</td><td><span class="on"></span></td><td><span class="off"></span></td><td><span class="on"></span></td><td><span class="off"></span></td></tr>
          <tr><td>P02</td><td><span class="off"></span></td><td><span class="on"></span></td><td><span class="on"></span></td><td><span class="on"></span></td></tr>
          <tr><td>P03</td><td><span class="on"></span></td><td><span class="on"></span></td><td><span class="off"></span></td><td><span class="off"></span></td></tr>
          <tr><td>P04</td><td><span class="off"></span></td><td><span class="off"></span></td><td><span class="off"></span></td><td><span class="off"></span></td></tr>
        </tbody>
      </table>
    </div>
    <figcaption>A minute later it's a document in your drive. Click a cell to mark a theme, and it's saved.</figcaption>
  </figure>

  <section>
    <h2>What people make with it</h2>
    <ul class="plain">
      <li>A coding sheet for interview transcripts</li>
      <li>A plate map that marks which wells are done</li>
      <li>A reading list sorted by project</li>
      <li>A lab protocol checklist with a timer for each step</li>
    </ul>
  </section>

  <section>
    <h2>How it works</h2>
    <div class="facts">
      <div><h3>You use your own AI</h3><p>Connect your own Claude or ChatGPT account. The agent works only inside your drive.</p></div>
      <div><h3>Your work is saved in the document</h3><p>What you type, tick or move in a tool stays in that document, so it's there next time.</p></div>
      <div><h3>Change it any time</h3><p>Ask for another column, a chart or a button, and it's added to the document you're using.</p></div>
      <div><h3>It's yours</h3><p>Each document is one file. Share a page with a link, or download your whole drive.</p></div>
    </div>
  </section>

  <section class="in">
    <h2>Have an invite code?</h2>
    <a class="go" href="${JOIN_URL}">Make your drive</a>
    <p>Already made one? Open the link you saved when you made it.</p>
  </section>

  <footer>Marble Drive is a research project at UC San Diego.</footer>
</main>
</body>
</html>
`;

export function landing() {
  return new Response(LANDING_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' },
  });
}
