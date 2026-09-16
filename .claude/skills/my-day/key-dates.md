# Key dates — pins & corrections

**This file is not the key-dates list.** Every run, the skill *discovers* key
dates by searching Gmail, Google Calendar, Notion, `third-year.mrbl`, and the web
(SKILL.md step 3). This file only holds:

1. **Pins** — dates to always include even if the sweep misses them.
2. **Corrections** — an authoritative date that should override whatever the
   sweep finds for the same thing (say so in the label).

Format, one per line:

    YYYY-MM-DD<two-or-more-spaces>Label

Lines starting with `#` or blank are ignored. `build.mjs dates` parses this and
also sweeps `drive/Travel/third-year.mrbl`. Past dates are dropped automatically.
When a run confirms or corrects a date marked "(confirm)" below, rewrite that line.

# --- research CFPs ---
# CHI 2027 full-paper deadline — confirmed Sep 10 2026 (Calendar "Research Bryan",
# Notion Zurich trip page, third-year.mrbl). Submission 2102 "Elicitive UIs" in
# progress, submitting author Eunhye Kim.
2026-09-10  CHI 2027 paper + everything deadline
2027-04-02  UIST 2027 papers deadline (est. — no official CFP yet, per community trackers)
# Doctoral Symposium — no date found yet; check the CHI 2027 site once the DS CFP posts.

# --- add your own pins below, e.g. ---
# 2026-09-28  Ai2 internship starts (already in Calendar; pin only if it moves)
