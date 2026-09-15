# Feed sources & queries

The feed has three buckets. For each daily run, work the queries below with
`WebSearch` / `WebFetch`, then filter and rank (see SKILL.md step 5). Tune this
file freely — it is the knob. `state/tuning.json` (`boost` / `mute` topic lists,
maintained from 👍/👎) rides on top of it: push `boost` terms into the queries,
drop anything matching a `mute` term.

Anchor everything to the research vision in
`drive/Research/research-vision.mrbl` — the four theses:
1. GenUI is a different design problem (design the space, not the screen)
2. UI envisioning — imagination is the bottleneck
3. Personal User Experiences — personal by construction
4. Continuous elicitation — elicitation rides along with use

Aim for **3–6 items per bucket**, each genuinely from the last ~1–2 weeks (or
newly noticed). Prefer primary sources (arXiv abs page, ACM DL, project site).

---

## Bucket 1 — GenUI · malleable software · building with AI

Queries (rotate, don't run all every day):

- `arxiv.org/list/cs.HC/recent` — scan titles/abstracts for: generative UI,
  LLM-generated interface, malleable / tailorable / end-user software, adaptive
  UI, preference elicitation, feedforward, UI optimization
- "generative UI" OR "generative interface" LLM  2026
- "malleable software" OR "end-user programming" OR "tailorable interface"  new
- "AI app builder" OR "prompt to app" OR "generative interface" research
- site:arxiv.org "user interface" "large language model" personalization
- UIST 2026 / CHI 2026 / DIS 2026 accepted papers — generative or adaptive UI
- Follow-ups to systems the user tracks: Webstrates, Varv, Wildcard, Stylette,
  Malleable Software (Litt), SUPPLE / ARNAULD, Jelly, Maru, Meridian, DynaVis,
  Bespoke, BISCUIT, Graphologue, PromptInfuser, "Generative Interfaces for LMs",
  Gulf of Envisioning, GUM, JIT Objectives

Why-line: name which thesis it touches and how (one sentence).

## Bucket 2 — Industry & startups

- Figma (Make), Vercel v0, Lovable, Bolt, Cursor, Claude Artifacts / Apps,
  ChatGPT Canvas, Google (A2UI, Stitch), Notion AI, Retool — shipping notes,
  changelogs, launch posts touching generated or user-editable UI
- Hacker News front page + "Show HN" — app builders, personal software, local-first
- a16z / Elad Gil / Lenny / Nielsen Norman — essays on generative interfaces,
  agentic UIs, software personalization
- funding news: "generative UI" OR "AI app builder" seed / Series A

Why-line: what the signal is for the research program (adoption, a design pattern
going mainstream, a gap).

## Bucket 2b — Frontier AI, and what people make of it

Asked for on 8 Sep: *"just in general, more news about frontier AI news... I want to
know what's happening with GPT6? what do people think?"* This bucket is about the
**discourse**, not just the release note — what the field is saying about a model,
not only that it shipped. File items from here into the `industry` bucket.

- frontier model releases and the reaction to them: GPT-6, Claude, Gemini, Llama,
  open-weight drops — the capability claims **and** the pushback
- the informal benchmarks the field invents for itself (the "CUA Blender" /
  will-smith-spaghetti genre). These say more about what people believe a model
  can do than the official evals do.
- **world / interface models** — Runway Solaris and anything downstream of it.
  A standing interest, not a one-off: it is the live evidence for *World
  Interface Models*. Always look for what people are *saying* about it, not just
  the launch post.
- where to look beyond the usual: X/Twitter threads from researchers, the
  relevant Reddit threads (r/MachineLearning, r/LocalLLaMA), Hacker News
  discussion (the comments, not only the link), Simon Willison, Interconnects,
  Import AI
- the standing question Bryan keeps returning to: **what is the future of HCI in
  a world driven this hard by AI models?** Anything taking a real position on
  this is worth surfacing even when it is an essay rather than a paper.

Why-line: what the *reaction* tells you, not only what shipped.

## Bucket 3 — HCI pulse

A wider net so the user keeps a feel for the field, not only their niche.

- arXiv cs.HC recent — the 3–4 most-discussed / most interesting papers regardless
  of topic
- CHI / UIST / DIS / CSCW / TOCHI — notable new work, best-paper chatter
- HCI researchers' blogs / Mastodon / Bluesky threads worth surfacing
- adjacent: LLM evaluation of interfaces, agent UX, accessibility of generated UI,
  visualization authoring, creativity support tools

Why-line: one sentence on what it adds to the user's picture of HCI right now.

---

## Papers like *The Interface of Theseus*

Asked for on 14 Sep, naming the paper: *"michael bernstien arcived a paper called
interface of thesueus-- i want to be finding papers like these!!!"* — Michael S.
Bernstein, *The Interface of Theseus: The Rise of Just-In-Time Interfaces*,
arXiv 2609.06770, UIST Visions 2026.

What makes a paper "like this", and why the ordinary sweep missed it:

- **A position, not a system.** Two pages, no study, and a claim about what
  interfaces become when building software is nearly free. The cs.HC listing
  buries these among forty system papers a day, and a relevance pass that rewards
  evidence grades them down. Don't: a vision that takes a real position on
  generative, just-in-time or malleable interfaces is **Core** by default.
- **The venue says so in the comments field** — `UIST Visions`, `alt.chi`,
  "position paper", "vision paper". `sources.mjs arxiv` queries these directly
  (`state/tuning.json` → `watch.comments`) and leads the result with them.
- **Named people.** `watch.authors`, starting with Michael S. Bernstein. Add a
  name whenever Bryan reacts to someone's work this way.
- **It can land on a morning no issue reads.** Theseus was announced on 8 Sep,
  deep in CHI week, and no issue read that listing. Always sweep with
  `--since <the last issue's date> --unseen`, never just the newest day.

Where else to look: the arXiv comments search (`co:"UIST Visions"`); the
pith.science review pages that trail new cs.HC papers; and **the essays that argue
back** — Andreas Kirsch's *The Flawed Ephemeral Software Hypothesis* is the
counter-case to Theseus. When a vision has a serious rebuttal, run them together.

Why-line: the position it takes, and whether Bryan's theses agree with it, extend
it, or hold the answer it leaves open.

---

## Ranking

1. Drop anything whose key is already in `state/seen.json` (feed items; papers use `sources.mjs arxiv --unseen`).
2. Drop anything matching a `state/tuning.json` `mute` term.
3. Boost anything matching a `boost` term or directly advancing a thesis.
4. Within a bucket, order by relevance-to-vision, then recency.
