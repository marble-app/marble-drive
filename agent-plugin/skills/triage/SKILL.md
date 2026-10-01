---
name: triage
description: Use when the owner asks to triage their features, run triage, see what they are building and how far along it is, or refresh the Console's Features view; also when the Console's Run triage button sends you here. Reads every chat, checkout, spec and commit in the workshop, groups them into features, saves the board the Console's Features view draws (spec, plan, build, commit, push, then the owner’s drives, t-bryan and everyone), and answers with a link that opens it. Only on the owner's drive, where the workshop's checkouts are.
---

# Triage the features

The Console's **Features** view draws every change the owner is making to
Marble as a line: Spec → Plan → Build → Commit → Push, then out to the drives
(their own first, then t-bryan, then everyone). The view places each feature on
its stops and drives **from git, by itself**. Your job is the part that needs
judgement: which chats, commits, worktrees and specs are one feature, what it
is called, and what happens next. The spec is the drive page
`Notes and Sketches/Features view`.

`triage.mjs` is next to this file. Use the base directory you were given for
this skill:

```sh
node "<this skill's directory>/triage.mjs" facts      # read everything, ~2 s
node "<this skill's directory>/triage.mjs" board      # the board as last saved
node "<this skill's directory>/triage.mjs" save /tmp/board.json --by <this chat's id if you know it>
```

Run them from the drive (your working directory). If `facts` says no checkout
was found, this is not the owner's workshop drive: say so in one line and stop.

## Steps

1. **Read.** `facts` writes `.marble/console/features-facts.json` and prints
   a summary. Read the facts file's `draft` (a grouping made by rules), its
   `chats`, `commits`, `worktrees` and `specs`, and the saved board (`board`).
   Each chat has `madeCommits` (commits it made), `pushedCommits` (pushed, not
   made), `trees` (worktrees it wrote in), `repoFiles`, `driveDocs`,
   `deploys`, `target` and its first `prompt`.
2. **Group.** Start from the draft and the saved board, then fix them:
   - Merge lines that are one piece of work (a spec page and the commits that
     built it; a run of commits with the same lead, like "Notes:").
   - Split a line that is two things (a long session that shipped several).
   - A feature built into a document of this drive and not into the repo (a
     view added to Agents.mrbl, an app like Calendar.mrbl) is `kind: "drive"`;
     a skill in this drive's `.claude/skills` is `kind: "skill"`. Give those a
     `lives` line: where it lives, in a few words.
   - Leave out the owner's own writing (a day page, a paper, travel notes):
     it is not a feature of Marble.
   - Chats that made nothing you can place go in `loose`.
   - A chat that worked on two features is listed in both; the view shows it
     once with both under it.
3. **Keep what was there.** Reuse the `id` of every feature already on the
   saved board that is still the same work, so the owner's corrections (kept
   by id, under `owner`) stay with it. Never write `owner`: the save keeps it.
4. **Name and say what is next.** Follow the drive's Design Don'ts "Words":
   - `name`: what it is, in plain words, sentence case, no full stop, under
     eight words ("Share links at three levels", "Codex as an agent").
   - `area`: a short group, the same few across the board ("Agents and chat",
     "Notes", "Sharing and the drive", "Hosting", "Console", "Design
     system", "Apps and skills in your drive").
   - `next`: the one next step, as a verb ("Ship to t-bryan and everyone",
     "Commit from the variations-ui worktree", "On every drive"). The owner
     tries changes on their own drive (admin-p2 and the Mac) first, not on
     t-bryan.
   - `wait: true` only when it waits on something outside their hands (a Google
     client, a reply).
   - No made-up facts. If you do not know, leave `next` null.
5. **Save.** Write the board as JSON and run `save`. It refuses a board it
   cannot use and says why; fix that and save again.
6. **Answer.** In a few lines: what moved since the last read (newly pushed,
   newly on a drive, newly started), and what waits on them. End with a link
   that opens the view: `[Open Features in the Console](/a/Console?view=features)`.
   To point at one line, add `&feature=<id>`.

## The board

```json
{
  "areas": ["Agents and chat", "Notes", "Hosting"],
  "features": [{
    "id": "share-links-three-levels",
    "name": "Share links at three levels",
    "area": "Sharing and the drive",
    "kind": "host",
    "commits": ["d1fe89a"],
    "worktrees": [],
    "specs": [], "plans": [],
    "docs": [],
    "chats": [{ "id": "920483843561", "source": "drive" }],
    "lives": null,
    "at": null,
    "next": "Ship to t-bryan and everyone",
    "wait": false
  }],
  "loose": [{ "id": "10d93075a62a", "source": "drive" }],
  "note": "One sentence on what this read found, or null."
}
```

- `commits`: shas, short or full. They decide Commit, Push and every drive.
- `worktrees`: paths from the facts. Loose files in one mean Build.
- `specs`, `plans`: paths from the facts' `specs` (drive pages and repo docs).
- `docs`: drive documents the feature lives in (`Agents`, `Calendar`).
- `chats`: `source` is `drive` (opens in Agents) or `terminal` (a Claude Code
  session; the view shows its folder).
- `at`: only for `drive` and `skill` kinds (usually `build`), or a host feature
  with nothing in git yet (`spec`, `plan`). Leave it null otherwise; git
  decides.
- `areas`: the order the groups appear in.

## Never

- Never deploy, commit, push, pull or switch a branch. Triage only reads.
- Never wake a sleeping sprite or read `~/.config/marble-drive/testers.json`.
- Never print a key or a passphrase.
