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

## Ranking

1. Drop anything whose key is already in `state/seen.json` (feed items only).
2. Drop anything matching a `state/tuning.json` `mute` term.
3. Boost anything matching a `boost` term or directly advancing a thesis.
4. Within a bucket, order by relevance-to-vision, then recency.
